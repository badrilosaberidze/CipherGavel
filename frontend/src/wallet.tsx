import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ethers } from "ethers";
import { SEPOLIA_CHAIN_ID } from "./contract";

interface WalletCtx {
  account: string | null;
  provider: ethers.BrowserProvider | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  busy: boolean;
  error: string | null;
}

const Ctx = createContext<WalletCtx>(null as unknown as WalletCtx);
export const useWallet = () => useContext(Ctx);

// --- pick MetaMask specifically, even if other wallets are installed ---
// Modern wallets announce themselves via EIP-6963; we collect those so we can
// target MetaMask rather than whatever extension grabbed window.ethereum.
const announced: { rdns: string; name: string; provider: any }[] = [];

function setupEIP6963Listener() {
  if (typeof window === "undefined") return;

  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const d = e.detail;
    if (d?.info && d?.provider && !announced.find((a) => a.rdns === d.info.rdns)) {
      console.log("EIP-6963 provider announced:", d.info.rdns, d.info.name);
      announced.push({ rdns: d.info.rdns, name: d.info.name, provider: d.provider });
    }
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// Setup listener on module load
if (typeof window !== "undefined") {
  setupEIP6963Listener();
}

async function pickMetaMask(): Promise<any | null> {
  // Wait a bit for EIP-6963 announcements to arrive
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log("Available EIP-6963 providers:", announced.map(a => `${a.rdns} (${a.name})`));

  // First priority: EIP-6963 announced MetaMask with exact RDNS
  const mmExact = announced.find((a) => a.rdns === "io.metamask");
  if (mmExact) {
    console.log("Found MetaMask via EIP-6963 (exact match)");
    return mmExact.provider;
  }

  // Second priority: EIP-6963 announced provider with "metamask" in name
  const mmFuzzy = announced.find((a) => /metamask/i.test(a.name));
  if (mmFuzzy) {
    console.log("Found MetaMask via EIP-6963 (fuzzy match)");
    return mmFuzzy.provider;
  }

  // Third priority: window.ethereum with providers array
  const eth: any = (window as any).ethereum;
  console.log("window.ethereum exists:", !!eth);
  console.log("window.ethereum.providers:", eth?.providers?.map((p: any) => ({
    isMetaMask: p.isMetaMask,
    isHinkal: p.isHinkal,
    isPhantom: p.isPhantom
  })));

  if (eth?.providers?.length) {
    const found = eth.providers.find((p: any) => p.isMetaMask && !p.isHinkal && !p.isPhantom);
    if (found) {
      console.log("Found MetaMask via window.ethereum.providers array");
      return found;
    }
  }

  // Fourth priority: Check if Hinkal is wrapping MetaMask
  console.log("window.ethereum.isMetaMask:", eth?.isMetaMask);
  console.log("window.ethereum.isHinkal:", eth?.isHinkal);

  // If Hinkal is wrapping MetaMask, look for the underlying provider
  if (eth?.isHinkal && eth?.isMetaMask) {
    console.log("Hinkal detected, looking for underlying MetaMask provider...");

    // Check common properties where wrapped providers are stored
    const possibleProviders = [
      eth._metamask?.provider,
      eth._provider,
      eth.provider,
      eth.metamask,
      (window as any).ethereum._metamask
    ];

    for (const candidate of possibleProviders) {
      if (candidate && candidate.isMetaMask && !candidate.isHinkal) {
        console.log("Found unwrapped MetaMask provider!");
        return candidate;
      }
    }

    // If we can't find unwrapped MetaMask, use Hinkal's wrapped version
    // It should still work for basic operations
    console.log("Using Hinkal-wrapped MetaMask (may work for basic operations)");
    return eth;
  }

  // Fifth priority: window.ethereum is MetaMask itself (not wrapped)
  if (eth?.isMetaMask && !eth?.isHinkal && !eth?.isPhantom) {
    console.log("Found MetaMask directly via window.ethereum");
    return eth;
  }

  console.error("MetaMask not found. Please disable other wallet extensions or set MetaMask as default.");
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manuallyDisconnected, setManuallyDisconnected] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    setManuallyDisconnected(false); // Reset the flag when manually connecting
    try {
      const injected = await pickMetaMask();
      if (!injected) {
        setError("MetaMask not found — install it, or set it as your default wallet.");
        return;
      }
      const bp = new ethers.BrowserProvider(injected);
      // Force MetaMask to show the account picker every time, even if a
      // permission was already granted. Without this, eth_requestAccounts
      // silently reuses the previously connected account, so "disconnect +
      // reconnect" can never switch to a different address.
      try {
        await bp.send("wallet_requestPermissions", [{ eth_accounts: {} }]);
      } catch {
        // User rejected the permission prompt, or the wallet doesn't support
        // it — fall through to eth_requestAccounts below.
      }
      await bp.send("eth_requestAccounts", []);
      try {
        await bp.send("wallet_switchEthereumChain", [{ chainId: SEPOLIA_CHAIN_ID }]);
      } catch {
        setError("Connected — please switch MetaMask to the Sepolia network.");
      }
      const signer = await bp.getSigner();
      setProvider(bp);
      setAccount(await signer.getAddress());
    } catch {
      setError("Connection cancelled or failed.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setAccount(null);
    setProvider(null);
    setError(null);
    setManuallyDisconnected(true); // Mark as manually disconnected
  }

  // Setup MetaMask event listeners and auto-reconnect
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    pickMetaMask().then((injected) => {
      if (!injected) return;

      // Auto-reconnect on page load (unless manually disconnected)
      if (!manuallyDisconnected) {
        const bp = new ethers.BrowserProvider(injected);
        bp.send("eth_accounts", [])
          .then((accs: string[]) => {
            if (accs?.length) {
              setProvider(bp);
              setAccount(ethers.getAddress(accs[0]));
            }
          })
          .catch(() => {});
      }

      // Setup event listeners (always, regardless of disconnect state)
      if (injected.on) {
        const handleAccountsChanged = (accs: string[]) => {
          console.log("MetaMask accounts changed:", accs);
          if (accs?.length) {
            // User switched account in MetaMask
            const bp = new ethers.BrowserProvider(injected);
            setProvider(bp);
            setAccount(ethers.getAddress(accs[0]));
            setManuallyDisconnected(false); // Allow auto-reconnect again
          } else {
            // User disconnected in MetaMask
            setAccount(null);
            setProvider(null);
          }
        };

        const handleChainChanged = () => {
          console.log("Chain changed, reloading...");
          window.location.reload();
        };

        injected.on("accountsChanged", handleAccountsChanged);
        injected.on("chainChanged", handleChainChanged);

        // Setup cleanup function
        cleanup = () => {
          if (injected.removeListener) {
            injected.removeListener("accountsChanged", handleAccountsChanged);
            injected.removeListener("chainChanged", handleChainChanged);
          }
        };
      }
    });

    // Cleanup listeners on unmount
    return () => {
      if (cleanup) cleanup();
    };
  }, [manuallyDisconnected]);

  return (
    <Ctx.Provider value={{ account, provider, connect, disconnect, busy, error }}>{children}</Ctx.Provider>
  );
}
