/**
 * Fails when the README loses a link a judge needs to reach the project.
 *
 * Written after the repository link was found deleted, uncommitted, in FOUR of
 * the five project READMEs at once. In this project BOTH the header link and
 * the clone command were lost, which makes the quickstart unrunnable: a judge
 * following it verbatim gets `git clone && cd ...`, a syntax error.
 *
 * Nothing errored when it happened. A `sed` rewriting the repo owner across the
 * docs matched a longer region than intended and took the surrounding text with
 * it. No test noticed, because no test was looking. The submission is judged
 * partly on whether a judge can reach and run the project, so a vanished link
 * is a scoring defect that produces no failure signal anywhere.
 *
 * ANCHORED ON SHAPE, NOT ON THE URL APPEARING SOMEWHERE. A first attempt that
 * merely grepped for the URL passed with the header link deleted, because the
 * same URL also lives in the clone command. Each check below pins the full
 * construct it cares about, so losing either line fails on its own.
 *
 * OFFLINE BY DESIGN. This asserts presence and shape, never reachability: CI
 * must not go red because GitHub is slow. Reachability is checked separately by
 * tools/check_links.py, which resolves every URL and asserts it is not merely
 * alive via a redirect.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const README = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

/** The canonical owner. The repo was renamed; the old owner only 301s. */
const SLUG = "pranjalcodesinw3/casper-invoice-factoring-agent";

const REQUIRED: Array<{ what: string; pattern: RegExp; why: string }> = [
  {
    what: "the **Repository:** header link",
    pattern: new RegExp(
      String.raw`\*\*Repository:\*\*\s*\[[^\]]+\]\(https://github\.com/${SLUG}\)`
    ),
    why: "a judge reading the README has no other way to find the source",
  },
  {
    what: "the clone command in the quickstart",
    pattern: new RegExp(String.raw`git clone https://github\.com/${SLUG}\b`),
    why: "without the URL the quickstart is `git clone && cd ...`, which is a syntax error",
  },
  {
    what: "the live demo link",
    pattern: /https:\/\/casper-invoice-factoring\.vercel\.app/,
    why: "the deployed UI is the only thing a judge can look at without a toolchain",
  },
  {
    what: "the deployed contract package on the explorer",
    pattern:
      /https:\/\/testnet\.cspr\.live\/contract-package\/1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec/,
    why: "the on-chain proof is the claim; without the link it is an assertion",
  },
];

for (const { what, pattern, why } of REQUIRED) {
  test(`README still contains ${what}`, () => {
    assert.ok(
      pattern.test(README),
      `${what} is missing from README.md.\n` +
        `Why it matters: ${why}.\n` +
        `Expected to match: ${pattern}`
    );
  });
}

test("the README does not cite the stale repository owner", () => {
  // The repo was renamed. The old owner path still resolves, but only through
  // GitHub's 301, which dies the moment anyone claims the old name.
  assert.ok(
    !/github\.com\/kamalbuilds\/casper-invoice-factoring-agent/.test(README),
    "README cites kamalbuilds/..., which only works via a redirect we do not control"
  );
});

test("the quickstart clone command is syntactically runnable", () => {
  // The exact failure that motivated this file: a clone line with no URL.
  const clone = README.match(/git clone[^\n]*/);
  assert.ok(clone, "no clone command found in the README at all");
  assert.match(
    clone[0],
    /git clone\s+https:\/\/\S+/,
    `the clone command has no URL: ${JSON.stringify(clone[0])}`
  );
});
