/**
 * Reads the deployed ReceivableEscrow's Odra state.
 *
 * Field indices are 1-based in declaration order in
 * `contract/src/receivable_escrow.rs`:
 *
 *     owner: Var<Address>          -> 1
 *     min_risk_score: Var<u64>     -> 2
 *     notes: Mapping<u64, Note>    -> 3
 *
 * Verified against the live testnet contract
 * (package hash-1c7b0dfe..., contract 98424363...): field 1 decodes to
 * account-hash-45a10219..., which is the blake2b account hash of the deployer
 * public key 016f2691... recorded in web/.env.local, and field 2 decodes to
 * 50, the `min_risk_score` the contract was initialized with.
 */
import { CLReader, accountKeyBytes, u64le } from "./kernel/clvalue.js";
import { OdraStateClient, type OdraNodeConfig } from "./kernel/odra-state.js";

/** Field indices, 1-based in declaration order within the Odra module. */
export const RECEIVABLE_ESCROW_FIELDS = {
  owner: 1,
  minRiskScore: 2,
  notes: 3,
} as const;

/** Lifecycle values of `Note.status` as the contract writes them. */
export const NOTE_STATUS = {
  0: "open",
  1: "funded",
  2: "repaid",
} as const;

export type NoteStatus = (typeof NOTE_STATUS)[keyof typeof NOTE_STATUS];

export interface OnChainNote {
  noteId: string;
  seller: string;
  /** Null until an investor funds the note. */
  investor: string | null;
  faceValueMotes: string;
  riskScore: number;
  riskDataHash: string;
  status: NoteStatus;
}

function readNote(noteId: bigint): (r: CLReader) => OnChainNote {
  return (r) => {
    const seller = r.address();
    const investor = r.option((x) => x.address());
    const faceValue = r.u512();
    const riskScore = r.u64le();
    const riskDataHash = r.string();
    const statusByte = r.u8();
    const status = NOTE_STATUS[statusByte as keyof typeof NOTE_STATUS];
    if (!status) {
      throw new Error(
        `note ${noteId} has unknown status byte ${statusByte}; the contract layout may have changed`
      );
    }
    return {
      noteId: noteId.toString(),
      seller,
      investor,
      faceValueMotes: faceValue.toString(),
      riskScore: Number(riskScore),
      riskDataHash,
      status,
    };
  };
}

export class ReceivableEscrowReader {
  private readonly state: OdraStateClient;

  constructor(cfg: OdraNodeConfig) {
    this.state = new OdraStateClient(cfg);
  }

  /** The underwriter address the contract gates `open_note` on. */
  async getOwner(): Promise<string> {
    const owner = await this.state.readField(
      RECEIVABLE_ESCROW_FIELDS.owner,
      undefined,
      "escrow owner",
      (r) => r.address()
    );
    if (owner === null) {
      throw new Error("ReceivableEscrow has no owner set; is it initialized?");
    }
    return owner;
  }

  /**
   * The minimum risk score the contract accepts. This is the authority the
   * agent must respect: proposing a note below it is a guaranteed revert.
   */
  async getMinRiskScore(): Promise<number> {
    const value = await this.state.readField(
      RECEIVABLE_ESCROW_FIELDS.minRiskScore,
      undefined,
      "min risk score",
      (r) => r.u64le()
    );
    if (value === null) {
      throw new Error("ReceivableEscrow has no min_risk_score set");
    }
    return Number(value);
  }

  /** One note by id, or null when no note has ever been opened under it. */
  async getNote(noteId: bigint): Promise<OnChainNote | null> {
    return this.state.readField(
      RECEIVABLE_ESCROW_FIELDS.notes,
      u64le(noteId),
      `note ${noteId}`,
      readNote(noteId)
    );
  }

  /**
   * Scans a contiguous id range for existing notes.
   *
   * Odra gives no way to enumerate a `Mapping`, so a bounded scan is the only
   * honest option. The bound is explicit rather than hidden so the caller
   * knows exactly what "no notes" means: none in [from, from+limit).
   */
  async scanNotes(from: bigint, limit: number): Promise<OnChainNote[]> {
    const ids = Array.from({ length: limit }, (_, i) => from + BigInt(i));
    const notes = await Promise.all(ids.map((id) => this.getNote(id)));
    return notes.filter((n): n is OnChainNote => n !== null);
  }

  /** Current node block time in ms, for freshness statements. */
  async getBlockTime(): Promise<number> {
    return this.state.blockTimeMs();
  }

  /** Native tokens escrowed in the contract, when the module holds a purse. */
  async getEscrowBalanceMotes(): Promise<string | null> {
    return this.state.contractBalanceMotes();
  }
}
