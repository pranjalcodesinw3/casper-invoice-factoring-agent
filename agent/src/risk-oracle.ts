/**
 * Signed credit risk reports, bought over x402.
 *
 * The provider answers the first request with 402 Payment Required and serves
 * the report only on the retry that carries payment. The report is HMAC-signed
 * and this client verifies it before returning, because the score becomes the
 * `risk_data_hash` committed on-chain: an unverified score would be an
 * unattributable number in a permanent record.
 *
 * `riskDataHash` is a SHA-256 over the canonical report, so the same report
 * always produces the same commitment and anyone holding the report can
 * recompute it and check what the note was opened against.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SignedRiskReport {
  debtor: string;
  riskScore: number;
  factors: string[];
  signatureValid: boolean;
  /** SHA-256 commitment over the canonical report, written on-chain. */
  riskDataHash: string;
  /** True when the provider actually demanded payment before serving. */
  paidVia402: boolean;
}

export interface RiskOracle {
  fetchSigned(debtorId: string): Promise<SignedRiskReport>;
}

interface ProviderResponse {
  data: { debtor: string; riskScore: number; factors: string[] };
  signature: string;
  timestamp: number;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class HttpRiskOracle implements RiskOracle {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string
  ) {
    if (!secret) {
      throw new Error(
        "risk oracle requires RISK_PROVIDER_SECRET; without it a report's signature cannot be checked"
      );
    }
  }

  async fetchSigned(debtorId: string): Promise<SignedRiskReport> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/risk-report`;
    const body = JSON.stringify({ debtor_id: debtorId });

    let paidVia402 = false;
    let response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    if (response.status === 402) {
      paidVia402 = true;
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-payment": "paid" },
        body,
      });
    }

    if (!response.ok) {
      throw new Error(
        `risk provider returned ${response.status}: ${(await response.text()).slice(0, 200)}`
      );
    }

    const parsed = (await response.json()) as ProviderResponse;
    if (
      !parsed?.data ||
      typeof parsed.data.riskScore !== "number" ||
      typeof parsed.signature !== "string"
    ) {
      throw new Error("risk provider returned a malformed report");
    }

    const expected = createHmac("sha256", this.secret)
      .update(JSON.stringify(parsed.data))
      .digest("hex");
    const signatureValid = constantTimeEquals(parsed.signature, expected);
    if (!signatureValid) {
      // Refuse rather than return an unsigned score. A caller that ignored the
      // flag would commit an unattributable number to the chain.
      throw new Error(
        "risk report HMAC did not verify; refusing to underwrite on unattributable data"
      );
    }

    return {
      debtor: parsed.data.debtor,
      riskScore: parsed.data.riskScore,
      factors: parsed.data.factors ?? [],
      signatureValid,
      riskDataHash: createHash("sha256")
        .update(JSON.stringify(parsed.data))
        .digest("hex"),
      paidVia402,
    };
  }
}
