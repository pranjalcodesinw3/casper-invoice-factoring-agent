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

/**
 * Gas budget for payable `post_bond` via the Odra proxy caller (20 CSPR).
 *
 * Session wasm costs far more gas than a contract call: the node executes the
 * whole proxy module, not just an entrypoint. 5 CSPR runs out and surfaces as
 * "Out of gas error", which reads deceptively like a contract rejection. This
 * matches the PROXY_GAS_MOTES the prover script settled on.
 *
 * Casper 2.x charges the FULL limit even when the call reverts, so this number
 * is a real cost on every attempt, not a ceiling.
 */
export const PROXY_CALL_PAYMENT_MOTES = 20_000_000_000;

/** Gas budget for owner-gated `declare_default` (5 CSPR: it transfers out). */
export const DECLARE_DEFAULT_PAYMENT_MOTES = 5_000_000_000;

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
 * Builds a session deploy that calls a PAYABLE Odra entrypoint.
 *
 * Payable entrypoints cannot be called directly from an account on Casper:
 * there is no way to attach native tokens to a plain contract call. Odra ships
 * `proxy_caller.wasm`, a session shim that takes the package hash as a raw
 * 32-byte ByteArray, the entry point name, the inner args as a List<U8> of
 * their serialization, and the value to attach.
 *
 * Shared by fund_note and post_bond, which differ only in entry point, args,
 * and amount. They were separate copies of this until post_bond needed it, and
 * a second copy is a second place for the ByteArray/List<U8> encoding to drift.
 */
async function buildPayableProxyDeploy(opts: {
  contractPackageHash: string;
  callerPublicKeyHex: string;
  entryPoint: string;
  /** Inner entrypoint args. Empty for a payable call that takes none. */
  innerArgs: ReturnType<typeof Args.fromMap>;
  /** Native motes to attach, as a base-10 string. */
  attachedMotes: string;
  paymentMotes: number;
}): Promise<PreparedDeploy> {
  const publicKey = PublicKey.fromHex(opts.callerPublicKeyHex);
  const packageHashBytes = hexToBytes(
    normalizePackageHash(opts.contractPackageHash)
  );
  const innerBytes = Array.from(opts.innerArgs.toBytes());
  const argsList = CLValue.newCLList(
    CLTypeUInt8,
    innerBytes.map((b) => CLValue.newCLUint8(b))
  );

  const proxyArgs = Args.fromMap({
    package_hash: CLValue.newCLByteArray(packageHashBytes),
    entry_point: CLValue.newCLString(opts.entryPoint),
    args: argsList,
    attached_value: CLValue.newCLUInt512(opts.attachedMotes),
    amount: CLValue.newCLUInt512(opts.attachedMotes),
  });

  const wasm = await loadProxyCallerWasm();
  const transaction = new SessionBuilder()
    .from(publicKey)
    .wasm(wasm)
    .runtimeArgs(proxyArgs)
    .chainName(CHAIN_NAME)
    .payment(opts.paymentMotes)
    .buildFor1_5();

  return legacyDeployFromTransaction(transaction);
}

/**
 * Payable `fund_note(note_id)` deploy. The investor must attach exactly
 * `faceValueMotes`; the contract reverts WrongAmount on anything else.
 */
export async function buildFundNoteDeploy(
  contractPackageHash: string,
  callerPublicKeyHex: string,
  noteId: number,
  faceValueMotes: string
): Promise<PreparedDeploy> {
  return buildPayableProxyDeploy({
    contractPackageHash,
    callerPublicKeyHex,
    entryPoint: "fund_note",
    innerArgs: Args.fromMap({ note_id: CLValue.newCLUint64(noteId) }),
    attachedMotes: faceValueMotes,
    paymentMotes: PROXY_CALL_PAYMENT_MOTES,
  });
}

/**
 * Payable `post_bond()` deploy: stakes the underwriter's own CSPR as
 * collateral behind every score it signs.
 *
 * This is what separates the bond from a number in a table. The attached CSPR
 * moves into the contract's purse and only leaves via withdraw_bond or a slash
 * on declare_default, both of which are real transfers.
 *
 * The entrypoint takes NO arguments: the staked amount is the attached value.
 */
export async function buildPostBondDeploy(
  contractPackageHash: string,
  callerPublicKeyHex: string,
  bondMotes: string
): Promise<PreparedDeploy> {
  if (BigInt(bondMotes) <= BigInt(0)) {
    // The contract reverts ZeroBond, but that revert still burns the full gas
    // limit on Casper 2.x, so refusing here saves 20 CSPR of real money.
    throw new Error("Bond amount must be greater than zero");
  }
  return buildPayableProxyDeploy({
    contractPackageHash,
    callerPublicKeyHex,
    entryPoint: "post_bond",
    innerArgs: Args.fromMap({}),
    attachedMotes: bondMotes,
    paymentMotes: PROXY_CALL_PAYMENT_MOTES,
  });
}

/**
 * Owner-only `declare_default(note_id)`: pays the note's investor out of the
 * underwriter's bond. Not payable, so it is a direct contract call.
 */
export function buildDeclareDefaultDeploy(
  contractHash: string,
  callerPublicKeyHex: string,
  noteId: number
): PreparedDeploy {
  const publicKey = PublicKey.fromHex(callerPublicKeyHex);
  const transaction = new ContractCallBuilder()
    .from(publicKey)
    .byHash(normalizeContractHash(contractHash))
    .entryPoint("declare_default")
    .runtimeArgs(Args.fromMap({ note_id: CLValue.newCLUint64(noteId) }))
    .chainName(CHAIN_NAME)
    .payment(DECLARE_DEFAULT_PAYMENT_MOTES)
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

/**
 * Where a signed deploy is broadcast from the browser.
 *
 * NOT the node directly. The testnet RPC answers 403 to the CORS preflight, so
 * a `fetch` from the page fails with a bare "Failed to fetch" AFTER the user
 * has approved in their wallet: the worst place to lose a transaction, because
 * the wallet showed an approval for something that never reached the chain.
 * The agent relays instead, and holds no key while doing it.
 */
export const BROADCAST_URL = `${
  process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4030"
}/api/broadcast`;

/**
 * Attaches a signature to a legacy deploy and broadcasts it.
 *
 * Returns the hash the NODE acknowledged. A deploy hash is computable before
 * signing, so returning the locally built one would show a plausible hash for
 * a transaction that was never accepted, which is exactly the kind of proof a
 * judge is right to distrust.
 */
export async function signAndSendDeploy(
  deployJson: Record<string, unknown>,
  signerPublicKeyHex: string,
  signature: Uint8Array
): Promise<string> {
  // The approval signature carries the key algorithm as a leading byte: 0x01
  // for ed25519, 0x02 for secp256k1. The extension returns the raw signature
  // without it, and the prefix is recoverable from the public key's own tag.
  const algoPrefix = signerPublicKeyHex.slice(0, 2);
  const signatureHex =
    algoPrefix +
    Array.from(signature)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const signed = {
    ...deployJson,
    approvals: [{ signer: signerPublicKeyHex, signature: signatureHex }],
  };

  const res = await fetch(BROADCAST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deploy: signed }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    deployHash?: string;
    error?: string;
    data?: string;
  };
  if (!res.ok) {
    throw new Error(
      `${body.error ?? `broadcast failed with HTTP ${res.status}`}${
        body.data ? ` (${body.data})` : ""
      }`
    );
  }
  if (!body.deployHash) {
    throw new Error("Broadcast succeeded but returned no deploy hash");
  }
  return body.deployHash;
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
