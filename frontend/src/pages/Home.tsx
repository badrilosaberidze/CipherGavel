import { Link } from "react-router-dom";
import { WaxSeal } from "../components/WaxSeal";

export function Home() {
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
            <Link className="btn btn-primary" to="/create">Create Auction</Link>
            <a className="btn btn-ghost" href="#ledger">What stays secret</a>
          </div>
        </div>
        <div className="hero-stage">
          <div className="stage-plinth" />
          <WaxSeal size={230} idle />
          <span className="seal-caption">Lot 001 — sealed</span>
        </div>
      </section>

      {/* ---------- privacy ledger ---------- */}
      <section className="section" id="ledger">
        <div className="section-head">
          <div>
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

        <div className="hero-cta" style={{ marginTop: "2.5rem" }}>
          <Link className="btn btn-primary" to="/create">Create your sealed auction</Link>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="footer">
        <span className="footer-meta">CipherGavel — confidential Vickrey auctions on Zama fhEVM</span>
      </footer>
    </>
  );
}
