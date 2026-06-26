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
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const d = e.detail;
    if (d?.info && d?.provider && !announced.find((a) => a.rdns === d.info.rdns)) {
      announced.push({ rdns: d.info.rdns, name: d.info.name, provider: d.provider });
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function pickMetaMask(): any | null {
  const mm = announced.find((a) => a.rdns === "io.metamask" || /metamask/i.test(a.name));
  if (mm) return mm.provider;
  const eth: any = (window as any).ethereum;
  if (eth?.providers?.length) {
    const found = eth.providers.find((p: any) => p.isMetaMask);
    if (found) return found;
  }
  if (eth?.isMetaMask) return eth;
  return eth ?? null;
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
      const injected = pickMetaMask();
      if (!injected) {
        setError("MetaMask not found — install it, or set it as your default wallet.");
        return;
      }
      const bp = new ethers.BrowserProvider(injected);
      // Request accounts - this opens MetaMask account selector
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
    const injected = pickMetaMask();
    if (!injected) return;

    // Auto-reconnect on page load (unless manually disconnected)
    if (!manuallyDisconnected) {
      const bp = new ethers.BrowserProvider(injected);
      bp.send("eth_accounts", [])
        .then((accs: string[]) => {
          if (accs?.length) {
            setProvider(bp);
            setAccount(accs[0]);
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
          setAccount(accs[0]);
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

      // Cleanup listeners on unmount
      return () => {
        if (injected.removeListener) {
          injected.removeListener("accountsChanged", handleAccountsChanged);
          injected.removeListener("chainChanged", handleChainChanged);
        }
      };
    }
  }, [manuallyDisconnected]);

  return (
    <Ctx.Provider value={{ account, provider, connect, disconnect, busy, error }}>{children}</Ctx.Provider>
  );
}
