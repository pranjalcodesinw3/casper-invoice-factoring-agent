/**
 * CI-safe unit tests for the deterministic layer: the underwriting decision
 * table and the contract-arg encoders.
 *
 * Nothing here touches the network, the risk oracle, or an LLM. `underwrite()`
 * calls the LLM only to write a prose memo, so these tests stub that boundary
 * and assert on the numbers, which are the part that decides how much money
 * moves.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// `underwrite()` reaches for an LLM to write its memo. Stub that one boundary
// before importing it, so the decision logic is testable without a key. The
// tests below assert on approval, advance rate and funding amount only.
const requireFn = Module.createRequire(__filename);
requireFn("./ai.js"); // resolve + populate the cache, then overwrite the export
requireFn.cache[requireFn.resolve("./ai.js")]!.exports = {
  ai: null,
  MODEL: "stub",
  generateUnderwritingMemo: async () => "stubbed memo",
};

const { underwrite } = requireFn("./underwriting.js") as typeof import("./underwriting.js");
const {
  invoiceIdToNoteId,
  csprToMotes,
  mapNoteArgsToContract,
  explorerDeployUrl,
  sellerToAddressKey,
} = requireFn("./contract-client.js") as typeof import("./contract-client.js");

const INVOICE = {
  invoice_id: "INV-001",
  debtor_name: "Acme Corp",
  face_value: 10_000,
  days_overdue: 0,
};

function riskReport(riskScore: number) {
  // Matches VerifiedRiskReport exactly, so a drift in that interface breaks
  // this test instead of being papered over by a cast.
  const report: Parameters<typeof underwrite>[1] = {
    debtor: "Acme Corp",
    riskScore,
    factors: ["test fixture"],
    signatureValid: true,
  };
  return report;
}

test("a risk score below the floor is declined and funds nothing", async () => {
  const d = await underwrite(INVOICE, riskReport(20), 50);
  assert.equal(d.approved, false);
  assert.equal(d.fundingAmount, 0);
  assert.equal(d.recommendedAdvanceRate, 0);
  assert.ok(d.reasons.some((r) => r.includes("below minimum threshold")));
});

test("the advance-rate tiers are exactly the documented bands", async () => {
  const cases: Array<[number, number]> = [
    [95, 0.85],
    [80, 0.85], // boundary: tier 1 starts at 80
    [79, 0.75],
    [70, 0.75], // boundary: tier 2 starts at 70
    [69, 0.65],
    [60, 0.65], // boundary: tier 3 starts at 60
    [59, 0.5],
    [50, 0.5], // boundary: at the floor, still approved
  ];
  for (const [score, expectedRate] of cases) {
    const d = await underwrite(INVOICE, riskReport(score), 50);
    assert.equal(d.approved, true, `score ${score} should be approved`);
    assert.equal(
      d.recommendedAdvanceRate,
      expectedRate,
      `score ${score} should advance at ${expectedRate}`
    );
    assert.equal(
      d.fundingAmount,
      Math.round(INVOICE.face_value * expectedRate),
      `score ${score} funding must equal face value * rate`
    );
  }
});

test("funding never exceeds face value", async () => {
  const d = await underwrite(INVOICE, riskReport(100), 50);
  assert.ok(
    d.fundingAmount < d.faceValue,
    "an advance against a receivable must be a discount, never the full face"
  );
});

test("an LLM memo failure degrades to a declared fallback, it does not throw", async () => {
  requireFn.cache[requireFn.resolve("./ai.js")]!.exports.generateUnderwritingMemo =
    async () => {
      throw new Error("no API key");
    };
  const d = await underwrite(INVOICE, riskReport(85), 50);
  assert.equal(d.approved, true, "a memo failure must not change the decision");
  assert.match(d.memo, /failed|Manual review/i);
  // restore for any later test
  requireFn.cache[requireFn.resolve("./ai.js")]!.exports.generateUnderwritingMemo =
    async () => "stubbed memo";
});

test("an overdue invoice is flagged in the reasons a human will read", async () => {
  const d = await underwrite({ ...INVOICE, days_overdue: 90 }, riskReport(85), 50);
  assert.ok(d.reasons.some((r) => r.includes("significantly overdue")));
});

test("invoiceIdToNoteId is deterministic, collision-resistant and a safe integer", () => {
  const a = invoiceIdToNoteId("INV-001");
  assert.equal(a, invoiceIdToNoteId("INV-001"), "must be stable across calls");
  assert.notEqual(a, invoiceIdToNoteId("INV-002"), "distinct ids must not collide");
  assert.ok(Number.isSafeInteger(a), "must survive the JSON/u64 boundary intact");
  assert.ok(a >= 0);
});

test("csprToMotes converts at 1e9 and rejects nonsense amounts", () => {
  assert.equal(csprToMotes(1), "1000000000");
  assert.equal(csprToMotes(0), "0");
  assert.equal(csprToMotes(2.5), "2500000000");
  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(() => csprToMotes(bad), /non-negative finite/);
  }
});

test("a public key and its account hash both encode to a canonical Key", () => {
  const pub = "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9";
  const fromPub = sellerToAddressKey(pub).toPrefixedString();
  assert.match(
    fromPub,
    /^account-hash-[0-9a-f]{64}$/,
    "must emit the hyphenated canonical form the contract accepts"
  );
  // The same account hash fed back in must round-trip unchanged.
  assert.equal(sellerToAddressKey(fromPub).toPrefixedString(), fromPub);
});

test("mapNoteArgsToContract carries the risk data through to the contract args", () => {
  const args = mapNoteArgsToContract(
    {
      note_id: "INV-001",
      risk_score: 82,
      risk_data_hash: "c".repeat(64),
    } as Parameters<typeof mapNoteArgsToContract>[0],
    "017d3032ee8d1c518faa80850ae066db1ccda4742dff52132374143864dba7baf9",
    2.5
  );
  assert.equal(args.note_id, invoiceIdToNoteId("INV-001"));
  assert.equal(args.face_value_motes, "2500000000");
  assert.equal(args.risk_score, 82);
  assert.equal(args.risk_data_hash, "c".repeat(64));
});

test("the explorer URL points at testnet, not mainnet", () => {
  const url = explorerDeployUrl("d".repeat(64));
  assert.equal(url, `https://testnet.cspr.live/deploy/${"d".repeat(64)}`);
});
