import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ABI, PHASES, PUBLIC_RPC } from "../contract";
import { useWallet } from "../wallet";

interface Live {
  phase: number;
  bids: number;
  maxBidders: number;
  reserveSet: boolean;
  published: boolean;
  winner: string;
  clearingPrice: string;
  reserveMet: boolean;
}

interface Props {
  contractAddress: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function LiveStatus({ contractAddress }: Props) {
  const { account, connect, busy, error } = useWallet();
  const [live, setLive] = useState<Live | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);

  // Reads always go through a public RPC, so the panel works regardless of
  // wallet state. The wallet is only needed for the address (and later, bids).
  async function refresh() {
    setReadErr(null);
    try {
      const reader = new ethers.JsonRpcProvider(PUBLIC_RPC);
      const c: any = new ethers.Contract(contractAddress, ABI, reader);
      const [phase, bids, maxBidders, reserveSet, published, winner, clearingPrice, reserveMet] =
        await Promise.all([
          c.phase(), c.bidCount(), c.maxBidders(), c.reserveSet(),
          c.resultPublished(), c.winner(), c.clearingPrice(), c.reserveMet(),
        ]);
      setLive({
        phase: Number(phase),
        bids: Number(bids),
        maxBidders: Number(maxBidders),
        reserveSet,
        published,
        winner,
        clearingPrice: clearingPrice.toString(),
        reserveMet,
      });
    } catch {
      setReadErr("Couldn't read the contract — check CONTRACT_ADDRESS in contract.ts.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, contractAddress]);

  return (
    <aside className="console">
      <div className="console-row">
        <span className="console-label">Network</span>
        <span className="pill"><span className="dot" /> Sepolia</span>
      </div>
      <div className="console-row">
        <span className="console-label">Wallet</span>
        <span className="console-value mono" style={{ fontSize: "0.82rem" }}>
          {account ? short(account) : "not connected"}
        </span>
      </div>

      {live ? (
        <>
          <div className="console-row">
            <span className="console-label">Phase</span>
            <span className="console-value">{PHASES[live.phase] ?? "—"}</span>
          </div>
          <div className="console-row">
            <span className="console-label">Sealed bids</span>
            <span className="console-value">{live.bids} / {live.maxBidders}</span>
          </div>
          <div className="console-row">
            <span className="console-label">Reserve</span>
            <span className="console-value">{live.reserveSet ? "set · sealed" : "—"}</span>
          </div>
          {live.published && (
            <>
              <div className="console-row">
                <span className="console-label">Winner</span>
                <span className="console-value mono" style={{ fontSize: "0.82rem" }}>
                  {live.reserveMet ? short(live.winner) : "no sale"}
                </span>
              </div>
              <div className="console-row">
                <span className="console-label">Clearing price</span>
                <span className="console-value">{live.reserveMet ? live.clearingPrice : "—"}</span>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="console-row">
          <span className="console-label">State</span>
          <span className="console-value dim" style={{ fontSize: "0.85rem" }}>reading…</span>
        </div>
      )}

      {(error || readErr) && (
        <p style={{ color: "var(--wax-soft)", fontSize: "0.8rem", marginTop: "0.8rem" }}>
          {error || readErr}
        </p>
      )}

      <div className="console-actions">
        {!account ? (
          <button className="btn btn-primary" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect MetaMask"}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={refresh}>Refresh live state</button>
        )}
        <a
          className="btn btn-ghost"
          href={`https://sepolia.etherscan.io/address/${contractAddress}`}
          target="_blank"
          rel="noreferrer"
          style={{ justifyContent: "center" }}
        >
          View on Etherscan
        </a>
      </div>
    </aside>
  );
}
