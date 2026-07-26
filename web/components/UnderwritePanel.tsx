"use client";

/* The working surface: run the agent, then sign what it proposed.
 *
 * This panel used to render a `decision` object the server stopped returning
 * when the acceptance bar moved on-chain, and posted a `minRiskScore` the
 * server now rejects outright. Every click produced HTTP 400 and the panel
 * showed the string "Invalid request", which is the worst possible failure for
 * a demo: it looks like the agent refused the invoice rather than like the
 * frontend called an endpoint that no longer exists.
 *
 * What the server returns is an agent RUN. The evidence is the trace: which
 * contract terms it read, which signed report it bought, and whether it chose
 * to propose a note. So the trace is what this renders, and the deploy the
 * agent built is what the owner signs. Nothing here re-derives a decision.
 */

import { useMemo, useState } from "react";
import {
  lastToolResult,
  runUnderwriting,
  SCENARIOS,
  Scenario,
  UnderwriteRunResponse,
  type EscrowTermsResult,
  type ProposalResult,
  type RiskReportResult,
} from "@/lib/agent-client";
import {
  DEMO_USD_PER_CSPR,
  explorerDeployUrl,
  isOwnerPublicKey,
  motesToCspr,
  truncateHex,
  usdToFundingCspr,
} from "@/lib/casper";
import { useWallet } from "@/lib/wallet";
import styles from "./UnderwritePanel.module.css";

export type NoteStatus = "open" | "funded" | "repaid";

export interface OpenedNote {
  noteId: number;
  seller: string;
  faceValueMotes: string;
  fundingCspr: number;
  fundingUsd: number;
  riskScore: number;
  riskDataHash: string;
  deployHash: string;
  invoiceId: string;
  status: NoteStatus;
  fundDeployHash?: string;
  repayDeployHash?: string;
}

interface UnderwritePanelProps {
  onEvaluated?: (result: UnderwriteRunResponse) => void;
  onNoteOpened?: (note: OpenedNote) => void;
}

type DeployStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "sent"; deployHash: string }
  | { state: "error"; message: string }
  | { state: "cancelled" };

const OWNER_PUBLIC_KEY = process.env.NEXT_PUBLIC_OWNER_PUBLIC_KEY;

/** The note id the agent proposed, read back out of its own tool call. */
function proposedNoteId(run: UnderwriteRunResponse): number | null {
  for (let i = run.trace.length - 1; i >= 0; i -= 1) {
    const entry = run.trace[i];
    if (entry.kind === "tool_call" && entry.tool === "propose_open_note") {
      const args = entry.args as { noteId?: string } | undefined;
      const parsed = Number(args?.noteId);
      return Number.isInteger(parsed) ? parsed : null;
    }
  }
  return null;
}

export default function UnderwritePanel({ onEvaluated, onNoteOpened }: UnderwritePanelProps) {
  const wallet = useWallet();
  const [scenarioKey, setScenarioKey] = useState<Scenario["key"]>("good");
  const [sellerAddress, setSellerAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<UnderwriteRunResponse | null>(null);
  const [deploy, setDeploy] = useState<DeployStatus>({ state: "idle" });

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0],
    [scenarioKey]
  );

  const isOwner = isOwnerPublicKey(wallet.publicKeyHex, OWNER_PUBLIC_KEY);

  const report = run ? lastToolResult<RiskReportResult>(run.trace, "get_risk_report") : null;
  const terms = run ? lastToolResult<EscrowTermsResult>(run.trace, "get_escrow_terms") : null;
  const proposal = run
    ? lastToolResult<ProposalResult>(run.trace, "propose_open_note")
    : null;

  const runUnderwritingFlow = async () => {
    const seller = sellerAddress.trim() || wallet.publicKeyHex;
    if (!seller) {
      setError("Connect a wallet or enter the seller's Casper public key.");
      return;
    }
    if (!wallet.publicKeyHex) {
      setError("Connect the escrow owner wallet: open_note reverts NotOwner for anyone else.");
      return;
    }

    setLoading(true);
    setError(null);
    setRun(null);
    setDeploy({ state: "idle" });

    try {
      const outcome = await runUnderwriting({
        invoice: scenario.invoice,
        debtorId: scenario.debtorId,
        sellerPublicKeyHex: seller,
        callerPublicKeyHex: wallet.publicKeyHex,
      });
      setRun(outcome);
      onEvaluated?.(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[underwrite-panel] underwrite request failed:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const signProposedNote = async () => {
    if (!run?.deploy) return;
    if (!wallet.publicKeyHex) {
      setDeploy({ state: "error", message: "Connect the owner wallet before opening a note." });
      return;
    }
    if (!isOwner) {
      setDeploy({
        state: "error",
        message: "open_note is owner-gated. Connect the contract owner key.",
      });
      return;
    }

    const noteId = proposedNoteId(run);
    if (noteId === null) {
      setDeploy({ state: "error", message: "The agent did not propose a note id." });
      return;
    }

    setDeploy({ state: "pending" });
    try {
      const outcome = await wallet.sendDeploy(run.deploy, wallet.publicKeyHex);
      if (outcome.cancelled) {
        setDeploy({ state: "cancelled" });
      } else if (outcome.error || !outcome.deployHash) {
        setDeploy({
          state: "error",
          message: outcome.error ?? "Wallet returned no deploy hash",
        });
      } else {
        setDeploy({ state: "sent", deployHash: outcome.deployHash });
        const faceValueMotes = proposal?.faceValueMotes ?? "0";
        onNoteOpened?.({
          noteId,
          seller: sellerAddress.trim() || wallet.publicKeyHex,
          faceValueMotes,
          fundingCspr: Number(motesToCspr(faceValueMotes)),
          fundingUsd: scenario.invoice.face_value,
          riskScore: report?.riskScore ?? 0,
          riskDataHash: report?.riskDataHash ?? "",
          deployHash: outcome.deployHash,
          invoiceId: scenario.invoice.invoice_id,
          status: "open",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[underwrite-panel] failed to sign open_note deploy:", message);
      setDeploy({ state: "error", message });
    }
  };

  const proposed = run?.noteProposed === true && Boolean(run?.deploy);

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <h2>Underwrite invoice &amp; open note</h2>
        <span>x402 paid risk data, HMAC verify, agent reads the contract</span>
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
      </div>

      {/* The min risk score input is GONE, and its absence is the point: the
          acceptance bar is a term of the contract, read by the agent from
          chain. A form field here would let a demo pick its own bar. */}
      <p className={styles.chainNote}>
        The acceptance bar is not set here. The agent calls get_escrow_terms and
        reads the minimum the contract enforces, then compares the signed score
        against it.
      </p>

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
          <span className={styles.label}>On-chain note</span>
          <span className="mono">
            {usdToFundingCspr(scenario.invoice.face_value)} CSPR
          </span>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Seller public key (receives funding)</span>
        <input
          className={styles.input}
          placeholder={wallet.publicKeyHex ?? "0202abc... or account-hash-..."}
          value={sellerAddress}
          onChange={(e) => setSellerAddress(e.target.value)}
        />
      </label>

      <button
        type="button"
        className={styles.primaryButton}
        onClick={runUnderwritingFlow}
        disabled={loading}
      >
        {loading ? "Agent is underwriting..." : "Run the underwriting agent"}
      </button>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {run && (
        <>
          <div className={styles.pipeline}>
            <div className={styles.pipelineTitle}>
              What the agent did ({run.toolCalls} tool calls over {run.steps} steps)
            </div>
            {run.trace
              .filter((t) => t.kind === "tool_call")
              .map((t, i) => (
                <div key={`${t.step}-${i}`} className={styles.pipelineStep}>
                  <span className={styles.mark}>{i + 1}</span>
                  <span className="mono">{t.tool}</span>
                </div>
              ))}
            {report && (
              <div className={styles.badgeRow}>
                <span
                  className={`${styles.badge} ${
                    report.signatureValid ? styles.badgePass : styles.badgeFail
                  }`}
                >
                  {report.signatureValid ? "SIGNATURE PASS" : "SIGNATURE FAIL"}
                </span>
                {report.paidVia402 && (
                  <span className={styles.badge}>PAID VIA 402</span>
                )}
              </div>
            )}
          </div>

          {report && terms && (
            <div className={styles.comparison}>
              <div className={styles.comparisonCell}>
                <span className={styles.label}>Risk score</span>
                <span className={`${styles.value} mono`}>{report.riskScore}</span>
              </div>
              <span className={styles.comparisonOperator}>
                {report.riskScore >= terms.minRiskScore ? ">=" : "<"}
              </span>
              <div className={styles.comparisonCell}>
                <span className={styles.label}>Contract minimum</span>
                <span className={`${styles.value} mono`}>{terms.minRiskScore}</span>
              </div>
            </div>
          )}

          {report && (
            <ul className={styles.factors}>
              {report.factors.map((factor, i) => (
                <li key={i} className={styles.factor}>
                  {factor}
                </li>
              ))}
            </ul>
          )}

          {/* The bond gate, stated where it bites. open_note checks is_bonded
              BEFORE the risk score, so an unbonded desk is refused no matter
              how good the paper is. */}
          {terms && !terms.underwriterIsBonded && (
            <div className={styles.errorBanner}>
              The underwriter has staked {motesToCspr(terms.underwriterBondMotes)} CSPR
              against a {motesToCspr(terms.minBondMotes)} CSPR minimum. open_note
              reverts NotBonded until the bond is posted above.
            </div>
          )}

          <div
            className={`${styles.outcome} ${
              proposed ? styles.outcomeApproved : styles.outcomeDeclined
            }`}
          >
            <span className={styles.outcomeLabel}>
              {proposed
                ? "Agent proposed a note, awaiting the owner's signature"
                : "No note proposed"}
            </span>
            {proposal && !proposal.prepared && proposal.refusedBy && (
              <div className={styles.fundingRow}>
                <span>
                  Refused by contract clause{" "}
                  <strong className="mono">{proposal.refusedBy}</strong>
                </span>
              </div>
            )}
            {proposed && proposal?.faceValueMotes && (
              <div className={styles.fundingRow}>
                <span>
                  Note face value:{" "}
                  <strong className="mono">
                    {motesToCspr(proposal.faceValueMotes)} CSPR
                  </strong>
                  <span className={styles.rateHint}>
                    (demo: ${DEMO_USD_PER_CSPR.toLocaleString()} USD per 1 CSPR)
                  </span>
                </span>
              </div>
            )}
            <p className={styles.memo}>{run.finalText || run.explanation}</p>
          </div>

          <div className={styles.chainSection}>
            <div className={styles.ownerRow}>
              <p className={styles.chainNote}>
                The agent never holds a key and never broadcasts. It builds an
                unsigned open_note deploy; only the escrow owner can turn it into
                a note, and the contract re-checks the bond, the note id and the
                risk score independently.
              </p>
              {isOwner ? (
                <span className={styles.ownerBadge}>Owner wallet connected</span>
              ) : (
                <span className={styles.ownerBadgeMuted}>
                  Connect owner key{OWNER_PUBLIC_KEY ? " (configured)" : ""}
                </span>
              )}
            </div>
            {proposal?.deployHashHex && (
              <div className={styles.notePreview}>
                <span>
                  proposed deploy{" "}
                  <strong className="mono">
                    {truncateHex(proposal.deployHashHex, 10, 8)}
                  </strong>
                </span>
                {report && (
                  <span>
                    risk_data_hash{" "}
                    <strong className="mono">
                      {truncateHex(report.riskDataHash, 10, 8)}
                    </strong>
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={signProposedNote}
              disabled={!proposed || !isOwner || deploy.state === "pending"}
            >
              {deploy.state === "pending"
                ? "Awaiting wallet..."
                : "Sign & open note on-chain"}
            </button>

            {deploy.state === "sent" && (
              <div className={styles.deployResult}>
                <span>Deploy accepted by the node.</span>
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
