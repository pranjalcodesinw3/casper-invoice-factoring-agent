# Invoice Factoring Agent Backend

Autonomous underwriting backend for invoice factoring on Casper testnet. Implements HTTP 402 Payment Required handshake for signed risk data, AI-driven underwriting memo generation, and deterministic contract arguments.

## Architecture

```
CLI / Server
    |
    v
  Agent (orchestrator)
    |
    +-- Risk Client (402 handshake + HMAC verify)
    |       |
    |       v
    |   Risk Provider (HTTP 402 endpoint + HMAC sign)
    |
    +-- Underwriting (AI memo + tiered decisions)
    |       |
    |       v
    |   OpenRouter AI (Claude)
    |
    +-- Contract Args (for Casper open_note)
```

## Components

### 1. Risk Provider (port 4031)

Real HTTP 402 Payment Required endpoint that:
- Returns 402 + payment info on first request
- Returns HMAC-signed risk report on second request with X-Payment header
- Pulls debtor data from `debtors.json` (demo attestation data)

**Endpoint:** `POST /risk-report`

Request:
```json
{
  "debtor_id": "acme_corp"
}
```

Response (402):
```
HTTP 402 Payment Required
X-Payment-Required: {"price": 1000, "currency": "mote", "ref": "uuid"}

{
  "error": "Payment required",
  "payment": {"price": 1000, "currency": "mote", "ref": "..."}
}
```

Response (200, with X-Payment header):
```json
{
  "data": {
    "debtor": "Acme Corp Manufacturing",
    "riskScore": 82,
    "factors": [...]
  },
  "signature": "sha256_hmac_hex",
  "timestamp": 1234567890
}
```

### 2. Risk Client

Handles the 402 handshake:
1. Makes initial request without payment
2. Receives 402, extracts payment info
3. Retries with X-Payment header
4. Verifies HMAC signature using RISK_PROVIDER_SECRET
5. Rejects if signature invalid

Returns: `VerifiedRiskReport` with `signatureValid: true`

### 3. Underwriting Engine

Processes invoice + risk report:
- Risk score validation against minimum threshold
- Days overdue assessment
- Tiered advance rate assignment (50% to 85%)
- Generates plain-language AI memo via OpenRouter
- Returns deterministic decision with reasoning

**Output:** `UnderwritingDecision`

```typescript
{
  approved: boolean,
  recommendedAdvanceRate: number,  // 0.0 to 1.0
  fundingAmount: number,
  reasons: string[],
  memo: string  // AI-generated plain language
}
```

### 4. Agent Orchestrator

Coordinates the full flow:
1. Calls risk client (triggers 402 handshake)
2. Calls underwriting engine
3. Generates contract note args (if approved)

Returns: `UnderwritingResult` with risk report, decision, and note args

**Note args for Casper `open_note` entrypoint:**
```typescript
{
  note_id: string,
  seller: string,
  face_value: number,
  risk_score: number,
  risk_data_hash: string  // sha256 of risk report
}
```

## Setup

### 1. Install Dependencies

```bash
cd agent
export PATH="/Users/kamal/.nvm/versions/node/v24.9.0/bin:$PATH"
npm install
```

### 2. Environment Variables

Create `.env` from `.env.example`:

```bash
OPENROUTER_API_KEY=sk_live_...
RISK_PROVIDER_SECRET=dev-secret-key-change-in-production
CONTRACT_HASH=hash-09...
CASPER_NODE_ADDRESS=https://node.testnet.cspr.cloud/rpc
RISK_PROVIDER_PORT=4031
SERVER_PORT=4030
```

### 3. TypeScript Check

```bash
npm run typecheck
```

Output should be: `Found 0 errors in 2 seconds`

## Running End-to-End

### Terminal 1: Start Risk Provider

```bash
npm run provider
```

Output:
```
Risk provider running on port 4031 with secret: dev-secre...
```

### Terminal 2: Run CLI Tests

Test with a good debtor (risk score 82, should approve):
```bash
npm run cli:good
```

Expected output flow:
1. `[RiskClient] Requesting risk report for acme_corp...`
2. `[RiskClient] Received 402 Payment Required`
3. `[RiskClient] Retrying with X-Payment header...`
4. `[RiskClient] Signature verified successfully`
5. `[Agent] Risk report received: score=82, signature=True`
6. `[Agent] Underwriting complete: approved=true`
7. Shows decision with 85% advance rate
8. Shows contract note args

Test with a risky debtor (risk score 35, should reject):
```bash
npm run cli:risky
```

Expected output flow:
1. Same 402 handshake and verification
2. `[Agent] Underwriting complete: approved=false`
3. Shows rejection reason (risk score below minimum)

### Terminal 3: Start Agent Server

```bash
npm run dev
```

Test via curl:
```bash
curl -X POST http://localhost:4030/api/underwrite \
  -H "Content-Type: application/json" \
  -d '{
    "invoice": {
      "invoice_id": "INV-2024-001",
      "debtor_name": "Acme Corp Manufacturing",
      "face_value": 150000,
      "days_overdue": 15
    },
    "debtor_id": "acme_corp"
  }'
```

## Key Design Decisions

### HTTP 402 Payment Required

Real spec compliance: first request without payment returns 402, second request with X-Payment header returns the data. This models a real x402-style paid data API and demonstrates:
- Non-trivial contract interaction (not just "call endpoint")
- State-aware client logic (retry on 402)
- Signature verification (not trusting the endpoint blindly)

### HMAC Signature Verification

Risk report signed with RISK_PROVIDER_SECRET using SHA256. Client verifies before accepting data. Protects against:
- Man-in-the-middle tampering
- Rogue risk provider
- Data integrity validation

### Demo Attestation Data

`debtors.json` is labeled demo data with realistic credit factors:
- Good debtor: Acme Corp (score 82, prime rating, strong payment history)
- Risky debtor: StartupTech (score 35, unclassified, late payments)

Not production credit data. Serves as realistic test scenario.

### AI Underwriting Memo

Uses OpenRouter Claude 3.5 Sonnet to generate 2-3 sentence plain-language explanation of the decision. Shows agent reasoning and justification, not just numbers.

## Files

- `src/ai.ts` - OpenRouter client + memo generation
- `src/risk-provider.ts` - HTTP 402 endpoint (port 4031)
- `src/risk-client.ts` - 402 handshake + HMAC verification
- `src/underwriting.ts` - Underwriting logic + tiered rates
- `src/agent.ts` - Orchestrator
- `src/server.ts` - Express API (port 4030)
- `src/cli.ts` - Test CLI (good/risky scenarios)
- `src/debtors.json` - Demo debtor database
- `src/invoices.json` - Test invoices
- `tsconfig.json` - TypeScript config
- `package.json` - Dependencies

## Contract Integration

The agent outputs `noteArgs` ready for Casper contract `open_note` entrypoint:

```rust
pub fn open_note(
  &mut self,
  note_id: String,
  seller: Address,
  face_value: U512,
  risk_score: u32,
  risk_data_hash: String,
) -> Result<(), Error>
```

Flow:
1. Agent returns approved decision with noteArgs
2. Frontend submits noteArgs to contract
3. Contract enforces risk_score >= min_risk_score in init()
4. Contract stores note in registry
5. Contract emits NoteOpened event

## Verification Checklist

- [x] npm install clean
- [x] tsc --noEmit returns 0 errors
- [x] Risk provider starts on port 4031
- [x] CLI good scenario: 402 response, HMAC verify passes, approves with 85% rate
- [x] CLI risky scenario: 402 response, HMAC verify passes, rejects on risk score
- [x] Agent server starts on port 4030
- [x] POST /api/underwrite returns full result
- [x] All outputs are real data, no mocks
