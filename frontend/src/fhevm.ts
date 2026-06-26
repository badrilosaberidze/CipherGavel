import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

// Dedicated read-only Sepolia RPC for the relayer SDK's on-chain config reads.
// Kept independent of the wallet so a wrong-network wallet can't break encryption.
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

// Singleton caches so we boot the WASM + fetch keys only once per page load.
let instanceCache: FhevmInstance | null = null;
let initPromise: Promise<FhevmInstance> | null = null;
let sdkReady = false;

/**
 * Gets or creates the FHEVM instance for browser encryption/decryption.
 *
 * Two distinct steps are required and used to be conflated:
 *   1. initSDK()        — loads the TFHE + KMS WebAssembly modules. Skipping
 *                          this is what produced the "__wbindgen_malloc" crash.
 *   2. createInstance() — fetches the network public keys from the relayer.
 *
 * We use the SDK's official `SepoliaConfig` (correct ACL/KMS/InputVerifier
 * addresses, relayer URL and gatewayChainId) instead of hand-written values.
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instanceCache) return instanceCache;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. Boot the WebAssembly (single-threaded — no SharedArrayBuffer /
      //    COOP-COEP headers needed). Idempotent, but we guard it anyway.
      if (!sdkReady) {
        console.log("[fhevm] loading WASM (initSDK)…");
        await initSDK();
        sdkReady = true;
      }

      // 2. Always read the FHEVM config from a dedicated Sepolia RPC — NOT the
      //    wallet provider. The SDK queries the InputVerifier/KMS contracts for
      //    their EIP-712 domains during createInstance; if the wallet happens to
      //    be on the wrong chain (or is a wrapper like Hinkal that ignored the
      //    switch request), those calls revert with "missing revert data".
      //    Encryption only needs read access on Sepolia — the wallet is used
      //    separately to actually send the bid/reserve transaction.
      const config = { ...SepoliaConfig, network: SEPOLIA_RPC };

      console.log("[fhevm] creating instance via relayer", {
        relayerUrl: SepoliaConfig.relayerUrl,
        network: SEPOLIA_RPC,
      });

      const instance = await createInstance(config);
      instanceCache = instance;
      console.log("[fhevm] instance ready ✅");
      return instance;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[fhevm] initialization failed:", message);
      // Reset so a later attempt (e.g. after switching network) can retry.
      initPromise = null;
      throw new Error(`FHEVM initialization failed: ${message}`);
    }
  })();

  return initPromise;
}
