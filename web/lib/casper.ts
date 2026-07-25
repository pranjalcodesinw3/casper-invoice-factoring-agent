import crypto from "crypto";
import {
  Args,
  CLTypeUInt8,
  CLValue,
  ContractCallBuilder,
  Deploy,
  Key,
  PublicKey,
  SessionBuilder,
} from "casper-js-sdk";

/**
 * Casper testnet chain name. This project targets testnet only.
 */
export const CHAIN_NAME = "casper-test";

/** Gas budget (in motes) for the owner-gated `open_note` call. 1 CSPR = 1e9 motes. */
export const OPEN_NOTE_PAYMENT_MOTES = 3_000_000_000;

/** Gas budget for payable `fund_note` via Odra proxy caller (5 CSPR). */
export const FUND_NOTE_PAYMENT_MOTES = 5_000_000_000;

/** Gas budget for owner-gated `mark_repaid` (3 CSPR). */
export const MARK_REPAID_PAYMENT_MOTES = 3_000_000_000;

/** Motes per CSPR. */
export const MOTES_PER_CSPR = BigInt(1_000_000_000);

/**
 * Demo notional: USD invoice value represented per 1 CSPR on testnet.
 * $127,500 advance at 10,000 USD/CSPR = 12.75 CSPR on-chain.
 */
export const DEMO_USD_PER_CSPR = Number(
  process.env.NEXT_PUBLIC_DEMO_USD_PER_CSPR ?? "10000"
);

const PROXY_CALLER_WASM_URL = "/proxy_caller.wasm";

let cachedProxyWasm: Uint8Array | null = null;

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

function normalizePackageHash(hash: string): string {
  return hash
    .replace(/^(contract-package-wasm-|contract-package-|hash-)/, "")
    .trim();
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.replace(/^0x/, "");
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Expected a hex-encoded hash");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function legacyDeployFromTransaction(
  transaction: ReturnType<ContractCallBuilder["buildFor1_5"]>
): PreparedDeploy {
  const deploy = transaction.getDeploy();
  if (!deploy) {
    throw new Error("casper-js-sdk did not produce a legacy deploy");
  }
  return {
    deployJson: Deploy.toJSON(deploy),
    deployHashHex: deploy.hash.toHex(),
  };
}

async function loadProxyCallerWasm(): Promise<Uint8Array> {
  if (cachedProxyWasm) return cachedProxyWasm;
  const res = await fetch(PROXY_CALLER_WASM_URL);
  if (!res.ok) {
    throw new Error(`Failed to load proxy caller wasm (${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  cachedProxyWasm = new Uint8Array(buffer);
  return cachedProxyWasm;
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
  return Key.newKey(publicKey.accountHash().toPrefixedString());
}

/**
 * Convert a USD advance amount to a demo CSPR face value for on-chain calls.
 * Invoice amounts stay in USD off-chain; testnet notes use this scaled rate.
 */
export function usdToFundingCspr(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("USD amount must be a non-negative finite number");
  }
  if (DEMO_USD_PER_CSPR <= 0) {
    throw new Error("NEXT_PUBLIC_DEMO_USD_PER_CSPR must be positive");
  }
  return Math.round((usd / DEMO_USD_PER_CSPR) * 100) / 100;
}

/**
 * Format motes as a human-readable CSPR string (drops trailing zeros).
 */
export function motesToCspr(motes: string): string {
  try {
    const value = BigInt(motes);
    const whole = value / MOTES_PER_CSPR;
    const fraction = value % MOTES_PER_CSPR;
    if (fraction === BigInt(0)) return whole.toString();
    const frac = fraction.toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole.toString()}.${frac}`;
  } catch {
    return motes;
  }
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
 * (or account hash). `fundingUsd` is the agent's recommended USD advance; it is
 * converted to demo CSPR via `usdToFundingCspr` before encoding as motes.
 */
export function mapNoteArgsToContract(
  noteArgs: {
    note_id: string;
    risk_score: number;
    risk_data_hash: string;
  },
  sellerAddress: string,
  fundingUsd: number
): OpenNoteContractArgs {
  const fundingCspr = usdToFundingCspr(fundingUsd);
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

  return legacyDeployFromTransaction(transaction);
}

/**
 * Payable `fund_note(note_id)` deploy. Odra payable entrypoints require the
 * `proxy_caller.wasm` session shim so native CSPR can be attached from an account.
 *
 * The investor must attach exactly `faceValueMotes` (the note face value).
 * Requires `NEXT_PUBLIC_CONTRACT_PACKAGE_HASH` from the deploy receipt.
 */
export async function buildFundNoteDeploy(
  contractPackageHash: string,
  callerPublicKeyHex: string,
  noteId: number,
  faceValueMotes: string
): Promise<PreparedDeploy> {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);
  const packageHashBytes = hexToBytes(normalizePackageHash(contractPackageHash));
  const innerArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(noteId),
  });
  const innerBytes = Array.from(innerArgs.toBytes());
  const argsList = CLValue.newCLList(
    CLTypeUInt8,
    innerBytes.map((b) => CLValue.newCLUint8(b))
  );

  const proxyArgs = Args.fromMap({
    package_hash: CLValue.newCLByteArray(packageHashBytes),
    entry_point: CLValue.newCLString("fund_note"),
    args: argsList,
    attached_value: CLValue.newCLUInt512(faceValueMotes),
    amount: CLValue.newCLUInt512(faceValueMotes),
  });

  const wasm = await loadProxyCallerWasm();
  const transaction = new SessionBuilder()
    .from(publicKey)
    .wasm(wasm)
    .runtimeArgs(proxyArgs)
    .chainName(CHAIN_NAME)
    .payment(FUND_NOTE_PAYMENT_MOTES)
    .buildFor1_5();

  return legacyDeployFromTransaction(transaction);
}

/**
 * Owner-only `mark_repaid(note_id)` deploy. Marks a funded note as repaid once
 * the debtor settles off-chain.
 */
export function buildMarkRepaidDeploy(
  contractHash: string,
  callerPublicKeyHex: string,
  noteId: number
): PreparedDeploy {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);

  const runtimeArgs = Args.fromMap({
    note_id: CLValue.newCLUint64(noteId),
  });

  const transaction = new ContractCallBuilder()
    .from(publicKey)
    .byHash(normalizeContractHash(contractHash))
    .entryPoint("mark_repaid")
    .runtimeArgs(runtimeArgs)
    .chainName(CHAIN_NAME)
    .payment(MARK_REPAID_PAYMENT_MOTES)
    .buildFor1_5();

  return legacyDeployFromTransaction(transaction);
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
