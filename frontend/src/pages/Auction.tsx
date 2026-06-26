import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ethers } from "ethers";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "../wallet";
import { ABI, PHASES, PUBLIC_RPC } from "../contract";
import { getFhevmInstance } from "../fhevm";

interface AuctionState {
  seller: string;
  phase: number;
  bidCount: number;
  maxBidders: number;
  depositWei: bigint;
  biddingDeadline: number;
  reserveSet: boolean;
  published: boolean;
  winner: string;
  clearingPrice: bigint;
  reserveMet: boolean;
}

export function Auction() {
  const { address } = useParams();
  const { account, provider, connect, busy: walletBusy } = useWallet();

  const [state, setState] = useState<AuctionState | null>(null);
  const [bidders, setBidders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bidValue, setBidValue] = useState("");
  const [reserveValue, setReserveValue] = useState("");
  const [txStatus, setTxStatus] = useState("");
  const [txBusy, setTxBusy] = useState(false);

  async function loadState() {
    if (!address) return;

    setLoading(true);
    setError(null);

    try {
      const reader = new ethers.JsonRpcProvider(PUBLIC_RPC);
      const auction = new ethers.Contract(address, ABI, reader);

      const [seller, phase, bidCount, maxBidders, depositWei, biddingDeadline,
             reserveSet, published, winner, clearingPrice, reserveMet] =
        await Promise.all([
          auction.seller(),
          auction.phase(),
          auction.bidCount(),
          auction.maxBidders(),
          auction.depositWei(),
          auction.biddingDeadline(),
          auction.reserveSet(),
          auction.resultPublished(),
          auction.winner(),
          auction.clearingPrice(),
          auction.reserveMet()
        ]);

      setState({
        seller,
        phase: Number(phase),
        bidCount: Number(bidCount),
        maxBidders: Number(maxBidders),
        depositWei,
        biddingDeadline: Number(biddingDeadline),
        reserveSet,
        published,
        winner,
        clearingPrice,
        reserveMet
      });

      // Load bidder addresses
      const bidderPromises = [];
      for (let i = 0; i < Number(bidCount); i++) {
        bidderPromises.push(auction.bidderAt(i));
      }
      const addrs = await Promise.all(bidderPromises);
      setBidders(addrs);

    } catch (err: any) {
      console.error("Failed to load auction state:", err);
      setError("Failed to load auction. Check contract address.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadState();
  }, [address, account]);

  async function handlePlaceBid() {
    if (!provider || !account || !address || !state) return;

    setTxBusy(true);
    setTxStatus("Encrypting bid...");
    setError(null);

    try {
      const bidWei = ethers.parseEther(bidValue);
      const instance = await getFhevmInstance();

      const encInput = instance
        .createEncryptedInput(address, account)
        .add64(Number(bidWei));

      const encrypted = await encInput.encrypt();

      setTxStatus("Placing bid...");
      const signer = await provider.getSigner();
      const auction = new ethers.Contract(address, ABI, signer);

      const tx = await auction.placeBid(
        encrypted.handles[0],
        encrypted.inputProof,
        { value: state.depositWei }
      );

      setTxStatus("Confirming...");
      await tx.wait();

      setTxStatus("Bid placed!");
      setBidValue("");
      setTimeout(() => {
        setTxStatus("");
        loadState();
      }, 2000);

    } catch (err: any) {
      console.error("Bid failed:", err);
      const msg = err.message || "Bid transaction failed";
      if (msg.includes("FHEVM") || msg.includes("WASM")) {
        setError(
          "Browser encryption failed (WASM issue). Use CLI instead:\n" +
          `npx hardhat cg:bid --value ${bidValue} --account 1 --network sepolia`
        );
      } else {
        setError(msg);
      }
      setTxStatus("");
    } finally {
      setTxBusy(false);
    }
  }

  async function handleSetReserve() {
    if (!provider || !account || !address) return;

    setTxBusy(true);
    setTxStatus("Encrypting reserve...");
    setError(null);

    try {
      const reserveWei = ethers.parseEther(reserveValue);
      const instance = await getFhevmInstance();

      const encInput = instance
        .createEncryptedInput(address, account)
        .add64(Number(reserveWei));

      const encrypted = await encInput.encrypt();

      setTxStatus("Setting reserve...");
      const signer = await provider.getSigner();
      const auction = new ethers.Contract(address, ABI, signer);

      const tx = await auction.setReserve(
        encrypted.handles[0],
        encrypted.inputProof
      );

      setTxStatus("Confirming...");
      await tx.wait();

      setTxStatus("Reserve set!");
      setReserveValue("");
      setTimeout(() => {
        setTxStatus("");
        loadState();
      }, 2000);

    } catch (err: any) {
      console.error("Set reserve failed:", err);
      const msg = err.message || "Reserve transaction failed";
      if (msg.includes("FHEVM") || msg.includes("WASM")) {
        setError(
          "Browser encryption failed (WASM issue). Use CLI instead:\n" +
          `npx hardhat cg:set-reserve --value ${reserveValue} --network sepolia`
        );
      } else {
        setError(msg);
      }
      setTxStatus("");
    } finally {
      setTxBusy(false);
    }
  }

  async function handleClose() {
    if (!provider || !address) return;

    setTxBusy(true);
    setTxStatus("Closing auction...");
    setError(null);

    try {
      const signer = await provider.getSigner();
      const auction = new ethers.Contract(address, ABI, signer);

      const tx = await auction.closeAuction();

      setTxStatus("Confirming...");
      await tx.wait();

      setTxStatus("Auction closed!");
      setTimeout(() => {
        setTxStatus("");
        loadState();
      }, 2000);

    } catch (err: any) {
      console.error("Close failed:", err);
      setError(err.message || "Close transaction failed");
      setTxStatus("");
    } finally {
      setTxBusy(false);
    }
  }

  async function handleFinalize() {
    if (!provider || !address) return;

    setTxBusy(true);
    setTxStatus("Decrypting results...");
    setError(null);

    try {
      const reader = new ethers.JsonRpcProvider(PUBLIC_RPC);
      const auction = new ethers.Contract(address, ABI, reader);

      const handles = [
        await auction.getWinnerIndexEnc(),
        await auction.getClearingPriceEnc(),
        await auction.getReserveMetEnc()
      ];

      const instance = await getFhevmInstance();
      const decrypted: any = await (instance as any).publicDecrypt(handles);

      setTxStatus("Finalizing...");
      const signer = await provider.getSigner();
      const auctionWrite = new ethers.Contract(address, ABI, signer);

      const tx = await auctionWrite.finalize(
        decrypted.abiEncodedClearValues,
        decrypted.decryptionProof
      );

      setTxStatus("Confirming...");
      await tx.wait();

      setTxStatus("Finalized!");
      setTimeout(() => {
        setTxStatus("");
        loadState();
      }, 2000);

    } catch (err: any) {
      console.error("Finalize failed:", err);
      const msg = err.message || "Finalize transaction failed";
      if (msg.includes("FHEVM") || msg.includes("WASM")) {
        setError(
          "Browser decryption failed (WASM issue). Use CLI instead:\n" +
          "npx hardhat cg:finalize --network sepolia"
        );
      } else {
        setError(msg);
      }
      setTxStatus("");
    } finally {
      setTxBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!provider || !address) return;

    setTxBusy(true);
    setTxStatus("Withdrawing deposit...");
    setError(null);

    try {
      const signer = await provider.getSigner();
      const auction = new ethers.Contract(address, ABI, signer);

      const tx = await auction.withdrawDeposit();

      setTxStatus("Confirming...");
      await tx.wait();

      setTxStatus("Withdrawn!");
      setTimeout(() => {
        setTxStatus("");
      }, 2000);

    } catch (err: any) {
      console.error("Withdraw failed:", err);
      setError(err.message || "Withdraw transaction failed");
      setTxStatus("");
    } finally {
      setTxBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="wrap">
        <section className="section">
          <p style={{ color: "var(--ivory)", textAlign: "center", padding: "4rem" }}>
            Loading auction...
          </p>
        </section>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="wrap">
        <section className="section">
          <p style={{ color: "var(--wax)", textAlign: "center", padding: "4rem" }}>
            {error}
          </p>
          <div style={{ textAlign: "center" }}>
            <Link to="/" className="btn btn-ghost">
              Go Home
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!state) return null;

  const isCreator = account && state.seller.toLowerCase() === account.toLowerCase();
  const isPastDeadline = Date.now() / 1000 > state.biddingDeadline;
  const canClose = state.phase === 0 && (isCreator || isPastDeadline);
  const canFinalize = state.phase === 1;
  const isRevealed = state.phase === 2;
  const isBidder = account && bidders.some(b => b.toLowerCase() === account.toLowerCase());

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <div className="wrap">
      <section className="section">
        <div className="section-head">
          <div>
            <div className="section-num">Auction</div>
            <h2 className="mono" style={{ fontSize: "1.1rem", color: "var(--brass)" }}>
              {short(address!)}
            </h2>
          </div>
        </div>

        <div className="floor">
          {/* Console / Controls */}
          <aside className="console">
            <div className="console-row">
              <span className="console-label">Phase</span>
              <span className="console-value">{PHASES[state.phase] ?? "—"}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Seller</span>
              <span className="console-value mono" style={{ fontSize: "0.82rem" }}>
                {short(state.seller)}
                {isCreator && <span style={{ color: "var(--brass)", marginLeft: "0.5rem" }}>(you)</span>}
              </span>
            </div>
            <div className="console-row">
              <span className="console-label">Bids</span>
              <span className="console-value">{state.bidCount} / {state.maxBidders}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Reserve</span>
              <span className="console-value">{state.reserveSet ? "set · sealed" : "—"}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Deposit</span>
              <span className="console-value mono" style={{ fontSize: "0.85rem" }}>
                {ethers.formatEther(state.depositWei)} ETH
              </span>
            </div>

            {txStatus && (
              <div className="console-row" style={{ marginTop: "1rem" }}>
                <span className="console-label">Status</span>
                <span className="console-value" style={{ fontSize: "0.85rem" }}>{txStatus}</span>
              </div>
            )}

            {error && (
              <p style={{
                color: "var(--wax)",
                fontSize: "0.85rem",
                marginTop: "1rem",
                whiteSpace: "pre-wrap",
                fontFamily: error.includes("CLI") ? "var(--mono)" : "inherit"
              }}>
                {error}
              </p>
            )}

            {/* Phase-specific controls */}
            <div className="console-actions" style={{ marginTop: "1.5rem" }}>
              {!account ? (
                <button
                  className="btn btn-primary"
                  onClick={connect}
                  disabled={walletBusy}
                >
                  {walletBusy ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <>
                  {/* BIDDING PHASE */}
                  {state.phase === 0 && (
                    <>
                      {/* Bid form (everyone) */}
                      <div style={{ marginBottom: "1rem" }}>
                        <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--ivory)", fontSize: "0.9rem" }}>
                          Your Bid (ETH)
                        </label>
                        <input
                          type="text"
                          value={bidValue}
                          onChange={(e) => setBidValue(e.target.value)}
                          disabled={txBusy || state.bidCount >= state.maxBidders || Boolean(isBidder)}
                          placeholder="0.1"
                          style={{
                            width: "100%",
                            padding: "0.5rem",
                            background: "var(--ink)",
                            border: "1px solid var(--dimmer)",
                            color: "var(--ivory)",
                            fontFamily: "var(--mono)",
                            fontSize: "0.9rem",
                            marginBottom: "0.5rem"
                          }}
                        />
                        <button
                          className="btn btn-wax"
                          onClick={handlePlaceBid}
                          disabled={txBusy || !bidValue.trim() || state.bidCount >= state.maxBidders || Boolean(isBidder)}
                        >
                          {isBidder ? "Already bid" : "Place Bid (sealed)"}
                        </button>
                      </div>

                      {/* Reserve form (creator only) */}
                      {isCreator && !state.reserveSet && (
                        <div style={{ marginBottom: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--dimmer)" }}>
                          <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--ivory)", fontSize: "0.9rem" }}>
                            Secret Reserve (ETH)
                          </label>
                          <input
                            type="text"
                            value={reserveValue}
                            onChange={(e) => setReserveValue(e.target.value)}
                            disabled={txBusy}
                            placeholder="0.2"
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              background: "var(--ink)",
                              border: "1px solid var(--dimmer)",
                              color: "var(--ivory)",
                              fontFamily: "var(--mono)",
                              fontSize: "0.9rem",
                              marginBottom: "0.5rem"
                            }}
                          />
                          <button
                            className="btn btn-ghost"
                            onClick={handleSetReserve}
                            disabled={txBusy || !reserveValue.trim()}
                          >
                            Set Secret Reserve
                          </button>
                        </div>
                      )}

                      {/* Close button */}
                      {canClose && (
                        <div style={{ paddingTop: "1rem", borderTop: "1px solid var(--dimmer)" }}>
                          <button
                            className="btn btn-primary"
                            onClick={handleClose}
                            disabled={txBusy || state.bidCount === 0}
                          >
                            Close Auction
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* CLOSED PHASE */}
                  {canFinalize && (
                    <button
                      className="btn btn-primary"
                      onClick={handleFinalize}
                      disabled={txBusy}
                    >
                      Finalize (trustless)
                    </button>
                  )}

                  {/* REVEALED PHASE */}
                  {isRevealed && isBidder && (
                    <button
                      className="btn btn-ghost"
                      onClick={handleWithdraw}
                      disabled={txBusy}
                    >
                      Withdraw Deposit
                    </button>
                  )}
                </>
              )}
            </div>

            <a
              className="btn btn-ghost"
              href={`https://sepolia.etherscan.io/address/${address}`}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: "1rem", justifyContent: "center" }}
            >
              View on Etherscan
            </a>
          </aside>

          {/* Bidders / Paddles */}
          <div className="paddles">
            {bidders.length === 0 ? (
              <div className="empty-floor">No bids yet.</div>
            ) : (
              bidders.map((bidderAddr, idx) => {
                const isWinner = isRevealed && state.winner.toLowerCase() === bidderAddr.toLowerCase();
                return (
                  <motion.div
                    key={bidderAddr}
                    className={`paddle ${isWinner ? "winner" : ""}`}
                    initial={{ scale: 1.1, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <div className="paddle-head">
                      <span className="paddle-id mono" style={{ fontSize: "0.8rem" }}>
                        {short(bidderAddr)}
                      </span>
                    </div>
                    <div className="redaction" style={{ marginTop: "1rem" }}>
                      {isRevealed ? "sealed — forever" : "sealed"}
                    </div>
                    {isWinner && (
                      <div className="paddle-tag" style={{ marginTop: "0.5rem" }}>
                        Winner
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* Verdict (revealed phase) */}
        <AnimatePresence>
          {isRevealed && state.published && (
            <motion.div
              className="verdict"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4 }}
              style={{ marginTop: "3rem" }}
            >
              <div className="verdict-inner">
                <div className="verdict-eyebrow">The gavel falls</div>
                <h3>{state.reserveMet ? "Sold." : "No sale — reserve not met."}</h3>

                {state.reserveMet ? (
                  <>
                    <div className="verdict-grid">
                      <div className="verdict-cell">
                        <div className="k">Winner</div>
                        <div className="v addr">{short(state.winner)}</div>
                      </div>
                      <div className="verdict-cell">
                        <div className="k">Clearing price (2nd)</div>
                        <div className="v">{ethers.formatEther(state.clearingPrice)} ETH</div>
                      </div>
                    </div>
                    <p className="verdict-foot">
                      The winner pays the second-highest price. Every losing bid, and the winner's true bid, stays sealed forever.
                    </p>
                  </>
                ) : (
                  <p className="verdict-foot">
                    No bid cleared the secret reserve. The item goes unsold — and no one ever learns the reserve or a single bid.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <footer className="footer">
        <span className="footer-meta">CipherGavel — confidential Vickrey auctions on Zama fhEVM</span>
      </footer>
    </div>
  );
}
