import crypto from "crypto";
import {
  Args,
  CLValue,
  ContractCallBuilder,
  Deploy,
  PublicKey,
} from "casper-js-sdk";
import { NoteArgs } from "./agent";

export const CHAIN_NAME = "casper-test";

/** Gas budget for open_note contract call (3 CSPR in motes). */
export const OPEN_NOTE_PAYMENT_MOTES = 3_000_000_000;

export interface ContractOpenNoteArgs {
  note_id: number;
  seller: string;
  face_value_motes: string;
  risk_score: number;
  risk_data_hash: string;
}

export interface PreparedOpenNoteDeploy {
  contractArgs: ContractOpenNoteArgs;
  deployJson: unknown;
  deployHashHex: string;
}

function normalizeContractHash(hash: string): string {
  return hash.replace(/^(hash-|contract-)/, "").trim();
}

/**
 * Derive a stable u64 note_id from an invoice id string.
 */
export function invoiceIdToNoteId(invoiceId: string): number {
  const digest = crypto.createHash("sha256").update(invoiceId).digest();
  const raw = digest.readBigUInt64BE(0);
  return Number(raw % BigInt(Number.MAX_SAFE_INTEGER));
}

/**
 * Map agent noteArgs to contract types: u64 note_id, Address seller.
 */
export function mapNoteArgsToContract(
  noteArgs: NoteArgs,
  sellerPubKeyHex: string,
  faceValueMotes: bigint
): ContractOpenNoteArgs {
  const noteId =
    typeof noteArgs.note_id === "number"
      ? noteArgs.note_id
      : invoiceIdToNoteId(String(noteArgs.note_id));

  PublicKey.fromHex(sellerPubKeyHex);

  return {
    note_id: noteId,
    seller: sellerPubKeyHex.replace(/^0x/i, ""),
    face_value_motes: faceValueMotes.toString(),
    risk_score: noteArgs.risk_score,
    risk_data_hash: noteArgs.risk_data_hash,
  };
}

export function buildOpenNoteDeploy(
  contractHash: string,
  callerPublicKeyHex: string,
  args: ContractOpenNoteArgs
): PreparedOpenNoteDeploy {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);
  const sellerKey = PublicKey.fromHex(args.seller);

  const runtimeArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(args.note_id),
    seller: CLValue.newCLPublicKey(sellerKey),
    face_value: CLValue.newCLUInt512(args.face_value_motes),
    risk_score: CLValue.newCLUint64(args.risk_score),
    risk_data_hash: CLValue.newCLString(args.risk_data_hash),
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
    contractArgs: args,
    deployJson: Deploy.toJSON(deploy),
    deployHashHex: deploy.hash.toHex(),
  };
}

export function explorerDeployUrl(deployHashHex: string): string {
  return `https://testnet.cspr.live/deploy/${deployHashHex}`;
}
