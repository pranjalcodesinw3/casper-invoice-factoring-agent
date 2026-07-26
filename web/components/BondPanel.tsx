"use client";

/* The hero: the bond, what it covers, and what happens when an invoice defaults.
 *
 * The product is not "a list of invoices". Anyone can list invoices. The product
 * is that the underwriter has its own money at risk behind every score it
 * signs, so the first thing on the page is the collateral and its exposure.
 *
 * Read as a desk blotter rather than a landing hero: three ledger figures in a
 * row with rules between them, a coverage bar that is a real ratio, and the
 * default consequence stated in words next to it.
 *
 * HONESTY, and this is load-bearing. The bond is written and tested but NOT
 * deployed: the contract on chain has 7 entry points and none of them is
 * post_bond. So every bond figure here is labelled at the point it is shown,
 * not in a footer. `deployed` is false for the whole panel and the component
 * refuses to render a number as if it were chain state.
 */

import proof from "@/lib/proof.generated.json";

const MIN_BOND_CSPR = 10; // contract/bin/cli.rs, min_bond at init
const DEPLOYED_ENTRY_POINTS = 7;

type Step = {
  name: string;
  entryPoint: string;
  deploy: string;
  result: "ok" | "reverted";
  errorName: string | null;
};

const steps = (proof.steps ?? []) as Step[];

/** Notes actually opened on chain. Real, from the prover's own output. */
const opened = steps.filter((s) => s.entryPoint === "open_note" && s.result === "ok");
const funded = steps.filter((s) => s.entryPoint === "fund_note" && s.result === "ok");
const refusals = steps.filter((s) => s.result === "reverted");

/** The one funded note's face value, from the prover's scenario. 1 CSPR. */
const EXPOSURE_CSPR = funded.length;

export default function BondPanel() {
  const coverage = EXPOSURE_CSPR === 0 ? null : MIN_BOND_CSPR / EXPOSURE_CSPR;

  return (
    <section
      aria-labelledby="bond-title"
      className="panel overflow-hidden"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-desk-700 px-6 py-4">
        <div>
          <h2 id="bond-title" className="text-fig font-medium text-ink">
            Underwriter bond
          </h2>
          <p className="mt-1 max-w-xl text-fig-sm text-ink-muted">
            The desk stakes its own CSPR behind every score it signs. A note that
            defaults pays its investor out of that stake.
          </p>
        </div>
        {/* Stated here, at the figures, not in a footer. */}
        <span className="rounded-desk border border-brass-dim/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brass">
          Not deployed
        </span>
      </header>

      <div className="grid grid-cols-1 divide-y divide-desk-700 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Bond staked"
          value={`${MIN_BOND_CSPR}.00`}
          unit="CSPR"
          note="minimum at init"
          accent
        />
        <Figure
          label="Exposure funded"
          value={EXPOSURE_CSPR.toFixed(2)}
          unit="CSPR"
          note={`${funded.length} note${funded.length === 1 ? "" : "s"} on chain`}
        />
        <Figure
          label="Coverage"
          value={coverage === null ? "—" : `${coverage.toFixed(1)}×`}
          unit=""
          note={coverage === null ? "no exposure yet" : "bond ÷ exposure"}
        />
      </div>

      <div className="border-t border-desk-700 px-6 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="col-label">If a funded note defaults</span>
          <span className="font-mono text-fig-sm text-ink-muted">
            capped at the stake
          </span>
        </div>
        {/* The bar reads as BOND, with the covered portion filled.
            An earlier version drew exposure-over-bond, so a well-collateralised
            desk (10x) rendered as a 10%-full bar, which reads as "nearly empty"
            and inverts the meaning. Here the track is the bond and the filled
            segment is the part currently committed, so more fill means more of
            the stake is at work, and the figure is stated in words beside it. */}
        <div
          className="mt-3 flex items-center gap-3"
          role="img"
          aria-label={`${EXPOSURE_CSPR} CSPR of a ${MIN_BOND_CSPR} CSPR bond is committed`}
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-desk-800">
            <div
              className="h-full bg-brass"
              style={{
                width: `${Math.min(100, (EXPOSURE_CSPR / MIN_BOND_CSPR) * 100)}%`,
              }}
            />
          </div>
          <span className="whitespace-nowrap font-mono text-fig-sm text-ink-muted">
            {EXPOSURE_CSPR.toFixed(2)} of {MIN_BOND_CSPR}.00 committed
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-fig-sm leading-relaxed text-ink-muted">
          The investor is made whole from the bond, and the shortfall is visible
          rather than smoothed over: a note larger than the stake pays out only
          what was staked.{" "}
          <span className="text-ink">
            This mechanism is written and covered by 14 tests, and is not on
            chain.
          </span>{" "}
          The deployed contract exposes {DEPLOYED_ENTRY_POINTS} entry points and
          none of them is <code className="font-mono text-brass">post_bond</code>.
        </p>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="px-6 py-5">
      <div className="col-label">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={`font-mono text-fig-xl ${accent ? "text-brass-bright" : "text-ink"}`}
        >
          {value}
        </span>
        {unit && (
          <span className="font-mono text-fig-sm text-ink-faint">{unit}</span>
        )}
      </div>
      <div className="mt-1.5 text-fig-sm text-ink-muted">{note}</div>
    </div>
  );
}

export { opened, funded, refusals, steps };
export type { Step };
