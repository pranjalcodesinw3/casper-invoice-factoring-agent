/**
 * HTTP surface for the underwriting agent.
 *
 * The old endpoints took `min_risk_score` from the request body and defaulted
 * it to 50 when absent, so a caller could underwrite against whatever bar they
 * fancied by posting `{min_risk_score: 0}`. It never mattered on-chain, because
 * `open_note` reverts `RiskTooHigh` against the contract's own minimum, but it
 * meant the API cheerfully told callers a note was approved that the chain
 * would reject. The acceptance bar now comes from the deployed contract.
 *
 * The agent produces an unsigned deploy. Only the escrow owner's key can turn
 * it into a note, and the contract re-checks the risk score and note uniqueness
 * independently, so exposing underwriting publicly moves no money.
 */
import express, { type Request, type Response } from "express";
import dotenv from "dotenv";
import { z } from "zod";
import { createUnderwriter } from "./underwriter";
import { DeployNoteProposer } from "./note-proposer";

dotenv.config();

const app = express();

const CONTRACT_HASH =
  process.env.CONTRACT_HASH ??
  "hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec";

/**
 * Demo notional: USD of invoice face value represented by 1 CSPR on testnet.
 *
 * Invoices are denominated in USD and notes are denominated in motes, so
 * something has to bridge them. The old prompt said "Face value 150000 CSPR"
 * for a $150,000 invoice, which asked an investor to attach 150,000 CSPR to
 * fund one note. No testnet wallet holds that, so every note the agent opened
 * was unfundable by construction and the demo died at fund_note. Mirrors
 * NEXT_PUBLIC_DEMO_USD_PER_CSPR in the web app; both default to 10,000.
 */
const DEMO_USD_PER_CSPR = Number(process.env.DEMO_USD_PER_CSPR ?? "10000");
if (!Number.isFinite(DEMO_USD_PER_CSPR) || DEMO_USD_PER_CSPR <= 0) {
  throw new Error("DEMO_USD_PER_CSPR must be a positive number");
}

/** USD face value to the demo CSPR amount a note is actually denominated in. */
export function usdToDemoCspr(usd: number): string {
  return (Math.round((usd / DEMO_USD_PER_CSPR) * 100) / 100).toFixed(2);
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function originAllowed(origin?: string): boolean {
  if (!origin) return false;
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    return true;
  }
  return ALLOWED_ORIGINS.includes(origin);
}

app.use(express.json());

app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    res.set("Access-Control-Allow-Origin", origin as string);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const underwriter = createUnderwriter({
  node: {
    rpcUrl: process.env.CASPER_NODE_ADDRESS ?? "https://node.testnet.casper.network/rpc",
    accessKey: process.env.CSPR_CLOUD_ACCESS_KEY,
    contractHash: CONTRACT_HASH,
  },
  openai: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseURL: process.env.OPENROUTER_BASE_URL,
    model: process.env.OPENROUTER_MODEL,
  },
  risk: {
    baseUrl: process.env.RISK_PROVIDER_URL ?? "http://localhost:4031",
    secret: process.env.RISK_PROVIDER_SECRET ?? "",
  },
});

/**
 * Note what is absent: min_risk_score. The contract holds it.
 *
 * .strict() rather than zod's default of stripping unknown keys, so a caller
 * still sending min_risk_score is told the field is gone instead of having it
 * silently dropped while they believe it is controlling the decision.
 */
const UnderwriteSchema = z
  .object({
    invoice: z
      .object({
        invoice_id: z.string().min(1),
        debtor_name: z.string().min(1),
        face_value: z.number().positive(),
        days_overdue: z.number().min(0),
      })
      .strict(),
    debtor_id: z.string().min(1),
    seller_pubkey: z.string().min(2),
    caller_pubkey: z.string().min(2),
  })
  .strict();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "invoice-factoring-agent" });
});

/**
 * Live escrow terms, including the underwriter's bond.
 *
 * The UI needs these to render the bond panel, and it must not compute them
 * itself: the Odra state-dictionary derivation (blake2b over a nibble-packed
 * field path) lives in `escrow-reader`, and a second copy in the browser is a
 * second place for the layout to drift. This repo already shipped a UI that
 * claimed the contract had 7 entry points while the chain had 13.
 *
 * A read failure is a 502, never a zero. "This underwriter has posted no bond"
 * and "we could not check" must not render the same.
 */
app.get("/api/escrow-terms", async (req: Request, res: Response) => {
  const requested = req.query.underwriter;
  if (requested !== undefined && typeof requested !== "string") {
    return res.status(400).json({ error: "underwriter must be a single value" });
  }
  try {
    const [owner, minRiskScore, minBondMotes] = await Promise.all([
      underwriter.reader.getOwner(),
      underwriter.reader.getMinRiskScore(),
      underwriter.reader.getMinBondMotes(),
    ]);
    // Default to the escrow owner: a visitor with no wallet connected should
    // still see whether the desk itself is collateralised.
    const address = requested ?? owner;
    const bond = await underwriter.reader.getBond(address);
    const stakedMotes = bond?.amountMotes ?? "0";

    res.json({
      owner,
      minRiskScore,
      underwriter: address,
      minBondMotes,
      stakedMotes,
      slashedMotes: bond?.slashedMotes ?? "0",
      defaults: bond?.defaults ?? 0,
      bonded: BigInt(stakedMotes) >= BigInt(minBondMotes),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[server] escrow-terms read failed:", message);
    res.status(502).json({ error: message });
  }
});

app.post("/api/underwrite", async (req: Request, res: Response) => {
  const parsed = UnderwriteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.errors,
      hint:
        "min_risk_score is no longer accepted: the acceptance bar is a term of " +
        "the contract and is read from it",
    });
  }

  const { invoice, debtor_id, seller_pubkey, caller_pubkey } = parsed.data;

  try {
    const proposer = new DeployNoteProposer(CONTRACT_HASH, caller_pubkey);
    const noteCspr = usdToDemoCspr(invoice.face_value);
    const request =
      `Underwrite invoice ${invoice.invoice_id} from debtor ${debtor_id}. ` +
      `Face value $${invoice.face_value.toLocaleString("en-US")} USD, ` +
      `${invoice.days_overdue} days overdue. ` +
      `On testnet this note is denominated at ${noteCspr} CSPR ` +
      `(demo rate: $${DEMO_USD_PER_CSPR.toLocaleString("en-US")} USD per 1 CSPR), ` +
      `so pass faceValueCspr exactly "${noteCspr}". ` +
      `The seller's Casper public key is ${seller_pubkey}. ` +
      `Open a note if and only if the contract's own terms allow it.`;

    const result = await underwriter.run(request, proposer);

    res.json({
      finalText: result.finalText,
      trace: result.trace,
      steps: result.steps,
      toolCalls: result.toolCalls,
      noteProposed: result.noteProposed,
      escrowTerms: result.escrowTerms,
      deploy: proposer.lastDeployJson,
      explanation:
        result.noteProposed && proposer.lastDeployJson
          ? "The escrow owner must sign the deploy before it reaches the chain."
          : "No note was proposed; see finalText for the clause that blocked it.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[server] underwrite failed:", message);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || process.env.SERVER_PORT || 4030;
app.listen(PORT, () => {
  console.log(`[server] Invoice factoring agent on http://localhost:${PORT}`);
  console.log(`[server] POST /api/underwrite {invoice, debtor_id, seller_pubkey, caller_pubkey}`);
});
