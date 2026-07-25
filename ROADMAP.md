# Invoice Factoring Agent roadmap

Last updated 2026-07-26. Written against the contract deployed at
[`1c7b0dfe…`](https://testnet.cspr.live/contract-package/1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec)
on Casper testnet.

Everything under "Shipped" has a deploy hash or a file path. Everything below it
does not, and is dated and costed so it can be held to.

**Update 2026-07-26:** the gap this file opened with is closed. The contract now
has a full lifecycle on chain, plus five typed refusals each built so exactly one
clause can fail. Note opened
[`e09ad580…`](https://testnet.cspr.live/deploy/e09ad580159e2a6c66bb09e408c2153b1eed3c2cfc023b298fe45ef623022051), funded and
forwarded to the seller
[`2233b2d0…`](https://testnet.cspr.live/deploy/2233b2d0216adaf8eff0b6dc697e076590f68e6762acce21c210e6d94b528b88), and an
under-minimum risk score refused
[`ffd87d19…`](https://testnet.cspr.live/deploy/ffd87d1929d92da2c71e0f891fbd1d092cf13bb3a16221e2a65b02e06883ddd9) with `RiskTooHigh`.
Full record in [PROOF.json](PROOF.json). The Q3 items below are updated to match.

---

## Who this is for

**Primary user: the freelance supplier holding a 90-day unpaid invoice.** Their
painful moment: payroll is due Friday and the invoice clears in November. Bank
factoring exists, but not at their size and not at that speed.

**Secondary user: the investor** who wants short-dated receivable exposure and
currently has no way to price it without underwriting each debtor themselves.

**Not for:** invoices large enough for a real factoring house. They will beat us
on rate. The wedge is the invoice too small for anyone to bother underwriting
manually, where an agent doing the underwriting is the only way the economics
work at all.

---

## Shipped

| Capability | Evidence |
|---|---|
| `ReceivableEscrow` deployed, 7 entrypoints | [`1c7b0dfe…`](https://testnet.cspr.live/contract-package/1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec) package resolves |
| Agent reads the acceptance bar from the contract, not its prompt | `agent/src/underwriting-tools.ts::get_escrow_terms` |
| Tool guards re-check live state before proposing a note | `agent/src/underwriting-tools.ts::propose_open_note` |
| Risk reports bought over x402 and signature-checked | `agent/src/risk-oracle.ts` |
| 12 contract tests, 11 agent tests, CI with a clean-clone job | `.github/workflows/ci.yml` |

---

## Q3 2026 (Aug-Sep): get it on chain, then make the risk real

**DONE 2026-07-26 — the lifecycle and the refusals are both on chain.**
Open, fund and repay all execute, and five refusals (`RiskTooHigh`, `NoteExists`,
`NoNote`, `WrongAmount`, `NotFunded`) each have their own deploy hash. Two
things this cost that are invisible until you hit them: a payable Odra entrypoint
cannot be called directly, because Odra runs a session wasm in the caller's
account context and that is the only place a cargo purse can be funded, so a
direct call sees `attached_value == 0` and reverts as an underpayment; and
`package_hash` must be a raw 32-byte ByteArray, since a Key-wrapped value fails
the argument deserializer before any contract logic runs, which is not
enforcement and must never be counted as a rejection.

**Sep 2026 — replace the fixture debtor set.**
`agent/src/debtors.json` is sample data. Until a risk score comes from something
outside this repo, the underwriting is a demo of a mechanism rather than a
credit decision. The cheapest honest version is one real data source, even a
narrow one, with its provenance recorded in `risk_data_hash`.

---

## Q4 2026 (Oct-Dec): make it a market

**Oct 2026 — the repayment and default path.**
The contract opens and funds notes. What happens when the debtor pays late,
partially, or never is simply not modelled, and that is most of what factoring
actually is. This is the largest single piece of missing contract logic and it
is honestly a quarter of work, not a weekend.

**Nov 2026 — transferable notes.**
A note is currently not transferable, so there is no secondary market and an
investor is locked in until repayment. CEP-18 or CEP-78 representation is the
enabling change.

**Dec 2026 — decide whether the underwriter runs on AgentVault.**
Our flagship generalises scoped, attenuating authority. An underwriting agent
that can commit investor funds is exactly the case for it: the agent should hold
a grant with a per-note ceiling it cannot exceed, rather than an unrestricted
key. Committing to answer that in the open.

---

## What happens to the testnet contracts

They stay up. The package hash in this repo will keep resolving on
`testnet.cspr.live` for as long as the network keeps testnet history. A v2 gets
a new package hash listed here alongside the old one, marked superseded rather
than deleted.

---

## How to reach us

- **Bugs, questions and security reports:** [GitHub Issues](https://github.com/kamalbuilds/casper-invoice-factoring-agent/issues)
- **Live demo:** [casper-invoice-factoring.vercel.app](https://casper-invoice-factoring.vercel.app)

We do not have an X account or a Discord server. Rather than register a handle
with no posts behind it, the repo is the channel, and Issues is answered by the
people whose commits are in `git log`.

---

## Maintenance commitment

Maintained by the authors in `git log`. Through 2026: security reports triaged
within 72 hours, and the contract left deployed and unchanged on testnet.

If this project is abandoned, this file will say so at the top, with a date.
