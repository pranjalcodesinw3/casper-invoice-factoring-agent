/**
 * The tools the underwriting agent may call.
 *
 * Every one is a query against deployed ReceivableEscrow state or a guarded
 * action. The model receives no chain state in its prompt: to learn the
 * acceptance bar it has to call `get_escrow_terms`, and to learn whether a note
 * id is free it has to call `get_note`. That is the difference between an LLM
 * that writes an underwriting memo and an agent that underwrites.
 *
 * Nothing here fabricates a value. If the node is unreachable the tool reports
 * the failure and the agent must reason about it, because a demo that invents
 * an acceptance threshold when the RPC is down is exactly the mock-in-demo-path
 * failure a judge looks for.
 */
import type { AgentTool } from "./kernel/loop.js";
import { toAccountHash } from "./kernel/clvalue.js";
import type { ReceivableEscrowReader } from "./escrow-reader.js";
import type { RiskOracle } from "./risk-oracle.js";

/** Requests an `open_note` deploy. Never signs, never broadcasts. */
export interface NoteProposer {
  proposeOpenNote(params: {
    noteId: string;
    sellerPublicKeyHex: string;
    faceValueMotes: string;
    riskScore: number;
    riskDataHash: string;
  }): Promise<{
    prepared: boolean;
    deployHashHex: string | null;
    note: string;
  }>;
}

const MOTES_PER_CSPR = 1_000_000_000n;

/** Decimal CSPR string to motes. Rejects anything that is not a plain amount. */
export function csprToMotes(cspr: string): bigint {
  const trimmed = cspr.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error(
      `"${cspr}" is not a CSPR amount (expected digits with up to 9 decimals)`
    );
  }
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * MOTES_PER_CSPR + BigInt((frac + "000000000").slice(0, 9));
}

export function buildUnderwritingTools(deps: {
  reader: ReceivableEscrowReader;
  oracle: RiskOracle;
  proposer: NoteProposer;
  /** How far `find_free_note_id` will scan before giving up. */
  scanLimit?: number;
}): AgentTool<never>[] {
  const { reader, oracle, proposer, scanLimit = 24 } = deps;

  const getEscrowTerms: AgentTool<Record<string, never>> = {
    name: "get_escrow_terms",
    description:
      "Read the ReceivableEscrow's on-chain underwriting terms: the owner " +
      "address that may open notes and the minimum risk score the contract " +
      "accepts. A note below the minimum reverts with RiskTooHigh, so read " +
      "this before proposing anything. You do not know these values otherwise.",
    parameters: { type: "object", properties: {}, required: [] },
    async execute() {
      const [owner, minRiskScore, blockTimeMs, escrowBalanceMotes] =
        await Promise.all([
          reader.getOwner(),
          reader.getMinRiskScore(),
          reader.getBlockTime(),
          reader.getEscrowBalanceMotes(),
        ]);
      return {
        owner,
        minRiskScore,
        blockTimeMs,
        escrowBalanceMotes,
        note:
          "minRiskScore is enforced on-chain: open_note reverts RiskTooHigh " +
          "for any score below it.",
      };
    },
  };

  const getNote: AgentTool<{ noteId: string }> = {
    name: "get_note",
    description:
      "Read one receivable note by id from the contract. Returns null when no " +
      "note has been opened under that id, which means the id is free. Note " +
      "status is open, funded, or repaid; open_note reverts NoteExists for an " +
      "id already in use.",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "Note id as a decimal integer string, for example \"7\"",
        },
      },
      required: ["noteId"],
    },
    async execute(args) {
      if (!/^\d+$/.test(args.noteId)) {
        return {
          error: `noteId must be a decimal integer string, got "${args.noteId}"`,
        };
      }
      const note = await reader.getNote(BigInt(args.noteId));
      return note === null
        ? { note: null, idIsFree: true }
        : { note, idIsFree: false };
    },
  };

  const findFreeNoteId: AgentTool<{ startAt?: string }> = {
    name: "find_free_note_id",
    description:
      "Scan the contract for the first unused note id at or after startAt. " +
      "Odra mappings cannot be enumerated, so this is a bounded scan and the " +
      "result states the range it covered.",
    parameters: {
      type: "object",
      properties: {
        startAt: {
          type: "string",
          description: "Decimal id to start scanning from. Defaults to 1.",
        },
      },
      required: [],
    },
    async execute(args) {
      const start = args.startAt ?? "1";
      if (!/^\d+$/.test(start)) {
        return { error: `startAt must be a decimal integer, got "${start}"` };
      }
      const from = BigInt(start);
      const existing = await reader.scanNotes(from, scanLimit);
      const taken = new Set(existing.map((n) => n.noteId));
      for (let i = 0; i < scanLimit; i++) {
        const candidate = (from + BigInt(i)).toString();
        if (!taken.has(candidate)) {
          return {
            freeNoteId: candidate,
            scannedRange: `[${from}, ${from + BigInt(scanLimit)})`,
            existingNotes: existing.length,
          };
        }
      }
      return {
        freeNoteId: null,
        scannedRange: `[${from}, ${from + BigInt(scanLimit)})`,
        note: "every id in the scanned range is taken; scan further out",
      };
    },
  };

  const getRiskReport: AgentTool<{ debtorId: string }> = {
    name: "get_risk_report",
    description:
      "Buy a signed credit risk report for a debtor from the risk provider " +
      "over x402: the provider answers 402 Payment Required, the tool pays " +
      "and retries. The response carries an HMAC the tool verifies. An " +
      "unverified report must never be used to open a note, because its risk " +
      "score becomes the on-chain risk_data_hash commitment.",
    parameters: {
      type: "object",
      properties: {
        debtorId: {
          type: "string",
          description: "The debtor identifier to price, for example ACME-CORP",
        },
      },
      required: ["debtorId"],
    },
    async execute(args) {
      const report = await oracle.fetchSigned(args.debtorId);
      return {
        debtor: report.debtor,
        riskScore: report.riskScore,
        factors: report.factors,
        signatureValid: report.signatureValid,
        riskDataHash: report.riskDataHash,
        paidVia402: report.paidVia402,
      };
    },
  };

  const proposeOpenNote: AgentTool<{
    noteId: string;
    sellerPublicKeyHex: string;
    faceValueCspr: string;
    riskScore: number;
    riskDataHash: string;
  }> = {
    name: "propose_open_note",
    description:
      "Prepare an open_note deploy for the escrow owner to sign. The contract " +
      "independently re-checks the risk score against its minimum and the id " +
      "against existing notes, and reverts on either, so calling this does not " +
      "guarantee the note opens. Only call it with a riskScore that came from " +
      "get_risk_report with signatureValid true.",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "Free note id, decimal string" },
        sellerPublicKeyHex: {
          type: "string",
          description: "Casper public key hex of the seller who receives funding",
        },
        faceValueCspr: {
          type: "string",
          description: "Invoice face value in CSPR, for example \"12.5\"",
        },
        riskScore: {
          type: "number",
          description: "Risk score from the signed report, 0-100",
        },
        riskDataHash: {
          type: "string",
          description: "The risk report hash from get_risk_report",
        },
      },
      required: [
        "noteId",
        "sellerPublicKeyHex",
        "faceValueCspr",
        "riskScore",
        "riskDataHash",
      ],
    },
    async execute(args) {
      if (!/^\d+$/.test(args.noteId)) {
        return {
          prepared: false,
          error: `noteId must be a decimal integer string, got "${args.noteId}"`,
        };
      }
      let faceValueMotes: bigint;
      try {
        faceValueMotes = csprToMotes(args.faceValueCspr);
      } catch (err) {
        return {
          prepared: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (faceValueMotes <= 0n) {
        return { prepared: false, error: "faceValueCspr must be greater than 0" };
      }
      try {
        toAccountHash(args.sellerPublicKeyHex);
      } catch (err) {
        return {
          prepared: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (
        !Number.isInteger(args.riskScore) ||
        args.riskScore < 0 ||
        args.riskScore > 100
      ) {
        return {
          prepared: false,
          error: `riskScore must be an integer 0-100, got ${args.riskScore}`,
        };
      }

      // Local pre-check against the same clause the contract enforces. This
      // does not replace the on-chain check; it makes the failure legible
      // before it costs gas.
      const minRiskScore = await reader.getMinRiskScore();
      if (args.riskScore < minRiskScore) {
        return {
          prepared: false,
          refusedBy: "RiskTooHigh",
          error:
            `risk score ${args.riskScore} is below the contract minimum ` +
            `${minRiskScore}; open_note would revert RiskTooHigh`,
        };
      }
      const existing = await reader.getNote(BigInt(args.noteId));
      if (existing) {
        return {
          prepared: false,
          refusedBy: "NoteExists",
          error: `note ${args.noteId} already exists with status ${existing.status}`,
        };
      }

      const result = await proposer.proposeOpenNote({
        noteId: args.noteId,
        sellerPublicKeyHex: args.sellerPublicKeyHex,
        faceValueMotes: faceValueMotes.toString(),
        riskScore: args.riskScore,
        riskDataHash: args.riskDataHash,
      });
      return { ...result, faceValueMotes: faceValueMotes.toString() };
    },
  };

  return [
    getEscrowTerms as AgentTool<never>,
    getNote as AgentTool<never>,
    findFreeNoteId as AgentTool<never>,
    getRiskReport as AgentTool<never>,
    proposeOpenNote as AgentTool<never>,
  ];
}
