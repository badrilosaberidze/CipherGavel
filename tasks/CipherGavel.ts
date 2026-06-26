import { CipherGavel } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// Drive a CipherGavel auction from the command line (local node or Sepolia).
// All tasks auto-find the most recently deployed CipherGavel via hardhat-deploy,
// OR you can specify --address to target any auction deployed from the browser.

async function load(hre: HardhatRuntimeEnvironment, accountIndex = 0, addressOverride?: string) {
  let address: string;

  if (addressOverride) {
    address = addressOverride;
    console.log("Targeting contract at:", address);
  } else {
    const dep = await hre.deployments.get("CipherGavel");
    address = dep.address;
    console.log("Using hardhat-deploy contract at:", address);
  }

  const signer = (await hre.ethers.getSigners())[accountIndex];
  const c = (await hre.ethers.getContractAt("CipherGavel", address, signer)) as unknown as CipherGavel;
  return { address, signer, c };
}

task("cg:status", "Show auction phase and bid count")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .setAction(async (args, hre) => {
    const { address, c } = await load(hre, 0, args.address);
    const phases = ["Bidding", "Closed", "Revealed"];
    console.log("phase:     ", phases[Number(await c.phase())]);
    console.log("bidders:   ", `${await c.bidCount()} / ${await c.maxBidders()}`);
    console.log("reserveSet:", await c.reserveSet());
    if (await c.resultPublished()) {
      console.log("winner:    ", await c.winner());
      console.log("price:     ", (await c.clearingPrice()).toString());
    }
  });

task("cg:set-reserve", "Seller sets a SECRET encrypted reserve")
  .addParam("value", "reserve price (encrypted client-side)")
  .addOptionalParam("account", "signer index (default 0 = seller)", "0")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .setAction(async (args, hre) => {
    await hre.fhevm.initializeCLIApi();
    const { address, signer, c } = await load(hre, Number(args.account), args.address);
    const enc = await hre.fhevm.createEncryptedInput(address, signer.address).add64(Number(args.value)).encrypt();
    const tx = await c.setReserve(enc.handles[0], enc.inputProof);
    console.log("setReserve tx:", tx.hash);
    await tx.wait();
    console.log("Secret reserve set (never appears on-chain in cleartext).");
  });

task("cg:bid", "Place an encrypted bid (locks the uniform deposit)")
  .addParam("value", "bid amount (encrypted client-side)")
  .addParam("account", "signer index for this bidder (e.g. 1, 2, 3)")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .setAction(async (args, hre) => {
    await hre.fhevm.initializeCLIApi();
    const { address, signer, c } = await load(hre, Number(args.account), args.address);
    const deposit = await c.depositWei();
    const enc = await hre.fhevm.createEncryptedInput(address, signer.address).add64(Number(args.value)).encrypt();
    const tx = await c.placeBid(enc.handles[0], enc.inputProof, { value: deposit });
    console.log(`placeBid tx: ${tx.hash}  (bidder ${signer.address})`);
    await tx.wait();
    console.log("Encrypted bid submitted. On the explorer the calldata is opaque ciphertext.");
  });

task("cg:close", "Close bidding and compute the encrypted results")
  .addOptionalParam("account", "signer index (default 0 = seller, can close early)", "0")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .setAction(async (args, hre) => {
    const { c } = await load(hre, Number(args.account), args.address);
    const tx = await c.closeAuction();
    console.log("closeAuction tx:", tx.hash);
    await tx.wait();
    console.log("Auction closed. Winner / second-price / reserve-check computed homomorphically.");
  });

task("cg:reveal", "Decrypt the results and (optionally) publish them on-chain")
  .addOptionalParam("account", "signer index (default 0 = seller)", "0")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .addFlag("publish", "also call publishResult on-chain (seller only)")
  .setAction(async (args, hre) => {
    await hre.fhevm.initializeCLIApi();
    const { address, signer, c } = await load(hre, Number(args.account), args.address);

    const winnerIndex = Number(
      await hre.fhevm.userDecryptEuint(FhevmType.euint32, await c.getWinnerIndexEnc(), address, signer),
    );
    const clearingPrice = Number(
      await hre.fhevm.userDecryptEuint(FhevmType.euint64, await c.getClearingPriceEnc(), address, signer),
    );
    const reserveMet =
      Number(await hre.fhevm.userDecryptEuint(FhevmType.euint32, await c.getReserveMetEnc(), address, signer)) === 1;

    const winnerAddr = await c.bidderAt(winnerIndex);
    console.log("\n--- DECRYPTED RESULT ---");
    console.log("reserve met:    ", reserveMet);
    console.log("winner index:   ", winnerIndex, reserveMet ? `(${winnerAddr})` : "(no winner)");
    console.log("clearing price: ", clearingPrice, " <- the SECOND price; losing bids stay secret");
    console.log("------------------------\n");

    if (args.publish) {
      const tx = await c.publishResult(winnerIndex, clearingPrice, reserveMet);
      console.log("publishResult tx:", tx.hash);
      await tx.wait();
      console.log("Result published. Anyone can independently re-decrypt and verify it.");
    }
  });

task("cg:finalize", "TRUSTLESS reveal: decrypt off-chain, verify on-chain via KMS signatures")
  .addOptionalParam("account", "signer index (default 0)", "0")
  .addOptionalParam("address", "auction contract address (default: hardhat-deploy)")
  .setAction(async (args, hre) => {
    await hre.fhevm.initializeCLIApi();
    const { c } = await load(hre, Number(args.account), args.address);

    const handles = [
      await c.getWinnerIndexEnc(),
      await c.getClearingPriceEnc(),
      await c.getReserveMetEnc(),
    ];

    const res: any = await (hre.fhevm as any).publicDecrypt(handles);
    console.log("decrypted values:", res.clearValues);

    const tx = await c.finalize(res.abiEncodedClearValues, res.decryptionProof);
    console.log("finalize tx:", tx.hash);
    await tx.wait();
    console.log("Verified on-chain via KMS signatures and settled — zero trust in the seller.");
  });