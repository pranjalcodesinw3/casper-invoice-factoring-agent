"use client";

import { useMemo, useState } from "react";
import {
  runUnderwriting,
  SCENARIOS,
  Scenario,
  UnderwritingResult,
} from "@/lib/agent-client";
import {
  buildOpenNoteDeploy,
  explorerDeployUrl,
  mapNoteArgsToContract,
  noteIdFromString,
  truncateHex,
} from "@/lib/casper";
import { useWallet } from "@/lib/wallet";
import styles from "./UnderwritePanel.module.css";

export interface OpenedNote {
  noteId: number;
  seller: string;
  faceValueMotes: string;
  riskScore: number;
  riskDataHash: string;
  deployHash: string;
  invoiceId: string;
}

interface UnderwritePanelProps {
  onEvaluated?: (result: UnderwritingResult) => void;
  onNoteOpened?: (note: OpenedNote) => void;
}

type DeployStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "sent"; deployHash: string }
  | { state: "error"; message: string }
  | { state: "cancelled" };

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;

export default function UnderwritePanel({ onEvaluated, onNoteOpened }: UnderwritePanelProps) {
  const wallet = useWallet();
  const [scenarioKey, setScenarioKey] = useState<Scenario["key"]>("good");
  const [minRiskScore, setMinRiskScore] = useState("50");
  const [sellerAddress, setSellerAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnderwritingResult | null>(null);
  const [deploy, setDeploy] = useState<DeployStatus>({ state: "idle" });

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0],
    [scenarioKey]
  );

  const runEvaluation = async () => {
    const min = Number.parseInt(minRiskScore, 10);
    if (Number.isNaN(min) || min < 0 || min > 100) {
      setError("Minimum risk score must be an integer between 0 and 100.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setDeploy({ state: "idle" });

    try {
      const outcome = await runUnderwriting({
        invoice: scenario.invoice,
        debtorId: scenario.debtorId,
        minRiskScore: min,
      });
      setResult(outcome);
      onEvaluated?.(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[underwrite-panel] underwrite request failed:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const openNoteOnChain = async () => {
    if (!result || !result.noteArgs) return;

    if (!CONTRACT_HASH) {
      setDeploy({ state: "error", message: "NEXT_PUBLIC_CONTRACT_HASH is not configured." });
      return;
    }
    if (!wallet.publicKeyHex) {
      setDeploy({ state: "error", message: "Connect the owner wallet before opening a note." });
      return;
    }
    const seller = sellerAddress.trim();
    if (!seller) {
      setDeploy({
        state: "error",
        message: "Enter the seller's Casper public key (or account-hash) to receive funding.",
      });
      return;
    }

    setDeploy({ state: "pending" });
    try {
      // Map the agent's noteArgs onto the contract types: u64 note_id derived from the
      // note id string, Address seller from the supplied public key, and the recommended
      // advance amount as the on-chain face value in motes.
      const contractArgs = mapNoteArgsToContract(
        result.noteArgs,
        seller,
        result.decision.fundingAmount
      );

      const { deployJson, deployHashHex } = buildOpenNoteDeploy(
        CONTRACT_HASH,
        wallet.publicKeyHex,
        contractArgs
      );

      const outcome = await wallet.sendDeploy(deployJson, wallet.publicKeyHex);
      if (outcome.cancelled) {
        setDeploy({ state: "cancelled" });
      } else if (outcome.error) {
        setDeploy({ state: "error", message: outcome.error });
      } else {
        const hash = outcome.deployHash ?? deployHashHex;
        setDeploy({ state: "sent", deployHash: hash });
        onNoteOpened?.({
          noteId: contractArgs.noteId,
          seller: contractArgs.sellerAddress,
          faceValueMotes: contractArgs.faceValueMotes,
          riskScore: contractArgs.riskScore,
          riskDataHash: contractArgs.riskDataHash,
          deployHash: hash,
          invoiceId: result.invoice.invoice_id,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[underwrite-panel] failed to build open_note deploy:", message);
      setDeploy({ state: "error", message });
    }
  };

  const approved = result?.decision.approved ?? false;

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <h2>Underwrite invoice &amp; open note</h2>
        <span>x402 paid risk data, HMAC verify, AI decision</span>
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Scenario</span>
          <select
            className={styles.select}
            value={scenarioKey}
            onChange={(e) => setScenarioKey(e.target.value as Scenario["key"])}
          >
            {SCENARIOS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Min risk score</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={minRiskScore}
            onChange={(e) => setMinRiskScore(e.target.value)}
          />
        </label>
      </div>

      <div className={styles.invoiceSummary}>
        <div className={styles.invoiceCell}>
          <span className={styles.label}>Invoice</span>
          <span className="mono">{scenario.invoice.invoice_id}</span>
        </div>
        <div className={styles.invoiceCell}>
          <span className={styles.label}>Debtor</span>
          <span>{scenario.invoice.debtor_name}</span>
        </div>
        <div className={styles.invoiceCell}>
          <span className={styles.label}>Face value</span>
          <span className="mono">${scenario.invoice.face_value.toLocaleString()}</span>
        </div>
        <div className={styles.invoiceCell}>
          <span className={styles.label}>Days overdue</span>
          <span className="mono">{scenario.invoice.days_overdue}</span>
        </div>
      </div>

      <button
        type="button"
        className={styles.primaryButton}
        onClick={runEvaluation}
        disabled={loading}
      >
        {loading ? "Underwriting..." : "Fetch signed risk report & underwrite"}
      </button>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {result && (
        <>
          <div className={styles.pipeline}>
            <div className={styles.pipelineTitle}>Paid data request</div>
            <div className={styles.pipelineStep}>
              <span className={styles.mark}>1</span>
              <span>HTTP 402 Payment Required returned by the risk data provider</span>
            </div>
            <div className={styles.pipelineStep}>
              <span className={styles.mark}>2</span>
              <span>Agent paid the reference and re-requested the risk report</span>
            </div>
            <div className={styles.pipelineStep}>
              <span className={styles.mark}>3</span>
              <span>Signed risk report received for {result.riskReport.debtor}</span>
            </div>
            <div className={styles.badgeRow}>
              <span
                className={`${styles.badge} ${
                  result.dataSignatureValid ? styles.badgePass : styles.badgeFail
                }`}
              >
                {result.dataSignatureValid ? "SIGNATURE PASS" : "SIGNATURE FAIL"}
              </span>
            </div>
          </div>

          <div className={styles.comparison}>
            <div className={styles.comparisonCell}>
              <span className={styles.label}>Risk score</span>
              <span className={`${styles.value} mono`}>{result.riskReport.riskScore}</span>
            </div>
            <span className={styles.comparisonOperator}>{approved ? ">=" : "<"}</span>
            <div className={styles.comparisonCell}>
              <span className={styles.label}>Min threshold</span>
              <span className={`${styles.value} mono`}>{minRiskScore}</span>
            </div>
          </div>

          <ul className={styles.factors}>
            {result.riskReport.factors.map((factor, i) => (
              <li key={i} className={styles.factor}>
                {factor}
              </li>
            ))}
          </ul>

          <div
            className={`${styles.outcome} ${
              approved ? styles.outcomeApproved : styles.outcomeDeclined
            }`}
          >
            <span className={styles.outcomeLabel}>
              {approved
                ? `Approved, advance ${(result.decision.recommendedAdvanceRate * 100).toFixed(0)}%`
                : "Declined, note not opened"}
            </span>
            {approved && (
              <div className={styles.fundingRow}>
                <span>
                  Funding amount:{" "}
                  <strong className="mono">
                    ${result.decision.fundingAmount.toLocaleString()}
                  </strong>
                </span>
              </div>
            )}
            <p className={styles.memo}>{result.decision.memo}</p>
          </div>

          <div className={styles.chainSection}>
            <p className={styles.chainNote}>
              open_note is owner-gated on-chain: only the wallet holding the ReceivableEscrow
              owner key (the agent-underwriter authority) can execute it, and the risk score
              must clear the contract&apos;s configured minimum. The invoice id maps to a
              deterministic u64 note id, and the seller public key below is encoded as the
              Odra Address that receives investor funding.
            </p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Seller public key (Address)</span>
              <input
                className={styles.input}
                placeholder="0202abc... or account-hash-..."
                value={sellerAddress}
                onChange={(e) => setSellerAddress(e.target.value)}
                disabled={!approved}
              />
            </label>
            {approved && result.noteArgs && (
              <div className={styles.notePreview}>
                <span>
                  note_id <strong className="mono">{noteIdFromString(result.noteArgs.note_id)}</strong>
                </span>
                <span>
                  risk_data_hash{" "}
                  <strong className="mono">
                    {truncateHex(result.noteArgs.risk_data_hash, 10, 8)}
                  </strong>
                </span>
              </div>
            )}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={openNoteOnChain}
              disabled={!approved || deploy.state === "pending"}
            >
              {deploy.state === "pending" ? "Awaiting wallet..." : "Open note on-chain"}
            </button>

            {deploy.state === "sent" && (
              <div className={styles.deployResult}>
                <span>Deploy submitted.</span>
                <a href={explorerDeployUrl(deploy.deployHash)} target="_blank" rel="noreferrer">
                  {explorerDeployUrl(deploy.deployHash)}
                </a>
              </div>
            )}
            {deploy.state === "cancelled" && (
              <div className={styles.deployResult}>Signing was cancelled in the wallet.</div>
            )}
            {deploy.state === "error" && (
              <div className={styles.deployError}>{deploy.message}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
