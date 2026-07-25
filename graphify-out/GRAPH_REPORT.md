# Graph Report - invoice-factoring-agent  (2026-07-10)

## Corpus Check
- 29 files · ~20,295 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 105 nodes · 137 edges · 7 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]

## God Nodes (most connected - your core abstractions)
1. `setup()` - 14 edges
2. `ReceivableEscrow` - 9 edges
3. `mark_repaid_after_funding_emits_event()` - 6 edges
4. `buildFundNoteDeploy()` - 6 edges
5. `Error` - 5 edges
6. `fund_note_with_correct_amount_pays_seller_and_emits_event()` - 5 edges
7. `open_note_with_acceptable_risk_emits_event()` - 4 edges
8. `fund_note_reverts_when_already_funded()` - 4 edges
9. `normalizeContractHash()` - 4 edges
10. `legacyDeployFromTransaction()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `fundNoteOnChain()` --calls--> `Error`  [INFERRED]
  web/components/FundNotePanel.tsx → contract/src/receivable_escrow.rs
- `markRepaidOnChain()` --calls--> `Error`  [INFERRED]
  web/components/FundNotePanel.tsx → contract/src/receivable_escrow.rs
- `main()` --calls--> `Error`  [INFERRED]
  agent/src/cli.ts → contract/src/receivable_escrow.rs
- `underwrite()` --calls--> `Error`  [INFERRED]
  agent/src/underwriting.ts → contract/src/receivable_escrow.rs
- `fundNoteOnChain()` --calls--> `buildFundNoteDeploy()`  [INFERRED]
  web/components/FundNotePanel.tsx → web/lib/casper.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.2
Nodes (17): fund_note_reverts_for_missing_note(), fund_note_reverts_on_wrong_amount(), fund_note_reverts_when_already_funded(), fund_note_with_correct_amount_pays_seller_and_emits_event(), init_sets_owner_and_min_risk_score(), mark_repaid_after_funding_emits_event(), mark_repaid_reverts_for_missing_note(), mark_repaid_reverts_when_not_funded() (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.2
Nodes (13): buildFundNoteDeploy(), buildOpenNoteDeploy(), csprToMotes(), explorerContractUrl(), hexToBytes(), legacyDeployFromTransaction(), loadProxyCallerWasm(), mapNoteArgsToContract() (+5 more)

### Community 2 - "Community 2"
Cohesion: 0.15
Nodes (9): fundNoteOnChain(), markRepaidOnChain(), buildMarkRepaidDeploy(), runUnderwriting(), generateUnderwritingMemo(), main(), Error, getRiskReport() (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.25
Nodes (4): UnderwritePanel(), WalletButton(), isOwnerPublicKey(), useWallet()

### Community 4 - "Community 4"
Cohesion: 0.43
Nodes (6): buildOpenNoteDeploy(), csprToMotes(), invoiceIdToNoteId(), mapNoteArgsToContract(), normalizeContractHash(), sellerToAddressKey()

### Community 5 - "Community 5"
Cohesion: 0.4
Nodes (1): ReceivableEscrow

### Community 6 - "Community 6"
Cohesion: 0.67
Nodes (2): main(), ReceivableEscrowDeployScript

## Knowledge Gaps
- **4 isolated node(s):** `Note`, `NoteOpened`, `NoteFunded`, `NoteRepaid`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 5`** (6 nodes): `ReceivableEscrow`, `.assert_owner()`, `.get_min_risk_score()`, `.get_owner()`, `.init()`, `.mark_repaid()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 6`** (4 nodes): `main()`, `ReceivableEscrowDeployScript`, `.deploy()`, `cli.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Error` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.281) - this node is a cross-community bridge._
- **Why does `fundNoteOnChain()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `buildFundNoteDeploy()` connect `Community 1` to `Community 2`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Error` (e.g. with `fundNoteOnChain()` and `markRepaidOnChain()`) actually correct?**
  _`Error` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Note`, `NoteOpened`, `NoteFunded` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._