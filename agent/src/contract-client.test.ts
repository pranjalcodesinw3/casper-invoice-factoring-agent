/**
 * CI-safe tests for the deploy builder: the last step before bytes reach the
 * chain.
 *
 * Nothing here signs or broadcasts. What is under test is argument encoding,
 * which is where a mistake is both easy and expensive: a malformed deploy is
 * not rejected cheaply, it is accepted, executed, and charged for. Casper 2.x
 * charges the full payment limit whether the call succeeds or fails, so a
 * deploy that reverts on a deserialization error costs exactly as much as one
 * that works.
 *
 * Two encoding traps are pinned here because both have already cost this
 * project real money elsewhere:
 *
 *   1. `AccountHash.toJSON()` renders "account-hash<hex>" with no hyphen, which
 *      `Key.newKey` then rejects. `toPrefixedString()` emits the canonical
 *      hyphenated form. Getting this wrong yields an unroutable deploy rather
 *      than a clear error.
 *   2. A CSPR amount must survive the float boundary. 0.1 + 0.2 is not 0.3 in
 *      binary floating point, and a note priced from a float can be short by
 *      motes that the contract's exact-amount check will then reject.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHAIN_NAME,
  MOTES_PER_CSPR,
  OPEN_NOTE_PAYMENT_MOTES,
  buildOpenNoteDeploy,
  csprToMotes,
  explorerDeployUrl,
  invoiceIdToNoteId,
  mapNoteArgsToContract,
  sellerToAddressKey,
} from "./contract-client.js";

const OWNER_PUBLIC_KEY =
  "016f26910ea1630842e6ae5be76e5c866a915422b2ed689d1684e01cf0b421a576";
const SELLER_PUBLIC_KEY =
  "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";
const CONTRACT =
  "984243631528b25918c69364ba6c28893b061d1c90858e1872b7c8c0f56a8cb8";
const RISK_HASH = "a".repeat(64);

/* ------------------------------------------------------------------ *
 * Chain constants
 * ------------------------------------------------------------------ */

test("the deploy targets testnet, not mainnet", () => {
  assert.equal(CHAIN_NAME, "casper-test");
});

test("the motes conversion factor is 1e9", () => {
  assert.equal(MOTES_PER_CSPR, 1_000_000_000);
});

test("the open_note payment is a positive, explicitly chosen limit", () => {
  // Casper charges the FULL limit regardless of outcome, so this number is a
  // price, not a ceiling. It is asserted here so a casual edit is visible in a
  // diff rather than discovered on a bill.
  assert.ok(OPEN_NOTE_PAYMENT_MOTES > 0);
  assert.equal(OPEN_NOTE_PAYMENT_MOTES, 3_000_000_000);
});

/* ------------------------------------------------------------------ *
 * Note ids
 * ------------------------------------------------------------------ */

test("an invoice id maps to a stable, collision-resistant u64 note id", () => {
  const a = invoiceIdToNoteId("INV-001");
  assert.equal(a, invoiceIdToNoteId("INV-001"), "must be stable across calls");
  assert.notEqual(a, invoiceIdToNoteId("INV-002"), "distinct ids must not collide");
  assert.ok(Number.isSafeInteger(a), "must survive the JSON/u64 boundary");
  assert.ok(a >= 0, "note ids are unsigned");
});

test("similar invoice ids do not produce adjacent note ids", () => {
  // A truncating or additive scheme would map INV-001 and INV-002 to
  // neighbours, making accidental collisions likely across a real invoice set.
  const ids = ["INV-001", "INV-002", "INV-003", "inv-001", "INV-0010"].map(
    invoiceIdToNoteId
  );
  assert.equal(new Set(ids).size, ids.length, "all distinct");
});

/* ------------------------------------------------------------------ *
 * Address encoding
 * ------------------------------------------------------------------ */

test("a public key encodes to the canonical hyphenated account hash", () => {
  const key = sellerToAddressKey(SELLER_PUBLIC_KEY).toPrefixedString();
  assert.match(
    key,
    /^account-hash-[0-9a-f]{64}$/,
    "toJSON()'s unhyphenated form is rejected by Key.newKey"
  );
});

test("an account hash round-trips unchanged", () => {
  const once = sellerToAddressKey(SELLER_PUBLIC_KEY).toPrefixedString();
  assert.equal(sellerToAddressKey(once).toPrefixedString(), once);
});

test("whitespace around a key does not change the encoding", () => {
  assert.equal(
    sellerToAddressKey(`  ${SELLER_PUBLIC_KEY}  `).toPrefixedString(),
    sellerToAddressKey(SELLER_PUBLIC_KEY).toPrefixedString()
  );
});

test("a key that is not a key throws rather than producing a bad deploy", () => {
  for (const bad of ["", "not-a-key", "zz".repeat(32)]) {
    assert.throws(
      () => sellerToAddressKey(bad),
      `expected ${JSON.stringify(bad)} to be rejected`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Amounts
 * ------------------------------------------------------------------ */

test("csprToMotes converts at 1e9 and rejects nonsense amounts", () => {
  assert.equal(csprToMotes(1), "1000000000");
  assert.equal(csprToMotes(0), "0");
  assert.equal(csprToMotes(2.5), "2500000000");
  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(() => csprToMotes(bad), /non-negative finite/);
  }
});

test("amounts a float would round survive the conversion exactly", () => {
  // The contract's fund_note requires the attached value to EQUAL face value,
  // so a one-mote drift here becomes a WrongAmount revert on chain.
  assert.equal(csprToMotes(0.1), "100000000");
  assert.equal(csprToMotes(0.2), "200000000");
  assert.equal(csprToMotes(0.3), "300000000");
  assert.equal(csprToMotes(0.1 + 0.2), "300000000", "0.30000000000000004 must not leak");
});

/* ------------------------------------------------------------------ *
 * Argument mapping
 * ------------------------------------------------------------------ */

test("the contract args carry the risk data through unchanged", () => {
  const args = mapNoteArgsToContract(
    {
      note_id: "INV-001",
      risk_score: 82,
      risk_data_hash: RISK_HASH,
    } as Parameters<typeof mapNoteArgsToContract>[0],
    SELLER_PUBLIC_KEY,
    2.5
  );
  assert.equal(args.note_id, invoiceIdToNoteId("INV-001"));
  assert.equal(args.face_value_motes, "2500000000");
  assert.equal(
    args.risk_score,
    82,
    "the score the contract gates on must not be transformed in transit"
  );
  assert.equal(args.risk_data_hash, RISK_HASH, "provenance is passed verbatim");
});

test("mapping rejects a seller that is not a valid key", () => {
  assert.throws(() =>
    mapNoteArgsToContract(
      { note_id: "INV-9", risk_score: 70, risk_data_hash: RISK_HASH } as Parameters<
        typeof mapNoteArgsToContract
      >[0],
      "not-a-key",
      1
    )
  );
});

/* ------------------------------------------------------------------ *
 * The deploy itself
 * ------------------------------------------------------------------ */

test("a built open_note deploy has a real hash and carries its args", () => {
  const args = mapNoteArgsToContract(
    { note_id: "INV-100", risk_score: 91, risk_data_hash: RISK_HASH } as Parameters<
      typeof mapNoteArgsToContract
    >[0],
    SELLER_PUBLIC_KEY,
    12.5
  );
  const built = buildOpenNoteDeploy(CONTRACT, OWNER_PUBLIC_KEY, args);

  assert.match(
    built.deployHashHex,
    /^[0-9a-f]{64}$/,
    "a deploy hash is 32 bytes of hex, not a placeholder"
  );
  assert.ok(built.deployJson, "the wallet needs a serialisable deploy");
  assert.equal(built.contractArgs.face_value_motes, "12500000000");
  assert.equal(built.contractArgs.risk_score, 91);
});

test("the built deploy commits to the amount it was given", () => {
  // NOTE: deploy hashes cannot be compared for equality across builds. A Casper
  // deploy header includes a timestamp, so building the SAME call twice yields
  // two different hashes. That is correct (it is what stops replay), but it
  // means a hash comparison proves nothing about the arguments. Assert on the
  // args the deploy carries instead.
  const mk = (cspr: number) =>
    buildOpenNoteDeploy(
      CONTRACT,
      OWNER_PUBLIC_KEY,
      mapNoteArgsToContract(
        { note_id: "INV-200", risk_score: 80, risk_data_hash: RISK_HASH } as Parameters<
          typeof mapNoteArgsToContract
        >[0],
        SELLER_PUBLIC_KEY,
        cspr
      )
    );
  assert.equal(mk(1).contractArgs.face_value_motes, "1000000000");
  assert.equal(mk(2).contractArgs.face_value_motes, "2000000000");
});

test("building the same call twice yields different hashes, because of the timestamp", () => {
  const args = mapNoteArgsToContract(
    { note_id: "INV-201", risk_score: 80, risk_data_hash: RISK_HASH } as Parameters<
      typeof mapNoteArgsToContract
    >[0],
    SELLER_PUBLIC_KEY,
    1
  );
  const a = buildOpenNoteDeploy(CONTRACT, OWNER_PUBLIC_KEY, args).deployHashHex;
  const b = buildOpenNoteDeploy(CONTRACT, OWNER_PUBLIC_KEY, args).deployHashHex;
  assert.notEqual(a, b, "a deploy header carries a timestamp, so hashes are not reproducible");
});

test("a contract hash is accepted with or without its prefix", () => {
  const args = mapNoteArgsToContract(
    { note_id: "INV-300", risk_score: 80, risk_data_hash: RISK_HASH } as Parameters<
      typeof mapNoteArgsToContract
    >[0],
    SELLER_PUBLIC_KEY,
    1
  );
  // Both forms must build without throwing and produce a well-formed hash.
  // They cannot be compared to each other: see the timestamp note above.
  for (const form of [CONTRACT, `hash-${CONTRACT}`, `contract-${CONTRACT}`]) {
    const built = buildOpenNoteDeploy(form, OWNER_PUBLIC_KEY, args);
    assert.match(built.deployHashHex, /^[0-9a-f]{64}$/, `failed for ${form}`);
  }
});

test("the explorer URL points at testnet and the deploy path", () => {
  const hash = "2233b2d0216adaf8eff0b6dc697e076590f68e6762acce21c210e6d94b528b88";
  assert.equal(explorerDeployUrl(hash), `https://testnet.cspr.live/deploy/${hash}`);
  // /transaction/ is the TransactionV1 path; these are Deploy-type and 404 there.
  assert.ok(!explorerDeployUrl(hash).includes("/transaction/"));
});
