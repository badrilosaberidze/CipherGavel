import { createInstance, SepoliaConfigV2 } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

// Singleton instance cache to avoid re-initializing WASM
let instanceCache: FhevmInstance | null = null;
let initPromise: Promise<FhevmInstance> | null = null;

/**
 * Gets or creates the FHEVM instance for browser encryption/decryption.
 * Boots WASM and fetches encryption keys from the relayer on first call.
 * Subsequent calls return the cached instance.
 *
 * Uses SepoliaConfigV2 (newer relayer infrastructure).
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  // Return cached instance if available
  if (instanceCache) return instanceCache;

  // If initialization is in progress, wait for it
  if (initPromise) return initPromise;

  // Start initialization
  initPromise = (async () => {
    try {
      console.log("Initializing FHEVM instance...");

      // SepoliaConfigV2 needs a network provider
      const config = {
        ...SepoliaConfigV2,
        network: window.ethereum || "https://ethereum-sepolia-rpc.publicnode.com",
      };

      // This boots the WASM module and fetches public keys from the gateway
      const instance = await createInstance(config);
      instanceCache = instance;
      console.log("FHEVM instance initialized successfully");
      return instance;
    } catch (error) {
      console.error("Failed to initialize FHEVM instance:", error);
      initPromise = null; // Reset so it can be retried
      throw new Error(
        "FHEVM initialization failed. Check console for details. " +
        "Common issues: WASM not loaded, wrong relayer URL, or network error. " +
        "Try refreshing the page (Ctrl+Shift+R)."
      );
    }
  })();

  return initPromise;
}
