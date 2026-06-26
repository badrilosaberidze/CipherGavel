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
      console.log("This may take 10-20 seconds to download WASM (~5MB)...");

      // Give the page time to fully load
      await new Promise(resolve => setTimeout(resolve, 100));

      // SepoliaConfigV2 needs a network provider
      const config = {
        ...SepoliaConfigV2,
        network: window.ethereum || "https://ethereum-sepolia-rpc.publicnode.com",
        debug: true, // Enable debug logs
      };

      console.log("Config:", {
        gatewayUrl: (SepoliaConfigV2 as any).gatewayUrl,
        network: config.network ? "MetaMask" : "Public RPC"
      });

      // This boots the WASM module and fetches public keys from the gateway
      const instance = await createInstance(config);
      instanceCache = instance;
      console.log("✅ FHEVM instance initialized successfully");
      return instance;
    } catch (error: any) {
      console.error("❌ Failed to initialize FHEVM instance:", error);

      // Show user-friendly error
      const message = error?.message || String(error);
      if (message.includes("__wbindgen_malloc")) {
        console.error(
          "\n🔧 WASM Loading Error - This is a known issue with the relayer SDK.\n" +
          "Workaround: Use the CLI for encrypted operations:\n" +
          "  npx hardhat cg:set-reserve --value 200 --network sepolia\n" +
          "  npx hardhat cg:bid --value 100 --account 1 --network sepolia\n"
        );
      }

      initPromise = null; // Reset so it can be retried
      throw new Error(
        "FHEVM initialization failed. " +
        "This is a known browser WASM issue. " +
        "Please use the Hardhat CLI for encrypted operations (see console for commands)."
      );
    }
  })();

  return initPromise;
}
