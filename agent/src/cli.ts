/**
 * CLI for the underwriting agent.
 *
 * Runs the same agent the server does, against the same live contract, so what
 * a judge sees here is what the product does. It previously called
 * `runUnderwriting`, which decided by a fixed if-ladder and used the model only
 * to write a memo about the decision.
 *
 *   npx tsx src/cli.ts good     # a debtor that clears the on-chain bar
 *   npx tsx src/cli.ts risky    # one that does not
 *   npx tsx src/cli.ts "underwrite INV-9 from acme_corp for 5 CSPR ..."
 */
import "dotenv/config";
import { createUnderwriter } from "./underwriter";
import { DeployNoteProposer } from "./note-proposer";

const CONTRACT_HASH =
  process.env.CONTRACT_HASH ??
  "hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec";
const OWNER_PUBLIC_KEY =
  process.env.OWNER_PUBLIC_KEY ??
  "016f26910ea1630842e6ae5be76e5c866a915422b2ed689d1684e01cf0b421a576";
const SELLER_PUBLIC_KEY =
  "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";

const PRESETS: Record<string, string> = {
  good:
    `Underwrite invoice INV-GOOD-001 from debtor acme_corp. Face value 12 CSPR, ` +
    `15 days overdue. The seller's Casper public key is ${SELLER_PUBLIC_KEY}. ` +
    `Open a note if and only if the contract's own terms allow it.`,
  risky:
    `Underwrite invoice INV-RISKY-001 from debtor startup_tech. Face value 12 CSPR, ` +
    `40 days overdue. The seller's Casper public key is ${SELLER_PUBLIC_KEY}. ` +
    `Open a note if and only if the contract's own terms allow it.`,
};

async function main() {
  const arg = process.argv.slice(2).join(" ").trim();
  if (!arg) {
    console.log("Usage: tsx src/cli.ts <good|risky|free text request>");
    process.exit(1);
  }
  const request = PRESETS[arg] ?? arg;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const secret = process.env.RISK_PROVIDER_SECRET;
  if (!secret) throw new Error("RISK_PROVIDER_SECRET is required");

  const underwriter = createUnderwriter({
    node: {
      rpcUrl:
        process.env.CASPER_NODE_ADDRESS ?? "https://node.testnet.casper.network/rpc",
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

  console.log(`REQUEST: ${request}\n`);
  const proposer = new DeployNoteProposer(CONTRACT_HASH, OWNER_PUBLIC_KEY);
  const result = await underwriter.run(request, proposer, (t) => {
    if (t.kind === "tool_call") console.log(`  -> ${t.tool}(${JSON.stringify(t.args)})`);
    else if (t.kind === "tool_result")
      console.log(`  <- ${t.tool}: ${JSON.stringify(t.result).slice(0, 200)}`);
    else if (t.kind === "error") console.log(`  !! ${t.text}`);
  });

  console.log(`\n${result.finalText}\n`);
  console.log(
    `steps=${result.steps} toolCalls=${result.toolCalls} noteProposed=${result.noteProposed}`
  );
  console.log(`escrowTerms=${JSON.stringify(result.escrowTerms)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
