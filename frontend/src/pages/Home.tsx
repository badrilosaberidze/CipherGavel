import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { WaxSeal } from "../components/WaxSeal";
import type { Phase, SealedBid, Outcome } from "../mock";
import { ROSTER, SECRET_RESERVE, settle } from "../mock";
import { LiveStatus } from "../components/LiveStatus";
import { CONTRACT_ADDRESS } from "../contract";

export function Home() {
  const [phase, setPhase] = useState<Phase>("open");
  const [bids, setBids] = useState<SealedBid[]>([]);
  const [reserve, setReserve] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const next = ROSTER[bids.length];
  const canSeal = phase === "open" && !!next;

  function sealBid() {
    if (!canSeal) return;
    setBids((b) => [...b, { id: b.length, ...next }]);
  }
  function setSecretReserve() {
    if (phase === "open") setReserve(SECRET_RESERVE);
  }
  function dropGavel() {
    if (phase === "open" && bids.length > 0) setPhase("closed");
  }
  function reveal() {
    setOutcome(settle(bids, reserve));
    setPhase("revealed");
  }
  function reset() {
    setPhase("open");
    setBids([]);
    setReserve(null);
    setOutcome(null);
  }

  const phaseIndex = phase === "open" ? 0 : phase === "closed" ? 1 : 2;

  return (
    <>
      {/* ---------- hero ---------- */}
      <section className="hero">
        <div>
          <div className="hero-eyebrow eyebrow">Sealed-bid · Second-price · FHE</div>
          <h1 className="display">
            The auction where<br />
            every bid stays <span className="line2">sealed.</span>
          </h1>
          <p className="hero-sub">
            Bids and the seller's reserve are <strong>encrypted end-to-end</strong>. The winner and the
            second-highest price are computed directly on the ciphertext — and nothing else is ever revealed.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#floor">Enter the floor</a>
            <Link className="btn btn-ghost" to="/create">Create Auction</Link>
          </div>
        </div>
        <div className="hero-stage">
          <div className="stage-plinth" />
          <WaxSeal size={230} idle />
          <span className="seal-caption">Lot 001 — sealed</span>
        </div>
      </section>

      {/* ---------- the floor ---------- */}
      <section className="section" id="floor">
        <div className="section-head">
          <div>
            <div className="section-num">01 — The floor</div>
            <h2>Place a sealed bid</h2>
          </div>
        </div>

        <div className="floor">
          {/* console */}
          <aside className="console">
            <div className="phase-track">
              <div className={`phase-step ${phaseIndex >= 0 ? "active" : ""}`} />
              <div className={`phase-step ${phaseIndex >= 1 ? "active" : ""}`} />
              <div className={`phase-step ${phaseIndex >= 2 ? "active" : ""}`} />
            </div>

            <div className="console-row">
              <span className="console-label">Phase</span>
              <span className="console-value" style={{ textTransform: "capitalize" }}>{phase}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Sealed bids</span>
              <span className="console-value">{bids.length} / {ROSTER.length}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Reserve</span>
              <span className="console-value">{reserve === null ? "—" : "set · sealed"}</span>
            </div>
            <div className="console-row">
              <span className="console-label">Deposit</span>
              <span className="console-value mono" style={{ fontSize: "0.9rem" }}>0.001 ETH</span>
            </div>

            <div className="console-actions">
              <button className="btn btn-wax" onClick={sealBid} disabled={!canSeal}>
                {next ? `Seal a bid · ${next.paddle}` : "All bids sealed"}
              </button>
              <button className="btn btn-ghost" onClick={setSecretReserve} disabled={phase !== "open" || reserve !== null}>
                {reserve === null ? "Set secret reserve" : "Reserve sealed ✓"}
              </button>
              {phase === "open" && (
                <button className="btn btn-primary" onClick={dropGavel} disabled={bids.length === 0}>
                  Drop the gavel
                </button>
              )}
              {phase === "closed" && (
                <button className="btn btn-primary" onClick={reveal}>Break the seals</button>
              )}
              {phase === "revealed" && (
                <button className="btn btn-ghost" onClick={reset}>Run it again</button>
              )}
            </div>
          </aside>

          {/* paddles */}
          <div className="paddles">
            {bids.length === 0 && (
              <div className="empty-floor">No bids yet — seal one to begin.</div>
            )}
            <AnimatePresence>
              {bids.map((bid) => {
                const isWinner = phase === "revealed" && outcome?.winnerId === bid.id;
                const showValue = phase === "revealed" && isWinner;
                return (
                  <motion.div
                    key={bid.id}
                    layout
                    className={`paddle ${isWinner ? "winner" : ""}`}
                    initial={{ scale: 1.25, opacity: 0, y: 14 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  >
                    <div className="paddle-head">
                      <span className="paddle-id">{bid.paddle}</span>
                    </div>
                    <div className="paddle-seal">
                      <WaxSeal size={40} monogram="✶" />
                    </div>

                    <div className="paddle-id mono" style={{ marginTop: "0.4rem", fontSize: "0.7rem", color: "var(--dimmer)" }}>
                      {bid.addr}
                    </div>

                    {showValue ? (
                      <motion.div
                        className="paddle-value"
                        initial={{ opacity: 0, filter: "blur(8px)" }}
                        animate={{ opacity: 1, filter: "blur(0px)" }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                      >
                        <div className="paddle-tag">Winning bid · never published</div>
                      </motion.div>
                    ) : (
                      <div className="redaction">{phase === "revealed" ? "sealed — forever" : "sealed"}</div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ---------- the verdict ---------- */}
      <AnimatePresence>
        {phase === "revealed" && outcome && (
          <motion.section
            className="section"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="section-head">
              <div>
                <div className="section-num">02 — The verdict</div>
                <h2>Brought to light</h2>
              </div>
            </div>

            <motion.div
              className="verdict"
              initial={{ y: 40, opacity: 0, rotateX: 8 }}
              animate={{ y: 0, opacity: 1, rotateX: 0 }}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
            >
              <div className="verdict-inner">
                <div className="verdict-eyebrow">The gavel falls</div>
                <h3>{outcome.reserveMet ? "Sold." : "No sale — reserve not met."}</h3>

                {outcome.reserveMet ? (
                  <>
                    <div className="verdict-grid">
                      <div className="verdict-cell">
                        <div className="k">Winning paddle</div>
                        <div className="v">{outcome.winnerPaddle}</div>
                      </div>
                      <div className="verdict-cell">
                        <div className="k">Winner</div>
                        <div className="v addr">{outcome.winnerAddr}</div>
                      </div>
                      <div className="verdict-cell">
                        <div className="k">Clearing price (2nd)</div>
                        <div className="v">{outcome.clearingPrice}</div>
                      </div>
                    </div>
                    <p className="verdict-foot">
                      The winner pays the second-highest price — not their own bid. Every losing bid, and
                      the winner's true bid, stays sealed forever.
                    </p>
                  </>
                ) : (
                  <p className="verdict-foot">
                    No bid cleared the secret reserve. The item goes unsold — and no one ever learns the
                    reserve or a single bid.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ---------- privacy ledger ---------- */}
      <section className="section" id="ledger">
        <div className="section-head">
          <div>
            <div className="section-num">03 — The ledger</div>
            <h2>What stays secret, and what doesn't</h2>
          </div>
        </div>

        <div className="ledger">
          <div className="ledger-col sealed">
            <h4>Sealed — forever</h4>
            <div className="ledger-item">Every bid amount</div>
            <div className="ledger-item">The seller's reserve</div>
            <div className="ledger-item">The winner's true bid</div>
          </div>
          <div className="ledger-col revealed">
            <h4>Revealed — the verdict</h4>
            <div className="ledger-item">The winning bidder</div>
            <div className="ledger-item">The clearing price</div>
            <div className="ledger-item">Whether it sold</div>
          </div>
          <div className="ledger-col public">
            <h4>Never hidden — and we say so</h4>
            <div className="ledger-item">Who placed a bid</div>
            <div className="ledger-item">When they bid</div>
            <div className="ledger-item">The fixed deposit</div>
          </div>
        </div>

        <p className="ledger-note">
          <strong>The honest boundary:</strong> homomorphic encryption hides the <em>values</em> in a
          transaction, not the <em>sender</em>. Bidder addresses are public on Ethereum — hiding who bids
          would need an added zero-knowledge layer. CipherGavel protects the thing that matters strategically:
          the numbers.
        </p>
      </section>

      {/* ---------- live on Sepolia ---------- */}
      <section className="section" id="live">
        <div className="section-head">
          <div>
            <div className="section-num">— On-chain</div>
            <h2>Live on Sepolia</h2>
          </div>
        </div>
        <div className="floor">
          <LiveStatus contractAddress={CONTRACT_ADDRESS} />
          <div className="empty-floor" style={{ display: "grid", placeItems: "center" }}>
            This panel reads your deployed CipherGavel contract directly from the Sepolia network — phase,
            sealed-bid count, and the published verdict, straight from chain.
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="footer">
        <span className="footer-meta">CipherGavel — confidential Vickrey auctions on Zama fhEVM</span>
        <span className="footer-meta">Design preview · figures shown here are illustrative</span>
      </footer>
    </>
  );
}
