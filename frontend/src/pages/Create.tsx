import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../wallet";
import { ABI, BYTECODE } from "../contract";

export function Create() {
  const { account, provider, connect, busy: walletBusy } = useWallet();
  const navigate = useNavigate();

  const [depositEth, setDepositEth] = useState("0.001");
  const [periodSeconds, setPeriodSeconds] = useState("300");
  const [maxBidders, setMaxBidders] = useState("3");

  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function handleDeploy() {
    if (!provider || !account) {
      setError("Please connect your wallet first");
      return;
    }

    setError(null);
    setDeploying(true);
    setStatus("Preparing deployment...");

    try {
      const depositWei = ethers.parseEther(depositEth);
      const period = parseInt(periodSeconds);
      const max = parseInt(maxBidders);

      if (isNaN(period) || period <= 0) {
        throw new Error("Invalid bidding period");
      }
      if (isNaN(max) || max <= 0 || max > 10) {
        throw new Error("Max bidders must be between 1 and 10");
      }

      setStatus("Deploying contract...");
      const signer = await provider.getSigner();
      const factory = new ethers.ContractFactory(ABI, BYTECODE, signer);

      const contract = await factory.deploy(depositWei, period, max);

      setStatus("Waiting for confirmation...");
      await contract.waitForDeployment();

      const address = await contract.getAddress();
      setStatus(`Deployed at ${address}`);

      // Navigate to the new auction
      setTimeout(() => {
        navigate(`/auction/${address}`);
      }, 1500);

    } catch (err: any) {
      console.error("Deployment failed:", err);
      setError(err.message || "Deployment failed");
      setStatus("");
    } finally {
      setDeploying(false);
    }
  }

  const showHCUWarning = parseInt(maxBidders) > 3;

  return (
    <div className="wrap">
      <section className="section">
        <div className="section-head">
          <div>
            <div className="section-num">Create Auction</div>
            <h2>Deploy a new sealed-bid auction</h2>
          </div>
        </div>

        <div className="floor">
          <aside className="console" style={{ maxWidth: "500px", margin: "0 auto" }}>
            {!account ? (
              <>
                <p style={{ color: "var(--ivory)", marginBottom: "1.5rem" }}>
                  Connect your wallet to deploy a new CipherGavel auction instance on Sepolia.
                  You will become the seller and can set the encrypted reserve.
                </p>
                <div className="console-actions">
                  <button
                    className="btn btn-primary"
                    onClick={connect}
                    disabled={walletBusy}
                  >
                    {walletBusy ? "Connecting..." : "Connect MetaMask"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="console-row">
                  <span className="console-label">Connected</span>
                  <span className="console-value mono" style={{ fontSize: "0.85rem" }}>
                    {account.slice(0, 6)}…{account.slice(-4)}
                  </span>
                </div>

                <div style={{ marginTop: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--ivory)" }}>
                    Deposit (ETH)
                  </label>
                  <input
                    type="text"
                    value={depositEth}
                    onChange={(e) => setDepositEth(e.target.value)}
                    disabled={deploying}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "var(--ink)",
                      border: "1px solid var(--dimmer)",
                      color: "var(--ivory)",
                      fontFamily: "var(--mono)",
                      fontSize: "0.9rem",
                      marginBottom: "1rem"
                    }}
                  />

                  <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--ivory)" }}>
                    Bidding Period (seconds)
                  </label>
                  <input
                    type="number"
                    value={periodSeconds}
                    onChange={(e) => setPeriodSeconds(e.target.value)}
                    disabled={deploying}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "var(--ink)",
                      border: "1px solid var(--dimmer)",
                      color: "var(--ivory)",
                      fontFamily: "var(--mono)",
                      fontSize: "0.9rem",
                      marginBottom: "1rem"
                    }}
                  />

                  <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--ivory)" }}>
                    Max Bidders
                  </label>
                  <input
                    type="number"
                    value={maxBidders}
                    onChange={(e) => setMaxBidders(e.target.value)}
                    disabled={deploying}
                    min="1"
                    max="10"
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "var(--ink)",
                      border: "1px solid var(--dimmer)",
                      color: "var(--ivory)",
                      fontFamily: "var(--mono)",
                      fontSize: "0.9rem",
                      marginBottom: showHCUWarning ? "0.5rem" : "1rem"
                    }}
                  />

                  {showHCUWarning && (
                    <p style={{ color: "var(--wax-soft)", fontSize: "0.8rem", marginBottom: "1rem" }}>
                      ⚠ HCU limit: keep ≤3 for live Sepolia runs
                    </p>
                  )}
                </div>

                {status && (
                  <div className="console-row" style={{ marginBottom: "1rem" }}>
                    <span className="console-label">Status</span>
                    <span className="console-value" style={{ fontSize: "0.85rem" }}>{status}</span>
                  </div>
                )}

                {error && (
                  <p style={{ color: "var(--wax)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                    {error}
                  </p>
                )}

                <div className="console-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleDeploy}
                    disabled={deploying}
                  >
                    {deploying ? "Deploying..." : "Deploy Auction"}
                  </button>
                </div>

                <p style={{ color: "var(--dimmer)", fontSize: "0.75rem", marginTop: "1rem", textAlign: "center" }}>
                  You will become the seller. Gas cost ~0.02 ETH on Sepolia.
                </p>
              </>
            )}
          </aside>
        </div>
      </section>

      <footer className="footer">
        <span className="footer-meta">CipherGavel — confidential Vickrey auctions on Zama fhEVM</span>
      </footer>
    </div>
  );
}
