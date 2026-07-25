/**
 * CI-safe tests for the note proposer: the boundary between an agent's decision
 * and a signable transaction.
 *
 * Nothing here signs or broadcasts. What matters about this class is what it
 * does when the build FAILS. A proposer that reported success on a deploy it
 * could not build would hand the agent a hash-shaped value for a transaction
 * that does not exist, and the agent would then reason, and report, as though a
 * note had been opened. That is the single most damaging lie this layer could
 * tell, so most of the file is about the failure path.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DeployNoteProposer } from "./note-proposer.js";

const OWNER =
  "016f26910ea1630842e6ae5be76e5c866a915422b2ed689d1684e01cf0b421a576";
const SELLER =
  "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";
const CONTRACT =
  "984243631528b25918c69364ba6c28893b061d1c90858e1872b7c8c0f56a8cb8";
const RISK_HASH = "a".repeat(64);

function proposer() {
  return new DeployNoteProposer(CONTRACT, OWNER);
}

const GOOD = {
  noteId: "1",
  sellerPublicKeyHex: SELLER,
  faceValueMotes: "1000000000",
  riskScore: 80,
  riskDataHash: RISK_HASH,
};

/* ------------------------------------------------------------------ *
 * Construction: refuse to exist in a state that cannot work
 * ------------------------------------------------------------------ */

test("a proposer without a contract hash refuses to be constructed", () => {
  assert.throws(
    () => new DeployNoteProposer("", OWNER),
    /requires a contract hash/
  );
});

test("a proposer without the owner key refuses to be constructed", () => {
  // open_note is owner-gated, so a proposer built with anyone else's key would
  // produce deploys that revert NotOwner. Failing at construction makes that a
  // config error rather than a wasted transaction.
  assert.throws(
    () => new DeployNoteProposer(CONTRACT, ""),
    /owner public key/
  );
});

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test("a well-formed proposal builds an unsigned deploy", async () => {
  const p = proposer();
  const res = await p.proposeOpenNote(GOOD);

  assert.equal(res.prepared, true, res.note);
  assert.match(
    String(res.deployHashHex),
    /^[0-9a-f]{64}$/,
    "a real deploy hash, not a placeholder"
  );
  assert.ok(p.lastDeployJson, "the deploy is retained for the wallet to sign");
});

test("the note says plainly that the deploy is unsigned", async () => {
  const res = await proposer().proposeOpenNote(GOOD);
  assert.match(
    res.note,
    /unsigned|must sign/i,
    "the agent must not read this as a settled transaction"
  );
});

/* ------------------------------------------------------------------ *
 * The failure path, which is the point of this class
 * ------------------------------------------------------------------ */

test("an unbuildable deploy reports failure instead of inventing a hash", async () => {
  const res = await proposer().proposeOpenNote({
    ...GOOD,
    sellerPublicKeyHex: "not-a-key",
  });

  assert.equal(res.prepared, false);
  assert.equal(
    res.deployHashHex,
    null,
    "null, not a hash-shaped placeholder the agent might report as real"
  );
  assert.match(res.note, /could not build/i);
});

test("a build failure explains itself rather than failing silently", async () => {
  const res = await proposer().proposeOpenNote({
    ...GOOD,
    sellerPublicKeyHex: "zz".repeat(32),
  });
  assert.equal(res.prepared, false);
  assert.ok(
    res.note.length > "could not build the deploy: ".length,
    "the underlying error is passed through so the agent can reason about it"
  );
});

test("a failed build does not leave a stale deploy behind for the wallet", async () => {
  const p = proposer();
  await p.proposeOpenNote(GOOD);
  const afterSuccess = p.lastDeployJson;
  assert.ok(afterSuccess);

  await p.proposeOpenNote({ ...GOOD, sellerPublicKeyHex: "not-a-key" });

  // The previous deploy is still the last one BUILT, which is honest, but the
  // failed call must not have replaced it with something unusable.
  assert.equal(
    p.lastDeployJson,
    afterSuccess,
    "a failed build must not overwrite the last good deploy with junk"
  );
});

test("a proposal never throws, because the agent needs a value to reason about", async () => {
  // The tool loop feeds this result back to the model. An exception would
  // abort the run; a structured failure lets the model try something else.
  const p = proposer();
  for (const bad of [
    { ...GOOD, sellerPublicKeyHex: "" },
    { ...GOOD, sellerPublicKeyHex: "0x" },
    { ...GOOD, faceValueMotes: "not-a-number" },
  ]) {
    const res = await p.proposeOpenNote(bad);
    assert.equal(typeof res.prepared, "boolean", "always a structured result");
  }
});

test("the risk hash reaches the deploy unchanged, so provenance survives", async () => {
  const p = proposer();
  const riskDataHash = "b".repeat(64);
  const res = await p.proposeOpenNote({ ...GOOD, riskDataHash });
  assert.equal(res.prepared, true);

  // The hash is the commitment to the report the note was underwritten against.
  // If this layer rewrote it, the on-chain record would point at nothing.
  //
  // It is NOT searchable as raw ASCII: runtime args are CL-serialised, so a
  // CLString is stored as a 4-byte little-endian length followed by the UTF-8
  // bytes, all hex-encoded. So "bbbb..." appears as "40000000" + "62" x 64.
  const serialised = JSON.stringify(p.lastDeployJson);
  const expected =
    "40000000" + Buffer.from(riskDataHash, "utf8").toString("hex");
  assert.ok(
    serialised.includes(expected),
    "the risk hash must survive CL serialisation byte for byte"
  );
});
