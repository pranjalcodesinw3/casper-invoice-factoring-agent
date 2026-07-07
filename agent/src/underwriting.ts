import { z } from "zod";
import { generateUnderwritingMemo } from "./ai";
import { VerifiedRiskReport } from "./risk-client";

export interface Invoice {
  invoice_id: string;
  debtor_name: string;
  face_value: number;
  days_overdue: number;
}

export interface UnderwritingDecision {
  approved: boolean;
  recommendedAdvanceRate: number;
  faceValue: number;
  fundingAmount: number;
  reasons: string[];
  memo: string;
}

const UnderwritingDecisionSchema = z.object({
  approved: z.boolean(),
  recommendedAdvanceRate: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});

export async function underwrite(
  invoice: Invoice,
  riskReport: VerifiedRiskReport,
  minRiskScore: number = 50
): Promise<UnderwritingDecision> {
  const reasons: string[] = [];

  // Risk score validation
  if (riskReport.riskScore < minRiskScore) {
    reasons.push(
      `Risk score ${riskReport.riskScore} below minimum threshold ${minRiskScore}`
    );
  } else {
    reasons.push(`Risk score ${riskReport.riskScore} acceptable`);
  }

  // Days overdue assessment
  if (invoice.days_overdue > 60) {
    reasons.push(`Invoice significantly overdue (${invoice.days_overdue} days)`);
  } else if (invoice.days_overdue > 0) {
    reasons.push(`Invoice moderately overdue (${invoice.days_overdue} days)`);
  } else {
    reasons.push("Invoice not yet due, strong advance case");
  }

  // Face value sanity check
  if (invoice.face_value <= 0) {
    reasons.push("Invalid face value");
  } else {
    reasons.push(`Face value: $${invoice.face_value}`);
  }

  // Determine approval and advance rate
  const approved = riskReport.riskScore >= minRiskScore;
  let recommendedAdvanceRate = 0;
  let fundingAmount = 0;

  if (approved) {
    // Tiered advance rate based on risk score
    if (riskReport.riskScore >= 80) {
      recommendedAdvanceRate = 0.85;
      reasons.push("Tier 1: 85% advance rate available");
    } else if (riskReport.riskScore >= 70) {
      recommendedAdvanceRate = 0.75;
      reasons.push("Tier 2: 75% advance rate available");
    } else if (riskReport.riskScore >= 60) {
      recommendedAdvanceRate = 0.65;
      reasons.push("Tier 3: 65% advance rate available");
    } else {
      recommendedAdvanceRate = 0.5;
      reasons.push("Tier 4: 50% advance rate available");
    }
    fundingAmount = Math.round(invoice.face_value * recommendedAdvanceRate);
  } else {
    reasons.push("Approval declined due to insufficient risk score");
  }

  // Generate AI underwriting memo
  let memo = "";
  try {
    memo = await generateUnderwritingMemo(invoice, riskReport);
  } catch (error) {
    console.error("[Underwriting] AI memo generation failed, retrying:", error);
    // Retry once
    try {
      memo = await generateUnderwritingMemo(invoice, riskReport);
    } catch (retryError) {
      memo =
        "AI underwriting memo generation failed. Manual review recommended.";
    }
  }

  const decision: UnderwritingDecision = {
    approved,
    recommendedAdvanceRate,
    faceValue: invoice.face_value,
    fundingAmount,
    reasons,
    memo,
  };

  // Validate decision structure with zod
  const validated = UnderwritingDecisionSchema.parse({
    approved: decision.approved,
    recommendedAdvanceRate: decision.recommendedAdvanceRate,
    reasons: decision.reasons,
  });

  return { ...decision, ...validated };
}
