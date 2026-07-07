export interface Invoice {
  invoice_id: string;
  debtor_name: string;
  face_value: number;
  days_overdue: number;
}

export interface VerifiedRiskReport {
  debtor: string;
  riskScore: number;
  factors: string[];
  signatureValid: boolean;
}

export interface UnderwritingDecision {
  approved: boolean;
  recommendedAdvanceRate: number;
  faceValue: number;
  fundingAmount: number;
  reasons: string[];
  memo: string;
}

export interface NoteArgs {
  note_id: string;
  seller: string;
  face_value: number;
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

export interface UnderwriteRequest {
  invoice: Invoice;
  debtorId: string;
  minRiskScore?: number;
}

/** A ready-to-run scenario pairing an invoice with the debtor id the risk provider knows. */
export interface Scenario {
  key: "good" | "risky";
  label: string;
  debtorId: string;
  invoice: Invoice;
}

export const SCENARIOS: Scenario[] = [
  {
    key: "good",
    label: "Prime debtor (approve)",
    debtorId: "acme_corp",
    invoice: {
      invoice_id: "INV-2024-001",
      debtor_name: "Acme Corp Manufacturing",
      face_value: 150000,
      days_overdue: 15,
    },
  },
  {
    key: "risky",
    label: "Sub-threshold debtor (decline)",
    debtorId: "startup_tech",
    invoice: {
      invoice_id: "INV-2024-002",
      debtor_name: "StartupTech Inc",
      face_value: 45000,
      days_overdue: 45,
    },
  },
];

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4030";

export async function runUnderwriting(req: UnderwriteRequest): Promise<UnderwritingResult> {
  const res = await fetch(`${AGENT_URL}/api/underwrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoice: req.invoice,
      debtor_id: req.debtorId,
      min_risk_score: req.minRiskScore ?? 50,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.message || body?.error || `Agent responded ${res.status}`;
    throw new Error(message);
  }

  return (await res.json()) as UnderwritingResult;
}
