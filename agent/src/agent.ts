import crypto from "crypto";
import { invoiceIdToNoteId } from "./contract-client";
import { getRiskReport, VerifiedRiskReport } from "./risk-client";
import { underwrite, Invoice, UnderwritingDecision } from "./underwriting";

export interface NoteArgs {
  /** Stable u64 derived from invoice_id for on-chain open_note. */
  note_id: number;
  /** Casper public key hex for the seller (Address). */
  seller: string;
  /** Face value in motes (U512 on-chain). */
  face_value_motes: string;
  risk_score: number;
  risk_data_hash: string;
}

export interface UnderwritingResult {
  invoice: Invoice;
  riskReport: VerifiedRiskReport;
  decision: UnderwritingDecision;
  dataSignatureValid: boolean;
  noteArgs: NoteArgs | null;
}

/** Demo conversion: treat invoice face value as CSPR and convert to motes. */
export function faceValueToMotes(faceValue: number): bigint {
  return BigInt(Math.round(faceValue)) * 1_000_000_000n;
}

export async function runUnderwriting(
  invoice: Invoice,
  debtorId: string,
  minRiskScore: number = 50,
  riskProviderUrl?: string,
  sellerPubKeyHex?: string
): Promise<UnderwritingResult> {
  console.log(`[Agent] Starting underwriting for invoice ${invoice.invoice_id}`);

  // Step 1: Fetch risk data via 402 handshake
  const riskReport = await getRiskReport(debtorId, riskProviderUrl);
  console.log(
    `[Agent] Risk report received: score=${riskReport.riskScore}, signature=${riskReport.signatureValid}`
  );

  // Step 2: Underwrite
  const decision = await underwrite(invoice, riskReport, minRiskScore);
  console.log(`[Agent] Underwriting complete: approved=${decision.approved}`);

  // Step 3: Generate contract args if approved and seller pubkey provided
  let noteArgs: NoteArgs | null = null;
  if (decision.approved) {
    const riskDataHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(riskReport))
      .digest("hex");

    if (sellerPubKeyHex) {
      noteArgs = {
        note_id: invoiceIdToNoteId(invoice.invoice_id),
        seller: sellerPubKeyHex.replace(/^0x/i, ""),
        face_value_motes: faceValueToMotes(invoice.face_value).toString(),
        risk_score: riskReport.riskScore,
        risk_data_hash: riskDataHash,
      };
      console.log(`[Agent] Note args prepared: ${JSON.stringify(noteArgs)}`);
    }
  }

  return {
    invoice,
    riskReport,
    decision,
    dataSignatureValid: riskReport.signatureValid,
    noteArgs,
  };
}
