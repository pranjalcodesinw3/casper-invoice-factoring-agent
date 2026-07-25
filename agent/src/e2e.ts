/**
 * End-to-end proof that the underwriting agent is a real agent.
 *
 * Runs against the live testnet ReceivableEscrow and a locally running risk
 * provider. Nothing here is mocked: the contract terms come from the node, the
 * risk report comes over a real 402 handshake, and the deploy is really built.
 *
 * Pass/fail is explicit. `toolCalls` must be at least one, or the model
 * answered from its own head and the agent is cosmetic again.
 *
 *   npx tsx src/e2e.ts                      # in-policy, expects a proposal
 *   npx tsx src/e2e.ts risky                # below the on-chain bar, expects refusal
 */
import "dotenv/config";
import { createUnderwriter } from "./underwriter.js";
import { DeployNoteProposer } from "./note-proposer.js";

const CONTRACT_HASH =
  process.env.CONTRACT_HASH ??
  "hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec";
const OWNER_PUBLIC_KEY =
  process.env.OWNER_PUBLIC_KEY ??
  "016f26910ea1630842e6ae5be76e5c866a915422b2ed689d1684e01cf0b421a576";
const SELLER_PUBLIC_KEY =
  "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";

const SCENARIOS: Record<string, { debtorId: string; expectProposal: boolean }> = {
  good: { debtorId: "acme_corp", expectProposal: true },
  risky: { debtorId: "startup_tech", expectProposal: false },
};

async function main() {
  const name = process.argv[2] ?? "good";
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(
      `unknown scenario "${name}"; expected one of ${Object.keys(SCENARIOS).join(", ")}`
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const secret = process.env.RISK_PROVIDER_SECRET;
  if (!secret) throw new Error("RISK_PROVIDER_SECRET is required");

  const underwriter = createUnderwriter({
    node: {
      rpcUrl: process.env.CASPER_NODE_ADDRESS ?? "https://node.testnet.casper.network/rpc",
      accessKey: process.env.CSPR_CLOUD_ACCESS_KEY,
      contractHash: CONTRACT_HASH,
    },
    openai: {
      apiKey,
      baseURL: process.env.OPENROUTER_BASE_URL,
      model: process.env.OPENROUTER_MODEL,
    },
    risk: {
      baseUrl: process.env.RISK_PROVIDER_URL ?? "http://localhost:4031",
      secret,
    },
  });

  const proposer = new DeployNoteProposer(CONTRACT_HASH, OWNER_PUBLIC_KEY);
  const request =
    `Underwrite invoice INV-${name.toUpperCase()}-001 from debtor ${scenario.debtorId}. ` +
    `Face value 12 CSPR, 15 days overdue. The seller's Casper public key is ` +
    `${SELLER_PUBLIC_KEY}. Open a note if and only if the contract's own terms allow it.`;

  console.log(`SCENARIO: ${name}`);
  console.log(`REQUEST: ${request}\n`);

  const result = await underwriter.run(request, proposer);

  for (const t of result.trace) {
    if (t.kind === "tool_call") console.log(`  -> ${t.tool}(${JSON.stringify(t.args)})`);
    else if (t.kind === "tool_result")
      console.log(`  <- ${t.tool}: ${JSON.stringify(t.result).slice(0, 220)}`);
    else if (t.kind === "thought") console.log(`  ~ ${String(t.text).slice(0, 200)}`);
    else if (t.kind === "error") console.log(`  !! ${t.text}`);
  }

  console.log(`\nFINAL: ${result.finalText}`);
  console.log(
    `steps=${result.steps} toolCalls=${result.toolCalls} noteProposed=${result.noteProposed} exhausted=${result.exhausted}`
  );
  console.log(`escrowTerms=${JSON.stringify(result.escrowTerms)}`);

  const failures: string[] = [];
  if (result.toolCalls < 1) {
    failures.push("agent made no tool calls: it answered from its own head");
  }
  if (result.exhausted) failures.push("loop exhausted without a final answer");
  if (!result.trace.some((t) => t.tool === "get_escrow_terms")) {
    failures.push("agent never read the contract's terms");
  }
  if (scenario.expectProposal && !result.noteProposed) {
    failures.push("in-policy scenario did not reach a note proposal");
  }
  if (scenario.expectProposal) {
    // Reaching the proposer is not enough: the deploy has to actually build.
    // Without this the run "passes" while every proposal silently fails.
    const built = result.trace.some(
      (t) =>
        t.kind === "tool_result" &&
        t.tool === "propose_open_note" &&
        (t.result as { prepared?: boolean; deployHashHex?: string | null })
          ?.prepared === true &&
        Boolean(
          (t.result as { deployHashHex?: string | null })?.deployHashHex
        )
    );
    if (!built) {
      failures.push("no open_note deploy was actually built");
    }
  }
  if (!scenario.expectProposal && result.noteProposed) {
    failures.push("agent proposed a note the contract would reject");
  }

  if (failures.length > 0) {
    console.error(`\nFAIL:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
