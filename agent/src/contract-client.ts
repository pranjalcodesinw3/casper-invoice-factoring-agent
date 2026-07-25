import crypto from "crypto";
import * as casperSdk from "casper-js-sdk";
import type { Key } from "casper-js-sdk";
import { NoteArgs } from "./types";

const { Args, CLValue, ContractCallBuilder, Deploy, Key: KeyCtor, PublicKey } =
  casperSdk;

export const CHAIN_NAME = "casper-test";
export const OPEN_NOTE_PAYMENT_MOTES = 3_000_000_000;
export const MOTES_PER_CSPR = 1_000_000_000;

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

export function invoiceIdToNoteId(noteIdString: string): number {
  const digest = crypto.createHash("sha256").update(noteIdString).digest();
  const raw = digest.readBigUInt64BE(0);
  return Number(raw % BigInt(Number.MAX_SAFE_INTEGER));
}

export function sellerToAddressKey(seller: string): Key {
  const trimmed = seller.trim();
  if (trimmed.startsWith("account-hash-")) {
    return KeyCtor.newKey(trimmed);
  }
  const publicKey = PublicKey.fromHex(trimmed);
  // `AccountHash.toJSON()` renders "account-hash<hex>" with no hyphen, which
  // `Key.newKey` then rejects as an unknown prefix. `toPrefixedString()` is the
  // one that emits the canonical "account-hash-<hex>" form.
  return KeyCtor.newKey(publicKey.accountHash().toPrefixedString());
}

export function csprToMotes(cspr: number): string {
  if (!Number.isFinite(cspr) || cspr < 0) {
    throw new Error("CSPR amount must be a non-negative finite number");
  }
  const whole = BigInt(Math.trunc(cspr));
  const fraction = cspr - Math.trunc(cspr);
  const fractionalMotes = BigInt(Math.round(fraction * MOTES_PER_CSPR));
  return (whole * BigInt(MOTES_PER_CSPR) + fractionalMotes).toString();
}

/**
 * Map agent noteArgs to contract types: u64 note_id, Address seller.
 */
export function mapNoteArgsToContract(
  noteArgs: NoteArgs,
  sellerAddress: string,
  fundingCspr: number
): ContractOpenNoteArgs {
  sellerToAddressKey(sellerAddress);

  return {
    note_id: invoiceIdToNoteId(noteArgs.note_id),
    seller: sellerAddress.replace(/^0x/i, ""),
    face_value_motes: csprToMotes(fundingCspr),
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
  const seller = sellerToAddressKey(args.seller);

  const runtimeArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(args.note_id),
    seller: CLValue.newCLKey(seller),
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
