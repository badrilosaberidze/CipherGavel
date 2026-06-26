import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

// Singleton instance cache to avoid re-initializing WASM
let instanceCache: FhevmInstance | null = null;

/**
 * Gets or creates the FHEVM instance for browser encryption/decryption.
 * Boots WASM and fetches encryption keys from the relayer on first call.
 * Subsequent calls return the cached instance.
 *
 * Uses SepoliaConfig from the SDK which includes the correct relayer/ACL/KMS addresses.
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instanceCache) return instanceCache;

  try {
    // SepoliaConfig needs a network provider - use public Sepolia RPC
    const config = {
      ...SepoliaConfig,
      network: "https://ethereum-sepolia-rpc.publicnode.com",
    };

    // This boots the WASM module and fetches public keys from the gateway
    instanceCache = await createInstance(config);
    return instanceCache;
  } catch (error) {
    console.error("Failed to initialize FHEVM instance:", error);
    throw new Error(
      "FHEVM initialization failed. Check console for details. " +
      "Common issues: WASM not loaded, wrong relayer URL, or network error."
    );
  }
}
