# CipherGavel Demo Guide

A complete, end-to-end walkthrough of a confidential auction. **Every step — including the encrypted
ones (bids, reserve, finalize) — works directly in the browser.** A CLI path is provided as an
alternative for scripting multi-bidder runs.

> Encryption happens client-side via Zama's relayer SDK. On a block explorer, bids and the reserve appear
> as opaque ciphertext.

---

## Prerequisites

- MetaMask installed, with **Sepolia ETH** in your account(s).
- The dApp running locally:

  ```bash
  cd frontend
  npm install
  npm run dev          # http://localhost:5173
  ```

- (Optional, for the CLI path) the Hardhat project set up at the repo root — see the main [README](./README.md).
  To fund extra bidder accounts from account 0:

  ```bash
  npx hardhat cg:fund-bidders --network sepolia
  ```

---

## Browser walkthrough (recommended)

### Step 1 — Create the auction

1. Open http://localhost:5173 and click **Connect MetaMask** (top-right). Approve the Sepolia network switch if prompted.
2. Go to **Create Auction** and fill the form:
   - **Deposit:** `0.001` ETH
   - **Bidding period:** `600` seconds (10 min)
   - **Max bidders:** `3` (keep small — see the HCU note in the README)
3. Click **Deploy Auction** and confirm in MetaMask.
4. You're routed to `/auction/<address>` — you are now the **seller**. Share this URL so others can bid.

### Step 2 — Set the secret reserve (seller)

In the auction console, enter a **Secret Reserve** in ETH (e.g. `0.0002`) and click **Set Secret Reserve**.
The value is encrypted in the browser and sealed on-chain. The panel shows *Reserve: set · sealed*.

### Step 3 — Place sealed bids (anyone)

Enter a bid in ETH and click **Place Bid (sealed)**. Each bidder locks the uniform deposit.
To simulate multiple bidders, switch the account in MetaMask (or open the URL from another wallet) and bid again.

For example: `0.0001`, `0.00025`, `0.000175` from three different accounts. The panel shows *Bids: 3 / 3*
and a sealed card per bidder.

> All browser bids are entered in **ETH** and encrypted as wei. Don't mix browser bids and CLI bids on the
> *same* auction — the CLI uses raw integer units (see below), so the scales won't match.

### Step 4 — Close the auction

The **seller** can close any time; **anyone** can close after the bidding deadline. Click **Close Auction**
and confirm. This runs the homomorphic Vickrey computation on the encrypted bids (winner, second price,
reserve check) — all on ciphertext. The phase becomes *Closed*.

### Step 5 — Finalize (trustless reveal, anyone)

Click **Finalize (trustless)**. The browser decrypts the three encrypted results through the relayer,
receives the cleartext plus a KMS signature, and submits them to `finalize()`, which **verifies the KMS
signature on-chain** before recording the outcome. The phase becomes *Revealed* and the verdict panel shows:

- **Winner:** the highest bidder's address
- **Clearing price:** the second-highest bid (or the reserve, if only one bid cleared it)
- **Sold / not sold**

### Step 6 — Withdraw deposits

As any bidder, click **Withdraw Deposit** to reclaim the uniform deposit (refunded via the
checks-effects-interactions pattern).

---

## CLI path (alternative)

Useful for scripting a multi-bidder run from a single machine. Tasks auto-discover the most recently
deployed contract, or take `--address <auction>`. Note `--value` here is a **raw integer** (not ETH).

```bash
npx hardhat cg:status      --network sepolia          # always check the phase first
npx hardhat cg:set-reserve --value 200 --network sepolia
npx hardhat cg:bid         --value 100 --account 1 --network sepolia
npx hardhat cg:bid         --value 250 --account 2 --network sepolia
npx hardhat cg:bid         --value 175 --account 3 --network sepolia
npx hardhat cg:close       --network sepolia
npx hardhat cg:finalize    --network sepolia          # trustless reveal
```

Expected `finalize` output (winner index, clearing price, reserve-met):

```
decrypted values: [ 1n, 175n, 1n ]
  winner index:   1   (the account that bid 250)
  clearing price: 175 (the second-highest bid)
  reserve met:    true
```

### How CLI accounts work

Hardhat derives accounts from your `MNEMONIC` (HD wallet):

- **Account 0** — deployer / seller
- **Accounts 1, 2, 3** — bidders

List addresses with `npx hardhat accounts --network sepolia`.

---

## Troubleshooting

**"Please switch your wallet to Sepolia."** The app sends transactions on Sepolia only. Approve the network
switch, or switch manually in MetaMask. If a wrapper extension (e.g. Hinkal) ignores the switch, set
MetaMask as your default wallet or disable the other extension.

**Reconnecting to the same account.** Use **Disconnect**, then **Connect** again — MetaMask's account picker
will appear so you can choose a different address.

**"Not bidding" / "Not closed" errors.** The targeted contract is past that phase (often a stale address).
Check with `npx hardhat cg:status --network sepolia`.

**Tasks can't find the contract / want a fresh one.**

```bash
rm -rf deployments/sepolia
npx hardhat deploy --network sepolia
```

**Out of Sepolia ETH.** Use a faucet (e.g. https://www.alchemy.com/faucets/ethereum-sepolia) or
`npx hardhat cg:fund-bidders --network sepolia`.

---

## What this demonstrates

- A confidential, end-to-end **encrypted Vickrey auction** with a **secret reserve**.
- The homomorphic close: winner and second price computed **on ciphertext**, never decrypting individual bids.
- **Trustless finalization** via on-chain KMS-signature verification.
- A full browser dApp plus a CLI, both deployed against a **verified live contract on Sepolia**.
