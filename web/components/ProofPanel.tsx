"use client";

import { explorerContractUrl, explorerDeployUrl, motesToCspr, truncateHex } from "@/lib/casper";
import type { OpenedNote } from "./UnderwritePanel";
import styles from "./ProofPanel.module.css";

interface ProofPanelProps {
  notes: OpenedNote[];
}

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;

const STATUS_LABEL: Record<OpenedNote["status"], string> = {
  open: "Open",
  funded: "Funded",
  repaid: "Repaid",
};

export default function ProofPanel({ notes }: ProofPanelProps) {
  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <h2>On-chain proof</h2>
        <span>NoteOpened / NoteFunded / NoteRepaid deploys</span>
        {CONTRACT_HASH && (
          <a
            className={styles.contractLink}
            href={explorerContractUrl(CONTRACT_HASH)}
            target="_blank"
            rel="noreferrer"
          >
            View contract
          </a>
        )}
      </div>

      {notes.length === 0 ? (
        <div className={styles.empty}>
          No receivable notes opened yet. Underwrite an approved invoice above and open the
          note on-chain to populate this proof table with live testnet deploys.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.eventsTable}>
            <thead>
              <tr>
                <th className={styles.headerCell}>Invoice</th>
                <th className={styles.headerCell}>Note ID</th>
                <th className={styles.headerCell}>Status</th>
                <th className={styles.headerCell}>Face value</th>
                <th className={styles.headerCell}>Risk</th>
                <th className={styles.headerCell}>Open</th>
                <th className={styles.headerCell}>Fund</th>
                <th className={styles.headerCell}>Repay</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note, index) => (
                <tr key={`${note.deployHash}-${index}`} className={styles.bodyRow}>
                  <td className={styles.bodyCell}>{note.invoiceId}</td>
                  <td className={`${styles.bodyCell} mono`}>{note.noteId}</td>
                  <td className={styles.bodyCell}>
                    <span className={`${styles.status} ${styles[`status_${note.status}`]}`}>
                      {STATUS_LABEL[note.status]}
                    </span>
                  </td>
                  <td className={`${styles.bodyCell} mono`}>
                    {motesToCspr(note.faceValueMotes)} CSPR
                    <span className={styles.usdHint}>(${note.fundingUsd.toLocaleString()})</span>
                  </td>
                  <td className={`${styles.bodyCell} mono`}>{note.riskScore}</td>
                  <td className={styles.bodyCell}>
                    <a
                      className={styles.link}
                      href={explorerDeployUrl(note.deployHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {truncateHex(note.deployHash, 8, 6)}
                    </a>
                  </td>
                  <td className={styles.bodyCell}>
                    {note.fundDeployHash ? (
                      <a
                        className={styles.link}
                        href={explorerDeployUrl(note.fundDeployHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {truncateHex(note.fundDeployHash, 8, 6)}
                      </a>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.bodyCell}>
                    {note.repayDeployHash ? (
                      <a
                        className={styles.link}
                        href={explorerDeployUrl(note.repayDeployHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {truncateHex(note.repayDeployHash, 8, 6)}
                      </a>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
