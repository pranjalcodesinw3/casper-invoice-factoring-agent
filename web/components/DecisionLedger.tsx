"use client";

/* The decision ledger.
 *
 * Every underwriting decision the deployed contract has actually made, as ledger
 * rows. This is the density that makes the page a desk rather than a landing
 * page: monospace figures, ruled rows, the error code in the same column
 * position every time so the eye can scan down it.
 *
 * REAL DATA ONLY. Every row comes from PROOF.json, which the prover wrote by
 * executing against the live contract, synced at build time. There are no
 * sample invoices and no fabricated hashes; if the prover has not run, the
 * table says what the desk is waiting for.
 *
 * The refusals are the point and they are not styled as errors. A contract that
 * declines under-qualified paper is the product working, so a decline is
 * rendered in the same weight as an approval and labelled in words. Colour
 * never carries the meaning alone.
 */

import proof from "@/lib/proof.generated.json";

type Step = {
  name: string;
  entryPoint: string;
  deploy: string;
  result: "ok" | "reverted";
  errorCode: number | null;
  errorName: string | null;
  proves?: string;
};

const steps = (proof.steps ?? []) as Step[];

/** "open_note (accepted, risk 80 >= min 50)" -> "accepted, risk 80 >= min 50" */
function detail(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1] : name;
}

function explorer(hash: string): string {
  // Deploy-type, so /deploy/. /transaction/ is the TransactionV1 path and 404s.
  return `https://testnet.cspr.live/deploy/${hash}`;
}

export default function DecisionLedger() {
  if (steps.length === 0) {
    return (
      <section className="panel px-6 py-10">
        <h2 className="text-fig font-medium text-ink">Decision ledger</h2>
        <p className="mt-2 max-w-md text-fig-sm text-ink-muted">
          The desk has not underwritten anything yet. Run the prover against the
          deployed contract and every decision it makes, accepted or refused,
          appears here with its transaction.
        </p>
      </section>
    );
  }

  const refused = steps.filter((s) => s.result === "reverted").length;

  return (
    <section aria-labelledby="ledger-title" className="panel overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-desk-700 px-6 py-4">
        <h2 id="ledger-title" className="text-fig font-medium text-ink">
          Decision ledger
        </h2>
        <p className="font-mono text-fig-sm text-ink-muted">
          {steps.length} on chain · {refused} refused
        </p>
      </header>

      {/* Column headers, ledger style: the labels sit above the rules. */}
      <div className="hidden grid-cols-[1fr_auto_auto] gap-x-6 px-6 pt-4 md:grid">
        <span className="col-label">Decision</span>
        <span className="col-label text-right">Outcome</span>
        <span className="col-label text-right">Transaction</span>
      </div>

      <ol className="mt-1 divide-y divide-desk-800">
        {steps.map((s) => {
          const refusedRow = s.result === "reverted";
          return (
            <li key={s.deploy} className="group">
              <a
                href={explorer(s.deploy)}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-1 gap-x-6 gap-y-2 px-6 py-3.5 transition-colors hover:bg-desk-800/60 md:grid-cols-[1fr_auto_auto] md:items-baseline"
              >
              <div className="min-w-0">
                <code className="font-mono text-fig-sm text-ink">
                  {s.entryPoint}
                </code>
                <span className="ml-2 text-fig-sm text-ink-muted">
                  {detail(s.name)}
                </span>
              </div>

              <div className="md:text-right">
                {refusedRow ? (
                  <span className="font-mono text-fig-sm text-brass">
                    refused · {s.errorName}
                    <span className="text-ink-faint"> ({s.errorCode})</span>
                  </span>
                ) : (
                  <span className="font-mono text-fig-sm text-approve">
                    executed
                  </span>
                )}
              </div>

                <span className="font-mono text-fig-sm text-ink-faint underline decoration-desk-600 underline-offset-4 transition-colors group-hover:text-brass group-hover:decoration-brass md:text-right">
                  {s.deploy.slice(0, 10)}…
                </span>
              </a>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-desk-700 px-6 py-4 text-fig-sm leading-relaxed text-ink-muted">
        Each refusal was built so exactly one clause could fail, which is what
        makes its error code attributable. A transaction that could have failed
        two ways proves neither.
      </p>
    </section>
  );
}
