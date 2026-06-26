import { createInstance } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

// Singleton instance cache to avoid re-initializing WASM
let instanceCache: FhevmInstance | null = null;
let initPromise: Promise<FhevmInstance> | null = null;

// Manual Sepolia configuration (SepoliaConfigV2 export has missing fields)
// These are the official Zama Sepolia endpoints
const SEPOLIA_CONFIG = {
  // Contract addresses on Sepolia
  kmsContractAddress: "0x9D6891A6240D6130c54ae243d8005063D05fE14b",
  aclContractAddress: "0xFee8407e2f5e3Ee68ad77cAE98c434e637f516e5",
  inputVerifierContractAddress: "0x9D6891A6240D6130c54ae243d8005063D05fE14b",
  verifyingContractAddressDecryption: "0x9D6891A6240D6130c54ae243d8005063D05fE14b",
  verifyingContractAddressInputVerification: "0x9D6891A6240D6130c54ae243d8005063D05fE14b",

  // Relayer endpoints
  relayerUrl: "https://gateway.sepolia.zama.ai",
  gatewayUrl: "https://gateway.sepolia.zama.ai",

  // Chain config
  chainId: 11155111, // Sepolia
  gatewayChainId: 11155111, // Same as chainId for Sepolia
  relayerRouteVersion: 2 as const,
};

/**
 * Gets or creates the FHEVM instance for browser encryption/decryption.
 * Boots WASM and fetches encryption keys from the relayer on first call.
 * Subsequent calls return the cached instance.
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

      // Use MetaMask provider or fallback to public RPC
      const network = window.ethereum || "https://ethereum-sepolia-rpc.publicnode.com";

      const config = {
        ...SEPOLIA_CONFIG,
        network,
        debug: true,
      };

      console.log("Config:", {
        gatewayUrl: config.gatewayUrl,
        network: window.ethereum ? "MetaMask" : "Public RPC",
        chainId: config.chainId
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
