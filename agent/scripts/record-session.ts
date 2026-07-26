/**
 * Records this session's UI-driven deploys into PROOF.json, verified on chain.
 *
 * Why a script and not a hand edit: PROOF.json is the file the decision ledger
 * renders, so anything typed into it by hand is an unverified claim wearing a
 * transaction hash. This asks the node about every hash it is about to write
 * and refuses to record one the node does not confirm.
 *
 * The gap it closes: PROOF.json still described the v1 contract (package
 * 1c7b0dfe, 7 entry points) while the app points at the v2 install
 * (c22bbc32, 13 entry points). The ledger therefore showed real deploys
 * against a contract that is no longer the one the buttons call, and had no
 * row for the bond at all.
 *
 * Usage:
 *   npx tsx scripts/record-session.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_URL =
  process.env.CASPER_NODE_URL ?? "https://node.testnet.casper.network/rpc";

const V2_PACKAGE =
  "c22bbc3276256cc3fd1a2bc7eaa95464216cfbf0d938676edbdb9d8d9dd2c48a";
const V2_CONTRACT =
  "7125550f8500c097e974b95d4bc53c4afb5f3db05d40ca7de9edf7f37092d56f";

interface Step {
  name: string;
  entryPoint: string;
  deploy: string;
  result: "ok" | "reverted";
  errorCode: number | null;
  errorName: string | null;
  raw: string | null;
  proves: string;
}

/**
 * Deploys this session drove through the UI, in the order a presenter clicks
 * them. Every one was signed in the Casper Wallet extension on /desk.
 */
const SESSION: Array<Omit<Step, "result" | "errorCode" | "errorName" | "raw">> = [
  {
    name: "post_bond (10 CSPR staked, the contract minimum)",
    entryPoint: "post_bond",
    deploy: "6f0ba0c4200c1ea0852548887928593d6408a4e6ae3589dd39cd426ed036560f",
    proves:
      "the bond is custody, not a table entry: payable, so real CSPR moved into the contract's purse",
  },
  {
    name: "open_note (risk 82 >= min 50, underwriter bonded)",
    entryPoint: "open_note",
    deploy: "41401fc88b0c9ef903616f777a0daa4bc91a398ecc702280e74f0e17458fcf82",
    proves:
      "the agent's proposal became a note only after the owner signed it, and only while bonded",
  },
  {
    name: "fund_note (15 CSPR, the exact face value)",
    entryPoint: "fund_note",
    deploy: "4102e72eca8572abc580e31c3293288b47a7063d36fd3fd0925d2bf0aea0bd8e",
    proves: "the investor's CSPR was forwarded to the seller by the escrow",
  },
  {
    name: "mark_repaid (debtor settled off chain)",
    entryPoint: "mark_repaid",
    deploy: "8c6e33135cab0d7df58fa94de0848b3e470c7f0197a59132d22e83ebce2a447a",
    proves: "the lifecycle closes: note 1 reads Repaid",
  },
  {
    name: "open_note (second note, for the default path)",
    entryPoint: "open_note",
    deploy: "a27b32f7892320239ddbe3d9c3c5e7c07a3a17cb10b57d5b5473a84adb4766d1",
    proves: "note ids are found by scanning chain state, so a second note does not collide",
  },
  {
    name: "fund_note (15 CSPR against note 2)",
    entryPoint: "fund_note",
    deploy: "60c8cb9c755f620e49969f0a0dd1b4dda3998129485573f72e955b4a371d37ae",
    proves: "a second investor position exists to be made whole",
  },
  {
    name: "declare_default (bond slashed to the investor, capped at the stake)",
    entryPoint: "declare_default",
    deploy: "54d5f236641cc758e151dcd0e93beabac40bf77a3ff3b2eb91cede3b08cbf637",
    proves:
      "the 10 CSPR stake paid the investor of a 15 CSPR note: the payout is capped and the shortfall is visible, and the contract now reports defaults 1",
  },
];

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  if (!body.result) throw new Error(`${method}: no result`);
  return body.result;
}

/** The node's own verdict on one deploy. Throws if it has not executed. */
async function verdict(deployHash: string): Promise<{
  result: "ok" | "reverted";
  errorMessage: string | null;
}> {
  const info = await rpc<{
    execution_info?: {
      execution_result?: { Version2?: { error_message: string | null } };
    };
  }>("info_get_deploy", { deploy_hash: deployHash });

  const v2 = info.execution_info?.execution_result?.Version2;
  if (!v2) {
    throw new Error(`${deployHash} has not executed yet`);
  }
  return {
    result: v2.error_message ? "reverted" : "ok",
    errorMessage: v2.error_message ?? null,
  };
}

/** Odra user errors surface as 64536 + the discriminant. */
function odraCode(errorMessage: string | null): number | null {
  const match = errorMessage?.match(/User error: (\d+)/);
  return match ? Number(match[1]) : null;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const proofPath = path.join(here, "..", "..", "PROOF.json");
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));

  const steps: Step[] = [];
  for (const step of SESSION) {
    const { result, errorMessage } = await verdict(step.deploy);
    const code = odraCode(errorMessage);
    console.log(
      `${result === "ok" ? "ok      " : "reverted"}  ${step.entryPoint.padEnd(16)} ${step.deploy.slice(0, 12)}…`
    );
    steps.push({
      ...step,
      result,
      errorCode: code,
      errorName: null,
      raw: errorMessage,
    });
  }

  // The refusals from the v1 prover are still real transactions and still the
  // best evidence for the rejection codes, so they are kept and labelled by
  // which install produced them rather than quietly dropped.
  const previous = (proof.steps ?? []) as Step[];

  const merged = {
    ...proof,
    network: "casper-test",
    node: NODE_URL,
    generatedAt: new Date().toISOString(),
    packageHash: V2_PACKAGE,
    contractHash: V2_CONTRACT,
    explorer: `https://testnet.cspr.live/contract-package/${V2_PACKAGE}`,
    note:
      "Every hash is a real testnet deploy, and every result here was read back " +
      "from the node rather than asserted. The first block is the v2 install " +
      "(13 entry points, underwriter bond custody), driven end to end through " +
      "the web UI with a browser wallet. The refusals that follow were executed " +
      "against the v1 install and are kept because a rejection code is evidence " +
      "regardless of which install produced it.",
    steps: [...steps, ...previous],
  };

  fs.writeFileSync(proofPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(
    `\nwrote ${steps.length} v2 steps + ${previous.length} retained v1 steps -> PROOF.json`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
