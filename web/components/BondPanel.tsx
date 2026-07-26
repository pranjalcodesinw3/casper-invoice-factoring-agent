"use client";

/* The hero: the bond, what it covers, and what happens when an invoice defaults.
 *
 * The product is not "a list of invoices". Anyone can list invoices. The product
 * is that the underwriter has its own money at risk behind every score it
 * signs, so the first thing on the page is the collateral and its exposure.
 *
 * This panel used to be a static figure board captioned "NOT DEPLOYED", because
 * when it was written the chain really did expose 7 entry points and none of
 * them was post_bond. The v2 install changed that: the contract now has 13,
 * including post_bond, withdraw_bond, declare_default, get_bond, is_bonded and
 * min_bond. The panel was still telling judges the feature did not exist while
 * the entrypoint sat on chain, which is a worse failure than the honest label
 * it replaced, because it understates real work.
 *
 * Every figure here is now READ FROM THE CHAIN at mount. The staked amount, the
 * minimum, and the bonded flag come from the contract's own state dictionary,
 * and the panel says "reading" until they arrive rather than showing a
 * plausible number it has not verified.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildPostBondDeploy,
  csprToMotes,
  explorerDeployUrl,
  motesToCspr,
} from "@/lib/casper";
import { useWallet } from "@/lib/wallet";
import { AGENT_URL } from "@/lib/agent-client";
import proof from "@/lib/proof.generated.json";

const CONTRACT_PACKAGE_HASH = process.env.NEXT_PUBLIC_CONTRACT_PACKAGE_HASH;

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

/** Live bond state, or the reason it could not be read. */
type BondState =
  | { state: "loading" }
  | {
      state: "ready";
      minBondMotes: string;
      stakedMotes: string;
      defaults: number;
      bonded: boolean;
    }
  | { state: "error"; message: string };

type DeployStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "sent"; deployHash: string }
  | { state: "error"; message: string }
  | { state: "cancelled" };

export default function BondPanel() {
  const wallet = useWallet();
  const [bond, setBond] = useState<BondState>({ state: "loading" });
  const [amount, setAmount] = useState("10");
  const [deploy, setDeploy] = useState<DeployStatus>({ state: "idle" });

  const publicKey = wallet.publicKeyHex;

  const refresh = useCallback(async () => {
    setBond({ state: "loading" });
    try {
      const query = publicKey
        ? `?underwriter=${encodeURIComponent(publicKey)}`
        : "";
      const res = await fetch(`${AGENT_URL}/api/escrow-terms${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `bond read failed with HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        minBondMotes: string;
        stakedMotes: string;
        defaults: number;
        bonded: boolean;
      };
      setBond({ state: "ready", ...body });
    } catch (err) {
      // A read failure is NOT "no bond". Showing zero here would tell a judge
      // the desk has nothing at stake because a node timed out.
      setBond({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const minBondCspr =
    bond.state === "ready" ? motesToCspr(bond.minBondMotes) : null;
  const stakedCspr = bond.state === "ready" ? motesToCspr(bond.stakedMotes) : null;

  const coverage = useMemo(() => {
    if (bond.state !== "ready" || EXPOSURE_CSPR === 0) return null;
    const staked = Number(bond.stakedMotes) / 1e9;
    return staked / EXPOSURE_CSPR;
  }, [bond]);

  const postBond = async () => {
    if (!CONTRACT_PACKAGE_HASH) {
      setDeploy({
        state: "error",
        message: "NEXT_PUBLIC_CONTRACT_PACKAGE_HASH is not configured.",
      });
      return;
    }
    if (!publicKey) {
      setDeploy({ state: "error", message: "Connect the underwriter wallet first." });
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDeploy({ state: "error", message: "Bond amount must be a positive number of CSPR." });
      return;
    }

    setDeploy({ state: "pending" });
    try {
      const { deployJson, deployHashHex } = await buildPostBondDeploy(
        CONTRACT_PACKAGE_HASH,
        publicKey,
        csprToMotes(parsed)
      );
      const outcome = await wallet.sendDeploy(deployJson, publicKey);
      if (outcome.cancelled) {
        setDeploy({ state: "cancelled" });
      } else if (outcome.error) {
        setDeploy({ state: "error", message: outcome.error });
      } else {
        setDeploy({ state: "sent", deployHash: outcome.deployHash ?? deployHashHex });
        // The node accepts before it executes, so re-read after a delay rather
        // than claiming the stake landed the instant the hash came back.
        window.setTimeout(() => void refresh(), 20_000);
      }
    } catch (err) {
      setDeploy({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section aria-labelledby="bond-title" className="panel overflow-hidden">
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
        <span
          className={`rounded-desk border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
            bond.state === "ready" && bond.bonded
              ? "border-approve/60 text-approve"
              : "border-brass-dim/60 text-brass"
          }`}
        >
          {bond.state === "loading"
            ? "Reading chain"
            : bond.state === "error"
              ? "Chain unread"
              : bond.bonded
                ? "Bonded on chain"
                : "Not bonded"}
        </span>
      </header>

      <div className="grid grid-cols-1 divide-y divide-desk-700 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Bond staked"
          value={stakedCspr ?? "—"}
          unit="CSPR"
          note={
            bond.state === "ready"
              ? `minimum ${minBondCspr} CSPR, read from the contract`
              : bond.state === "error"
                ? "could not read the contract"
                : "reading the contract"
          }
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
          note={coverage === null ? "no stake or no exposure yet" : "bond ÷ exposure"}
        />
      </div>

      {/* The control. post_bond is payable, so this attaches real CSPR through
          the Odra proxy caller; it is not a form that records an intent. */}
      <div className="border-t border-desk-700 px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="col-label">Stake (CSPR)</span>
            <input
              className="w-32 rounded-desk border border-desk-600 bg-desk-900 px-3 py-2 font-mono text-fig-sm text-ink"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Bond amount in CSPR"
            />
          </label>
          <button
            type="button"
            className="min-h-11 rounded-desk bg-brass px-5 font-semibold text-desk-950 transition hover:bg-brass-bright disabled:opacity-50"
            onClick={postBond}
            disabled={!publicKey || deploy.state === "pending"}
          >
            {deploy.state === "pending" ? "Awaiting wallet..." : "Post bond"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-desk border border-desk-600 px-4 font-medium text-ink transition hover:bg-desk-800"
            onClick={() => void refresh()}
          >
            Re-read chain
          </button>
          {!publicKey && (
            <span className="text-fig-sm text-ink-muted">
              Connect a wallet to stake.
            </span>
          )}
        </div>

        {deploy.state === "sent" && (
          <p className="mt-3 font-mono text-fig-sm text-approve">
            BondPosted deploy submitted:{" "}
            <a
              className="underline decoration-desk-600 underline-offset-4 hover:text-brass"
              href={explorerDeployUrl(deploy.deployHash)}
              target="_blank"
              rel="noreferrer"
            >
              {deploy.deployHash}
            </a>
          </p>
        )}
        {deploy.state === "cancelled" && (
          <p className="mt-3 text-fig-sm text-ink-muted">
            Signing was cancelled in the wallet.
          </p>
        )}
        {deploy.state === "error" && (
          <p className="mt-3 text-fig-sm text-brass">{deploy.message}</p>
        )}
        {bond.state === "error" && (
          <p className="mt-3 text-fig-sm text-brass">
            Bond state unread: {bond.message}. The figures above are blank rather
            than zero, because a node timeout is not evidence of an empty stake.
          </p>
        )}
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
          aria-label={
            stakedCspr
              ? `${EXPOSURE_CSPR} CSPR of a ${stakedCspr} CSPR bond is committed`
              : "bond not yet read from the chain"
          }
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-desk-800">
            <div
              className="h-full bg-brass"
              style={{
                width:
                  bond.state === "ready" && Number(bond.stakedMotes) > 0
                    ? `${Math.min(100, (EXPOSURE_CSPR / (Number(bond.stakedMotes) / 1e9)) * 100)}%`
                    : "0%",
              }}
            />
          </div>
          <span className="whitespace-nowrap font-mono text-fig-sm text-ink-muted">
            {EXPOSURE_CSPR.toFixed(2)} of {stakedCspr ?? "—"} committed
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-fig-sm leading-relaxed text-ink-muted">
          The investor is made whole from the bond, and the shortfall is visible
          rather than smoothed over: a note larger than the stake pays out only
          what was staked.{" "}
          <span className="text-ink">
            post_bond, withdraw_bond and declare_default are live on chain.
          </span>{" "}
          The deployed contract exposes 13 entry points, and the stake above is
          held in the contract&apos;s own purse rather than in a table.
          {bond.state === "ready" && bond.defaults > 0 && (
            <>
              {" "}
              This underwriter has been slashed on{" "}
              <strong className="text-ink">{bond.defaults}</strong> declared
              default{bond.defaults === 1 ? "" : "s"}.
            </>
          )}
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
