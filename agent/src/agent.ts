import crypto from "crypto";
import { getRiskReport, VerifiedRiskReport } from "./risk-client";
import { NoteArgs } from "./types";
import { underwrite, Invoice, UnderwritingDecision } from "./underwriting";

export type { NoteArgs } from "./types";

export interface UnderwritingResult {
  invoice: Invoice;
  riskReport: VerifiedRiskReport;
  decision: UnderwritingDecision;
  dataSignatureValid: boolean;
  noteArgs: NoteArgs | null;
}

export async function runUnderwriting(
  invoice: Invoice,
  debtorId: string,
  minRiskScore: number = 50,
  riskProviderUrl?: string
): Promise<UnderwritingResult> {
  console.log(`[Agent] Starting underwriting for invoice ${invoice.invoice_id}`);

  const riskReport = await getRiskReport(debtorId, riskProviderUrl);
  console.log(
    `[Agent] Risk report received: score=${riskReport.riskScore}, signature=${riskReport.signatureValid}`
  );

  const decision = await underwrite(invoice, riskReport, minRiskScore);
  console.log(`[Agent] Underwriting complete: approved=${decision.approved}`);

  let noteArgs: NoteArgs | null = null;
  if (decision.approved) {
    const riskDataHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(riskReport))
      .digest("hex");

    noteArgs = {
      note_id: `note-${invoice.invoice_id}`,
      seller: invoice.debtor_name,
      face_value: invoice.face_value,
      risk_score: riskReport.riskScore,
      risk_data_hash: riskDataHash,
    };
    console.log(`[Agent] Note args prepared: ${JSON.stringify(noteArgs)}`);
  }

  return {
    invoice,
    riskReport,
    decision,
    dataSignatureValid: riskReport.signatureValid,
    noteArgs,
  };
}
