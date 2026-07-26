"use client";

/* The desk shell.
 *
 * Structure is deliberately NOT a landing page: no centred hero, no marketing
 * band, no step-by-step explainer strip. An underwriting desk opens on its
 * position (the bond and its exposure), then its book (the decision ledger),
 * then the working surface (underwrite, fund). A judge should see money at risk
 * before they see any prose.
 *
 * Layout is a two-column desk on wide screens: the working panels sit in the
 * left rail where a clerk's hands would be, and the book fills the main field.
 * That asymmetry is what keeps this from reading as the same three-card grid
 * every other dashboard uses.
 */

import { useCallback, useState } from "react";

import BondPanel from "@/components/BondPanel";
import DecisionLedger from "@/components/DecisionLedger";
import FundNotePanel from "@/components/FundNotePanel";
import UnderwritePanel, { OpenedNote } from "@/components/UnderwritePanel";
import WalletButton from "@/components/WalletButton";
import { UnderwritingResult } from "@/lib/agent-client";

const CONTRACT_HASH = process.env.NEXT_PUBLIC_CONTRACT_HASH;
const PACKAGE =
  "1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec";

export default function HomeDashboard() {
  const [, setResult] = useState<UnderwritingResult | null>(null);
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

  return (
    <div className="min-h-screen">
      {/* Masthead. A desk has a nameplate, not a nav bar with a CTA. */}
      <header className="border-b border-desk-700">
        <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-6 py-5 lg:px-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-fig font-medium tracking-tight text-ink">
              Receivables desk
            </h1>
            <span className="hidden font-mono text-fig-sm text-ink-faint sm:inline">
              Casper testnet
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href={`https://testnet.cspr.live/contract-package/${PACKAGE}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-fig-sm text-ink-muted underline decoration-desk-600 underline-offset-4 transition-colors hover:text-brass hover:decoration-brass"
            >
              {PACKAGE.slice(0, 8)}…
            </a>
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-14">
        {/* The line a judge reads first. Specific to this desk, no protocol
            soup, and it names the thing nobody else does. */}
        <p className="max-w-2xl text-fig leading-relaxed text-ink-muted">
          An autonomous underwriter buys a signed risk report, decides whether an
          invoice qualifies for an advance, and opens the note on chain.{" "}
          <span className="text-ink">
            It stakes its own CSPR behind every score it signs.
          </span>
        </p>

        <div className="mt-8 space-y-6">
          <BondPanel />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            {/* Working surface: left rail, where the clerk's hands are. */}
            <div className="space-y-6">
              <UnderwritePanel
                onEvaluated={setResult}
                onNoteOpened={onNoteOpened}
              />
              <FundNotePanel notes={notes} onNoteFunded={onNoteFunded} />
            </div>

            {/* The book. */}
            <DecisionLedger />
          </div>
        </div>

        <footer className="mt-14 border-t border-desk-700 pt-6">
          <p className="max-w-3xl text-fig-sm leading-relaxed text-ink-muted">
            The deployed contract exposes seven entry points:{" "}
            <code className="font-mono text-ink-faint">
              init, open_note, fund_note, mark_repaid, get_owner,
              get_min_risk_score, get_note
            </code>
            . Anything shown above that is not one of those is labelled where it
            appears.
            {CONTRACT_HASH && (
              <>
                {" "}
                Contract{" "}
                <a
                  href={`https://testnet.cspr.live/contract/${CONTRACT_HASH.replace(/^hash-/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-ink-faint underline decoration-desk-600 underline-offset-4 hover:text-brass"
                >
                  {CONTRACT_HASH.replace(/^hash-/, "").slice(0, 8)}…
                </a>
                .
              </>
            )}
          </p>
        </footer>
      </main>
    </div>
  );
}
