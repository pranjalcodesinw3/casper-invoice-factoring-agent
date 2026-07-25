# Invoice Factoring Agent — Demo Video Script

**Target length:** 2.5 to 3.5 minutes  
**App URL:** `http://localhost:3040`  
**Agent:** `http://localhost:4030`  
**Risk provider:** `http://localhost:4031`  
**Network:** Casper testnet  
**Wallet:** Contract owner for open / repay (`016f2691…` in local env). Investor wallet can fund.

---

## 1. What this project is about

**Invoice Factoring Agent** turns an unpaid invoice into a funded receivable note with agentic underwriting on Casper. The agent buys a signed risk report (x402), decides approve or decline, and opens an on-chain note when risk clears the bar. An investor funds the exact face value; the owner can later mark repaid.

**One-line pitch (open with this):**

> Advances that clear on verified risk, not gut feel.

---

## 2. Problem

1. SMEs wait on slow, opaque invoice advances.
2. Risk decisions lack signed, auditable inputs.
3. Declines should be as visible as approvals.
4. Funding needs exact escrow, not informal wires.

---

## 3. Solution

1. Agent pays an x402 risk endpoint, underwrites, and opens `open_note` when approved.
2. Investor funds with exact face value via payable `fund_note`.
3. Escrow forwards CSPR to the seller; owner later `mark_repaid`.
4. Lifecycle events: NoteOpened / NoteFunded / NoteRepaid.

---

## 4. Features to call out on camera

1. Scenarios: **Prime debtor (approve)** vs **Sub-threshold debtor (decline)**
2. Min risk score gate
3. Seller public key → on-chain note
4. Exact-amount fund CTA
5. Owner **Mark repaid**
6. Proof / explorer links for the note lifecycle

---

## 5. Pre-roll checklist

- [ ] Web **3040**, agent **4030**, risk provider **4031**
- [ ] Owner wallet connected for open / repay
- [ ] Seller public key ready (can use a known testnet key)
- [ ] Happy path scenario: **Prime debtor (approve)**
- [ ] Optional decline: **Sub-threshold debtor (decline)**
- [ ] Enough CSPR to fund the face value
- [ ] Browser zoom ~110%

---

## 6. Shot list and spoken script

### Shot 0 — Cold open (0:00–0:20)

**On screen:** Brand **Invoice Factoring Agent**, headline **Advances that clear on verified risk, not gut feel.**

| | |
|--|--|
| **Click / Do** | Open `http://localhost:3040`. Pan hero → underwrite / fund panels. |
| **Say** | “This is Invoice Factoring Agent. Agentic underwriting on Casper. Advances that clear on verified risk, not gut feel.” |

---

### Shot 1 — Problem and solution (0:20–0:45)

| | |
|--|--|
| **Click / Do** | Hover scenario selector and fund panel. |
| **Say** | “Invoice advances are usually slow and opaque. We buy a signed risk report, underwrite on-chain rules, open a receivable note when approved, and fund the exact face value into escrow.” |

---

### Shot 2 — Connect wallet (0:45–1:00)

| | |
|--|--|
| **Click / Do** | Click **Connect wallet** → Casper Wallet → Approve. |
| **Say** | “Connect the owner wallet. Opening and marking repaid are owner-gated.” |

---

### Shot 3 — Underwrite approve path (1:00–1:40)

| | |
|--|--|
| **Click / Do** | Select scenario **Prime debtor (approve)**. Click **Fetch signed risk report & underwrite**. Show approved outcome. |
| **Say** | “Prime debtor scenario. Fetch signed risk report and underwrite. The agent pays for risk data and clears the minimum score.” |

---

### Shot 4 — Optional decline beat

| | |
|--|--|
| **Click / Do** | Switch to **Sub-threshold debtor (decline)**. Click **Fetch signed risk report & underwrite**. Show **Declined, note not opened**. Point out Open note stays disabled. |
| **Say** | “Below the risk bar, the note is not opened. Declines are as visible as approvals.” |
| **Then** | Switch back to **Prime debtor (approve)** and underwrite again. |

---

### Shot 5 — Open note (1:40–2:10)

| | |
|--|--|
| **Click / Do** | Fill **Seller public key (Address)**. Click **Open note on-chain**. Approve. Wait for success. |
| **Say** | “Open note on-chain. The receivable is now a Casper note with a face value ready for funding.” |

---

### Shot 6 — Fund note (2:10–2:45)

| | |
|--|--|
| **Click / Do** | In fund panel, select the open note. Click **Fund note (`N` CSPR)** (label includes the exact amount). Approve. |
| **Say** | “An investor funds the exact face value. Fund note. Escrow sends CSPR to the seller. No informal wire.” |

---

### Shot 7 — Optional mark repaid (2:45–3:05)

| | |
|--|--|
| **Click / Do** | Click **Mark repaid**. Approve. |
| **Say** | “When the invoice clears, the owner marks the note repaid and closes the lifecycle.” |

---

### Shot 8 — Proof and close (3:05–3:30)

| | |
|--|--|
| **Click / Do** | Scroll to proof / explorer links for NoteOpened / NoteFunded / NoteRepaid. |
| **Say** | “Every step leaves an on-chain trail. Advances on verified risk. Thanks for watching.” |

---

## 7. Condensed voiceover

> Invoice Factoring Agent on Casper.  
> Buy signed risk, underwrite, open a note when approved.  
> Fund the exact face value. Mark repaid when done.  
> Advances that clear on verified risk, not gut feel.

---

## 8. Button cheat sheet

| Order | Exact label | What happens |
|------:|-------------|--------------|
| 1 | **Connect wallet** | Owner / investor session |
| 2 | Scenario **Prime debtor (approve)** | Happy-path invoice |
| 3 | **Fetch signed risk report & underwrite** | x402 risk + decision |
| 4 | **Open note on-chain** | `open_note` |
| 5 | **Fund note (`N` CSPR)** | Payable `fund_note` |
| 6 | **Mark repaid** | Owner closes lifecycle |
| — | Scenario **Sub-threshold debtor (decline)** | Shows **Declined, note not opened** |

---

## 9. Failure recovery

| Symptom | On camera |
|---------|-----------|
| Declined unexpectedly | Switch to Prime debtor |
| Wrong face value on fund | Select the matching open note |
| Risk provider down | Restart 4031, underwrite again |
| Not owner | Reconnect owner for open / repay |

---

## 10. Suggested title and description

**Title:** Invoice Factoring Agent — Advances on verified risk on Casper

**Description:**

```
Demo of Invoice Factoring Agent on Casper testnet.

An agent fetches a signed risk report, underwrites an invoice, opens a
receivable note when approved, and funds the exact face value on-chain.

Repo: https://github.com/pranjalcodesinw3/casper-invoice-factoring-agent
```
