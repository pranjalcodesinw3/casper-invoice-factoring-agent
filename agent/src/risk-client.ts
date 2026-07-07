import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.RISK_PROVIDER_SECRET) {
  throw new Error("RISK_PROVIDER_SECRET environment variable is required");
}

const SECRET = process.env.RISK_PROVIDER_SECRET;

export interface RiskReport {
  debtor: string;
  riskScore: number;
  factors: string[];
}

interface SignedRiskReport {
  data: RiskReport;
  signature: string;
  timestamp: number;
}

export interface VerifiedRiskReport extends RiskReport {
  signatureValid: boolean;
}

export async function getRiskReport(
  debtorId: string,
  riskProviderUrl: string = "http://localhost:4031"
): Promise<VerifiedRiskReport> {
  const url = `${riskProviderUrl}/risk-report`;

  // First request: no payment, expect 402
  console.log(`[RiskClient] Requesting risk report for ${debtorId}...`);
  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ debtor_id: debtorId }),
  });

  if (response.status === 402) {
    const paymentInfo = response.headers.get("x-payment-required");
    console.log(`[RiskClient] Received 402 Payment Required`);
    console.log(
      `[RiskClient] Payment info: ${paymentInfo ? paymentInfo.substring(0, 100) + "..." : "none"}`
    );

    // Second request: with payment header
    console.log(`[RiskClient] Retrying with X-Payment header...`);
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Payment": "paid",
      },
      body: JSON.stringify({ debtor_id: debtorId }),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Risk provider error: ${response.status} ${errorText}`
    );
  }

  const body = (await response.json()) as SignedRiskReport;
  const report = body.data;
  const receivedSignature = body.signature;

  // Verify HMAC signature
  const expectedSignature = crypto
    .createHmac("sha256", SECRET)
    .update(JSON.stringify(report))
    .digest("hex");

  const signatureValid = receivedSignature === expectedSignature;

  if (!signatureValid) {
    throw new Error("Risk report signature verification failed");
  }

  console.log(`[RiskClient] Signature verified successfully`);

  return {
    ...report,
    signatureValid: true,
  };
}
