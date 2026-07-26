/**
 * Reads the deployed ReceivableEscrow's Odra state.
 *
 * Field indices are 1-based in declaration order in
 * `contract/src/receivable_escrow.rs`:
 *
 *     owner: Var<Address>          -> 1
 *     min_risk_score: Var<u64>     -> 2
 *     notes: Mapping<u64, Note>    -> 3
 *     bond: SubModule<UnderwriterBond> -> 4
 *
 * A SubModule's own fields nest: Odra packs the path as one nibble per level,
 * so `bond.bonds` (child 1 of parent 4) is index `(4 << 4) | 1 = 0x41`, not 5.
 * Read off the live v2 contract: index 0x43 (`bond.min_bond`, child 3) decodes
 * to 10_000_000_000 motes, the 10 CSPR minimum the contract was installed
 * with, and indices 1-3 still decode to owner/min_risk_score/notes. That is
 * the evidence the nibble packing is right rather than a guess.
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
  /** SubModule<UnderwriterBond>, declared fourth. */
  bond: 4,
} as const;

/**
 * Field indices inside the `UnderwriterBond` submodule, in its own declaration
 * order. Nested under `RECEIVABLE_ESCROW_FIELDS.bond` via `nested()`.
 */
export const UNDERWRITER_BOND_FIELDS = {
  bonds: 1,
  defaulted: 2,
  minBond: 3,
} as const;

/**
 * Odra's index for a field one level inside a SubModule.
 *
 * The path is packed a nibble per level, most significant level first, so the
 * scheme holds while every index is <= 15. Both levels are checked rather than
 * assumed, because a silent overflow here would read a different dictionary
 * key and return a confident wrong answer.
 */
export function nested(parentIndex: number, childIndex: number): number {
  if (parentIndex < 1 || parentIndex > 15 || childIndex < 1 || childIndex > 15) {
    throw new Error(
      `Odra nibble packing only holds for indices 1-15; got ${parentIndex}.${childIndex}`
    );
  }
  return (parentIndex << 4) | childIndex;
}

/** Lifecycle values of `Note.status` as the contract writes them. */
export const NOTE_STATUS = {
  0: "open",
  1: "funded",
  2: "repaid",
  3: "defaulted",
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

/** The underwriter's staked collateral, as `UnderwriterBond::Bond`. */
export interface OnChainBond {
  /** Motes currently held for this underwriter. */
  amountMotes: string;
  /** Cumulative motes slashed to investors on declared defaults. */
  slashedMotes: string;
  /** Number of notes this underwriter has had declared in default. */
  defaults: number;
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

  /**
   * The minimum bond an underwriter must hold before `open_note` will accept
   * anything from it. Read from the contract, never assumed: the unit tests
   * use a symbolic 10_000 motes that would be meaningless against the live
   * install, which was initialized at 10 CSPR.
   */
  async getMinBondMotes(): Promise<string> {
    const value = await this.state.readField(
      nested(RECEIVABLE_ESCROW_FIELDS.bond, UNDERWRITER_BOND_FIELDS.minBond),
      undefined,
      "min bond",
      (r) => r.u512()
    );
    if (value === null) {
      throw new Error(
        "ReceivableEscrow has no min_bond set; the deployed contract predates underwriter bond custody"
      );
    }
    return value.toString();
  }

  /**
   * The collateral one underwriter has staked, or null when it has never
   * posted a bond. Null is a real answer here ("no stake"), so callers must
   * not confuse it with a read failure; every other error throws.
   */
  async getBond(underwriter: string): Promise<OnChainBond | null> {
    return this.state.readField(
      nested(RECEIVABLE_ESCROW_FIELDS.bond, UNDERWRITER_BOND_FIELDS.bonds),
      accountKeyBytes(underwriter),
      `bond for ${underwriter}`,
      (r) => ({
        amountMotes: r.u512().toString(),
        slashedMotes: r.u512().toString(),
        defaults: r.u32le(),
      })
    );
  }

  /**
   * Whether `underwriter` clears the bond bar, mirroring the contract's own
   * `is_bonded`. This is the clause `open_note` checks first, so an unbonded
   * underwriter is refused before the risk score is even considered.
   */
  async isBonded(underwriter: string): Promise<boolean> {
    const [bond, minBond] = await Promise.all([
      this.getBond(underwriter),
      this.getMinBondMotes(),
    ]);
    if (!bond) return false;
    return BigInt(bond.amountMotes) >= BigInt(minBond);
  }
}
