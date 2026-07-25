"use client";

import { useCallback, useMemo, useState } from "react";
import FundNotePanel from "@/components/FundNotePanel";
import ProofPanel from "@/components/ProofPanel";
import UnderwritePanel, { OpenedNote } from "@/components/UnderwritePanel";
import WalletButton from "@/components/WalletButton";
import { explorerDeployUrl, truncateHex } from "@/lib/casper";
import { UnderwritingResult } from "@/lib/agent-client";
import { useWallet } from "@/lib/wallet";
import styles from "@/app/page.module.css";

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;

type StepStatus = "complete" | "active" | "pending";

interface FlowStep {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
  href?: string;
}

export default function HomeDashboard() {
  const wallet = useWallet();
  const [result, setResult] = useState<UnderwritingResult | null>(null);
  const [notes, setNotes] = useState<OpenedNote[]>([]);

  const onNoteOpened = useCallback((note: OpenedNote) => {
    setNotes((prev) => [note, ...prev]);
  }, []);

  const onNoteFunded = useCallback((noteId: number, fundDeployHash: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.noteId === noteId ? { ...n, status: "funded" as const, fundDeployHash } : n
      )
    );
  }, []);

  const onNoteRepaid = useCallback((noteId: number, repayDeployHash: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.noteId === noteId ? { ...n, status: "repaid" as const, repayDeployHash } : n
      )
    );
  }, []);

  const steps = useMemo((): FlowStep[] => {
    const walletConnected = Boolean(wallet.publicKeyHex);
    const evaluated = Boolean(result);
    const approved = result?.decision.approved ?? false;
    const opened = notes.length > 0;
    const funded = notes.some((n) => n.status === "funded" || n.status === "repaid");
    const repaid = notes.some((n) => n.status === "repaid");
    const latestFundHash = notes.find((n) => n.fundDeployHash)?.fundDeployHash;
    const latestRepayHash = notes.find((n) => n.repayDeployHash)?.repayDeployHash;
    const latestOpenHash = notes[0]?.deployHash;

    return [
      {
        id: "wallet",
        title: "Connect owner wallet",
        detail: walletConnected
          ? `Signer ${truncateHex(wallet.publicKeyHex ?? "", 10, 8)}`
          : "CSPR.click session required to sign open_note",
        status: walletConnected ? "complete" : "active",
      },
      {
        id: "data",
        title: "Pay data endpoint (x402)",
        detail: evaluated
          ? "Signed risk report fetched and HMAC verified"
          : "Agent pays the reference and pulls a signed risk report",
        status: evaluated ? "complete" : walletConnected ? "active" : "pending",
      },
      {
        id: "decide",
        title: "AI underwriting decision",
        detail: evaluated
          ? approved
            ? "Approved: risk cleared threshold, advance recommended"
            : "Declined: risk below threshold, no note opened"
          : "Compares risk score to threshold and writes a memo",
        status: evaluated ? "complete" : "pending",
      },
      {
        id: "open",
        title: "Open receivable note on-chain",
        detail: opened
          ? `Note ${notes[0].noteId} opened via NoteOpened deploy`
          : "Owner calls open_note(note_id, seller, face_value, risk_score, hash)",
        status: opened ? "complete" : approved ? "active" : "pending",
        href: latestOpenHash ? explorerDeployUrl(latestOpenHash) : undefined,
      },
      {
        id: "fund",
        title: "Investor funds note",
        detail: funded
          ? `NoteFunded deploy: escrow forwarded CSPR to seller`
          : opened
            ? "Investor attaches exact face value via payable fund_note"
            : "Waiting for an open note",
        status: funded ? "complete" : opened ? "active" : "pending",
        href: latestFundHash ? explorerDeployUrl(latestFundHash) : undefined,
      },
      {
        id: "repay",
        title: "Owner marks note repaid",
        detail: repaid
          ? `NoteRepaid deploy closed the lifecycle`
          : funded
            ? "Owner calls mark_repaid after debtor settles off-chain"
            : "Waiting for funding",
        status: repaid ? "complete" : funded ? "active" : "pending",
        href: latestRepayHash ? explorerDeployUrl(latestRepayHash) : undefined,
      },
      {
        id: "proof",
        title: "On-chain proof",
        detail: opened
          ? `${notes.length} note deploy(s) live on testnet.cspr.live`
          : "Deploy hash links to the settled note on the explorer",
        status: repaid ? "complete" : opened ? "pending" : "pending",
      },
    ];
  }, [notes, result, wallet.publicKeyHex]);

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <strong>Invoice Factoring Agent</strong>
          <span>Agentic underwriting on Casper</span>
        </div>
        <WalletButton />
      </header>

      <section className={styles.hero}>
        <h1>Advances that clear on verified risk, not gut feel.</h1>
        <p>
          An autonomous underwriter pays a data endpoint for a signed risk report, decides
          whether an invoice qualifies for an advance, and opens the receivable note on-chain
          so an investor can fund it. Declines are just as visible: no note, no funding.
        </p>
        <div className={styles.metaRow}>
          <span className={styles.metaChip}>
            <span className={styles.metaDot} aria-hidden />
            Casper testnet
          </span>
          <span className={styles.metaChip}>
            Contract
            <span className={styles.metaValue}>
              {CONTRACT_HASH ? truncateHex(CONTRACT_HASH) : "not configured"}
            </span>
          </span>
        </div>
      </section>

      <ol className={styles.timeline}>
        {steps.map((step, index) => (
          <li key={step.id} className={`${styles.step} ${styles[step.status]}`}>
            <span className={styles.stepMark}>{index + 1}</span>
            <div className={styles.stepBody}>
              <span className={styles.stepTitle}>{step.title}</span>
              {step.href ? (
                <a
                  className={styles.stepDetailLink}
                  href={step.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {step.detail}
                </a>
              ) : (
                <span className={styles.stepDetail}>{step.detail}</span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className={styles.grid}>
        <UnderwritePanel onEvaluated={setResult} onNoteOpened={onNoteOpened} />
        <FundNotePanel notes={notes} onNoteFunded={onNoteFunded} onNoteRepaid={onNoteRepaid} />
        <ProofPanel notes={notes} />
      </div>

      <footer className={styles.footer}>
        Reads signed risk data through an x402 paid endpoint, verifies the HMAC signature, and
        settles through the ReceivableEscrow Odra contract. Testnet only.
      </footer>
    </div>
  );
}
