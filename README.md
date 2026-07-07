# Invoice Factoring Agent

**Turn an unpaid invoice into a funded receivable note with agentic underwriting.**

Invoice Factoring Agent is an on-chain receivable escrow system on the Casper blockchain. An AI agent reviews invoice data, purchases signed risk scores via an x402-style endpoint, and opens a receivable note on-chain. Investors fund notes by attaching native CSPR, which the escrow forwards directly to the seller. Built with the Odra 2.8.2 framework for Casper 2.0.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Smart Contracts](#smart-contracts)
- [Contract Addresses](#contract-addresses)
- [Getting Started](#getting-started)
- [Frontend](#frontend)
- [Security](#security)
- [License](#license)
- [Links](#links)

---

## Overview

Invoice Factoring Agent bridges off-chain invoice data with on-chain receivable finance. Small suppliers upload invoice details; the AI underwriting agent purchases a signed risk score from a paid data provider, then calls `open_note` on the ReceivableEscrow contract. Investors browse open notes and fund them by attaching the exact face value in CSPR. The escrow forwards funds to the seller and records the investor. The owner later marks notes repaid once the debtor settles off-chain. All lifecycle transitions emit auditable events readable via CSPR.cloud.

### Key Metrics (Testnet)

| Metric | Value |
|--------|-------|
| **Network** | Casper Testnet |
| **Framework** | Odra 2.8.2 |
| **Agent Port** | 4030 |
| **Risk Provider Port** | 4031 |
| **Web Port** | 3000 |

---

## Features

- **Agentic Underwriting**: AI agent reviews invoices and purchases risk data
- **On-Chain Receivable Notes**: Face value, risk score, and seller recorded on-chain
- **Escrow Funding**: Investors attach exact face value; escrow forwards to seller
- **Risk Score Gate**: Notes below `min_risk_score` are rejected at `open_note`
- **x402 Risk API**: Paid risk provider with HMAC-signed responses
- **Lifecycle Tracking**: Open, Funded, and Repaid states with event receipts
- **CSPR.click Integration**: Wallet-connected funding flow in the web UI

---

## Architecture

```
                    +------------------+
                    |  Seller Wallet   |
                    |   (CSPR.click)   |
                    +--------+---------+
                             |
                             v
+----------------------------------------------------------+
|              Web UI (Next.js)                             |
|  - Upload invoice details                                 |
|  - Connect wallet via CSPR.click                          |
|  - Fund open notes / view event timeline                  |
+---------------------------+------------------------------+
                            |
                            v
+----------------------------------------------------------+
|              Agent Server (port 4030)                     |
|  - POST /api/underwrite: AI review + risk purchase        |
|  - POST /api/run-agent-action: Full underwriting flow     |
|  - Build open_note deploy via casper-js-sdk               |
+---------------------------+------------------------------+
                            |
              x402 payment  |              open_note()
                            v                            v
+----------------------------+    +---------------------------+
|  Risk Provider (port 4031) |    | ReceivableEscrow (Odra)   |
|  - Signed risk scores      |    |  - open_note()            |
|  - HMAC attestation        |    |  - fund_note() payable    |
+----------------------------+    |  - mark_repaid()          |
                                  +---------------------------+
                                              ^
                                              | fund_note() payable
                                              |
                                  +---------------------------+
                                  |   Investor Wallet         |
                                  |   (CSPR.click)            |
                                  +---------------------------+
```

### Funding Flow

```
+----------+  underwrite   +-------------+  open_note   +------------------+
| Supplier | ------------> | Agent (4030)| -----------> | ReceivableEscrow |
|          |               |             |              |                  |
|          |               |             |              |                  |
|          |               +-------------+              |                  |
|          |                      ^                       |                  |
|          |                      | risk score           |                  |
|          |               +-------------+               |                  |
|          |               | Risk Prov.  |               |                  |
|          |               |   (4031)    |               |                  |
|          |               +-------------+               |                  |
|          |                                             |                  |
| Investor | ---------------- fund_note() -------------->|                  |
|          | <----------- CSPR to seller ----------------|                  |
+----------+                                             +------------------+
```

---

## Smart Contracts

### ReceivableEscrow

The core escrow contract managing receivable note lifecycle from opening through repayment.

**Entry Points:**

| Function | Description | Parameters |
|----------|-------------|------------|
| `init` | Initialize escrow with owner and minimum risk score | `min_risk_score: u64` |
| `open_note` | Open a new receivable note | `note_id: u64, seller: Address, face_value: U512, risk_score: u64, risk_data_hash: String` |
| `fund_note` | Fund an open note and forward CSPR to seller | `note_id: u64` (payable) |
| `mark_repaid` | Mark a funded note as repaid | `note_id: u64` |

**Events:**

| Event | Description |
|-------|-------------|
| `NoteOpened` | Owner opened a new receivable note |
| `NoteFunded` | Investor funded a note; escrow forwarded value to seller |
| `NoteRepaid` | Owner marked a funded note as repaid |

---

## Contract Addresses

### Casper Testnet

| Contract | Package Hash | Explorer |
|----------|--------------|----------|
| **ReceivableEscrow** | `hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec` | [View on cspr.live](https://testnet.cspr.live/package/hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec) |

### Network Configuration

| Setting | Value |
|---------|-------|
| **Chain Name** | `casper-test` |
| **Node URL** | `https://node.testnet.casper.network` |
| **CSPR.cloud RPC** | `https://node.testnet.cspr.cloud/rpc` |
| **Explorer** | `https://testnet.cspr.live` |

---

## Getting Started

### Prerequisites

- Rust 1.70+
- Cargo
- Odra CLI 2.8.2
- Node.js 18+
- Casper testnet account funded via the [testnet faucet](https://testnet.cspr.live/tools/faucet)

### Build Contracts

```bash
cd contract
cargo odra test
cargo odra build
```

Wasm output lands at `contract/wasm/ReceivableEscrow.wasm`.

### Deploy Contracts

```bash
casper-client put-transaction session \
  --node-address https://node.testnet.cspr.cloud/rpc \
  --chain-name casper-test \
  --secret-key /path/to/secret_key.pem \
  --wasm-path ./wasm/ReceivableEscrow.wasm \
  --install-upgrade \
  --pricing-mode fixed \
  --gas-price-tolerance 1 \
  --payment-amount 300000000000
```

Record the contract hash from the deploy result and set it in environment files below.

### Run Agent and Risk Provider

```bash
cd agent
npm install
cp .env.example .env
npm run dev
```

This starts:

- **Agent server** at `http://localhost:4030` (`POST /api/underwrite`, `POST /api/run-agent-action`)
- **Risk provider** at `http://localhost:4031` (signed risk scores)

### Run Web UI

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

Web UI available at `http://localhost:3000`.

---

## Frontend

The web app is a Next.js application with CSPR.click wallet integration.

### Pages

- **Home**: Upload invoice, trigger AI underwriting, view open notes
- **Fund Note**: Connect wallet and fund a receivable note
- **Proof Timeline**: Display `NoteOpened`, `NoteFunded`, and `NoteRepaid` events from CSPR.cloud

### Wallet Integration

Uses [CSPR.click](https://cspr.click) for wallet connection supporting:

- Casper Wallet
- Ledger
- Torus Wallet
- CasperDash
- MetaMask Snap

### Environment Variables

**Agent (`agent/.env`):**

```env
OPENROUTER_API_KEY=sk_live_...
RISK_PROVIDER_SECRET=dev-secret-key-change-in-production
CONTRACT_HASH=hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec
CASPER_NODE_ADDRESS=https://node.testnet.cspr.cloud/rpc
RISK_PROVIDER_PORT=4031
SERVER_PORT=4030
```

**Web (`web/.env.local`):**

```env
NEXT_PUBLIC_CSPR_CLICK_APP_ID=your_cspr_click_app_id
NEXT_PUBLIC_CONTRACT_HASH=hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec
NEXT_PUBLIC_AGENT_URL=http://localhost:4030
```

---

## Security

### Access Control

- Owner-only functions: `open_note`, `mark_repaid`
- `fund_note` callable by any investor with exact face value attached
- `init` sets deployer as owner and configures `min_risk_score`

### Escrow Safety

- Funding requires exact face value match (`WrongAmount` guard)
- Notes can only be funded once (`AlreadyFunded` guard)
- Repayment only allowed on funded notes (`NotFunded` guard)
- Risk scores below minimum rejected at `open_note`

### Off-Chain Data Trust

- Invoice and risk data are demo attestations, not real credit decisions
- Risk provider responses are HMAC-signed
- `risk_data_hash` stored on-chain for audit trail
- Production requires verified invoice sources and multi-party attestation

### Audits

- [ ] Pending security audit

---

## License

MIT License. See [LICENSE](./LICENSE) for details.

---

## Links

- **GitHub**: [pranjalcodesinw3/casper-invoice-factoring-agent](https://github.com/pranjalcodesinw3/casper-invoice-factoring-agent)
- **Testnet Explorer**: [cspr.live](https://testnet.cspr.live)
- **Package**: [ReceivableEscrow on testnet](https://testnet.cspr.live/package/hash-1c7b0dfe3d37d1c7acaed683b5e0f6183fe144c5daa39a361b6d3b50d850efec)
- **Casper Documentation**: [docs.casper.network](https://docs.casper.network)
- **Odra Framework**: [odra.dev](https://odra.dev)
- **CSPR.click**: [cspr.click](https://cspr.click)
- **CSPR.cloud**: [cspr.cloud](https://cspr.cloud)
