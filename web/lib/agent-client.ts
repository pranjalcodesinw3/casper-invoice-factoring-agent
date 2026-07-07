export interface InvoiceInput {
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

export interface NoteArgs {
  note_id: number;
  seller: string;
  face_value_motes: string;
  risk_score: number;
  risk_data_hash: string;
}

export interface UnderwritingResult {
  invoice: InvoiceInput;
  decision: UnderwritingDecision;
  dataSignatureValid: boolean;
  noteArgs: NoteArgs | null;
}

export interface ContractOpenNoteArgs {
  note_id: number;
  seller: string;
  face_value_motes: string;
  risk_score: number;
  risk_data_hash: string;
}

export interface RunAgentActionResult {
  underwriting: UnderwritingResult;
  contractArgs: ContractOpenNoteArgs;
  deployJson: unknown;
  deployHashHex: string;
  explanation: string;
}

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4030";

export async function runAgentAction(input: {
  invoice: InvoiceInput;
  debtor_id: string;
  seller_pubkey: string;
  caller_pubkey: string;
  min_risk_score?: number;
}): Promise<RunAgentActionResult> {
  const res = await fetch(`${AGENT_URL}/api/run-agent-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error || `Agent responded ${res.status}`;
    throw new Error(message);
  }

  return body as RunAgentActionResult;
}
