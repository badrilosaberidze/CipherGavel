import { useParams } from "react-router-dom";

export function Auction() {
  const { address } = useParams();

  return (
    <div className="wrap">
      <section className="section">
        <div className="section-head">
          <div>
            <div className="section-num">Auction View</div>
            <h2>Live Auction</h2>
          </div>
        </div>
        <p style={{ color: "var(--ivory)", padding: "2rem" }}>
          Auction at <span className="mono" style={{ color: "var(--brass)" }}>{address}</span>
        </p>
        <p style={{ color: "var(--dimmer)", padding: "0 2rem" }}>
          Step D-F implementation
        </p>
      </section>
    </div>
  );
}
