# CipherGavel

A confidential sealed-bid **Vickrey auction** built on Zama's fhEVM. Every bid — and even the seller's reserve price — is encrypted end-to-end. The winner and the second-highest (clearing) price are computed directly on the encrypted bids and are the only values ever revealed; losing bids stay encrypted forever.

## What makes it different
- **Two-sided privacy** — not just hidden bids; the seller's reserve price is secret too.
- **True second-price (Vickrey)** — the winner pays `max(second-highest bid, reserve)`, computed homomorphically.
- **MEV-immune by design** — encrypted bids in the calldata mean there is nothing to front-run.
- **Leak-free anti-grief** — a uniform refundable deposit reveals nothing about bid size.

## Built with
- [Zama fhEVM](https://docs.zama.org/protocol) — Fully Homomorphic Encryption on the EVM
- Hardhat · ethers · TypeScript

Scaffolded from [Zama's fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template).

## License
BSD-3-Clause-Clear (matching the Zama FHE libraries).