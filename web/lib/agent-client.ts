/**
 * Client for the underwriting agent's HTTP surface.
 *
 * The shape here is the SERVER's shape, read from agent/src/server.ts. It used
 * to be a different one: this file posted `{invoice, debtorId, minRiskScore}`
 * and expected `{riskReport, decision, noteArgs}` back, none of which the
 * server has accepted since the acceptance bar moved on-chain. Every click of
 * "Fetch signed risk report & underwrite" got HTTP 400 and rendered the string
 * "Invalid request". The panel was wired to an API that no longer existed.
 *
 * What the server actually returns is an agent RUN: a trace of tool calls
 * against live contract state, plus an unsigned open_note deploy when the
 * agent decided to propose one. There is no separate `decision` object,
 * because the decision IS the trace.
 */

export interface Invoice {
  invoice_id: string;
  debtor_name: string;
  /** USD. The server converts to a demo CSPR note denomination. */
  face_value: number;
  days_overdue: number;
}

/** One observable step of the agent loop, as the kernel emits it. */
export interface TraceEntry {
  step: number;
  kind: "thought" | "tool_call" | "tool_result" | "final" | "error";
  tool?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
  ms: number;
}

/** The signed risk report, as `get_risk_report` returns it. */
export interface RiskReportResult {
  debtor: string;
  riskScore: number;
  factors: string[];
  signatureValid: boolean;
  riskDataHash: string;
  paidVia402: boolean;
}

/** Contract terms, as `get_escrow_terms` returns them. */
export interface EscrowTermsResult {
  owner: string;
  minRiskScore: number;
  minBondMotes: string;
  underwriterBondMotes: string;
  underwriterIsBonded: boolean;
  underwriterDefaults: number;
}

/** The proposal outcome, as `propose_open_note` returns it. */
export interface ProposalResult {
  prepared: boolean;
  deployHashHex?: string | null;
  faceValueMotes?: string;
  /** Set when a contract clause would have rejected the note. */
  refusedBy?: string;
  error?: string;
}

export interface UnderwriteRunResponse {
  finalText: string;
  trace: TraceEntry[];
  steps: number;
  toolCalls: number;
  noteProposed: boolean;
  escrowTerms: { owner: string; minRiskScore: number } | null;
  /** Unsigned legacy deploy JSON, ready for the owner's wallet. */
  deploy: unknown;
  explanation: string;
}

export interface UnderwriteRequest {
  invoice: Invoice;
  debtorId: string;
  /** The seller who receives funding. */
  sellerPublicKeyHex: string;
  /** The escrow owner who will sign. open_note reverts NotOwner otherwise. */
  callerPublicKeyHex: string;
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

/** The last result of a given tool in the run, or null if it never ran. */
export function lastToolResult<T>(trace: TraceEntry[], tool: string): T | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const entry = trace[i];
    if (entry.kind === "tool_result" && entry.tool === tool) {
      return entry.result as T;
    }
  }
  return null;
}

export async function runUnderwriting(
  req: UnderwriteRequest
): Promise<UnderwriteRunResponse> {
  const res = await fetch(`${AGENT_URL}/api/underwrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoice: req.invoice,
      debtor_id: req.debtorId,
      seller_pubkey: req.sellerPublicKeyHex,
      caller_pubkey: req.callerPublicKeyHex,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // The server names the offending field in `details`; surfacing only
    // "Invalid request" is what let this mismatch survive as long as it did.
    const detail = Array.isArray(body?.details)
      ? body.details
          .map((d: { path?: string[]; message?: string }) =>
            `${(d.path ?? []).join(".")}: ${d.message ?? "invalid"}`
          )
          .join("; ")
      : "";
    const message =
      [body?.error, detail].filter(Boolean).join(" - ") ||
      `Agent responded ${res.status}`;
    throw new Error(message);
  }

  return (await res.json()) as UnderwriteRunResponse;
}
