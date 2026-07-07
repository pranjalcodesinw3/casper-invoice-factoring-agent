"use client";

import { explorerContractUrl, explorerDeployUrl, MOTES_PER_CSPR, truncateHex } from "@/lib/casper";
import type { OpenedNote } from "./UnderwritePanel";
import styles from "./ProofPanel.module.css";

interface ProofPanelProps {
  notes: OpenedNote[];
}

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;

function motesToCspr(motes: string): string {
  try {
    const value = BigInt(motes);
    const whole = value / MOTES_PER_CSPR;
    const fraction = value % MOTES_PER_CSPR;
    if (fraction === BigInt(0)) return whole.toString();
    const frac = fraction.toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole.toString()}.${frac}`;
  } catch {
    return motes;
  }
}

export default function ProofPanel({ notes }: ProofPanelProps) {
  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <h2>On-chain proof</h2>
        <span>NoteOpened deploys on Casper testnet</span>
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
          note on-chain to populate this proof table with a live testnet deploy.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.eventsTable}>
            <thead>
              <tr>
                <th className={styles.headerCell}>Invoice</th>
                <th className={styles.headerCell}>Note ID</th>
                <th className={styles.headerCell}>Seller</th>
                <th className={styles.headerCell}>Face value</th>
                <th className={styles.headerCell}>Risk</th>
                <th className={styles.headerCell}>Risk data hash</th>
                <th className={styles.headerCell}>Deploy</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note, index) => (
                <tr key={`${note.deployHash}-${index}`} className={styles.bodyRow}>
                  <td className={styles.bodyCell}>{note.invoiceId}</td>
                  <td className={`${styles.bodyCell} mono`}>{note.noteId}</td>
                  <td className={`${styles.bodyCell} mono`}>{truncateHex(note.seller, 8, 6)}</td>
                  <td className={`${styles.bodyCell} mono`}>
                    {motesToCspr(note.faceValueMotes)} CSPR
                  </td>
                  <td className={`${styles.bodyCell} mono`}>{note.riskScore}</td>
                  <td className={`${styles.bodyCell} mono`}>
                    {truncateHex(note.riskDataHash, 8, 6)}
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
