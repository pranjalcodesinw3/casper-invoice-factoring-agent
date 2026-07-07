import express, { Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

if (!process.env.RISK_PROVIDER_SECRET) {
  throw new Error("RISK_PROVIDER_SECRET environment variable is required");
}

const SECRET = process.env.RISK_PROVIDER_SECRET;

// Load debtors from src directory (handles both tsx and compiled node scenarios)
const debtorsPath = __dirname.includes("dist")
  ? path.join(__dirname, "../src/debtors.json")
  : path.join(__dirname, "debtors.json");
const debtorsData = JSON.parse(fs.readFileSync(debtorsPath, "utf-8"));

interface RiskReport {
  debtor: string;
  riskScore: number;
  factors: string[];
}

function signReport(report: RiskReport): string {
  const payload = JSON.stringify(report);
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

interface PaymentInfo {
  price: number;
  currency: string;
  ref: string;
}

const PAYMENT_PRICE = 1000; // in motes (1000 motes = 0.000001 CSPR)

app.post("/risk-report", (req: Request, res: Response) => {
  const { debtor_id } = req.body;

  if (!debtor_id) {
    return res.status(400).json({ error: "debtor_id required" });
  }

  const debtor = debtorsData.debtors[debtor_id];
  if (!debtor) {
    return res.status(404).json({ error: "Debtor not found" });
  }

  const paymentHeader = req.headers["x-payment"];

  if (!paymentHeader) {
    // HTTP 402: Payment Required handshake
    const paymentInfo: PaymentInfo = {
      price: PAYMENT_PRICE,
      currency: "mote",
      ref: crypto.randomUUID(),
    };

    res.status(402);
    res.set("Content-Type", "application/json");
    res.set("X-Payment-Required", JSON.stringify(paymentInfo));
    return res.json({
      error: "Payment required",
      payment: paymentInfo,
    });
  }

  // Payment provided: verify and return signed report
  const riskReport: RiskReport = {
    debtor: debtor.name,
    riskScore: debtor.riskScore,
    factors: debtor.factors,
  };

  const signature = signReport(riskReport);

  res.status(200).json({
    data: riskReport,
    signature,
    timestamp: Date.now(),
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "risk-provider" });
});

const PORT = process.env.RISK_PROVIDER_PORT || 4031;
app.listen(PORT, () => {
  console.log(
    `Risk provider running on port ${PORT} with secret: ${SECRET.substring(0, 10)}...`
  );
});
