"use client";

import { useMemo, useState } from "react";
import {
  buildDeclareDefaultDeploy,
  buildFundNoteDeploy,
  buildMarkRepaidDeploy,
  DEMO_USD_PER_CSPR,
  explorerDeployUrl,
  isOwnerPublicKey,
  motesToCspr,
  truncateHex,
} from "@/lib/casper";
import { useWallet } from "@/lib/wallet";
import type { OpenedNote } from "./UnderwritePanel";
import styles from "./FundNotePanel.module.css";

interface FundNotePanelProps {
  notes: OpenedNote[];
  onNoteFunded?: (noteId: number, fundDeployHash: string) => void;
  onNoteRepaid?: (noteId: number, repayDeployHash: string) => void;
}

type DeployStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "sent"; deployHash: string }
  | { state: "error"; message: string }
  | { state: "cancelled" };

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;
const CONTRACT_PACKAGE_HASH = process.env.NEXT_PUBLIC_CONTRACT_PACKAGE_HASH;
const OWNER_PUBLIC_KEY = process.env.NEXT_PUBLIC_OWNER_PUBLIC_KEY;

export default function FundNotePanel({
  notes,
  onNoteFunded,
  onNoteRepaid,
}: FundNotePanelProps) {
  const wallet = useWallet();
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [fundDeploy, setFundDeploy] = useState<DeployStatus>({ state: "idle" });
  const [repayDeploy, setRepayDeploy] = useState<DeployStatus>({ state: "idle" });
  const [defaultDeploy, setDefaultDeploy] = useState<DeployStatus>({ state: "idle" });

  const isOwner = isOwnerPublicKey(wallet.publicKeyHex, OWNER_PUBLIC_KEY);

  const openNotes = useMemo(
    () => notes.filter((n) => n.status === "open"),
    [notes]
  );
  const fundedNotes = useMemo(
    () => notes.filter((n) => n.status === "funded"),
    [notes]
  );

  const selectedNote = useMemo(() => {
    if (selectedNoteId === null) return openNotes[0] ?? null;
    return openNotes.find((n) => n.noteId === selectedNoteId) ?? openNotes[0] ?? null;
  }, [openNotes, selectedNoteId]);

  const fundNoteOnChain = async () => {
    if (!selectedNote) return;

    if (!CONTRACT_PACKAGE_HASH) {
      setFundDeploy({
        state: "error",
        message: "NEXT_PUBLIC_CONTRACT_PACKAGE_HASH is not configured.",
      });
      return;
    }
    if (!wallet.publicKeyHex) {
      setFundDeploy({ state: "error", message: "Connect an investor wallet to fund the note." });
      return;
    }

    setFundDeploy({ state: "pending" });
    try {
      const { deployJson } = await buildFundNoteDeploy(
        CONTRACT_PACKAGE_HASH,
        wallet.publicKeyHex,
        selectedNote.noteId,
        selectedNote.faceValueMotes
      );

      const outcome = await wallet.sendDeploy(deployJson, wallet.publicKeyHex);
      if (outcome.cancelled) {
        setFundDeploy({ state: "cancelled" });
      } else if (outcome.error || !outcome.deployHash) {
        // Never fall back to the locally built hash. It is computable before
        // signing, so showing it would link to a "deploy" the node never saw.
        setFundDeploy({
          state: "error",
          message: outcome.error ?? "Wallet returned no deploy hash",
        });
      } else {
        setFundDeploy({ state: "sent", deployHash: outcome.deployHash });
        onNoteFunded?.(selectedNote.noteId, outcome.deployHash);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fund-note-panel] failed to build fund_note deploy:", message);
      setFundDeploy({ state: "error", message });
    }
  };

  const markRepaidOnChain = async (note: OpenedNote) => {
    if (!CONTRACT_HASH) {
      setRepayDeploy({ state: "error", message: "NEXT_PUBLIC_CONTRACT_HASH is not configured." });
      return;
    }
    if (!wallet.publicKeyHex) {
      setRepayDeploy({ state: "error", message: "Connect the owner wallet before marking repaid." });
      return;
    }
    if (!isOwner) {
      setRepayDeploy({
        state: "error",
        message: "mark_repaid is owner-gated. Connect the contract owner key.",
      });
      return;
    }

    setRepayDeploy({ state: "pending" });
    try {
      const { deployJson } = buildMarkRepaidDeploy(
        CONTRACT_HASH,
        wallet.publicKeyHex,
        note.noteId
      );

      const outcome = await wallet.sendDeploy(deployJson, wallet.publicKeyHex);
      if (outcome.cancelled) {
        setRepayDeploy({ state: "cancelled" });
      } else if (outcome.error || !outcome.deployHash) {
        setRepayDeploy({
          state: "error",
          message: outcome.error ?? "Wallet returned no deploy hash",
        });
      } else {
        setRepayDeploy({ state: "sent", deployHash: outcome.deployHash });
        onNoteRepaid?.(note.noteId, outcome.deployHash);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fund-note-panel] failed to build mark_repaid deploy:", message);
      setRepayDeploy({ state: "error", message });
    }
  };

  /**
   * Declares a funded note in default, paying its investor out of the
   * underwriter's bond.
   *
   * This is the entrypoint the whole product argues for, and it had no control
   * at all: the bond was described in prose while the only way to exercise a
   * slash was a script. The honest boundary is stated at the button, because a
   * contract cannot observe that an invoice went unpaid in the real world.
   */
  const declareDefaultOnChain = async (note: OpenedNote) => {
    if (!CONTRACT_HASH) {
      setDefaultDeploy({ state: "error", message: "NEXT_PUBLIC_CONTRACT_HASH is not configured." });
      return;
    }
    if (!wallet.publicKeyHex) {
      setDefaultDeploy({ state: "error", message: "Connect the owner wallet before declaring a default." });
      return;
    }
    if (!isOwner) {
      setDefaultDeploy({
        state: "error",
        message: "declare_default is owner-gated. Connect the contract owner key.",
      });
      return;
    }

    setDefaultDeploy({ state: "pending" });
    try {
      const { deployJson } = buildDeclareDefaultDeploy(
        CONTRACT_HASH,
        wallet.publicKeyHex,
        note.noteId
      );
      const outcome = await wallet.sendDeploy(deployJson, wallet.publicKeyHex);
      if (outcome.cancelled) {
        setDefaultDeploy({ state: "cancelled" });
      } else if (outcome.error || !outcome.deployHash) {
        setDefaultDeploy({
          state: "error",
          message: outcome.error ?? "Wallet returned no deploy hash",
        });
      } else {
        setDefaultDeploy({ state: "sent", deployHash: outcome.deployHash });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fund-note-panel] failed to build declare_default deploy:", message);
      setDefaultDeploy({ state: "error", message });
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <h2>Fund &amp; settle notes</h2>
        <span>Investor fund_note, owner mark_repaid</span>
      </div>

      {notes.length === 0 ? (
        <div className={styles.empty}>
          No open receivable notes yet. Underwrite an approved invoice and open a note
          on-chain first; investors can then attach the exact face value in CSPR.
        </div>
      ) : (
        <>
          <div className={styles.fundSection}>
            <p className={styles.chainNote}>
              fund_note is payable: the investor attaches exactly the note face value in
              native CSPR. The escrow forwards the full amount to the seller and records
              the investor. Demo rate: ${DEMO_USD_PER_CSPR.toLocaleString()} USD notional
              per 1 CSPR on testnet.
            </p>

            {openNotes.length === 0 ? (
              <div className={styles.statusBanner}>All opened notes are funded or repaid.</div>
            ) : (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Open note to fund</span>
                  <select
                    className={styles.select}
                    value={selectedNote?.noteId ?? ""}
                    onChange={(e) => setSelectedNoteId(Number(e.target.value))}
                  >
                    {openNotes.map((note) => (
                      <option key={note.noteId} value={note.noteId}>
                        {note.invoiceId} (note {note.noteId}) - {motesToCspr(note.faceValueMotes)} CSPR
                      </option>
                    ))}
                  </select>
                </label>

                {selectedNote && (
                  <div className={styles.noteSummary}>
                    <div className={styles.summaryCell}>
                      <span className={styles.label}>Invoice</span>
                      <span className="mono">{selectedNote.invoiceId}</span>
                    </div>
                    <div className={styles.summaryCell}>
                      <span className={styles.label}>Note ID</span>
                      <span className="mono">{selectedNote.noteId}</span>
                    </div>
                    <div className={styles.summaryCell}>
                      <span className={styles.label}>USD advance</span>
                      <span className="mono">${selectedNote.fundingUsd.toLocaleString()}</span>
                    </div>
                    <div className={styles.summaryCell}>
                      <span className={styles.label}>Attach (face value)</span>
                      <span className="mono">{motesToCspr(selectedNote.faceValueMotes)} CSPR</span>
                    </div>
                    <div className={styles.summaryCell}>
                      <span className={styles.label}>Seller</span>
                      <span className="mono">{truncateHex(selectedNote.seller, 8, 6)}</span>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={fundNoteOnChain}
                  disabled={!selectedNote || fundDeploy.state === "pending"}
                >
                  {fundDeploy.state === "pending"
                    ? "Awaiting wallet..."
                    : `Fund note (${selectedNote ? motesToCspr(selectedNote.faceValueMotes) : "0"} CSPR)`}
                </button>

                {fundDeploy.state === "sent" && (
                  <div className={styles.deployResult}>
                    <span>NoteFunded deploy submitted.</span>
                    <a href={explorerDeployUrl(fundDeploy.deployHash)} target="_blank" rel="noreferrer">
                      {explorerDeployUrl(fundDeploy.deployHash)}
                    </a>
                  </div>
                )}
                {fundDeploy.state === "cancelled" && (
                  <div className={styles.deployResult}>Signing was cancelled in the wallet.</div>
                )}
                {fundDeploy.state === "error" && (
                  <div className={styles.deployError}>{fundDeploy.message}</div>
                )}
              </>
            )}
          </div>

          {fundedNotes.length > 0 && (
            <div className={styles.repaySection}>
              <div className={styles.repayHeading}>
                <span className={styles.repayTitle}>Mark repaid (owner)</span>
                {isOwner ? (
                  <span className={styles.ownerBadge}>Owner wallet connected</span>
                ) : (
                  <span className={styles.ownerBadgeMuted}>
                    Connect owner key{OWNER_PUBLIC_KEY ? " (configured)" : ""}
                  </span>
                )}
              </div>
              <p className={styles.chainNote}>
                Once the debtor settles off-chain, the agent-underwriter calls mark_repaid to
                close the note lifecycle. Only the contract owner can execute this entrypoint.
              </p>

              <ul className={styles.fundedList}>
                {fundedNotes.map((note) => (
                  <li key={note.noteId} className={styles.fundedItem}>
                    <div className={styles.fundedMeta}>
                      <span className="mono">{note.invoiceId}</span>
                      <span className="mono">note {note.noteId}</span>
                      <span className="mono">{motesToCspr(note.faceValueMotes)} CSPR</span>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => markRepaidOnChain(note)}
                      disabled={!isOwner || repayDeploy.state === "pending"}
                    >
                      {repayDeploy.state === "pending" ? "Awaiting wallet..." : "Mark repaid"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => declareDefaultOnChain(note)}
                      disabled={!isOwner || defaultDeploy.state === "pending"}
                      title="Pays this note's investor out of the underwriter's bond"
                    >
                      {defaultDeploy.state === "pending"
                        ? "Awaiting wallet..."
                        : "Declare default"}
                    </button>
                  </li>
                ))}
              </ul>

              {/* The honest boundary, stated at the control rather than in a
                  footer: the chain cannot see that an invoice went unpaid. */}
              <p className={styles.chainNote}>
                declare_default is the slash path. A contract cannot observe a
                real-world non-payment, so the declaration is an owner call. What
                the contract enforces is everything after it: only a funded note
                can default, the payout is capped by what was actually staked,
                and the money goes to the note&apos;s recorded investor.
              </p>

              {defaultDeploy.state === "sent" && (
                <div className={styles.deployResult}>
                  <span>NoteDefaulted deploy submitted, bond slashed to the investor.</span>
                  <a
                    href={explorerDeployUrl(defaultDeploy.deployHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {explorerDeployUrl(defaultDeploy.deployHash)}
                  </a>
                </div>
              )}
              {defaultDeploy.state === "cancelled" && (
                <div className={styles.deployResult}>Signing was cancelled in the wallet.</div>
              )}
              {defaultDeploy.state === "error" && (
                <div className={styles.deployError}>{defaultDeploy.message}</div>
              )}

              {repayDeploy.state === "sent" && (
                <div className={styles.deployResult}>
                  <span>NoteRepaid deploy submitted.</span>
                  <a href={explorerDeployUrl(repayDeploy.deployHash)} target="_blank" rel="noreferrer">
                    {explorerDeployUrl(repayDeploy.deployHash)}
                  </a>
                </div>
              )}
              {repayDeploy.state === "cancelled" && (
                <div className={styles.deployResult}>Signing was cancelled in the wallet.</div>
              )}
              {repayDeploy.state === "error" && (
                <div className={styles.deployError}>{repayDeploy.message}</div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
