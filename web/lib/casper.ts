import crypto from "crypto";
import {
  Args,
  CLValue,
  ContractCallBuilder,
  Deploy,
  Key,
  PublicKey,
} from "casper-js-sdk";

/**
 * Casper testnet chain name. This project targets testnet only.
 */
export const CHAIN_NAME = "casper-test";

/** Gas budget (in motes) for the owner-gated `open_note` call. 1 CSPR = 1e9 motes. */
export const OPEN_NOTE_PAYMENT_MOTES = 3_000_000_000;

/** Motes per CSPR. */
export const MOTES_PER_CSPR = BigInt(1_000_000_000);

export interface OpenNoteContractArgs {
  /** u64 note id derived from the agent's note id string. */
  noteId: number;
  /** Seller Casper public key hex or `account-hash-...` string. */
  sellerAddress: string;
  /** Invoice face value expressed in motes (string to preserve U512 precision). */
  faceValueMotes: string;
  /** Underwriting risk score, 0-100. */
  riskScore: number;
  /** Hash pointer to the off-chain, signed risk data attestation. */
  riskDataHash: string;
}

export interface PreparedDeploy {
  /** JSON body accepted by `CSPRClickSDK.send(deployJson, signingPublicKey)`. */
  deployJson: unknown;
  /** Hex deploy hash, known before signing so the UI can link to the explorer immediately. */
  deployHashHex: string;
}

/**
 * Strips a `hash-` or `contract-` prefix some UIs display contract hashes with; the
 * SDK's `ContractCallBuilder.byHash` expects the bare hex hash.
 */
function normalizeContractHash(hash: string): string {
  return hash.replace(/^(hash-|contract-)/, "").trim();
}

/**
 * Derive a stable u64 note id from the agent's note id string (e.g. `note-INV-001`).
 * The contract's `note_id` field is a `u64`, so we hash the string and fold it into
 * the JS-safe integer range. This is deterministic: the same invoice always maps to
 * the same on-chain note id.
 */
export function noteIdFromString(noteIdString: string): number {
  const digest = crypto.createHash("sha256").update(noteIdString).digest();
  const raw = digest.readBigUInt64BE(0);
  return Number(raw % BigInt(Number.MAX_SAFE_INTEGER));
}

/**
 * Odra `Address` serializes as a Casper `Key`. Accepts a hex public key or an
 * `account-hash-...` prefixed account hash string and returns the account `Key`.
 */
export function sellerToAddressKey(seller: string): Key {
  const trimmed = seller.trim();
  if (trimmed.startsWith("account-hash-")) {
    return Key.newKey(trimmed);
  }
  const publicKey = PublicKey.fromHex(trimmed);
  return Key.newKey(publicKey.accountHash().toJSON());
}

/**
 * Convert a whole/decimal CSPR amount to motes as a base-10 string.
 */
export function csprToMotes(cspr: number): string {
  if (!Number.isFinite(cspr) || cspr < 0) {
    throw new Error("CSPR amount must be a non-negative finite number");
  }
  const whole = BigInt(Math.trunc(cspr));
  const fraction = cspr - Math.trunc(cspr);
  const fractionalMotes = BigInt(Math.round(fraction * Number(MOTES_PER_CSPR)));
  return (whole * MOTES_PER_CSPR + fractionalMotes).toString();
}

/**
 * Map the agent's `noteArgs` (produced by the underwriting run) onto the exact
 * types the `open_note` entrypoint expects: a `u64` note id, an `Address` seller,
 * a `U512` face value in motes, a `u64` risk score, and the risk-data hash string.
 *
 * The agent's `noteArgs.seller` is a human-readable debtor/supplier name, not a
 * chain address, so the caller supplies the seller's real Casper public key
 * (or account hash). `fundingCspr` is the advance amount the agent recommends,
 * converted to motes for the on-chain face value.
 */
export function mapNoteArgsToContract(
  noteArgs: {
    note_id: string;
    risk_score: number;
    risk_data_hash: string;
  },
  sellerAddress: string,
  fundingCspr: number
): OpenNoteContractArgs {
  return {
    noteId: noteIdFromString(noteArgs.note_id),
    sellerAddress,
    faceValueMotes: csprToMotes(fundingCspr),
    riskScore: noteArgs.risk_score,
    riskDataHash: noteArgs.risk_data_hash,
  };
}

/**
 * Builds a real, signable `open_note` deploy against the deployed `ReceivableEscrow`
 * Odra contract. Entry point signature (see contract/src/receivable_escrow.rs):
 *
 *   pub fn open_note(&mut self, note_id: u64, seller: Address, face_value: U512,
 *                    risk_score: u64, risk_data_hash: String)
 *
 * The contract enforces `assert_owner()` and a `min_risk_score` floor on this
 * entrypoint: only the wallet holding the contract owner's key (the agent-underwriter
 * role for this MVP) can execute it successfully. A non-owner signer, a duplicate
 * note id, or a sub-threshold risk score will revert on testnet.cspr.live; that revert
 * is itself the enforced-policy proof.
 *
 * Uses the legacy (Casper 1.5) deploy encoding via `buildFor1_5()` because CSPR.click's
 * `send` method takes a legacy deploy JSON, not a TransactionV1 payload.
 */
export function buildOpenNoteDeploy(
  contractHash: string,
  callerPublicKeyHex: string,
  args: OpenNoteContractArgs
): PreparedDeploy {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);
  const seller = sellerToAddressKey(args.sellerAddress);

  const runtimeArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(args.noteId),
    seller: CLValue.newCLKey(seller),
    face_value: CLValue.newCLUInt512(args.faceValueMotes),
    risk_score: CLValue.newCLUint64(args.riskScore),
    risk_data_hash: CLValue.newCLString(args.riskDataHash),
  });

  const transaction = new ContractCallBuilder()
    .from(publicKey)
    .byHash(normalizeContractHash(contractHash))
    .entryPoint("open_note")
    .runtimeArgs(runtimeArgs)
    .chainName(CHAIN_NAME)
    .payment(OPEN_NOTE_PAYMENT_MOTES)
    .buildFor1_5();

  const deploy = transaction.getDeploy();
  if (!deploy) {
    throw new Error("casper-js-sdk did not produce a legacy deploy for open_note");
  }

  return {
    deployJson: Deploy.toJSON(deploy),
    deployHashHex: deploy.hash.toHex(),
  };
}

export function explorerDeployUrl(deployHashHex: string): string {
  return `https://testnet.cspr.live/deploy/${deployHashHex}`;
}

export function explorerContractUrl(contractHash: string): string {
  return `https://testnet.cspr.live/contract/${normalizeContractHash(contractHash)}`;
}

export function truncateHex(hex: string, lead = 8, tail = 6): string {
  if (hex.length <= lead + tail + 3) return hex;
  return `${hex.slice(0, lead)}...${hex.slice(-tail)}`;
}

/** True when the connected wallet matches the configured contract owner public key. */
export function isOwnerPublicKey(
  walletPublicKeyHex: string | null | undefined,
  ownerPublicKeyHex: string | undefined
): boolean {
  if (!walletPublicKeyHex || !ownerPublicKeyHex) return false;
  return walletPublicKeyHex.toLowerCase() === ownerPublicKeyHex.toLowerCase();
}
