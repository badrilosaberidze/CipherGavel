import { Routes, Route, Link } from "react-router-dom";
import { useWallet } from "./wallet";
import { Home } from "./pages/Home";
import { Create } from "./pages/Create";
import { Auction } from "./pages/Auction";

export default function App() {
  const wallet = useWallet();

  return (
    <div className="wrap">
      {/* ---------- top bar (shared across all pages) ---------- */}
      <header className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="brand-mark">CG</span>
          <span className="brand-name">CipherGavel</span>
        </Link>
        <div className="topbar-right">
          <span className="pill"><span className="dot" /> Sepolia</span>
          {wallet.account ? (
            <span className="pill mono">{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span>
          ) : (
            <button className="btn btn-ghost" onClick={wallet.connect} disabled={wallet.busy}>
              {wallet.busy ? "Connecting…" : "Connect MetaMask"}
            </button>
          )}
        </div>
      </header>

      {/* ---------- routes ---------- */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/auction/:address" element={<Auction />} />
      </Routes>
    </div>
  );
}
