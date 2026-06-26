# CLAUDE.md — CipherGavel

Context for continuing this project in Claude Code. Read this fully before making changes.

---

## 1. What this is

**CipherGavel** is a confidential sealed-bid **Vickrey (second-price) auction** built on **Zama's FHEVM** (Fully Homomorphic Encryption on the EVM). It's a university final project for a "Privacy on Blockchain" course. The graded rubric: privacy correctness 30%, engineering 20%, crypto choices 20%, demo 15%, originality 15%.

**Core idea:** every bid — and the seller's reserve price — is encrypted end-to-end. The contract computes the winner and the second-highest price *directly on the ciphertext* and never decrypts an individual bid. Only the winner, the clearing price, and a "sold/not-sold" flag are ever revealed.

**Originality twists (all implemented):**
- Two-sided privacy: the seller's reserve is also encrypted (not just the bids).
- True Vickrey: winner pays `max(second-highest bid, reserve)`, computed homomorphically.
- MEV-immune by construction (encrypted calldata → nothing to front-run).
- Uniform refundable deposit (leak-free anti-grief — equal for all, so it reveals nothing about bid size).
- Leak-free tie-break (strict `>` → earliest bidder wins, equality never revealed).
- **Trustless settlement** via on-chain KMS signature verification (`FHE.checkSignatures`).

**Honest limitation (documented, not a bug):** FHE hides bid *values*, not the *sender*. Bidder addresses are public. Full bidder anonymity would need an added ZK/shielded layer — this is future-work, NOT something to build (the brief says pick one primitive; we chose FHE).

---

## 2. Current status

We've been building in incremental, committed steps. Done so far:

- ✅ Contract complete: encrypted bidding, secret reserve, homomorphic Vickrey close, verifiable reveal, trustless finalize, deposit refunds.
- ✅ Mock-mode test suite passing (`test/CipherGavel.ts`).
- ✅ Deploy script + CLI tasks (`deploy/`, `tasks/`).
- ✅ **Deployed AND verified on Sepolia.** The auction has been driven end-to-end on Sepolia via the CLI (bid → close → finalize), with real encryption.
- ✅ Frontend: a polished, animated visual shell (Vite + React + TS + Framer Motion) with the design system in place.
- ✅ Frontend ↔ chain (read side): a "Live on Sepolia" panel reads the deployed contract's state via a public RPC; MetaMask wallet connection works (shared across navbar + panel, MetaMask-specific via EIP-6963).

**Where we are: step 10 (UI wiring).** The read + wallet half is done. The **write half — placing encrypted bids/reserve from the browser** — is NOT done. That's the next big technical piece (see §9), and it's the most fragile part (browser relayer-SDK + WASM).

**Still required and NOT started: the write-up (§10).**

---

## 3. Tech stack & versions — READ THIS, it's version-specific

The FHEVM API changed across versions and most online tutorials are out of date. The installed versions matter:

- `@fhevm/solidity` **^0.11.x** (this is the FHEVM "v0.9-generation"). Key consequences:
  - Config contract is **`ZamaEthereumConfig`**, imported from `@fhevm/solidity/config/ZamaConfig.sol`. **`SepoliaConfig` was REMOVED** — do not use it. The contract does `contract CipherGavel is ZamaEthereumConfig`.
  - The old decryption **oracle (`FHE.requestDecryption`) is GONE.** Reveal works via the self-relay model: `FHE.makePubliclyDecryptable(handle)` on-chain → off-chain `publicDecrypt` (relayer SDK or hardhat plugin) → `FHE.checkSignatures(...)` on-chain verification. This is what `finalize()` uses.
- `@fhevm/hardhat-plugin` ^0.4.x — provides mock FHEVM for tests and `hre.fhevm` in tasks.
- `@zama-fhe/relayer-sdk` (browser encryption/decryption — used in the NEXT step, not yet wired).
- `hardhat` ^2.28.x (Hardhat **v2**, not v3 — do not let `npx` pull v3), `hardhat-deploy` ^0.11.x.
- `ethers` **v6** (note: `ethers.BrowserProvider`, `parseEther`, bigints).
- Solidity `^0.8.24` (compiler 0.8.27).
- Frontend: Vite + React 18 + TypeScript (with `verbatimModuleSyntax` on), Framer Motion, lucide-react optional.
- Node: even-numbered LTS (20 or 22).

This is a **two-package repo**: the Hardhat project at the root, and a Vite app in `frontend/` (its own `package.json`). Run Hardhat commands from the root; run `npm run dev` from `frontend/`.

---

## 4. Repository layout

```
ciphergavel/                      (repo root — Hardhat project)
├── contracts/CipherGavel.sol     the auction contract
├── deploy/01_deploy_ciphergavel.ts   hardhat-deploy script
├── tasks/CipherGavel.ts          CLI tasks (cg:*), registered in hardhat.config.ts
├── test/CipherGavel.ts           mock-mode test suite
├── deployments/sepolia/          hardhat-deploy records the live address+ABI here
├── hardhat.config.ts             imports "./tasks/CipherGavel"; etherscan v2 key; sourcify off
├── docs/                         (write-up goes here)
└── frontend/                     (Vite + React app — its own package.json)
    ├── index.html                Google Fonts: Fraunces, Hanken Grotesk, IBM Plex Mono
    └── src/
        ├── main.tsx              wraps <App/> in <WalletProvider>
        ├── App.tsx               hero, mock auction floor, verdict, privacy ledger, Live section
        ├── index.css             the design system (see §8)
        ├── mock.ts               mock auction state + Vickrey settle() (for the demo floor)
        ├── contract.ts           CONTRACT_ADDRESS, ABI (read getters), PUBLIC_RPC, SEPOLIA_CHAIN_ID, PHASES
        ├── wallet.tsx            shared MetaMask connection (EIP-6963), useWallet() context
        └── components/
            ├── WaxSeal.tsx        the signature wax-seal SVG (animated)
            └── LiveStatus.tsx     reads live contract state from Sepolia
```

---

## 5. The contract (interface reference)

`contracts/CipherGavel.sol`. Phases: `Bidding → Closed → Revealed`.

Constructor: `constructor(uint256 depositWei, uint256 biddingPeriodSeconds, uint8 maxBidders)` — deployer becomes `seller`. **Keep `maxBidders` small (3)** — see HCU note in §7.

Functions (access in brackets):
- `setReserve(externalEuint64 encReserve, bytes inputProof)` [seller, Bidding] — encrypted secret reserve.
- `placeBid(externalEuint64 encBid, bytes inputProof) payable` [anyone, Bidding, exact `depositWei`, one per address, up to `maxBidders`] — encrypted bid.
- `closeAuction()` [seller anytime, OR anyone after `biddingDeadline`; Bidding→Closed] — homomorphic Vickrey: computes encrypted winner index, second price, reserve-met; marks results `makePubliclyDecryptable`; grants seller ACL.
- `publishResult(uint32 winnerIndex, uint64 clearingPrice, bool reserveMet)` [seller, Closed→Revealed] — trust-based reveal (verifiable because results are publicly decryptable). Kept as a fallback.
- `finalize(bytes abiEncodedCleartexts, bytes decryptionProof)` [**anyone**, Closed→Revealed] — TRUSTLESS reveal: verifies KMS signatures via `FHE.checkSignatures`, then settles. This is the preferred reveal path.
- `withdrawDeposit()` [any bidder, Revealed] — refunds the uniform deposit (checks-effects-interactions).

Public getters / state: `phase()`, `seller()`, `depositWei()`, `biddingDeadline()`, `maxBidders()`, `bidCount()`, `bidderAt(i)`, `bidAmountAt(i)` (encrypted handle), `reserveSet()`, `resultPublished()`, `winner()`, `clearingPrice()`, `reserveMet()`, and encrypted getters `getWinnerIndexEnc()`, `getClearingPriceEnc()`, `getReserveMetEnc()`.

Note for the UI: the contract enforces "seller can close anytime; anyone can close after the deadline" and "anyone can finalize." This matches the desired UX (creator-only close button while bidding open; finalize available to everyone once closed).

---

## 6. Build / test / deploy / run

From the repo root:
```bash
npm install
npx hardhat compile
npx hardhat test                         # mock-mode tests, fast, no testnet
npx hardhat deploy --network sepolia      # deploy (needs vars: MNEMONIC, INFURA_API_KEY)
npx hardhat verify --network sepolia <addr> 1000000000000000 <period> 3
```
Drive an auction on Sepolia (tasks auto-find the deployed address via hardhat-deploy):
```bash
npx hardhat cg:status   --network sepolia    # ALWAYS check phase first — must be "Bidding"
npx hardhat cg:set-reserve --value 200 --network sepolia
npx hardhat cg:bid --value 100 --account 1 --network sepolia
npx hardhat cg:bid --value 250 --account 2 --network sepolia
npx hardhat cg:bid --value 175 --account 3 --network sepolia
npx hardhat cg:close    --network sepolia
npx hardhat cg:finalize --network sepolia    # trustless reveal
npx hardhat cg:fund-bidders --network sepolia  # one-time: fund bidder accounts from account 0
```
Frontend:
```bash
cd frontend && npm install && npm run dev      # http://localhost:5173
```
Local testing uses a mock FHEVM node: `npx hardhat node` in one terminal, `--network localhost` in another.

---

## 7. Critical gotchas (these WILL bite you)

- **`ZamaEthereumConfig`, not `SepoliaConfig`** (see §3). Most tutorials are wrong about this.
- **Reveal model is self-relay, not oracle** (see §3). `finalize()` uses `makePubliclyDecryptable` + `checkSignatures`.
- **Tasks using FHE must call `await hre.fhevm.initializeCLIApi()`** before `createEncryptedInput`/`userDecryptEuint`.
- **HCU limit:** `closeAuction` does O(n) sequential FHE comparisons; FHEVM caps homomorphic complexity per tx (~5,000,000 HCU). Keep `maxBidders = 3` for live runs. Scaling = tournament reduction / batched close (future work).
- **hardhat-deploy reuses the contract** unless the artifact changes — it prints "reusing ... at 0x...". To force a fresh instance: `rm -rf deployments/sepolia && npx hardhat deploy --network sepolia`.
- **Phase errors are correct behavior.** "Not bidding" / "Not closed" reverts mean you're targeting a contract past that phase (often a stale/old deployment). Run `cg:status` first.
- **Keep `frontend/src/contract.ts` `CONTRACT_ADDRESS` in sync** with the deployed address. When you redeploy, update it.
- **Frontend uses `verbatimModuleSyntax`:** import types with `import type { X }`, values with `import { y }`. Mixing them in one import breaks at runtime.
- **MetaMask selection:** other wallet extensions hijack `window.ethereum`. `wallet.tsx` uses EIP-6963 to target MetaMask specifically. Keep that.
- **Folder trap:** Hardhat commands from repo root; `npm run dev` from `frontend/`. Check the shell path before running.
- This project runs locally with full network access (unlike the environment it was first scaffolded in) — so you CAN compile, test, deploy, and run. Do so to verify changes.

---

## 8. Conventions

**Commits:** one focused commit per logical step, conventional style — `feat:`, `chore:`, `test:`, `docs:`, `style:`. Keep the history readable; the repo's commit history is itself part of the grade. Push after each.

**Design system** (in `frontend/src/index.css`) — keep new UI consistent with it. Concept: "The Classified Catalog" — a luxury auction catalog, sealed by encryption.
- Colors: aubergine-ink bg `--ink #0d0a12`, ivory text `--ivory #efe6d6`, single brass accent `--brass #c8a24a`, sealing-wax red `--wax #9e2b25` (reserved for the seal). Color encodes meaning: dark/sealed = encrypted, ivory "paper" = the revealed verdict.
- Type: Fraunces (display serif), Hanken Grotesk (body), IBM Plex Mono (data/ciphertext/addresses).
- Signature: the wax seal + redaction bars. Reuse `WaxSeal.tsx` and existing classes (`.console`, `.btn`, `.pill`, `.verdict`, `.paddle`, `.redaction`, `.ledger`).
- Respect `prefers-reduced-motion` (already handled in CSS).

---

## 9. NEXT STEPS — the interactive dApp (primary task)

Goal: turn the UI from a read-only mirror into a full multi-auction dApp. **Roles:** the *creator* of an auction is its seller; anyone can join and bid; only the creator (or anyone after the deadline) can close; anyone can finalize.

Recommended architecture (matches the current single-auction-per-deploy contract): **deploy one CipherGavel instance per auction, from the browser.** Route the app by auction address.

Build it in committed steps:

**Step A — export contract artifacts to the frontend.** The browser needs the ABI *and* bytecode to deploy. After `npx hardhat compile`, copy `artifacts/contracts/CipherGavel.sol/CipherGavel.json` into `frontend/src/` (e.g. `CipherGavel.json`) — or add a small script/postcompile hook to sync it. Replace the hand-written read-only ABI in `contract.ts` with the full ABI from this file (it includes write functions too).

**Step B — wallet-aware routing & pages.** Add a tiny router (or simple state): Home (list/enter an auction by address), Create, and Auction view (`/auction/:address`). Reuse `useWallet()`.

**Step C — Create Auction page.** A form for `depositWei`, `biddingPeriodSeconds`, `maxBidders` (default 3), and a "Create" button that deploys from the browser:
```ts
const factory = new ethers.ContractFactory(abi, bytecode, signer);
const c = await factory.deploy(depositWei, biddingPeriodSeconds, maxBidders);
await c.waitForDeployment();
const address = await c.getAddress();   // route to /auction/:address
```
The connected wallet (signer) becomes the `seller`. Persist the address (URL + optionally a localStorage-free in-memory list / or a simple on-page list).

**Step D — in-browser encryption (the hard part).** This is the fragile, WASM-heavy piece. Use `@zama-fhe/relayer-sdk`:
```ts
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
const instance = await createInstance(SepoliaConfig);  // boots WASM + fetches keys
const enc = await instance
  .createEncryptedInput(auctionAddress, userAddress)
  .add64(bidValue)
  .encrypt();                                          // → { handles, inputProof }
await auction.placeBid(enc.handles[0], enc.inputProof, { value: depositWei });
```
Known pitfalls (budget time for these): Vite must bundle the SDK's WASM (you may need the `/web` bundle, vite WASM/top-level-await handling, and/or `optimizeDeps` excludes); common errors are `Cannot read properties of undefined (reading '__wbindgen_malloc')` (WASM not loaded) and `Impossible to fetch public key: wrong relayer url` (config). `SepoliaConfig` carries the correct relayer/ACL/KMS addresses. Verify `instance.createEncryptedInput` exists before using it. The CLI tasks already prove the same operations work via `@fhevm/hardhat-plugin` — mirror their behavior.

**Step E — auction controls, gated by role.** On the Auction page, read `seller()` and compare to the connected address:
- Bid form (encrypted, Step D) — shown to everyone while `phase == Bidding`.
- Set secret reserve (encrypted) — shown only to the creator (seller), while Bidding.
- Close button — shown to the creator anytime; to others only after `biddingDeadline`. Calls `closeAuction()`.
- Finalize button — shown to everyone once `phase == Closed`. Off-chain `instance.publicDecrypt([h1,h2,h3])` → `{ handles, abiEncodedCleartexts/clearValues, decryptionProof }` → `auction.finalize(abiEncodedCleartexts, decryptionProof)`. (The contract's `finalize` expects the three result handles in the order: winnerIndex, clearingPrice, reserveMet — already encoded in the contract.)
- After Revealed: show winner + clearing price (reuse the `.verdict` styling). Bidders can `withdrawDeposit()`.

**Step F — generalize LiveStatus.** It currently reads a single hard-coded `CONTRACT_ADDRESS`. Parametrize it to read the routed auction address so it reflects whichever auction is open.

Keep the existing mock "floor" + hero as the marketing/demo front; the new pages are the functional dApp. Maintain the design system throughout.

---

## 10. Still pending: the write-up (required deliverable)

A 4–8 page write-up is required and **not yet written**. It must cover: threat model (who sees what; the `publishResult` trust gap and how `finalize`/`checkSignatures` closes it; the honest "addresses are public" limitation), architecture + data flow, and cryptographic-choice justification (why FHE over ZK/MPC/TEE; why Vickrey; the HCU tradeoff; why a uniform deposit; the FHE-vs-ZK-shielded-pool comparison as future work for bidder anonymity). Put it in `docs/WRITEUP.md`. This is high-value and low-risk; prioritize it before the deadline if UI work is at risk of running long.

The project is already complete and gradeable as-is (working confidential auction + verified live contract on Sepolia + trustless settlement + tests + UI shell). The interactive dApp in §9 is enhancement, not a requirement.
