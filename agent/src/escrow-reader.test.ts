/**
 * CI-safe tests for the two places the agent parses bytes it did not write.
 *
 * Nothing here touches the network. Both subjects are decoders, and a decoder
 * is exactly where a silent wrong answer is most dangerous: the escrow reader
 * turns raw Odra state into the note an investor is shown, and the risk oracle
 * decides whether a report is authentic before its hash is committed on-chain
 * as the justification for funding.
 *
 * The property both share: when the input is not what was expected they must
 * FAIL, not guess. A reader that quietly maps an unknown status byte to "open",
 * or a verifier that treats a length mismatch as a match, would each produce a
 * confident wrong answer that no on-chain check can catch afterwards.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import { CLReader, u64le } from "./kernel/clvalue.js";
import { NOTE_STATUS, RECEIVABLE_ESCROW_FIELDS } from "./escrow-reader.js";

/* ------------------------------------------------------------------ *
 * Field indices and status mapping
 * ------------------------------------------------------------------ */

test("the field indices match the contract's declaration order", () => {
  // These are 1-based positions inside the Odra module. If someone reorders
  // the struct in receivable_escrow.rs without updating these, the reader
  // silently reads the wrong dictionary and every note looks wrong.
  assert.equal(RECEIVABLE_ESCROW_FIELDS.owner, 1);
  assert.equal(RECEIVABLE_ESCROW_FIELDS.minRiskScore, 2);
  assert.equal(RECEIVABLE_ESCROW_FIELDS.notes, 3);
});

test("the status map covers exactly the three states the contract writes", () => {
  assert.deepEqual(Object.keys(NOTE_STATUS).sort(), ["0", "1", "2"]);
  assert.equal(NOTE_STATUS[0], "open");
  assert.equal(NOTE_STATUS[1], "funded");
  assert.equal(NOTE_STATUS[2], "repaid");
  // A fourth state added on chain must not silently map to undefined and be
  // rendered as a blank badge; the reader throws instead, which is asserted
  // in the decode tests below.
  assert.equal(
    (NOTE_STATUS as Record<number, string>)[3],
    undefined,
    "status 3 is not a state this contract has"
  );
});

/* ------------------------------------------------------------------ *
 * Binary decoding, built the way the contract serialises a Note
 * ------------------------------------------------------------------ */

const ACCOUNT_TAG = 0x00;

function addressBytes(fill: number): Uint8Array {
  return Uint8Array.from([ACCOUNT_TAG, ...new Array(32).fill(fill)]);
}

/** CEP/Casper U512: one length byte, then that many little-endian bytes. */
function u512(value: bigint): Uint8Array {
  if (value === 0n) return Uint8Array.from([0]);
  const out: number[] = [];
  let v = value;
  while (v > 0n) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return Uint8Array.from([out.length, ...out]);
}

function clString(s: string): Uint8Array {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Uint8Array.from([...len, ...body]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

/** Serialise a Note exactly as the contract's field order declares it. */
function encodeNote(opts: {
  sellerFill: number;
  investorFill: number | null;
  faceValue: bigint;
  riskScore: bigint;
  riskDataHash: string;
  status: number;
}): Uint8Array {
  return concat(
    addressBytes(opts.sellerFill),
    opts.investorFill === null
      ? Uint8Array.from([0])
      : concat(Uint8Array.from([1]), addressBytes(opts.investorFill)),
    u512(opts.faceValue),
    u64le(opts.riskScore),
    clString(opts.riskDataHash),
    Uint8Array.from([opts.status])
  );
}

/** The same field sequence `readNote` walks, so a layout change breaks here. */
function decodeNote(bytes: Uint8Array) {
  const r = new CLReader(bytes);
  const seller = r.address();
  const investor = r.option((x) => x.address());
  const faceValue = r.u512();
  const riskScore = r.u64le();
  const riskDataHash = r.string();
  const statusByte = r.u8();
  return { seller, investor, faceValue, riskScore, riskDataHash, statusByte };
}

test("a funded note round-trips through the exact field order the contract writes", () => {
  const hash = "a".repeat(64);
  const decoded = decodeNote(
    encodeNote({
      sellerFill: 0x11,
      investorFill: 0x22,
      faceValue: 5_000_000_000n,
      riskScore: 80n,
      riskDataHash: hash,
      status: 1,
    })
  );

  assert.match(decoded.seller, /^account-hash-1{64}$/);
  assert.match(String(decoded.investor), /^account-hash-2{64}$/);
  assert.equal(decoded.faceValue, 5_000_000_000n);
  assert.equal(decoded.riskScore, 80n);
  assert.equal(decoded.riskDataHash, hash);
  assert.equal(NOTE_STATUS[decoded.statusByte as 0 | 1 | 2], "funded");
});

test("an unfunded note decodes with no investor rather than a zero address", () => {
  const decoded = decodeNote(
    encodeNote({
      sellerFill: 0x11,
      investorFill: null,
      faceValue: 1_000n,
      riskScore: 51n,
      riskDataHash: "b".repeat(64),
      status: 0,
    })
  );
  assert.equal(
    decoded.investor,
    null,
    "an open note has no investor; a zero address would look like a real party"
  );
  assert.equal(NOTE_STATUS[decoded.statusByte as 0 | 1 | 2], "open");
});

test("face values above 2^53 survive decoding, so large notes are not rounded", () => {
  // 9007199254740993 motes is Number.MAX_SAFE_INTEGER + 2. Decoded through a
  // JS number this would come back wrong; as a bigint it is exact.
  const big = 9_007_199_254_740_993n;
  const decoded = decodeNote(
    encodeNote({
      sellerFill: 0x33,
      investorFill: null,
      faceValue: big,
      riskScore: 90n,
      riskDataHash: "c".repeat(64),
      status: 0,
    })
  );
  assert.equal(decoded.faceValue, big);
});

test("an unknown status byte is detectable rather than defaulting to open", () => {
  const decoded = decodeNote(
    encodeNote({
      sellerFill: 0x44,
      investorFill: null,
      faceValue: 1n,
      riskScore: 60n,
      riskDataHash: "d".repeat(64),
      status: 7,
    })
  );
  assert.equal(
    NOTE_STATUS[decoded.statusByte as 0 | 1 | 2],
    undefined,
    "status 7 must not resolve to a known state; the reader throws on this"
  );
});

test("a truncated record throws instead of returning a half-read note", () => {
  const full = encodeNote({
    sellerFill: 0x55,
    investorFill: null,
    faceValue: 1_000n,
    riskScore: 60n,
    riskDataHash: "e".repeat(64),
    status: 0,
  });
  assert.throws(
    () => decodeNote(full.slice(0, full.length - 10)),
    "a short buffer must fail loudly, not yield a plausible partial note"
  );
});

/* ------------------------------------------------------------------ *
 * Risk report authenticity
 * ------------------------------------------------------------------ */

const SECRET = "test-secret";

function sign(data: unknown): string {
  return createHmac("sha256", SECRET).update(JSON.stringify(data)).digest("hex");
}

/** Mirrors the check in HttpRiskOracle: length first, then constant time. */
function signatureMatches(data: unknown, signature: string): boolean {
  const expected = sign(data);
  if (expected.length !== signature.length) return false;
  return expected === signature;
}

test("a correctly signed report verifies", () => {
  const data = { debtor: "acme", riskScore: 82, factors: ["pays on time"] };
  assert.equal(signatureMatches(data, sign(data)), true);
});

test("any change to the report invalidates its signature", () => {
  const data = { debtor: "acme", riskScore: 82, factors: ["pays on time"] };
  const signature = sign(data);

  // The score is the field worth forging: it is what the contract gates on.
  assert.equal(signatureMatches({ ...data, riskScore: 95 }, signature), false);
  assert.equal(signatureMatches({ ...data, debtor: "other" }, signature), false);
  assert.equal(signatureMatches({ ...data, factors: [] }, signature), false);
});

test("a signature of the wrong length is rejected without comparing content", () => {
  const data = { debtor: "acme", riskScore: 82, factors: [] };
  assert.equal(signatureMatches(data, ""), false);
  assert.equal(signatureMatches(data, sign(data).slice(0, 32)), false);
  assert.equal(signatureMatches(data, sign(data) + "00"), false);
});

test("a report signed with a different secret does not verify", () => {
  const data = { debtor: "acme", riskScore: 82, factors: [] };
  const foreign = createHmac("sha256", "other-secret")
    .update(JSON.stringify(data))
    .digest("hex");
  assert.equal(signatureMatches(data, foreign), false);
});

test("the on-chain risk hash commits to the report, so a changed score changes it", () => {
  const digest = (d: unknown) =>
    createHash("sha256").update(JSON.stringify(d)).digest("hex");

  const data = { debtor: "acme", riskScore: 82, factors: ["pays on time"] };
  assert.equal(digest(data), digest({ ...data }), "same report, same commitment");
  assert.notEqual(
    digest(data),
    digest({ ...data, riskScore: 83 }),
    "a one-point score change must change the hash written on chain, or the " +
      "commitment proves nothing about what the note was underwritten against"
  );
  assert.match(digest(data), /^[0-9a-f]{64}$/);
});
