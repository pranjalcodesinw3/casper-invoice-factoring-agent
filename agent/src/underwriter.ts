/**
 * The underwriting agent.
 *
 * What changed and why: `ai.ts` used to be a bare `chat.completions.create`
 * with no `tools:` array, so the model could only emit an underwriting memo as
 * prose. The decision itself was made by a fixed if-ladder in TypeScript and
 * the "AI" was decoration. Here the model has to call `get_escrow_terms` to
 * learn the contract's acceptance bar, `get_risk_report` to buy signed debtor
 * data over x402, and `propose_open_note` to act. It receives no chain state in
 * its prompt.
 *
 * Three layers must agree before a note opens:
 *   1. the model chooses to call propose_open_note
 *   2. this process re-checks the request against live contract state
 *   3. the contract re-checks min_risk_score and note uniqueness, and reverts
 * Only the third is authoritative. The first two exist so failures are cheap
 * and legible instead of costing gas.
 */
import OpenAI from "openai";
import { runAgentLoop, type AgentRunResult, type TraceEntry } from "./kernel/loop.js";
import type { OdraNodeConfig } from "./kernel/odra-state.js";
import { ReceivableEscrowReader } from "./escrow-reader.js";
import { HttpRiskOracle, type RiskOracle } from "./risk-oracle.js";
import {
  buildUnderwritingTools,
  type NoteProposer,
} from "./underwriting-tools.js";

export interface UnderwriterConfig {
  node: OdraNodeConfig;
  openai: { apiKey: string; baseURL?: string; model?: string };
  risk: { baseUrl: string; secret: string };
  maxSteps?: number;
}

const SYSTEM_PROMPT = `You are an invoice factoring underwriter operating against a ReceivableEscrow contract on the Casper network.

You do not know the escrow's terms. Read them from the contract before you
decide anything:

1. Call get_escrow_terms to learn the minimum risk score the contract enforces.
   Never assume a threshold.
2. Call get_risk_report for the debtor. Underwrite only on a report whose
   signatureValid is true. If it is false or the call fails, refuse.
3. If the score clears the on-chain minimum, call find_free_note_id, then
   propose_open_note with the risk score and riskDataHash from the report.
4. If the score is below the minimum, refuse and name the RiskTooHigh clause.
   Do not propose a note you know the contract will reject.

Rules:
- Amounts you pass are in CSPR; the contract stores motes. The tool converts.
- If a tool reports an error, do not guess the value it failed to fetch.
  Explain that you could not verify contract state and refuse to underwrite.
- When you refuse, name the specific on-chain clause or missing signature that
  blocks the request.

Finish with a short underwriting memo stating the decision, the risk score, the
contract minimum you compared it against, and the note id if you opened one.`;

export interface UnderwritingRunResult extends AgentRunResult {
  /** Contract terms as read at the time of the run, for the UI to show. */
  escrowTerms: { owner: string; minRiskScore: number } | null;
  /** True when a note proposal actually reached the deploy builder. */
  noteProposed: boolean;
}

export function createUnderwriter(cfg: UnderwriterConfig) {
  const client = new OpenAI({
    apiKey: cfg.openai.apiKey,
    baseURL: cfg.openai.baseURL ?? "https://openrouter.ai/api/v1",
  });
  // Must be a model that actually emits tool calls. Small/lite models answer an
  // underwriting question in prose without ever reading the contract, which
  // silently turns the agent back into decoration.
  const model = cfg.openai.model ?? "anthropic/claude-haiku-4.5";
  const reader = new ReceivableEscrowReader(cfg.node);
  const oracle: RiskOracle = new HttpRiskOracle(
    cfg.risk.baseUrl,
    cfg.risk.secret
  );

  return {
    reader,
    oracle,
    /**
     * Runs one underwriting request to completion.
     *
     * `proposer` builds the deploy; it never signs or broadcasts. The escrow
     * owner signs, which is why `get_escrow_terms` surfaces the owner address:
     * a proposal for an account that is not the owner is dead on arrival.
     */
    async run(
      request: string,
      proposer: NoteProposer,
      onTrace?: (e: TraceEntry) => void
    ): Promise<UnderwritingRunResult> {
      let noteProposed = false;
      const guarded: NoteProposer = {
        async proposeOpenNote(params) {
          noteProposed = true;
          return proposer.proposeOpenNote(params);
        },
      };

      const result = await runAgentLoop({
        client,
        model,
        system: SYSTEM_PROMPT,
        user: request,
        tools: buildUnderwritingTools({ reader, oracle, proposer: guarded }),
        maxSteps: cfg.maxSteps ?? 8,
        onTrace,
      });

      // Re-read terms for display. A failure here must not change the outcome
      // of the run, only what the UI can show.
      let escrowTerms: { owner: string; minRiskScore: number } | null = null;
      try {
        const [owner, minRiskScore] = await Promise.all([
          reader.getOwner(),
          reader.getMinRiskScore(),
        ]);
        escrowTerms = { owner, minRiskScore };
      } catch {
        escrowTerms = null;
      }

      return { ...result, escrowTerms, noteProposed };
    },
  };
}
