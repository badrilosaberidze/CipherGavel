import CipherGavelArtifact from "./CipherGavel.json";

declare global {
  interface Window {
    ethereum?: any;
  }
}

// Sepolia chain id (11155111) in hex — used to switch MetaMask's network.
export const SEPOLIA_CHAIN_ID = "0xaa36a7";

// A public read-only RPC so the UI can show live state even before a wallet connects.
export const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

export const PHASES = ["Bidding", "Closed", "Revealed"];

// Full ABI from compiled contract artifact (includes read + write functions)
export const ABI = CipherGavelArtifact.abi;

// Bytecode for deploying new auctions from the browser
export const BYTECODE = CipherGavelArtifact.bytecode;
