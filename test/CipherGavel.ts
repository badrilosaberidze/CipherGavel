import { CipherGavel, CipherGavel__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

// These run against the in-memory FHEVM mock (`npx hardhat test`): fast, no testnet.
// They prove the winner is the highest bidder, the price is the SECOND-highest (Vickrey)
// and the secret reserve is enforced — without revealing losing bids.

type Signers = {
  seller: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
};

const DEPOSIT = ethers.parseEther("0.001");
const BIDDING_PERIOD = 300; 
const MAX_BIDDERS = 3;

describe("CipherGavel", function () {
  let signers: Signers;

  before(async function () {
    const eth = await ethers.getSigners();
    signers = { seller: eth[0], alice: eth[1], bob: eth[2], carol: eth[3] };
  });

  async function deploy() {
    const factory = (await ethers.getContractFactory("CipherGavel")) as CipherGavel__factory;
    const auction = (await factory
      .connect(signers.seller)
      .deploy(DEPOSIT, BIDDING_PERIOD, MAX_BIDDERS)) as CipherGavel;
    const address = await auction.getAddress();
    return { auction, address };
  }

  async function bid(auction: CipherGavel, address: string, signer: HardhatEthersSigner, value: number) {
    const enc = await fhevm.createEncryptedInput(address, signer.address).add64(value).encrypt();
    await (await auction.connect(signer).placeBid(enc.handles[0], enc.inputProof, { value: DEPOSIT })).wait();
  }

  async function setReserve(auction: CipherGavel, address: string, value: number) {
    const enc = await fhevm.createEncryptedInput(address, signers.seller.address).add64(value).encrypt();
    await (await auction.connect(signers.seller).setReserve(enc.handles[0], enc.inputProof)).wait();
  }

  async function decryptResults(auction: CipherGavel, address: string) {
    const widx = await fhevm.userDecryptEuint(
      FhevmType.euint32, await auction.getWinnerIndexEnc(), address, signers.seller);
    const price = await fhevm.userDecryptEuint(
      FhevmType.euint64, await auction.getClearingPriceEnc(), address, signers.seller);
    const met = await fhevm.userDecryptEuint(
      FhevmType.euint32, await auction.getReserveMetEnc(), address, signers.seller);
    return { widx: Number(widx), price: Number(price), met: Number(met) };
  }

  it("deploys in the Bidding phase", async function () {
    const { auction } = await deploy();
    expect(await auction.phase()).to.eq(0); 
    expect(await auction.seller()).to.eq(signers.seller.address);
  });

  it("winner is the highest bid, price is the SECOND-highest (no reserve)", async function () {
    const { auction, address } = await deploy();
    await bid(auction, address, signers.alice, 100);
    await bid(auction, address, signers.bob, 250);   
    await bid(auction, address, signers.carol, 175); 
    await (await auction.connect(signers.seller).closeAuction()).wait();

    const { widx, price, met } = await decryptResults(auction, address);
    expect(widx).to.eq(1);    
    expect(price).to.eq(175); 
    expect(met).to.eq(1);
  });

  it("secret reserve raises the clearing price to max(secondBid, reserve)", async function () {
    const { auction, address } = await deploy();
    await setReserve(auction, address, 200);
    await bid(auction, address, signers.alice, 100);
    await bid(auction, address, signers.bob, 250);
    await bid(auction, address, signers.carol, 175);
    await (await auction.connect(signers.seller).closeAuction()).wait();

    const { widx, price, met } = await decryptResults(auction, address);
    expect(widx).to.eq(1);    
    expect(price).to.eq(200); 
    expect(met).to.eq(1);
  });

  it("auction fails (privately) when no bid clears the reserve", async function () {
    const { auction, address } = await deploy();
    await setReserve(auction, address, 300); 
    await bid(auction, address, signers.alice, 100);
    await bid(auction, address, signers.bob, 250);
    await (await auction.connect(signers.seller).closeAuction()).wait();

    const { price, met } = await decryptResults(auction, address);
    expect(met).to.eq(0);   
    expect(price).to.eq(0); 

    await (await auction.connect(signers.seller).publishResult(0, 0, false)).wait();
    expect(await auction.winner()).to.eq(ethers.ZeroAddress);
  });

  it("publishes the winner and refunds every deposit", async function () {
    const { auction, address } = await deploy();
    await bid(auction, address, signers.alice, 100);
    await bid(auction, address, signers.bob, 250);
    await bid(auction, address, signers.carol, 175);
    await (await auction.connect(signers.seller).closeAuction()).wait();

    const { widx, price, met } = await decryptResults(auction, address);
    await (await auction.connect(signers.seller).publishResult(widx, price, met === 1)).wait();

    expect(await auction.winner()).to.eq(signers.bob.address);
    expect(await auction.clearingPrice()).to.eq(175);

    const before = await ethers.provider.getBalance(signers.alice.address);
    const tx = await auction.connect(signers.alice).withdrawDeposit();
    const rcpt = await tx.wait();
    const gas = rcpt!.gasUsed * rcpt!.gasPrice;
    const after = await ethers.provider.getBalance(signers.alice.address);
    expect(after).to.eq(before + DEPOSIT - gas); // got the deposit back, minus gas
  });

  it("a bidder can decrypt their OWN bid", async function () {
    const { auction, address } = await deploy();
    await bid(auction, address, signers.alice, 100);
    const aliceBid = await fhevm.userDecryptEuint(
      FhevmType.euint64, await auction.bidAmountAt(0), address, signers.alice);
    expect(Number(aliceBid)).to.eq(100);
  });

  describe("access control & guards", function () {
    it("rejects a wrong deposit amount", async function () {
      const { auction, address } = await deploy();
      const enc = await fhevm.createEncryptedInput(address, signers.alice.address).add64(100).encrypt();
      await expect(
        auction.connect(signers.alice).placeBid(enc.handles[0], enc.inputProof, { value: 1n }),
      ).to.be.revertedWith("Wrong deposit");
    });

    it("rejects a second bid from the same address", async function () {
      const { auction, address } = await deploy();
      await bid(auction, address, signers.alice, 100);
      const enc = await fhevm.createEncryptedInput(address, signers.alice.address).add64(120).encrypt();
      await expect(
        auction.connect(signers.alice).placeBid(enc.handles[0], enc.inputProof, { value: DEPOSIT }),
      ).to.be.revertedWith("Already bid");
    });

    it("only the seller can set the reserve", async function () {
      const { auction, address } = await deploy();
      const enc = await fhevm.createEncryptedInput(address, signers.alice.address).add64(200).encrypt();
      await expect(
        auction.connect(signers.alice).setReserve(enc.handles[0], enc.inputProof),
      ).to.be.revertedWith("Only seller");
    });
  });
});