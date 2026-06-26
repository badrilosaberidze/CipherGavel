# CipherGavel: A Fully Confidential Sealed-Bid Vickrey Auction on FHEVM

**Author:** Badri Losaberidze
**Course:** Privacy on Blockchain — Final Project
**Repository:** https://github.com/badrilosaberidze/CipherGavel
**Deployed contract (Sepolia, verified):** [`0x9DC139B8737eFC64e71DE053dE80C37fd7689606`](https://sepolia.etherscan.io/address/0x9DC139B8737eFC64e71DE053dE80C37fd7689606)

---

## Abstract

CipherGavel is a sealed-bid auction in which every bid — and the seller's reserve price — remains encrypted from submission through settlement. Built on Zama's FHEVM (Fully Homomorphic Encryption on the Ethereum Virtual Machine), the contract determines the winner and the second-highest price by computing *directly on ciphertexts*; it never decrypts any individual bid. At settlement, only three facts become public: the winning address, the clearing price, and whether the item sold. Every losing bid, and even the winner's own bid, stays encrypted permanently.

The privacy primitive is fully homomorphic encryption, chosen over zero-knowledge proofs, secure multi-party computation, and trusted execution environments for reasons developed in Section 7. The headline design decision that distinguishes this project from a conventional sealed-bid auction is *two-sided privacy*: not only are bidders hidden from one another, the seller's reserve is hidden too, so neither side's strategy leaks. The auction is a true Vickrey (second-price) mechanism, generalised correctly to a secret reserve, and it concludes with a fully *trustless* on-chain settlement that verifies a key-management-network signature rather than trusting any party to report the result honestly.

This document presents the auction mechanics, the cryptographic architecture, a detailed threat model, the rationale behind each cryptographic and engineering choice, and an honest account of the system's limitations and the work that would extend it.

---

## 1. Motivation

Public blockchains are radically transparent by design: every transaction, its sender, and its calldata are visible to anyone. That transparency is the source of their trustworthiness, but it is fatal to any application whose correctness depends on participants *not* seeing each other's inputs. Auctions are the canonical example.

A sealed-bid auction only works if the bids are genuinely sealed. On a naïve on-chain implementation, "sealed" bids submitted as plaintext are visible in the mempool and in calldata the moment they are broadcast, so every bidder can see every other bid before the auction closes and adjust accordingly — which collapses the mechanism entirely. Even commit–reveal schemes, the usual workaround, leak on reveal and require a trusted reveal step. Worse, on a public ledger the ordering of transactions is itself a contested resource: a searcher or the block proposer can observe a pending bid and front-run it. This is the well-known problem of maximal extractable value (MEV).

CipherGavel addresses both problems at their root. Because bids are encrypted before they ever leave the bidder's machine and are *never* decrypted on-chain, there is nothing in the mempool or calldata for anyone — competing bidder, searcher, or validator — to read or to profitably reorder. The auction is, in a precise sense developed in Section 6.1, MEV-immune by construction.

---

## 2. Auction mechanics

A Vickrey auction is a sealed-bid auction in which the highest bidder wins but pays the **second-highest** price. Its theoretical appeal is that truthful bidding is a (weakly) dominant strategy: a rational bidder maximises expected utility by bidding exactly their private valuation, with no incentive to shade their bid. This removes the strategic second-guessing that characterises first-price auctions and pairs naturally with privacy — if the mechanism already rewards honest valuation, hiding the bids removes the remaining avenue for gaming.

CipherGavel augments the classic mechanism with a **secret reserve price** `r`, chosen by the seller and kept encrypted. The settlement rule becomes:

- Let `b(1) ≥ b(2) ≥ …` be the submitted bids in descending order.
- If `b(1) ≥ r`, the highest bidder wins and pays `clearing = max(b(2), r)`.
- If `b(1) < r`, the auction fails: there is no winner, and nothing about `r` or any bid is disclosed.

The term `max(b(2), r)` is the economically correct generalisation of the second price to a reserve: with a single qualifying bid (so `b(2) = 0`), the winner pays the reserve rather than nothing; with two or more bids above the reserve, the winner pays the second-highest bid. Both branches are computed homomorphically, on ciphertexts, in Section 6.

---

## 3. Cryptographic foundations

This section gives just enough background to make the architecture legible.

**Fully homomorphic encryption (FHE)** is encryption that supports computation on ciphertext. Given encryptions of `x` and `y`, one can compute an encryption of `f(x, y)` — for example `x + y`, or the boolean `x > y` — without ever decrypting, and without learning `x`, `y`, or the result. FHEVM exposes this capability inside Solidity through encrypted integer types (`euint64`, `euint32`) and an encrypted boolean (`ebool`), along with operations such as `FHE.add`, `FHE.gt`, `FHE.ge`, `FHE.max`, and the conditional `FHE.select`. A contract can therefore evaluate a function of many users' secret inputs while the inputs, intermediate values, and outputs all remain ciphertext.

**Encrypted inputs and input proofs.** A user encrypts a value on their own device under the network's public key, producing a compact ciphertext *handle* and a zero-knowledge *input proof*. The proof attests, without revealing the value, that the ciphertext is well-formed, that it was produced by this sender, and that it is bound to this specific contract. On-chain, `FHE.fromExternal(handle, proof)` verifies the proof and imports the value; a malformed or replayed input is rejected. This is how the contract can simultaneously *trust that an input is legitimate* and *never see it*.

**The access-control list (ACL).** An FHEVM ciphertext can only ever be decrypted by addresses explicitly granted access. `FHE.allowThis(x)` lets the contract reuse a ciphertext in later transactions; `FHE.allow(x, addr)` grants a specific address the right to decrypt; `FHE.makePubliclyDecryptable(x)` makes a value decryptable by anyone. Confidentiality is therefore enforced by an explicit permission system, not by obscurity.

**Threshold decryption and the KMS.** Decryption is not performed by any single party. A decentralised Key Management System (KMS) holds shares of the decryption key and decrypts only via threshold multi-party computation, producing the cleartext together with a signature attesting that this cleartext is the genuine decryption of a given ciphertext handle. As Section 8 explains, this signature is what makes CipherGavel's settlement trustless. (The FHEVM generation used here retired the older on-chain decryption *oracle* in favour of this self-relay model: a value is marked publicly decryptable on-chain, decrypted off-chain via the relayer, and the result is verified back on-chain.)

---

## 4. Architecture

### 4.1 Components and data flow

```
        Bidder device                                   Seller device
            │                                                │
   encrypt bid locally                              encrypt reserve locally
   (handle + input proof)                           (handle + input proof)
            │                                                │
            ▼                                                ▼
   placeBid(extEuint64, proof)  ── + deposit ──►   setReserve(extEuint64, proof)
            │                                                │
            └───────────────►   CipherGavel.sol   ◄──────────┘
                                      │
              stores ciphertext handles only — no plaintext on chain
                                      │
                               closeAuction()
              homomorphic fold over the encrypted bids computes:
              winner index · second-highest price · reserve-met flag
                                      │
                 FHE.allowThis + FHE.allow(seller) + makePubliclyDecryptable
                                      │
                ┌─────────────────────┴──────────────────────┐
                ▼                                              ▼
   off-chain public decryption (relayer/KMS)        anyone can re-decrypt
   → cleartexts + KMS signature                     and independently verify
                │
                ▼
   finalize(cleartexts, proof)  → FHE.checkSignatures verifies on-chain
                │                  → records winner + clearing price (trustless)
                ▼
   withdrawDeposit()  (uniform bond refunded)
```

The encryption boundary sits at the bidder's device. What travels on-chain is a ciphertext handle plus an input proof; on a block explorer, a bid appears as opaque bytes. The contract folds over the stored ciphertexts to produce three encrypted results, grants the appropriate decryption permissions, and the result is revealed and settled through a verifiable, signature-checked process.

### 4.2 Phase machine

The contract enforces a three-phase lifecycle — `Bidding → Closed → Revealed` — through require-guards and a bidding deadline. During `Bidding`, the seller may set a reserve and bidders may submit bids. The auction moves to `Closed` when `closeAuction` runs, which the seller may call at any time and which *anyone* may call after the deadline; this dual rule guarantees liveness, so a passive or absent seller cannot strand the auction or the bidders' deposits. The move to `Revealed` records the outcome and unlocks deposit withdrawals.

---

## 5. The confidential bidding layer

Each bidder submits one encrypted bid and locks a fixed, uniform deposit. On submission the contract imports the bid with `FHE.fromExternal`, grants itself permission to compute on it (`FHE.allowThis`) and grants the bidder permission to decrypt their own bid (`FHE.allow(bid, msg.sender)`) — and no one else. The bid is appended to on-chain storage as a ciphertext handle. Guards enforce that bidding is open, that the exact deposit was paid, that an address bids at most once, and that the bidder cap is respected.

The seller's reserve travels the identical path. Until the seller sets one, the reserve defaults to an encrypted zero, which every positive bid clears; setting a reserve replaces it with the seller's encrypted value. At no point does the reserve appear in cleartext on-chain.

---

## 6. The confidential second-price computation

### 6.1 Oblivious computation

Ordinary code would find the maximum with a branch: `if (bid > highest) { highest = bid; }`. That is impossible here, and the impossibility is the whole point. The comparison `bid > highest` is between two *encrypted* numbers, so its result is an *encrypted* boolean — the contract genuinely does not know whether it is true or false, and cannot branch on a value it cannot read.

The replacement is `FHE.select(condition, ifTrue, ifFalse)`, a branchless conditional that returns one of two values according to an encrypted condition without revealing which was chosen. Rather than branching, the contract computes *both* outcomes on every iteration and lets `select` retain the correct one. `closeAuction` folds over the encrypted bids, maintaining encrypted running values for the highest bid, the second-highest bid, and the winner's index:

```
isHigher = b > highest                                  // encrypted boolean
second   = select(isHigher, highest, max(second, b))    // old highest demoted, else best-of-rest
highest  = select(isHigher, b, highest)
winIdx   = select(isHigher, i, winIdx)
```

Every operation is data-independent: the loop performs exactly the same sequence of homomorphic operations regardless of the bid values, and no control-flow decision ever depends on a plaintext. This data-independence is precisely what makes the computation leak nothing — not the winner, not the ordering, not even the *pattern* of execution.

After the fold, the contract evaluates the reserve check `met = highest ≥ reserve` and computes `price = select(met, max(second, reserve), 0)` together with an encrypted 0/1 reserve-met flag. The three encrypted results are stored, marked publicly decryptable, and made decryptable by the seller.

### 6.2 The tie-break is free, and leak-free

Because the comparison is *strictly* greater-than, a later bid that exactly ties the current best does not displace it, so the earliest of equal top bids wins. This "earliest wins" tie-break therefore falls out of the construction at no cost — and because the comparison result is encrypted, an observer cannot even detect that a tie occurred. No extra code, no extra leakage.

### 6.3 Why MEV-immune by construction

A front-running or sandwich strategy requires the attacker to read a pending transaction's economically meaningful content and act on it. Here, a pending `placeBid` carries only a ciphertext and a proof; the bid value is unreadable, and reordering encrypted submissions confers no advantage because the contract's homomorphic logic is order-independent except for the deterministic tie-break. There is simply nothing to extract.

---

## 7. Cryptographic and engineering choices

### 7.1 Why FHE, and not ZK, MPC, or TEE

The defining requirement of this application is that *a public smart contract must privately compute a function of many independent parties' secret inputs*. That requirement maps cleanly onto FHE and awkwardly onto the alternatives.

Zero-knowledge proofs let a prover convince a verifier of a statement about hidden inputs, but they do not, by themselves, let a contract *compute over many parties' secrets*; expressing "compare everyone's hidden bids and output the second-largest" purely in ZK would require a coordinator or recursive machinery and does not fit the shape of an on-chain auction naturally. Secure multi-party computation is designed for joint computation over distributed secrets, but it requires interactive rounds and liveness from the participants, which is heavy to run as a permissionless smart contract. Trusted execution environments assume hardware trust and have a long history of side-channel compromises; the secret would be exposed in plaintext inside the enclave, trading a cryptographic assumption for a hardware one.

FHE on FHEVM lets the *contract itself* compute on encrypted inputs from non-interactive, independent bidders, with confidentiality reducing to a cryptographic assumption rather than a hardware one, and it integrates directly into Solidity. For "a public contract that privately computes a function of many users' secrets," it is the natural fit — which is exactly the shape of an auction.

It is worth being explicit about where a different primitive *would* help, because the boundary is instructive. A ZK shielded-pool protocol (Hinkal being a productised example) hides the *sender and amount of transactions* using zero-knowledge proofs and stealth addresses. It cannot perform the homomorphic comparison at the heart of this auction — nothing in a shielded pool computes the second-largest of others' hidden inputs — so it is not a substitute for FHE here. It *would*, however, address the one privacy axis FHE leaves open: hiding *who* is bidding (Section 9.5). The two primitives are complementary, not interchangeable, and choosing FHE for the computation while noting where a ZK layer would extend it is, I argue, the correct engineering judgment for this problem — and consistent with the brief's instruction to build with a single primitive.

### 7.2 Why Vickrey

Truthful bidding is dominant under a second-price rule, which removes bid-shading and aligns with a privacy-preserving design: since bids are hidden regardless, the mechanism that rewards honest valuation is the principled choice. The second-price rule also makes the privacy property *demonstrable* — at reveal, the winner verifiably pays a price different from (and lower than) their own, still-secret bid, which is a vivid illustration that no individual bid was disclosed.

### 7.3 The HCU constraint — an honest tradeoff

FHEVM bounds the homomorphic complexity a single transaction may consume (a sequential "homomorphic complexity unit" limit). Because `closeAuction` performs a number of homomorphic comparisons and selections that grows with the number of bidders, its cost scales with participation, and a sufficiently large auction would exceed the per-transaction limit. CipherGavel therefore caps the number of bidders (a small value is used for demonstration). This is a genuine property of the platform, and acknowledging it — rather than hiding it — is part of an honest design. The natural scaling paths are a *tournament reduction* (computing pairwise maxima in a shallower tree to reduce sequential depth) and splitting the close across multiple transactions; both are noted as future work in Section 9.

### 7.4 Why a uniform deposit

A deposit deters spam and non-committal bids and gives bidders skin in the game. But a deposit that *scaled with the bid* would leak the bid's magnitude: an observer watching the public ETH transfers could infer how much each bidder was willing to pay. CipherGavel therefore requires an **identical** deposit from every bidder. This preserves the anti-grief benefit while leaking nothing distinguishing — three bidders each lock the same amount, which reveals that three parties participated but nothing about their valuations. The deposit is fully refundable in this implementation; binding the winner's deposit to the clearing price is a natural extension that depends on the trustless price verification of Section 8.

This is an instance of a broader principle in privacy engineering that recurs throughout the design: it is not enough to encrypt the secret; one must also ensure the *non-encrypted surroundings* — amounts, timing, transfer patterns — do not reveal it. The uniform deposit is a small, deliberate example of that discipline.

### 7.5 Reentrancy safety

Deposit refunds follow the checks-effects-interactions pattern: the recorded balance is zeroed *before* the external ETH transfer, so a malicious recipient cannot re-enter `withdrawDeposit` to drain multiple refunds. This is the vulnerability behind some of the most consequential losses in Ethereum's history, and handling it correctly is a basic but essential engineering point.

---

## 8. The reveal and trustless settlement

After `closeAuction`, the three encrypted results sit on-chain marked publicly decryptable. They still must be turned into a usable, public outcome. CipherGavel offers two paths, and the contrast between them is itself a contribution.

**Path one — verifiable, seller-submitted (`publishResult`).** The seller, who holds decryption permission on the results, decrypts them off-chain and submits the cleartext winner and price. This is fast and simple, but it asks us to trust the seller's reported numbers. The trust is *bounded*, however: because the results were marked publicly decryptable, **anyone** can independently decrypt the same handles and check them against what the seller published. A dishonest seller is therefore caught immediately. This is verifiable trust, not blind trust.

**Path two — trustless, signature-checked (`finalize`).** The trust gap is removed entirely by having the contract verify, on-chain, that a submitted cleartext is the authentic decryption of the on-chain ciphertext. The result is decrypted off-chain through the relayer, which returns the cleartext together with a KMS signature; the contract reconstructs the relevant ciphertext handles and calls `FHE.checkSignatures(handles, cleartexts, proof)`, which reverts unless the signature is a valid attestation by the key-management network. Only then does it record the outcome. Because the values are self-certifying, `finalize` is callable by *anyone* — so the seller cannot withhold the result either. The settlement is both trustless and permissionless.

The elegance of this is that it does not introduce a new trust assumption — it removes one. Before, we trusted the seller; now we trust only the KMS threshold, which the entire FHE system already depends on. Trust is shifted from an interested party to the cryptographic foundation the system already rests upon.

---

## 9. Threat model

### 9.1 Assets

The system protects (A1) individual bid amounts, especially losing bids; (A2) the seller's reserve price; (A3) the integrity of the outcome — the correct winner at the correct second price; and (A4) liveness — the ability to always close the auction and recover deposits.

### 9.2 Actors and visibility

| Actor | Can observe | Cannot observe (assuming FHE holds) |
|---|---|---|
| A competing bidder | That an address bid; the uniform deposit; bid timing | Any bid amount; the reserve |
| The seller | The final winner and clearing price | Individual losing bids; even the winner's true bid (only the 2nd price) |
| A validator / block proposer | Encrypted calldata; addresses; deposits | Bid amounts; the reserve |
| An MEV searcher | The same as a validator | Anything actionable — there is no plaintext to front-run |
| The general public | Encrypted on-chain state; the published outcome | Losing bids; the reserve |

### 9.3 Trust boundaries

Confidentiality rests on the security of the FHE scheme and on an honest threshold of the KMS, which decrypts only via threshold MPC; this is the system's core cryptographic assumption. Input-proof soundness prevents malformed or replayed ciphertexts from corrupting the computation. The settlement trust boundary is the subject of Section 8: `publishResult` is verifiable-but-seller-submitted, while `finalize` eliminates seller trust by verifying KMS signatures on-chain.

### 9.4 Attacks considered

Front-running and sandwiching are defused by construction (Section 6.3): encrypted calldata exposes nothing to observe or profitably reorder. Bid copying — resubmitting another bidder's ciphertext handle — gains nothing, since the copier cannot learn or beat a hidden value, and the one-bid-per-address rule and uniform deposit blunt spam. Griefing with junk bids is made costly by the refundable deposit without leaking bid sizes. A passive or absent seller cannot deadlock the auction, because anyone may close after the deadline and deposits are recoverable once revealed. Tie manipulation has no surface: ties resolve deterministically by submission order and are never observable.

### 9.5 Out of scope and honest limitations

Three limitations are stated plainly, because naming them precisely is part of a sound privacy analysis.

First, **bidder anonymity is not provided.** FHE hides the *values* in a transaction, not its *sender*; bidder addresses are public on Ethereum. Hiding *who* bids would require an additional zero-knowledge or shielded-address layer (Section 7.1) — this is the most significant boundary of the design, and it is left as future work rather than half-implemented.

Second, **timing and participation are observable.** The number of bidders and the times at which bids arrive are public, which permits some traffic analysis even though the amounts are hidden.

Third, **the clearing price is disclosed**, by design, as the auction's output. One corner case deserves explicit mention: if exactly one bid clears the reserve, the clearing price equals the reserve, so publishing the price indirectly reveals the reserve in that single case. With two or more qualifying bids, the price is the second-highest bid and the reserve remains hidden. Hiding the price entirely is possible and is discussed below.

---

## 10. Future work

The trustless settlement of Section 8 is already implemented; the remaining extensions are genuine and clearly scoped.

**Confidential price.** Settling payment in a confidential ERC-20 token would let the winner pay an *encrypted* amount, hiding even the clearing price between winner and seller while keeping the outcome verifiable. This composes naturally on the same FHE stack, with no second protocol required.

**Bidder anonymity.** Combining FHE bid privacy with a zero-knowledge shielded-pool or stealth-address scheme (Hinkal being a productised example) would hide *who* bids, closing the address-visibility limitation of Section 9.5. This is the most substantial extension and a meaningful research-and-engineering effort in its own right.

**Multi-unit (uniform-price) generalisation.** Selling `k` identical units at a uniform clearing price equal to the `(k+1)`-th highest bid is the multi-unit analogue of Vickrey, computable homomorphically with a `k`-th-largest selection network.

**Scaling the close.** A tournament reduction or a multi-transaction close would lift the bidder cap imposed by the per-transaction homomorphic-complexity limit (Section 7.3).

---

## 11. Implementation and evaluation

CipherGavel is implemented in Solidity on FHEVM, with a TypeScript test suite, deployment scripts, command-line tasks for driving an auction, and a web interface. The contract was developed incrementally and is deployed and source-verified on the Sepolia testnet, where real FHE encryption (rather than a local mock) is in effect; a complete auction — set reserve, three encrypted bids, close, and trustless finalize — has been executed end-to-end on-chain. The web interface performs the same encryption *in the browser* via Zama's relayer SDK: it deploys a fresh auction from the connected wallet, encrypts bids and the reserve client-side (producing the handle and input proof), submits them, closes the auction, and finalizes trustlessly by decrypting the results through the relayer and verifying the KMS signature on-chain.

The test suite verifies the core claims under a local mock FHEVM: that the winner is the highest bidder, that the price is the second-highest bid, that a secret reserve correctly raises the clearing price to `max(second, reserve)`, that an auction whose top bid falls below the reserve fails privately, that a bidder can decrypt only their own bid, and that the access-control guards reject a wrong deposit, a double bid, and a non-seller setting the reserve.

Briefly, against the assessment criteria: *privacy correctness* is established by end-to-end encryption of bids and reserve, the never-decrypted losing bids, the oblivious (data-independent) computation, an explicit ACL, and the threat model of Section 9. *Engineering quality* is reflected in the phase machine, deadline-based liveness, access-control guards, reentrancy-safe withdrawals, a passing test suite, and a verified live deployment. *Cryptographic choices* are justified throughout Section 7. *Originality* lies in the two-sided privacy of the secret reserve, the homomorphic second-price construction, the MEV-immunity framing, the leak-free uniform deposit and tie-break, and the trustless signature-checked settlement.

---

## 12. Conclusion

CipherGavel demonstrates that a genuinely useful market mechanism — a second-price auction with a secret reserve — can run on a public blockchain without sacrificing the confidentiality that makes the mechanism meaningful. The bids and the reserve are computed upon while encrypted, the result is revealed and settled in a way that requires trusting no participant, and the design is honest about exactly what it protects and where its protection ends. The project's central lesson is one of judgment rather than maximalism: sound privacy engineering is the disciplined selection of the right primitive for a defined threat model, the careful design of the non-secret surroundings so they do not leak, and the clear articulation of the boundary at which the chosen protection stops.

---

## Appendix A — Deployment evidence

- Deployed, verified contract: [`0x9DC139B8737eFC64e71DE053dE80C37fd7689606`](https://sepolia.etherscan.io/address/0x9DC139B8737eFC64e71DE053dE80C37fd7689606) on Sepolia.
- Example encrypted-bid transaction: [`0x659fde…c5eb`](https://sepolia.etherscan.io/tx/0x659fde32207d008885e315753f671bfcdda393f66e3e3dcd3764fb6dc713c5eb) — Input Data shows the bid as opaque ciphertext.
- Trustless settlement transaction (`finalize`): [`0x4dc439…a924`](https://sepolia.etherscan.io/tx/0x4dc439d2f1d930a81b755ecc820ec2441df7f7bb9d154b8bdaddcd057c3ea924).
- Screenshots: *[encrypted bid calldata]*; *[Read Contract showing the revealed winner and second price]*.

## Appendix B — Contract interface (summary)

`setReserve` (seller, encrypted reserve); `placeBid` (payable, encrypted bid + uniform deposit); `closeAuction` (seller anytime or anyone after the deadline; computes the encrypted winner, second price, and reserve-met flag); `publishResult` (seller; verifiable reveal); `finalize` (anyone; trustless reveal via `FHE.checkSignatures`); `withdrawDeposit` (refunds the uniform deposit after reveal). Public getters expose the phase, the participants, the encrypted result handles, and — after reveal — the cleartext winner, clearing price, and reserve-met flag.

## Appendix C — Assumptions

Confidentiality assumes the security of the underlying FHE scheme and an honest threshold of the Zama key-management network. Input proofs prevent malformed ciphertexts from entering the computation. The verifiable path (`publishResult`) is seller-submitted but publicly auditable; the trustless path (`finalize`) requires trusting only the KMS threshold the system already depends upon.
