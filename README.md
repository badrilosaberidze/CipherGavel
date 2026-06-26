# CipherGavel

> A fully confidential sealed-bid **Vickrey (second-price) auction** on Zama's FHEVM.

Every bid — and even the seller's reserve price — is encrypted end-to-end. The winner and the
second-highest (clearing) price are computed **directly on the encrypted bids** and are the only
values ever revealed. Losing bids, and even the winner's own bid, stay encrypted forever.

**Live on Sepolia (verified):** [`0x9DC139B8737eFC64e71DE053dE80C37fd7689606`](https://sepolia.etherscan.io/address/0x9DC139B8737eFC64e71DE053dE80C37fd7689606)

For the full design rationale, threat model, and cryptographic justification, see [`WRITEUP.md`](./WRITEUP.md).

---

## What makes it different

- **Two-sided privacy** — not just hidden bids; the seller's reserve price is encrypted too, so neither side's strategy leaks.
- **True second-price (Vickrey)** — the winner pays `max(second-highest bid, reserve)`, computed homomorphically on ciphertext.
- **MEV-immune by design** — encrypted calldata means there is nothing in the mempool to front-run or reorder for profit.
- **Leak-free anti-grief** — a uniform, refundable deposit deters spam while revealing nothing about bid size.
- **Trustless settlement** — the result is verified on-chain via KMS signatures (`FHE.checkSignatures`), so no participant has to be trusted to report it honestly.

## How it works (in one minute)

1. A seller **creates** an auction (one contract instance per auction) and optionally sets an **encrypted reserve**.
2. Bidders **place encrypted bids**, each locking an identical refundable deposit.
3. Anyone closes the auction after the deadline (the seller may close early). `closeAuction` runs an
   oblivious, branch-free fold over the ciphertexts to compute the encrypted winner, second price, and reserve-met flag.
4. Anyone **finalizes**: results are decrypted off-chain through the relayer and the KMS signature is verified
   on-chain, revealing only the winner, the clearing price, and whether it sold.
5. Bidders **withdraw** their deposits.

## Tech stack

- **Contracts:** Solidity `0.8.27`, [Zama FHEVM](https://docs.zama.org/protocol) (`@fhevm/solidity` v0.11.x)
- **Tooling:** Hardhat v2, `hardhat-deploy`, TypeChain, ethers v6, TypeScript
- **Frontend:** Vite + React + TypeScript, Framer Motion, `@zama-fhe/relayer-sdk` (in-browser FHE encryption/decryption)

This is a **two-package repo**: a Hardhat project at the root and a Vite app in `frontend/` (its own `package.json`).

## Repository layout

```
CipherGavel/
├── contracts/CipherGavel.sol      the auction contract
├── deploy/                        hardhat-deploy script
├── tasks/CipherGavel.ts           CLI tasks (cg:*) for driving an auction
├── test/CipherGavel.ts            mock-mode test suite
├── hardhat.config.ts
├── WRITEUP.md                     the academic write-up (design + threat model)
├── DEMO_GUIDE.md                  step-by-step demo walkthrough
└── frontend/                      Vite + React dApp
    └── src/
        ├── pages/                 Home, Create, Auction
        ├── fhevm.ts               browser FHE instance (relayer SDK)
        ├── wallet.tsx             MetaMask connection (EIP-6963)
        └── contract.ts           ABI + bytecode + network config
```

---

## Prerequisites

- **Node.js** 20 or 22 (even-numbered LTS)
- A wallet with **Sepolia ETH** (e.g. via [a Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia))
- **MetaMask** in your browser to use the web app

## Setup

Clone and install the Hardhat project at the root:

```bash
git clone https://github.com/badrilosaberidze/CipherGavel.git
cd CipherGavel
npm install
```

Configure the Hardhat variables used for the Sepolia network and verification (stored encrypted by Hardhat, not in `.env`):

```bash
npx hardhat vars set MNEMONIC          # 12-word seed phrase (funds account 0 = deployer/seller)
npx hardhat vars set INFURA_API_KEY    # Infura project key for the Sepolia RPC
npx hardhat vars set ETHERSCAN_API_KEY # only needed for `verify`
```

Compile and run the tests (mock FHEVM, fast, no testnet needed):

```bash
npx hardhat compile
npx hardhat test
```

---

## Running the web app

The browser app is the primary way to use CipherGavel. It deploys a new auction per session and performs
all encryption client-side.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Then, in the browser:

1. **Connect MetaMask** (top-right). The app will prompt you to switch to **Sepolia** automatically.
2. **Create an auction** — go to *Create Auction*, set the deposit, bidding period, and max bidders
   (keep this small, e.g. `3`; see the HCU note below), then *Deploy*. You become the **seller**, and the
   app routes you to `/auction/<address>`.
3. **Set the secret reserve** (seller only) — enter a reserve in ETH; it is encrypted in the browser and sealed on-chain.
4. **Place a sealed bid** (anyone) — enter a bid in ETH. It is encrypted client-side and submitted with the uniform deposit.
5. **Close** the auction — the seller can close any time; anyone can close after the deadline.
6. **Finalize** (anyone) — decrypts the results through the relayer and verifies the KMS signature on-chain,
   revealing the winner, clearing price, and whether it sold.
7. **Withdraw deposit** — each bidder reclaims their deposit after the reveal.

> Share the `/auction/<address>` URL so other accounts (or people) can join and bid on the same auction.

> **Tip:** if you have another wallet extension (e.g. Phantom, Hinkal) hijacking the page, set MetaMask as
> your default or disable the others — the app targets MetaMask specifically via EIP-6963.

---

## Deploying your own instance (optional)

You can also deploy and verify from the CLI:

```bash
# deploy (constructor: depositWei, biddingPeriodSeconds, maxBidders)
npx hardhat deploy --network sepolia

# verify on Etherscan
npx hardhat verify --network sepolia <address> <depositWei> <periodSeconds> 3
```

`hardhat-deploy` records the address and ABI under `deployments/sepolia/`. To force a fresh instance,
`rm -rf deployments/sepolia` before deploying.

## Driving an auction from the CLI (alternative)

Every encrypted operation also has a CLI task (handy for scripting multi-bidder runs). Tasks auto-discover
the most recently deployed contract, or accept `--address <auction>`:

```bash
npx hardhat cg:status      --network sepolia          # always check the phase first
npx hardhat cg:set-reserve --value 200 --network sepolia
npx hardhat cg:bid         --value 100 --account 1 --network sepolia
npx hardhat cg:bid         --value 250 --account 2 --network sepolia
npx hardhat cg:bid         --value 175 --account 3 --network sepolia
npx hardhat cg:close       --network sepolia
npx hardhat cg:finalize    --network sepolia          # trustless reveal
npx hardhat cg:fund-bidders --network sepolia         # fund bidder accounts from account 0
```

See [`DEMO_GUIDE.md`](./DEMO_GUIDE.md) for a complete walkthrough.

For **local development**, run a mock node with `npx hardhat node` in one terminal and use `--network localhost` in another.

---

## Notes & gotchas

- **HCU limit.** `closeAuction` performs O(n) sequential homomorphic comparisons, and FHEVM caps the
  homomorphic complexity per transaction. Keep `maxBidders` small (3) for live Sepolia runs. Scaling to
  larger auctions (tournament reduction / batched close) is documented as future work in the write-up.
- **Phase errors are expected.** "Not bidding" / "Not closed" reverts mean the targeted contract is past
  that phase — run `cg:status` to check.
- **Reveal model.** This FHEVM generation uses the self-relay model (`makePubliclyDecryptable` →
  off-chain `publicDecrypt` → on-chain `FHE.checkSignatures`), not the old decryption oracle.

## License

BSD-3-Clause-Clear (matching the Zama FHE libraries). Scaffolded from
[Zama's fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template).
