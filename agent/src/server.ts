import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { runUnderwriting } from "./agent";
import {
  buildOpenNoteDeploy,
  mapNoteArgsToContract,
} from "./contract-client";
import { Invoice } from "./underwriting";

dotenv.config();

const app = express();
app.use(express.json());

// CORS for localhost:3000 frontend
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/api/underwrite", async (req: Request, res: Response) => {
  try {
    const { invoice, debtor_id, min_risk_score } = req.body;

    if (!invoice || !debtor_id) {
      return res.status(400).json({
        error: "Missing required fields: invoice, debtor_id",
      });
    }

    if (
      !invoice.invoice_id ||
      typeof invoice.debtor_name !== "string" ||
      typeof invoice.face_value !== "number" ||
      typeof invoice.days_overdue !== "number"
    ) {
      return res.status(400).json({
        error: "Invalid invoice structure",
      });
    }

    const minScore = min_risk_score || 50;
    const riskProviderUrl = process.env.RISK_PROVIDER_URL || "http://localhost:4031";

    const result = await runUnderwriting(
      invoice as Invoice,
      debtor_id,
      minScore,
      riskProviderUrl
    );

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Server] Error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * Underwrite an invoice, map noteArgs to contract types (u64 note_id, Address seller),
 * and return a signable open_note deploy for CSPR.click.
 */
app.post("/api/run-agent-action", async (req: Request, res: Response) => {
  try {
    const {
      invoice,
      debtor_id,
      seller_pubkey,
      caller_pubkey,
      min_risk_score,
    } = req.body;

    if (!invoice || !debtor_id) {
      return res.status(400).json({
        error: "Missing required fields: invoice, debtor_id",
      });
    }
    if (!seller_pubkey || typeof seller_pubkey !== "string") {
      return res.status(400).json({
        error: "Missing required field: seller_pubkey (Casper public key hex for seller Address)",
      });
    }
    if (!caller_pubkey || typeof caller_pubkey !== "string") {
      return res.status(400).json({
        error: "Missing required field: caller_pubkey (contract owner wallet public key hex)",
      });
    }

    const contractHash = process.env.CONTRACT_HASH;
    if (!contractHash) {
      return res.status(503).json({
        error: "CONTRACT_HASH is not configured on the agent server",
      });
    }

    if (
      !invoice.invoice_id ||
      typeof invoice.debtor_name !== "string" ||
      typeof invoice.face_value !== "number" ||
      typeof invoice.days_overdue !== "number"
    ) {
      return res.status(400).json({ error: "Invalid invoice structure" });
    }

    const minScore = min_risk_score || 50;
    const riskProviderUrl = process.env.RISK_PROVIDER_URL || "http://localhost:4031";

    const underwriting = await runUnderwriting(
      invoice as Invoice,
      debtor_id,
      minScore,
      riskProviderUrl
    );

    if (!underwriting.decision.approved) {
      return res.status(422).json({
        error: "Underwriting declined",
        underwriting,
      });
    }

    if (!underwriting.noteArgs) {
      return res.status(500).json({
        error: "Approved underwriting did not produce note args",
        underwriting,
      });
    }

    const contractArgs = mapNoteArgsToContract(
      underwriting.noteArgs,
      seller_pubkey,
      underwriting.decision.fundingAmount
    );

    const prepared = buildOpenNoteDeploy(
      contractHash,
      caller_pubkey,
      contractArgs
    );

    res.json({
      underwriting,
      contractArgs,
      deployJson: prepared.deployJson,
      deployHashHex: prepared.deployHashHex,
      explanation:
        "Underwriting approved. Sign and submit the open_note deploy with the contract owner key.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Server] run-agent-action error:", message);
    res.status(500).json({ error: message });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "agent-server" });
});

const PORT = process.env.SERVER_PORT || 4030;
app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
});
