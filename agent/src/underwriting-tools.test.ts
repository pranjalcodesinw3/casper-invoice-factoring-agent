/**
 * CI-safe unit tests for the underwriting tool guards.
 *
 * Nothing here touches the network, the risk oracle, or an LLM. The reader,
 * oracle and proposer are stubbed, so what is under test is the tool layer's
 * own refusal logic: the checks standing between a model's tool call and a
 * funding deploy.
 *
 * The property that matters is that `propose_open_note` re-checks live
 * contract state itself rather than trusting the model to have called
 * `get_escrow_terms` first. A model that skips the pre-check, or invents a
 * threshold, must still be unable to prepare a note the contract would revert.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUnderwritingTools, csprToMotes } from "./underwriting-tools.js";

const SELLER =
  "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";
const RISK_HASH = "a".repeat(64);

interface HarnessOpts {
  minRiskScore?: number;
  /** Existing note keyed by id, for the uniqueness check. */
  existingNote?: { status: string } | null;
  signatureValid?: boolean;
  /** Motes the underwriter has staked. Below `minBondMotes` means unbonded. */
  stakedMotes?: string;
  minBondMotes?: string;
}

const OWNER =
  "account-hash-45a102199a961184ce2c34198facfee7c08073bdc05eba127650019c7dacdbe4";

function harness(opts: HarnessOpts = {}) {
  const {
    minRiskScore = 60,
    existingNote = null,
    signatureValid = true,
    minBondMotes = "10000000000",
    // Bonded by default: the bond gate is asserted explicitly below, and
    // leaving every other test to trip over it would hide what they test.
    stakedMotes = "10000000000",
  } = opts;
  const proposed: Array<{ noteId: string; riskScore: number }> = [];

  const tools = buildUnderwritingTools({
    reader: {
      getMinRiskScore: async () => minRiskScore,
      getNote: async () => existingNote,
      getEscrowTerms: async () => ({ minRiskScore }),
      getOwner: async () => OWNER,
      getMinBondMotes: async () => minBondMotes,
      getBlockTime: async () => 1_700_000_000_000,
      getEscrowBalanceMotes: async () => null,
      getBond: async () => ({
        amountMotes: stakedMotes,
        slashedMotes: "0",
        defaults: 0,
      }),
      isBonded: async () => BigInt(stakedMotes) >= BigInt(minBondMotes),
    },
    oracle: {
      fetchSigned: async () => ({
        debtorId: "acme",
        riskScore: 85,
        reportHash: RISK_HASH,
        signatureValid,
        paidVia402: true,
      }),
    },
    proposer: {
      proposeOpenNote: async (params: { noteId: string; riskScore: number }) => {
        proposed.push({ noteId: params.noteId, riskScore: params.riskScore });
        return {
          prepared: true,
          deployHashHex: "f".repeat(64),
          note: "stub",
        };
      },
    },
  } as unknown as Parameters<typeof buildUnderwritingTools>[0]);

  return { tools, proposed };
}

function tool(tools: ReturnType<typeof buildUnderwritingTools>, name: string) {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} must exist`);
  return found as unknown as {
    name: string;
    execute: (a: unknown) => Promise<Record<string, unknown>>;
  };
}

const GOOD_ARGS = {
  noteId: "1",
  sellerPublicKeyHex: SELLER,
  faceValueCspr: "12.5",
  riskScore: 85,
  riskDataHash: RISK_HASH,
};

test("the tool surface exposes the documented tools", () => {
  const { tools } = harness();
  const names = tools.map((t) => t.name);
  for (const expected of [
    "get_escrow_terms",
    "get_note",
    "find_free_note_id",
    "get_risk_report",
    "propose_open_note",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}, got ${names.join(", ")}`);
  }
});

test("a well-formed proposal above the contract minimum is prepared", () => {
  return (async () => {
    const { tools, proposed } = harness({ minRiskScore: 60 });
    const res = await tool(tools, "propose_open_note").execute(GOOD_ARGS);
    assert.equal(res.prepared, true, String(res.error ?? ""));
    assert.equal(proposed.length, 1, "the guards must not be vacuous");
  })();
});

test("a risk score below the contract minimum is refused before it costs gas", async () => {
  const { tools, proposed } = harness({ minRiskScore: 90 });
  const res = await tool(tools, "propose_open_note").execute(GOOD_ARGS);
  assert.equal(res.prepared, false);
  assert.equal(res.refusedBy, "RiskTooHigh");
  assert.equal(proposed.length, 0, "nothing may reach the proposer");
});

test("the minimum is read from the contract, not taken from the model", async () => {
  // Same call, same arguments, different on-chain threshold: the outcome must
  // follow the chain. A model that assumed a threshold cannot override this.
  const permissive = harness({ minRiskScore: 10 });
  const strict = harness({ minRiskScore: 99 });

  const a = await tool(permissive.tools, "propose_open_note").execute(GOOD_ARGS);
  const b = await tool(strict.tools, "propose_open_note").execute(GOOD_ARGS);

  assert.equal(a.prepared, true);
  assert.equal(b.prepared, false);
});

test("a note id that already exists is refused instead of reverting NoteExists", async () => {
  const { tools, proposed } = harness({ existingNote: { status: "Open" } });
  const res = await tool(tools, "propose_open_note").execute(GOOD_ARGS);
  assert.equal(res.prepared, false);
  assert.equal(res.refusedBy, "NoteExists");
  assert.equal(proposed.length, 0);
});

test("a malformed note id is rejected before any chain read", async () => {
  const { tools, proposed } = harness();
  for (const bad of ["abc", "1.5", "-1", ""]) {
    const res = await tool(tools, "propose_open_note").execute({
      ...GOOD_ARGS,
      noteId: bad,
    });
    assert.equal(res.prepared, false, `noteId ${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(proposed.length, 0);
});

test("a zero or unparseable face value is rejected", async () => {
  const { tools, proposed } = harness();
  for (const bad of ["0", "abc", "-5", "1.9999999999"]) {
    const res = await tool(tools, "propose_open_note").execute({
      ...GOOD_ARGS,
      faceValueCspr: bad,
    });
    assert.equal(res.prepared, false, `faceValueCspr ${bad} must be rejected`);
  }
  assert.equal(proposed.length, 0);
});

test("a seller that is not a valid public key is rejected", async () => {
  const { tools, proposed } = harness();
  const res = await tool(tools, "propose_open_note").execute({
    ...GOOD_ARGS,
    sellerPublicKeyHex: "not-a-key",
  });
  assert.equal(res.prepared, false);
  assert.equal(proposed.length, 0);
});

test("a risk score outside 0-100 or non-integer is rejected", async () => {
  const { tools } = harness({ minRiskScore: 0 });
  for (const bad of [-1, 101, 85.5, NaN]) {
    const res = await tool(tools, "propose_open_note").execute({
      ...GOOD_ARGS,
      riskScore: bad,
    });
    assert.equal(res.prepared, false, `riskScore ${bad} must be rejected`);
  }
});

test("csprToMotes converts at 1e9 and refuses anything that is not a plain amount", () => {
  assert.equal(csprToMotes("1"), 1_000_000_000n);
  assert.equal(csprToMotes("12.5"), 12_500_000_000n);
  assert.equal(csprToMotes("0.000000001"), 1n);
  assert.equal(csprToMotes(" 2.5 "), 2_500_000_000n);
  for (const bad of ["", "abc", "-1", "1.9999999999", "1e9", "0x10"]) {
    assert.throws(
      () => csprToMotes(bad),
      /is not a CSPR amount/,
      `should reject ${JSON.stringify(bad)}`
    );
  }
});

test("motes conversion does not lose precision at amounts a float would round", () => {
  // 0.1 + 0.2 in floating point is 0.30000000000000004. Parsed as decimal
  // strings, these must land on exact motes.
  assert.equal(csprToMotes("0.1"), 100_000_000n);
  assert.equal(csprToMotes("0.2"), 200_000_000n);
  assert.equal(csprToMotes("0.3"), 300_000_000n);
  assert.equal(csprToMotes("9007199254.740993"), 9_007_199_254_740_993_000n);
});

/* ------------------------------------------------------------------ *
 * The bond gate
 *
 * open_note checks `is_bonded` BEFORE it looks at the risk score, so an
 * unbonded underwriter is refused NotBonded no matter how good the paper is.
 * The tool layer has to check the same clause in the same order, otherwise it
 * prepares a deploy whose only possible outcome is a revert that still burns
 * the whole gas limit on Casper 2.x.
 * ------------------------------------------------------------------ */

test("an unbonded underwriter is refused NotBonded before the risk score matters", async () => {
  // Staked below the minimum, and a risk score well ABOVE the bar: if the
  // order were wrong this would pass the score check and prepare a deploy.
  const { tools, proposed } = harness({
    stakedMotes: "1",
    minBondMotes: "10000000000",
    minRiskScore: 60,
  });

  const res = await tool(tools, "propose_open_note").execute({
    ...GOOD_ARGS,
    riskScore: 95,
  });

  assert.equal(res.prepared, false);
  assert.equal(res.refusedBy, "NotBonded");
  assert.equal(proposed.length, 0, "no deploy may be built for an unbonded desk");
});

test("a fully bonded underwriter clears the gate and the note is prepared", async () => {
  const { tools, proposed } = harness({
    stakedMotes: "10000000000",
    minBondMotes: "10000000000",
  });

  const res = await tool(tools, "propose_open_note").execute(GOOD_ARGS);

  assert.equal(res.prepared, true);
  assert.equal(proposed.length, 1);
});

test("get_escrow_terms reports the bond so the model can see the gate", async () => {
  const { tools } = harness({ stakedMotes: "0", minBondMotes: "10000000000" });

  const terms = await tool(tools, "get_escrow_terms").execute({});

  assert.equal(terms.minBondMotes, "10000000000");
  assert.equal(terms.underwriterBondMotes, "0");
  assert.equal(terms.underwriterIsBonded, false);
  assert.match(String(terms.note), /NotBonded/);
});
