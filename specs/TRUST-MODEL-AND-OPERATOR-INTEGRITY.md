# Trust Model and Operator Integrity Specification

**Version:** 1.0.0
**Date:** 2026-02-05
**Status:** NORMATIVE
**Companion Documents:** DATA-INTEGRITY-SPEC, ADVERSARIAL-ATTACK-DOMAINS, TWO-TREE-ARCHITECTURE-SPEC, COORDINATION-INTEGRITY-SPEC

---

## Preamble

This specification defines the trust model for the Voter Protocol, with particular attention to the role of the Shadow Atlas operator, the guarantees provided by on-chain contracts, and the progressive path from honest centralization to full trustlessness. It is written as an honest accounting of what the protocol does and does not guarantee at each phase of maturity.

The protocol exists in a landscape where the walkaway test — articulated by Vitalik Buterin in January 2026 — has become the accepted standard for protocol credibility. A protocol passes the walkaway test if it continues to function safely and remain useful even if its original developers permanently stop contributing. As of launch, this protocol does not pass the walkaway test. This document specifies the engineering path to passing it.

Every claim in this document is falsifiable. Where a guarantee depends on cryptography, we state that. Where a guarantee depends on operator honesty, we state that too. The protocol does not pretend to be trustless where it is not.

---

## Table of Contents

1. [The Trust Stack](#1-the-trust-stack)
2. [The MACI Parallel](#2-the-maci-parallel)
3. [Operator Surface Area](#3-operator-surface-area)
4. [On-Chain Governance Guarantees](#4-on-chain-governance-guarantees)
5. [Five Trust Gaps](#5-five-trust-gaps)
6. [Mitigation Architecture](#6-mitigation-architecture)
7. [The Walkaway Roadmap](#7-the-walkaway-roadmap)
8. [Landscape Context](#8-landscape-context)
9. [Threat Scenarios](#9-threat-scenarios)
10. [Acceptance Criteria by Phase](#10-acceptance-criteria-by-phase)
11. [Sociopolitical Risk Analysis](#11-sociopolitical-risk-analysis)

---

## 1. The Trust Stack

The protocol has four trust layers. Each layer has a different security model. The system's integrity ceiling is determined by the weakest layer.

### Layer 4: ZK Proof Verification (Trustless)

The UltraHonk proof system running on Scroll provides mathematical guarantees. If a proof verifies against DistrictGate.sol, the prover demonstrably knows a secret that is included in a Merkle tree whose root is registered on-chain, and the district commitment associated with their cell hashes correctly to the public outputs. No trust is required. The soundness guarantee comes from the discrete log assumption on BN254 and the algebraic structure of the PLONKish constraint system. Noir's UltraHonk backend requires no per-circuit trusted setup — it uses a universal SRS (Structured Reference String) from the Aztec ceremony with over 100,000 participants. The 1-of-N security model means that if even one participant was honest, the SRS is secure.

This layer is the foundation. It does not depend on the operator, the governance key, or any off-chain system. It depends on mathematics.

### Layer 3: Root Registries (Observable)

UserRootRegistry and CellMapRegistry are immutable contracts on Scroll. They are append-only: roots cannot be modified after creation. Every lifecycle transition emits an event. Deactivation, expiry, and reactivation all require 7-day timelocks. Anyone can monitor these events in real time.

The guarantee at this layer is not trustlessness — it is transparency with exit rights. If governance initiates a suspicious action (registering a root that doesn't match published data, transferring governance to an unknown address), the community has 7 days to detect it, evaluate it, and decide whether to continue using the protocol. This is the same model used by Optimism at Stage 1 and by Lido's dual governance.

The limitation is that root registration itself — adding a new root — is currently immediate with no timelock. This is identified as a gap and addressed in Section 6.

### Layer 2: Tree Construction (Trusted)

This is the weak link. The Shadow Atlas operator downloads Census TIGER boundary data, processes it through the cell-district mapping pipeline, constructs Poseidon2 Merkle trees, and registers the resulting roots on-chain. Users trust that the on-chain root corresponds to correct district mappings derived from authoritative public data.

The operator could, in principle, build a tree with incorrect district mappings and register that root. The ZK math would still work — proofs would verify against the poisoned root — but users would be proving membership in districts that don't correspond to reality.

This layer is the focus of this specification. The mitigations described in Sections 5 and 6 progressively reduce and eventually eliminate this trust assumption.

### Layer 1: Data Acquisition (Verifiable)

Census TIGER/Line data is published by the United States Census Bureau, a federal statistical agency. The data is public, freely downloadable, and used as ground truth by every level of government. The Census Bureau publishes SHA-256 checksums for its distribution files.

This layer is verifiable by default — anyone can download the same shapefiles from the same URLs. The trust assumption is that the Census Bureau publishes accurate boundary data, which is a reasonable assumption for Phase 1 (the next redistricting cycle is 2031-2032) but requires primary source comparison during redistricting years, as documented in DATA-INTEGRITY-SPEC.

The risk at this layer is not data falsification by the Census Bureau, but data staleness. TIGER is updated annually in July. During redistricting, state commissions publish new boundaries 6-18 months before TIGER reflects them. This is addressed by the freshness verification stack in DATA-INTEGRITY-SPEC, of which only Layer 1 (HTTP HEAD change detection) is currently implemented.

---

## 2. The MACI Parallel

The protocol's trust model is structurally identical to MACI (Minimal Anti-Collusion Infrastructure), the most widely deployed ZK voting system. Understanding this parallel clarifies what the protocol actually guarantees and where its risks lie.

### Structural Correspondence

In MACI, a trusted coordinator holds the decryption key for encrypted votes. The coordinator processes all votes and produces a tally with a ZK proof that the tally is correct. The coordinator can see individual votes (breaking privacy) and can censor votes (omitting them from the tally), but cannot forge votes or change how they were cast.

In this protocol, a trusted operator builds Merkle trees from public Census data. The operator processes all boundary data and produces tree roots that are registered on-chain. The operator can map addresses to incorrect districts (poisoning the tree) and can exclude users from the identity tree (censorship), but cannot forge ZK proofs or create valid proofs for users who are not in the tree.

The correspondence:

MACI's coordinator processes encrypted votes. The operator processes public Census data. Both produce a cryptographic commitment (tally proof / Merkle root) that downstream ZK proofs reference. Both can manipulate their inputs but cannot forge the downstream proofs. Both are trusted to be honest but operate in a regime where their honesty is, in principle, independently verifiable.

### Where the Parallel Breaks Down

MACI's coordinator sees votes in cleartext — a privacy violation. The Shadow Atlas operator does not see user secrets. User secrets are generated client-side and never transmitted. The operator knows which cell a user registered in (because the operator builds the tree), but not the user's secret, salt, or identity.

MACI has no transparency log for the coordinator's inputs — encrypted votes are opaque by design. The Shadow Atlas operator's inputs (Census TIGER data) are entirely public. This means independent verification of the operator's work product is possible in a way that independent verification of MACI's coordinator is not.

This is the key advantage: the operator's claim is falsifiable. If the operator publishes a root, and the build pipeline is deterministic, anyone can download the same TIGER data, run the same pipeline, and check whether they get the same root. The operator is trusted until verified, not trusted instead of verified.

### MACI's Coordinator Decentralization Effort

As of February 2026, PSE (Privacy & Scaling Explorations, the team behind MACI) has not shipped coordinator decentralization. It remains in research phase, with three approaches under investigation: multi-party computation, homomorphic/threshold encryption, and trusted execution environments. The `feat/elgamal` branch on the MACI repository explores ElGamal encryption with rerandomization, but this is not shipped.

MACI v2.5.0 (November 2024) improved the coordinator service (REST API for round finalization and proof generation) but did not change the trust model. The coordinator remains a single trusted party.

This is relevant context: even the most mature ZK voting system in production has not eliminated its trusted operator. The protocol is not behind the state of the art in this regard. It is at the state of the art, and this specification defines the path beyond it.

---

## 3. Operator Surface Area

This section provides an exhaustive inventory of what the Shadow Atlas operator controls, both on-chain (via the governance key) and off-chain (via the data pipeline).

### 3.1 On-Chain Governance Functions

The governance address (initially the founder's EOA, later a multisig) has the following powers across the deployed contract system:

**Immediate (No Timelock):**

| Contract | Function | Risk |
|----------|----------|------|
| DistrictRegistry | registerDistrict, registerDistrictsBatch | Can instantly register districts mapping to wrong countries or depths |
| UserRootRegistry | registerUserRoot | Can instantly register identity trees containing false users |
| CellMapRegistry | registerCellMapRoot | Can instantly register cell-district mappings that misattribute districts |
| DistrictGate | revokeActionDomain | Can instantly block all future proof submissions for an action scope |
| DistrictGate | pause | Can instantly halt all proof verification |
| NullifierRegistry | pause | Can instantly halt nullifier recording |
| CampaignRegistry | pauseCampaign, setCreatorWhitelist, authorizeCaller, revokeCaller | Can instantly manipulate campaign operations |

**Timelocked (7 Days):**

| Contract | Function | Purpose |
|----------|----------|---------|
| TimelockGovernance | initiateGovernanceTransfer | Transfer governance to new address |
| DistrictRegistry | initiateRootDeactivation, initiateRootExpiry, initiateRootReactivation | Root lifecycle management |
| UserRootRegistry | initiateRootDeactivation, initiateRootExpiry, initiateRootReactivation | User root lifecycle |
| CellMapRegistry | initiateRootDeactivation, initiateRootExpiry, deprecateCellMapRoot | Cell map root lifecycle |
| DistrictGate | proposeActionDomain, proposeCampaignRegistry, proposeTwoTreeRegistries | Configuration changes |
| NullifierRegistry | proposeCallerAuthorization, proposeCallerRevocation | Caller management |

**Timelocked (14 Days):**

| Contract | Function | Purpose |
|----------|----------|---------|
| VerifierRegistry | proposeVerifier, proposeVerifierUpgrade | ZK verifier contract changes |

The asymmetry is deliberate. Adding new roots is fast (users should not wait 7 days to register). Removing or invalidating roots is slow (existing users deserve warning). Verifier changes have the longest timelock (14 days) because a malicious verifier that accepts all proofs would undermine the entire proof system.

The critical gap is in the first category: root registration is immediate. This is addressed in Section 6.2.

### 3.2 Off-Chain Pipeline Control

The operator controls the following off-chain systems:

**Data Acquisition.** The operator decides when to download TIGER data, which vintage year to use, and how to handle the transition between TIGER releases. There is no on-chain mechanism that forces a particular data source. The operator could download TIGER 2024 instead of TIGER 2025, or could download data from an unofficial mirror. There is currently no checksum verification against Census-published checksums.

**Cell-District Mapping.** The `cell-district-loader.ts` module maps Census tract GEOIDs (cell IDs) to 24-slot district arrays. The slot assignments follow DISTRICT-TAXONOMY.md (slot 0 = congressional, slot 1 = federal senate, etc.). The operator controls this mapping. An error or manipulation here causes users to prove membership in incorrect districts. The mapping is schema-level (off-chain) — the circuit does not enforce which slot corresponds to which district type.

**Tree Construction.** The `dual-tree-builder.ts` module constructs both Merkle trees. Tree 1 leaves are `Poseidon2_Hash3(userSecret, cellId, registrationSalt)`. Tree 2 leaves are `Poseidon2_Hash2(cellId, districtCommitment)` where `districtCommitment = poseidon2Sponge(districts[0..24])`. The operator controls leaf ordering, tree depth, and whether all cells and users are included.

**Proof Generation API.** The operator runs the HTTP API that serves Merkle proofs to clients. Users cannot generate proofs without their sibling path from leaf to root. If the operator refuses to serve proof data, users cannot participate. There is no alternative data source (IPFS pinning is deferred to Phase 2 under SA-008).

**User Registration.** When a user registers, they transmit their cell ID to the operator (derived from their address via Census geocoding). The operator includes this user's leaf in the next tree build. The operator could omit the user (censorship) or include the user in the wrong cell (misattribution).

### 3.3 What the Operator Cannot Do

Even a fully compromised operator cannot:

**Forge ZK proofs.** The soundness of UltraHonk guarantees that only a prover who knows the correct witness (user secret, cell ID, salt, and a valid Merkle path) can produce a verifying proof. The operator does not know user secrets.

**Modify on-chain state outside contract rules.** The contracts are immutable (no proxy patterns, no UUPS, no diamond). The operator cannot change contract logic, only call functions that the contracts expose.

**Reverse-engineer user secrets from proofs.** Zero-knowledge guarantees that proofs reveal nothing about the witness beyond what the public inputs disclose. The public inputs are: user root, cell map root, 24 district IDs, nullifier, action domain, and authority level. The user secret, cell ID, and salt are never exposed.

**Create valid proofs accepted by a different root.** Each proof is bound to a specific user root and cell map root. The verifier contract checks that both roots are registered and active before accepting the proof.

---

## 4. On-Chain Governance Guarantees

### 4.1 TimelockGovernance: Honest Design

The TimelockGovernance contract's NatSpec documentation makes explicit claims about what it does and does not provide. These claims are accurate and should be understood by anyone evaluating the protocol.

**What TimelockGovernance provides:**
- Time for community to detect malicious governance actions
- Opportunity to exit the protocol before malicious changes execute
- Transparent on-chain record of all pending operations

**What TimelockGovernance does not provide:**
- Nation-state resistance (requires multi-jurisdiction guardians)
- Protection against founder key compromise (single point of failure)
- Censorship resistance (founder can pause)

The 7-day governance transfer timelock gives the community a window, not a guarantee. If the founder's key is compromised and a governance transfer is initiated, the community has 7 days to notice, evaluate, and decide whether to stop using the protocol. This is an alarm system. It is not a fortress.

### 4.2 Root Lifecycle Management

Both UserRootRegistry and CellMapRegistry implement a four-state lifecycle for Merkle roots:

**PROPOSED** (registration) — Governance registers the root. Currently immediate.

**ACTIVE** — Root is valid for proving. `isValidUserRoot()` and `isValidCellMapRoot()` return true.

**DEPRECATED/SUNSET** — Root has an expiry timestamp set. Still valid for proving until the timestamp passes. CellMapRegistry uses a 90-day grace period; UserRootRegistry uses 30 days. The longer grace for cell maps reflects the fact that redistricting transitions affect all users simultaneously and require more migration time.

**EXPIRED** — Root is no longer accepted. `block.timestamp > expiresAt`.

All transitions from ACTIVE to DEPRECATED/EXPIRED require a 7-day timelock. The total time from governance initiating deprecation to root expiry is: 7 days (timelock) + 30 or 90 days (grace) = 37 or 97 days.

This is the core user protection: existing proofs remain valid for months after a root is deprecated. Users are never suddenly unable to prove. The contract architecture enforces this — it is not a policy, it is code.

### 4.3 Grace Period Rationale

UserRootRegistry: 30-day grace. User identity changes are individual events (a user moves, re-registers). The affected user is the one who needs to act, and 30 days provides adequate notice.

CellMapRegistry: 90-day grace. District mapping changes are systemic events (redistricting, annual TIGER updates). All users in affected districts need to update cached data. Client auto-update mechanisms need time to propagate. 90 days ensures no user is suddenly disenfranchised by a tree update they weren't aware of.

### 4.4 Verifier Registry: The Strongest Timelock

VerifierRegistry requires 14-day timelocks for both initial verifier registration and verifier upgrades. This is the longest timelock in the system, reflecting the severity of the threat: a malicious verifier that returns `true` for all proofs would allow anyone to forge district membership.

During the 14-day window, the community can:
- Download the proposed verifier's bytecode from Scroll
- Independently compile the Noir circuit with the same nargo version and flags
- Compare the compiled Solidity verifier bytecode against the on-chain proposal
- If they don't match, alert the community and pressure governance to cancel

This verification process requires a documented, reproducible compilation procedure — identified as a gap in Section 5.1.

### 4.5 Pause as Defense

DistrictGate, NullifierRegistry, and CampaignRegistry all implement OpenZeppelin's Pausable pattern. Pause is immediate (no timelock) because it is defensive — it blocks operations, preventing further damage during an active attack.

The risk of immediate pause is governance abuse: the operator could pause the protocol to prevent legitimate participation during a time-sensitive action (e.g., pausing during a congressional vote). This is a known tradeoff. Immediate pause prevents active exploits from draining or corrupting the protocol state. The unpause is also immediate, limiting the duration of abusive pauses.

### 4.6 Event Transparency

Every critical governance action emits an indexed event. The complete list spans seven contracts and over 40 distinct event types. Community members can set up indexers (The Graph, Dune Analytics, custom scripts) to monitor these events in real time.

The events are the protocol's public accountability layer. They are not optional — they are hardcoded into the contract logic. A governance action that doesn't emit an event cannot happen.

---

## 5. Five Trust Gaps

### 5.1 Gap: Trusted Tree Construction

**Severity:** Critical
**Layer:** 2 (Off-Chain)

The operator builds Merkle trees from Census TIGER data and registers roots on-chain. There is no mechanism for users or third parties to independently verify that a registered root corresponds to correct district mappings without reproducing the entire build pipeline.

**What a malicious operator could do:**
- Map an address to the wrong congressional district (voter suppression or amplification)
- Include phantom cells with fabricated district assignments
- Omit legitimate cells, preventing residents of certain areas from proving
- Use stale TIGER data without disclosure

**What makes this gap partially mitigatable today:**
- The input data (Census TIGER) is public and checksummed
- The build pipeline (dual-tree-builder.ts, cell-district-loader.ts) is open source
- Poseidon2 hashing is deterministic — same inputs must produce same outputs
- The slot-to-district-type mapping is documented in DISTRICT-TAXONOMY.md

**What is missing:**
- No pinned checksums for TIGER source files in the repository
- No Docker container or Nix flake for reproducible builds
- No documentation of exact tool versions, flags, and procedures for independent verification
- No publication of intermediate build artifacts (cell-district mapping tables)
- No on-chain mechanism that requires proof of correct construction

### 5.2 Gap: Immediate Root Registration

**Severity:** Critical
**Layer:** 3 (On-Chain)

`registerCellMapRoot()`, `registerUserRoot()`, and `registerDistrict()` are all callable by governance with immediate effect. Unlike root deactivation (7-day timelock) and verifier registration (14-day timelock), root registration has no mandatory delay.

**Why this matters:**
A compromised governance key can instantly register a poisoned root. Users who generate proofs against this root would be proving membership in falsified districts. There is no window for the community to detect and respond before the root becomes active.

**Why it was designed this way:**
Registration was made immediate so that new users don't have to wait 7 days after a batch tree rebuild to start using the protocol. The intent was operational convenience for honest operators.

**Why the design should change:**
The convenience argument doesn't outweigh the security risk. Batch tree rebuilds are infrequent (weekly or monthly). A 7-day delay on root registration means the operator plans one week ahead — an acceptable operational constraint. The 7-day window allows independent verifiers to check the proposed root against a reproducible build before it becomes active.

### 5.3 Gap: No Data Availability Layer

**Severity:** High
**Layer:** 2 (Off-Chain)

If the operator disappears, users lose the ability to generate new proofs. Tree data (leaf values, sibling paths) exists only in the operator's local database. There is no IPFS pinning, no Arweave archival, no Filecoin deal. SA-008 (IPFS/Storacha integration) is deferred to Phase 2.

**The impact of operator disappearance:**

Tree 1 (User Identity): Unrecoverable. User secrets are private. Only the operator's database contains the full tree structure. If the database is lost, existing users cannot generate new proofs, even though their roots remain active on-chain for the duration of the grace period.

Tree 2 (Cell-District Mapping): Theoretically rebuildable from TIGER data, but requires matching the operator's exact preprocessing (tool versions, sort order, slot mapping). In practice, without a documented reproducible build, an independent party would struggle to produce the exact same root.

**Partial mitigation that exists today:**
Users who have previously generated proofs may have cached proof data in IndexedDB (the communique client uses AES-256-GCM encrypted local storage). But the client does not currently cache the full Merkle proof (sibling path from leaf to root) — it only caches the final ZK proof bytes. The sibling path is needed to generate new proofs for different action domains.

### 5.4 Gap: Governance Single Point of Failure

**Severity:** High
**Layer:** 3 (On-Chain)

The governance address is a single EOA controlled by the founder. Key compromise means full protocol control: registering malicious roots, revoking action domains, pausing contracts, swapping verifiers (after 14-day wait), and transferring governance to an attacker's address.

The TimelockGovernance contract is honest about this: "Single point of failure: Founder compromise = governance compromise."

**What the contracts provide:**
- 7-day timelocks on most destructive operations (governance transfer, root deactivation)
- 14-day timelocks on the most critical operation (verifier changes)
- Event emissions for every governance action (detection window)
- No `selfdestruct`, no proxy patterns, no upgrade paths (damage is bounded)

**What the contracts do not provide:**
- Multi-party authorization (no multisig requirement)
- Veto mechanism (no guardian can block malicious governance)
- Rage-quit mechanism (no way for users to signal collective distrust and freeze governance)

### 5.5 Gap: Frontend Trusts Operator Completely

**Severity:** Medium
**Layer:** Application

The communique frontend fetches tree roots and Merkle proofs from the shadow-atlas HTTP API without independent verification. The client does not check that the returned root matches an active root on-chain. It does not verify that the Merkle proof is valid for the claimed leaf and root. It does not fetch tree data from an alternative source.

A compromised operator could serve the client a stale root (one that is no longer active on-chain), causing the client to generate a proof that will be rejected by DistrictGate. Alternatively, the operator could serve a proof for the wrong leaf index, causing the client to generate a proof that verifies but proves membership in the wrong district.

The fix for this gap is straightforward and low-cost. The client should read the on-chain root registries directly (via Scroll RPC) and compare the returned root against active on-chain roots before generating a proof. This is approximately 10 lines of additional code.

### 5.6 Gap: Coordination Integrity (Astroturfing)

**Severity:** High
**Layer:** Application + On-Chain
**Companion Document:** COORDINATION-INTEGRITY-SPEC.md

The protocol verifies that each message comes from one real person in a district. It does not verify that coordinated messaging campaigns — where hundreds or thousands of verified users send identical or near-identical messages within a narrow time window — represent genuine constituent sentiment rather than orchestrated astroturfing.

**What the protocol currently guarantees:**
- One proof per user per action domain (nullifier uniqueness)
- Geographic diversity tracking via `CampaignRegistry.districtCount`
- Participant counting via `CampaignRegistry.participantCount`

**What the protocol does not guarantee:**
- That template diversity is genuine (a campaign with one template and 10,000 participants is functionally identical to a form letter mill)
- That temporal distribution is organic (all 10,000 messages arriving in the same hour is a coordination signal)
- That proof and message content are cryptographically bound (a valid proof can be paired with any message; the binding is through `action_domain`, not through content)
- That personalized content (the `[Personal Connection]` field users fill in) is moderated before delivery
- That all delivery paths enforce proof requirements (the `mailto:` fallback bypasses blockchain submission entirely)

**Why content hashing on-chain is the wrong solution:**

The intuitive fix — commit a hash of message content on-chain alongside the proof — creates three problems:
1. **Template fingerprinting attack.** Templates are public. An observer who precomputes `keccak256(template_text)` for every public template can correlate on-chain `contentHash` values with specific political positions, deanonymizing users who the ZK system was designed to protect.
2. **Three-form problem.** Messages exist in three forms: raw template (shared), resolved template (with PII addresses), and personalized template (with user-written additions). No form is a good hash target — the raw template deanonymizes, the resolved template contains PII, and the personalized template is unique but unverifiable.
3. **AI-generated duplication.** Identical content hashes from different users may indicate coordination — or may indicate independent users who happened to ask the same LLM to write their message. Content uniqueness is not a reliable coordination signal in a post-LLM landscape.

**What works instead: structural signals.**

Coordination is better detected through structural patterns that don't require content inspection:
- **Geographic diversity:** `districtCount / participantCount` ratio — organic campaigns have higher ratios
- **Template diversity:** `templateCount` per campaign — monoculture campaigns are a red flag
- **Temporal distribution:** Shannon entropy of submission timestamps — bot-like bursts have low entropy
- **Authority level distribution:** Campaigns where all participants are authority level 1 (self-attested) have weaker constituent signal

These signals are already partially tracked by `CampaignRegistry` (districtCount, participantCount). The missing pieces are template diversity tracking and temporal entropy computation, which require off-chain infrastructure documented in COORDINATION-INTEGRITY-SPEC.md.

---

## 6. Mitigation Architecture

### 6.1 Deterministic Reproducible Build

**Target:** v1.0 launch
**Addresses:** Gap 5.1 (Trusted Tree Construction)
**Cost:** $0 infrastructure, engineering effort only

The tree construction pipeline must be fully deterministic: identical inputs must produce identical outputs on any machine. This makes the operator's claim falsifiable.

**Requirements for determinism:**

The TIGER source file checksums must be pinned. Census publishes SHA-256 checksums alongside each TIGER distribution. The repository must contain a manifest listing the expected checksum for every TIGER file used in the build. The build script must verify checksums before processing.

Tool versions must be pinned exactly. The conversion from shapefile to GeoJSON (ogr2ogr) and the subsequent processing steps must use specific, documented versions. A Docker container (or Nix flake) must encapsulate the entire build environment with exact dependency versions.

Leaf ordering must be deterministic. The dual-tree-builder must sort leaves by a canonical key (cell ID, lexicographic) before constructing the tree. Any nondeterminism in leaf ordering produces different roots from the same input data.

The build must be documented as a procedure, not just as code. A document titled BUILD-VERIFICATION-PROCEDURE must specify: which TIGER files to download, from which URLs, with which expected checksums; which Docker image to use; which command to run; and what the expected output root is. Anyone following this procedure must get the same root, or the build is not reproducible.

The build manifest must be published alongside the root. When a new root is registered on-chain, the operator must publish (at minimum on a public git repository and ideally on Arweave) a manifest containing: TIGER file checksums used, tool versions, build timestamp, intermediate cell-district mapping digest, and final root hash.

### 6.2 Timelocked Root Registration

**Target:** v1.0 launch (contract modification)
**Addresses:** Gap 5.2 (Immediate Root Registration)
**Cost:** Contract redeployment

Root registration must follow the propose/execute pattern already used by VerifierRegistry, adapted to the root registries.

**Proposed flow:**

`proposeUserRoot(root, country, depth)` — Governance submits a proposed root. A `UserRootProposed` event is emitted. A 7-day timelock begins. The root is not yet active.

During the 7-day window: Independent verifiers download the published build manifest, run the reproducible build, and compare their computed root against the proposed root. If the roots match, the proposal is legitimate. If they don't, the community alerts and governance cancels via `cancelUserRoot(root)`.

`executeUserRoot(root)` — Anyone can call after the timelock expires. The root becomes active.

The same pattern applies to `CellMapRegistry.registerCellMapRoot` and `DistrictRegistry.registerDistrict`.

**Operational impact:** The operator plans tree rebuilds one week in advance. Batch user registrations are accumulated and included in the next tree build. New users wait up to 7 days for their first proof — the same order of magnitude as identity verification processing time, and acceptable for a civic participation tool.

### 6.3 Data Availability Layer

**Target:** v1.5 (3-6 months post-launch)
**Addresses:** Gap 5.3 (No Data Availability)
**Cost:** Approximately $324/year

**Arweave for permanent archival.** Each tree build's complete output (the full Tree 2 cell-district mapping, all leaf values, and the tree structure) is published to Arweave. Arweave charges a one-time fee for permanent storage (approximately $7 per GB as of February 2026). Monthly tree updates at 1GB per version cost approximately $84 per year.

**IPFS for fast access.** The same data is pinned on IPFS via a service like Pinata (approximately $240/year for 100GB). IPFS provides faster retrieval than Arweave and content-addressed integrity (the CID is a hash of the content — if the data matches the CID, it is correct by definition).

**On-chain anchoring.** When a root is registered, the transaction includes (in calldata or as additional storage) the Arweave transaction ID and the IPFS CID. This creates an on-chain pointer to the complete tree data. Anyone can fetch the tree from Arweave or IPFS, rebuild it locally, and verify the root matches.

**User-side proof caching.** At registration time, the client must download and locally store the user's complete Merkle sibling path (approximately 20 Poseidon2 hashes for depth 20, roughly 640 bytes). This is stored in IndexedDB alongside the user's encrypted credentials. With the sibling path cached, users can generate new proofs for different action domains even if the operator's API is unavailable. They cannot survive a root transition (new tree build), but they retain full functionality for the duration of their root's active period plus grace period.

### 6.4 Guardian Veto

**Target:** v1.5
**Addresses:** Gap 5.4 (Governance Single Point of Failure)
**Cost:** One additional hardware wallet, one trusted human in a different jurisdiction

A guardian is a second key with strictly limited powers: it can veto (cancel) any pending timelocked operation, but it cannot initiate operations. The guardian cannot register roots, pause contracts, or transfer governance. It can only prevent pending actions from executing.

This is the minimal viable decentralization of governance. The founder retains operational control. The guardian provides a check against compromise or error. The guardian key should be held by a human (not a bot, not an LLM agent) in a different legal jurisdiction from the founder, stored on a hardware wallet, and used only in response to community alerts about suspicious governance activity.

The contract architecture already supports this. The `cancelRootOperation`, `cancelGovernanceTransfer`, `cancelVerifier`, and `cancelActionDomain` functions exist and are callable by governance. Adding a second authorized caller for cancel-only operations requires a minor contract modification.

### 6.5 Client-Side Verification

**Target:** v1.0 launch
**Addresses:** Gap 5.5 (Frontend Trust)
**Cost:** Approximately 10 lines of code in the communique client

Before generating a proof, the client must:

Read the UserRootRegistry and CellMapRegistry contracts on Scroll directly (via RPC, not via the operator's API) and confirm that the root returned by the shadow-atlas API is registered and active on-chain.

If the returned root is not active on-chain, the client must refuse to generate a proof and display a warning to the user indicating a potential integrity issue with the data source.

This does not verify that the root is correct (that it corresponds to accurate TIGER data), but it does verify that the root is one the operator registered through the on-chain governance process, which means it was subject to whatever timelocks and transparency mechanisms apply.

### 6.6 zkVM Proof of Correct Tree Construction

**Target:** v2.0 (6-12 months post-launch)
**Addresses:** Gap 5.1 (eliminates it entirely)
**Cost:** Approximately $500/year in proving compute

This is the mitigation that eliminates operator trust for tree construction. The operator (or anyone) builds the tree inside a zero-knowledge virtual machine. The zkVM produces a receipt (proof) that the computation was executed correctly. The on-chain root registration function requires a valid zkVM receipt before accepting a new root.

**Current state of the technology (February 2026):**

SP1 Hypercube (Succinct) is production-ready. It proves Ethereum blocks in under 12 seconds on 16 GPUs. Over 5 million proofs have been fulfilled through the Succinct Prover Network, securing over $4 billion in value. SP1 supports Rust programs compiled to RISC-V, with precompiles for cryptographic operations.

RISC Zero Boundless launched its mainnet in September 2025. It operates a decentralized proving marketplace where GPU operators compete to generate proofs. Memory limit is 3GB per guest program.

**How it would work for this protocol:**

A Rust program reads TIGER shapefiles (using the `shapefile` and `geo` crates), performs the cell-district mapping according to DISTRICT-TAXONOMY.md, computes Poseidon2 hashes for each leaf, constructs the Merkle tree, and outputs the root. This program is compiled to RISC-V and executed in SP1 or RISC Zero. The prover generates a receipt attesting to correct execution. The on-chain CellMapRegistry is modified to require this receipt alongside the proposed root.

**Practical constraints:**

The 3GB memory limit (RISC Zero) or equivalent resource constraints (SP1) mean that a nationwide tree cannot be built in a single zkVM execution. The tree must be built per-state or per-county, with roots aggregated via recursive proof composition.

The `geo` and `shapefile` Rust crates do compile to RISC-V, but filesystem I/O must be replaced with in-memory operations (zkVM guests have no filesystem access). The TIGER data is passed as input to the guest program, with its SHA-256 checksum verified inside the circuit.

Floating-point operations in geospatial libraries require careful handling. RISC-V floating-point support varies across zkVMs. Integer-based or fixed-point geometry operations may be necessary for determinism.

Proving time for a full nationwide tree rebuild would be on the order of minutes to hours (one-time per tree update, not per user proof). The cost through the Succinct Prover Network is approximately $0.001 per proof transaction. For a nationwide rebuild chunked into 50 state-level proofs with aggregation, the total cost is approximately $0.05 per tree update.

### 6.7 Coordination Observability

**Target:** v1.0 launch (on-chain) + v1.5 (off-chain indexer)
**Addresses:** Gap 5.6 (Coordination Integrity)
**Cost:** Minor contract extension + off-chain service

**On-chain (v1.0):** Extend `CampaignRegistry` to track template diversity. When `recordParticipation()` is called, record the action domain's template identifier alongside the existing district and participant counts. Expose a `campaignTemplateCount(bytes32 campaignId)` view function. No new storage cost beyond a mapping entry per unique template per campaign.

**Off-chain (v1.5):** Deploy a coordination entropy indexer that computes:
- **H_temporal** — Shannon entropy of `TwoTreeProofVerified` event timestamps per action domain, bucketed by hour. Low entropy (< 1.5 bits) flags potential bot-like coordination.
- **H_geographic** — Shannon entropy of district distribution per campaign. Low entropy flags geographic concentration inconsistent with the campaign's claimed scope.
- **Template concentration ratio** — `1 / templateCount` per campaign. A ratio of 1.0 (single template) combined with high participant count is a structural astroturfing signal.

These metrics are published as a public dashboard, not used for access control. Congressional offices can consult the dashboard when evaluating message campaigns. The protocol does not block coordinated campaigns — it makes coordination patterns visible, preserving the right of verified constituents to participate in organized advocacy while giving recipients the information to distinguish organic sentiment from manufactured consensus.

**Proof-message binding:** The current architecture binds proofs to action domains (which encode template + session), not to message content. This is the correct design. Content binding would create the template fingerprinting attack described in Gap 5.6. The action domain binding is sufficient because each `action_domain = keccak256("communique.v1" || jurisdiction || template_id || session_id)` scopes the proof to a specific campaign context. Content integrity at the message level is deferred to Phase 2 TEE-based delivery, where the TEE can verify message content matches the template without exposing content on-chain.

**Delivery path security:** The `mailto:` delivery path (used for state/local officials without CWC integration) currently bypasses blockchain proof submission. This path must be fenced: messages sent via `mailto:` should carry a visible label indicating they are unverified by the on-chain system, preserving the distinction between verified and unverified channels.

---

## 7. The Walkaway Roadmap

### Phase 1: Honest Centralization (Launch)

**Trust model:** Single trusted operator with verifiable claims.
**Comparable to:** MACI v2.5 coordinator model.

The protocol launches with a single operator who builds trees from public Census data and registers roots on-chain. The operator is trusted, but the trust is bounded by:

- Immutable contracts (no upgrade path for malicious logic changes)
- 7-day timelocks on destructive governance operations
- 14-day timelocks on verifier changes
- Deterministic, reproducible build pipeline with published manifests
- Client-side on-chain root verification
- Full event transparency for all governance actions
- Public monitoring infrastructure (governance event bot)
- User-cached Merkle proof paths for resilience

What passes: The protocol operates correctly as long as the operator is honest.
What fails: If the operator disappears, new users cannot register and existing users cannot generate proofs for new action domains (cached proofs still work).

### Phase 1.5: Transparency Layer (3-6 Months)

**Trust model:** Verify-don't-trust with public data availability.
**Comparable to:** Optimism Stage 1 with independent verification.

The operator publishes all tree data to Arweave (permanent) and IPFS (fast access), with CIDs anchored on-chain. Root registration requires a 7-day timelock, during which independent verifiers can reproduce the build and confirm correctness. A guardian veto key provides a check against governance compromise.

What passes: The protocol's data is publicly auditable. Independent parties can verify tree correctness. The guardian can block malicious governance actions.
What fails: If both the operator and the guardian are compromised simultaneously, the attacker can register malicious roots after 7 days.

### Phase 2: Trustless Construction (6-12 Months)

**Trust model:** Cryptographically verified tree construction.
**Comparable to:** Starknet's validity proof model applied to off-chain data processing.

Tree construction runs inside a zkVM. The on-chain registry requires a valid proof of correct construction before accepting a root. Multiple independent operators can submit tree builds — anyone with access to Census data and compute resources can participate. Noir recursive proof aggregation reduces per-user verification costs by 8-32x. Governance transitions to a 3-of-5 multisig with human keyholders in distinct legal jurisdictions.

What passes: No single party can register an incorrect tree root. The proof of correct construction is verified on-chain.
What fails: If Census TIGER data itself is incorrect (but this is a problem with the authoritative data source, not the protocol).

### Phase 3: Full Walkaway (12-24 Months)

**Trust model:** Protocol operates without any operator.
**Comparable to:** Uniswap v4 (immutable, no admin keys).

Tree construction is permissionless — anyone can submit a tree build with a zkVM proof. Conflicting submissions are resolved via optimistic dispute resolution (the UMA Optimistic Oracle v3 pattern: assert, bond, challenge, arbitrate). Governance is ossified: no admin keys, no upgrade path, no pause mechanism. The frontend is served from IPFS/Arweave. The protocol passes the walkaway test.

What passes: The original team can disappear permanently. The protocol continues to function as long as at least one party downloads Census data, builds a tree, and submits a zkVM proof.
What fails: If all participants stop building trees, the protocol stalls (but existing proofs against active roots remain valid for 30-90 days).

---

## 8. Landscape Context

This section records the state of the relevant ecosystem as of February 2026, providing context for the design decisions in this specification.

### 8.1 L2 Maturity

Scroll (the target deployment chain) reached Stage 1 decentralization in April 2025 via the Euclid upgrade. The sequencer remains centralized, but users can force-include transactions via L1, and anyone can submit/finalize batches if the sequencer stops operating. The Security Council is a 9/12 multisig.

Only 2 of over 50 major L2s have reached Stage 2 (fully smart-contract-governed with 30+ day exit windows). Stage 1 is the current practical ceiling for the industry.

The protocol's contracts are immutable and do not depend on Scroll's upgrade mechanisms. A malicious Scroll upgrade could censor transactions at the L2 level, but cannot modify the protocol's contract logic. Users retain L1 forced inclusion as an escape hatch.

### 8.2 Proof Verification Costs

On Scroll, L2 execution gas is effectively free (gas price near zero Gwei as of February 2026). The real cost is the L1 data component — posting proof bytes to Ethereum. A single UltraHonk proof verification costs approximately $0.01 on Scroll. With Noir recursive proof aggregation (batching 32 user proofs into one on-chain verification), the per-user cost drops to approximately $0.0003.

Neither NEBRA UPA nor Aligned Layer currently supports UltraHonk proofs. Noir-native recursive aggregation is the immediate path for cost reduction. External aggregation support for UltraHonk is expected to arrive in 2026 as the Noir ecosystem matures (zkVerify already lists UltraHonk as a supported proof system).

### 8.3 Data Availability

Ethereum's Fusaka upgrade (December 2025) activated PeerDAS, enabling data availability sampling. Blob data (EIP-4844) is pruned after approximately 18 days, making blobs unsuitable for permanent tree data publication. Arweave ($7/GB, permanent, one-time payment) and IPFS with pinning services ($240/year for 100GB) are the practical options for tree data availability.

### 8.4 Verifiable Computation

SP1 Hypercube and RISC Zero Boundless are both production-ready zkVMs with decentralized proving networks. SP1 has fulfilled over 5 million proofs; RISC Zero's Boundless marketplace processed 542.7 trillion cycles in its first month. Both accept Rust programs compiled to RISC-V. The Rust geospatial ecosystem (geo, shapefile, proj crates) is mature enough for TIGER data processing within a zkVM guest.

### 8.5 Anti-Sybil

The protocol currently uses self.xyz and Didit.me for identity verification. The broader ecosystem offers Human Passport (formerly Gitcoin Passport, acquired by Holonym Foundation, 2M+ users, 34.5M ZK credentials), World ID (iris biometrics with AMPC uniqueness verification), Proof of Humanity V2 (Kleros-arbitrated), and Semaphore V4 (privacy-preserving group membership with EdDSA identity scheme). Integration with any of these as additional or alternative identity providers is a Phase 2 consideration.

### 8.6 Governance Innovation

Lido's dual governance (live since June 2025) is the most sophisticated production model. LDO token holders govern; stETH holders can escrow tokens to extend timelocks (1% escrowed = +5 days, 10% = full rage-quit mode where execution is blocked until all protesters withdraw). This pattern — governance with stakeholder veto — is the current production standard for high-trust protocols.

Trail of Bits published a governance maturity model (June 2025) with four levels: single EOA, multisig, timelock + role separation, and immutable. This protocol is currently at Level 1 (single EOA) with Level 3 mechanisms (timelocks) applied to most operations. The roadmap targets Level 3 fully at Phase 1.5 and Level 4 at Phase 3.

---

## 9. Threat Scenarios

### 9.1 Scenario: Operator Registers Poisoned Cell Map Root

**Attack:** Operator builds a cell-district mapping tree where Census tract 06037 (Los Angeles County) is mapped to congressional district TX-22 instead of CA-34. Users in LA who prove district membership would be proving they are in a Texas district.

**Detection with current mitigations:** If the build is reproducible and the manifest is published, any independent party running the same build from TIGER data would compute a different root and raise an alarm.

**Detection with timelocked registration:** The poisoned root would sit in PROPOSED state for 7 days before becoming ACTIVE. Independent verifiers have 7 days to reproduce the build and compare.

**Detection with zkVM proving:** Impossible to execute. The zkVM proof of correct construction would fail because the program's output root would not match the claimed root. The on-chain verifier would reject the registration.

### 9.2 Scenario: Founder Key Compromise

**Attack:** Attacker obtains the governance private key and initiates a governance transfer to their own address.

**Detection:** `GovernanceTransferInitiated` event emitted on-chain. Monitoring bot alerts the community immediately.

**Response window:** 7 days before the transfer can execute.

**With guardian veto (Phase 1.5):** Guardian calls `cancelGovernanceTransfer` to block the transfer. Founder rotates to a new key via a fresh deployment if the old key is confirmed compromised.

**Without guardian:** Community must organize within 7 days to publicize the compromise, warn users to stop using the protocol, and potentially deploy a new instance of the contracts.

### 9.3 Scenario: Operator Disappears

**Impact without DA layer:** New users cannot register. Existing users cannot generate proofs for new action domains. Cached proofs continue to work. On-chain roots remain active for 30-90 days (grace period), then expire.

**Impact with DA layer (Phase 1.5):** Tree data is on Arweave/IPFS. A new operator can download the tree, set up a proof-generation API, and serve users. Users with cached sibling paths can generate proofs independently. The protocol can survive operator disappearance indefinitely as long as someone runs a proof-generation service.

**Impact with zkVM proving and permissionless operation (Phase 2-3):** Anyone can rebuild the tree from Census data, prove correct construction, and register a new root. The protocol is fully walkaway-resilient.

### 9.4 Scenario: Census Data Is Stale During Redistricting

**Context:** The next congressional redistricting cycle will follow the 2030 Census, with new maps taking effect in 2031-2032. TIGER will lag primary sources by 6-18 months.

**Impact:** Users in redistricted areas prove membership in old districts. Their proofs are technically valid (the tree root is on-chain and active) but politically incorrect (the district no longer exists in its old form).

**Mitigation (DATA-INTEGRITY-SPEC Layers 2-4):** Validity window tracking, primary source comparison against state redistricting commission publications, and event subscription for boundary change announcements. Currently only Layer 1 (HTTP HEAD change detection) is implemented.

**Mitigation (operational):** The operator monitors redistricting commission announcements, downloads new maps from primary sources when available, rebuilds the tree, and registers a new root while deprecating the old one with a 90-day grace period. This is a manual, operator-dependent process — automated detection is a Phase 2 goal.

### 9.5 Scenario: Malicious Verifier Registration

**Attack:** Attacker compromises governance and proposes a verifier contract at depth 20 that returns `true` for all proof inputs, regardless of validity.

**Detection window:** 14 days. This is the longest timelock in the system.

**Detection mechanism:** The proposed verifier's address is emitted in the `VerifierProposed` event. Anyone can read the bytecode at that address, decompile it, and compare it against the expected bytecode from a reproducible Noir circuit compilation.

**Requirement:** The reproducible build procedure must extend to verifier contracts, not just tree construction. The expected verifier bytecode hash for each depth should be published and well-known.

---

## 10. Acceptance Criteria by Phase

### Phase 1 (Launch)

- [ ] Deterministic build: Docker container with pinned tool versions
- [ ] TIGER checksums: SHA-256 manifest committed to repository
- [ ] Build manifest: Published alongside each root registration
- [ ] Client verification: Frontend reads on-chain root registries before proof generation
- [ ] User caching: Client stores Merkle sibling path in IndexedDB at registration
- [ ] Monitoring: Governance event bot operational on public channel
- [ ] Documentation: BUILD-VERIFICATION-PROCEDURE published
- [ ] Documentation: This specification committed and referenced from SECURITY.md

### Phase 1.5 (Transparency)

- [ ] Timelocked registration: proposeRoot/executeRoot pattern for all root types
- [ ] Arweave anchoring: Tree 2 published to Arweave at each build
- [ ] IPFS mirroring: Tree data pinned on IPFS, CID anchored on-chain
- [ ] Guardian veto: Second key with cancel-only permissions deployed
- [ ] Client IPFS: Frontend fetches tree data from IPFS, not operator HTTP API
- [ ] Verifier toolkit: Docker container and script for independent root verification published
- [ ] At least one independent party has successfully reproduced a root from published TIGER data

### Phase 2 (Trustless Construction)

- [ ] zkVM proof: Tree construction proven inside SP1 or RISC Zero
- [ ] On-chain receipt verification: CellMapRegistry requires zkVM receipt for registration
- [ ] Recursive aggregation: Noir outer circuit aggregates 32 inner proofs
- [ ] Multisig governance: 3-of-5 multisig with geographically distributed keyholders
- [ ] Permissionless tree building: Any party can submit tree builds with valid proofs

### Phase 3 (Walkaway)

- [ ] Governance ossification: Admin keys renounced, contracts fully immutable
- [ ] Dispute resolution: Conflicting tree submissions resolved via optimistic oracle
- [ ] Frontend decentralization: Application served from IPFS/Arweave
- [ ] Walkaway test: Protocol operates for 30 days with zero operator intervention

---

## 11. Sociopolitical Risk Analysis

Sections 1-10 address technical trust: cryptographic soundness, operator honesty, governance integrity, data availability. This section addresses a different class of risk — the ways in which a technically correct protocol can produce socially harmful outcomes. These risks cannot be mitigated with code alone. They require architectural discipline, deployment norms, and ongoing institutional awareness.

These concerns were identified through structured adversarial analysis and represent genuine tensions inherent to any cryptographic civic infrastructure. They are not solvable in the traditional engineering sense. They are tensions to be managed through design constraints, honest positioning, and refusal to optimize for adoption at the expense of the values the protocol exists to serve.

### 11.1 Identity Binding and Coercion Risk

**The concern:** Zero-knowledge proofs prove properties without revealing identity. But the existence of a proving system creates a new social primitive: the ability to *demand* proof. An employer, landlord, community leader, or government official could require a constituency proof as a condition of employment, housing, or access. "Prove you're in District 9 or you're fired." The cryptography works perfectly in this scenario — the proof is valid, the user's name remains hidden from the chain — but the human being has been coerced into attesting to their political geography under duress.

**Why this is not a theoretical concern:** Coercion through attestation demand already exists in non-cryptographic form. Voter registration status is public record in most US states. Employers in some industries routinely verify employee addresses. The question is whether the protocol amplifies or constrains this existing coercion.

**What the protocol changes compared to the status quo:**

Today, contacting an elected representative through official channels (phone, email, web form, physical letter) requires disclosing full name, mailing address, and often phone number. This information is stored in the representative's constituent management system (typically a commercial CRM like Fireside21, IQ, or Quorum), where it is retained indefinitely, used for political analytics, and occasionally leaked in data breaches. The information is also accessible to staff, interns, and third-party vendors.

The protocol replaces this with a ZK proof that reveals: district membership (which congressional district, state legislative district, etc.), an action-scoped nullifier (proves one action per person per domain, without linking actions across domains), and an authority level (an integer, not a name). The proof does not reveal: the user's name, address, phone number, IP address (at the on-chain layer), cell ID, or any identifier that persists across action domains.

This is a strict reduction in information exposure. A coerced proof reveals less than a coerced phone call.

**Where the risk persists despite the reduction:**

The risk is not in what the proof reveals to the blockchain. The risk is in what the act of proving reveals to the person standing in front of you. If an employer demands a proof and the user generates one on their phone, the employer now knows: the user has the protocol installed (indicating civic engagement), the user is in a specific district (confirming residence), and the user is willing to comply with proof demands (establishing a compliance dynamic). None of this information comes from the proof itself — it comes from the social context of generating the proof.

**Approaches to mitigation:**

**Approach 1: Deniable non-participation.** The protocol should never require or incentivize visible "verified" status. The communique frontend must not display badges, checkmarks, or any visual distinction between verified and unverified users on any public-facing surface. If a user's messages reach a congressional office, the office sees verification status — but other users, the public internet, and any scraping service do not. The verified/unverified distinction must be invisible to everyone except the intended recipient (the office).

This prevents the formation of a social norm where "verified" is a public credential. If no one can see whether you're verified, no one can demand that you prove it publicly.

**Pitfall of Approach 1:** Congressional offices themselves could leak or publish verification status. An office could say "We received 5,000 verified messages supporting HR-4521." This implicitly legitimizes verified messages over unverified ones and creates pressure to verify. Mitigation: the protocol's API to congressional offices should report aggregate verification counts without enabling per-message verification status queries. Offices should know "this message is from a verified constituent" but should not be able to export a list of verified vs. unverified messages for public consumption.

**Approach 2: Proof non-transferability.** Proofs are bound to a specific action domain (e.g., a particular bill or campaign). A proof generated for one action cannot be presented as proof of constituency in a different context. If an employer demands "prove you're in District 9," the user can truthfully say "the system only generates proofs for specific congressional actions, not general constituency attestations." This is already the architecture — nullifiers are scoped to action domains, and the DistrictGate contract requires an active, whitelisted action domain. There is no "prove general constituency" action domain, and governance should never create one.

**Pitfall of Approach 2:** Nothing prevents governance from registering a broad action domain like "general-constituency-attestation." The architectural defense is only as strong as the governance discipline. Mitigation: document a governance policy that action domains must be scoped to specific legislative actions, campaigns, or time-bounded civic events. A general-purpose "prove you live here" domain must be explicitly prohibited in governance norms, and a guardian veto (Section 6.4) should be empowered to block any such proposal.

**Approach 3: Rate-limited proof generation.** The protocol already enforces a 60-second cooldown between proof submissions (NullifierRegistry). This limits the speed at which a coercer can demand multiple proofs. But the deeper defense is that proof generation takes 14-25 seconds on mobile — long enough to be inconvenient as a casual demand ("prove it right now"), and long enough that the user has time to consider whether to comply. This is not a strong defense, but it introduces friction that scales poorly for mass coercion.

**Pitfall of Approach 3:** Sophisticated coercers (employers conducting pre-employment screening, landlords requiring verification before lease signing) operate on longer timescales where proof generation latency is irrelevant. Rate limiting helps against spontaneous street-level coercion but not against institutional coercion. No protocol-level defense exists against institutional coercion — the defense is legal and cultural (anti-discrimination law, social norms around political privacy).

**Residual risk:** Coercion risk cannot be eliminated by protocol design. It can be constrained (proofs reveal less than alternatives, proofs are action-scoped and non-transferable, verified status is not publicly visible) and documented (the protocol's communications must never position verification as a loyalty test or civic duty). The protocol must be explicit: using this system is optional, and choosing not to use it is a legitimate exercise of privacy.

### 11.2 Civic Rails and Power Concentration

**The concern:** Whoever controls the messaging channel to representatives controls political access. The protocol creates a new channel with cryptographic legitimacy ("verified constituent") that could displace or delegitimize existing channels (phone calls, letters, town halls). If the protocol becomes the preferred channel, the operator who builds the district trees controls who can participate and who is excluded.

**Why this is a structural risk, not just an operator risk:**

The technical trust analysis in Sections 3-6 addresses the operator's power to poison trees, censor users, and manipulate roots. But the power concentration risk goes deeper than operator malfeasance. Even an honest, competent operator concentrates power by being the sole entity that resolves ambiguity in geographic data.

Census TIGER data is not a perfect map of political reality. Census tracts can straddle district boundaries. Annexations and de-annexations change municipal boundaries between TIGER releases. Redistricting commissions publish maps in formats that don't perfectly align with Census geometry. Every tree build requires hundreds of interpretive decisions about edge cases — which side of a boundary a split tract belongs to, how to handle unincorporated areas, whether to use TIGER's boundaries or a state commission's slightly different version.

These interpretive decisions are individually minor but collectively significant. A systematic bias in edge-case resolution could shift the provable constituency of marginal districts by hundreds or thousands of residents. This is not gerrymandering in the traditional sense (the operator cannot redraw districts), but it is a form of soft cartographic power: the power to define which version of political geography becomes the cryptographic ground truth.

**Approaches to mitigation:**

**Approach 1: Publish the ambiguity resolution algorithm, not just the tree.** The cell-district-loader must document every edge-case resolution strategy. When a census tract straddles two congressional districts, the resolution rule must be explicit (e.g., "assign to the district that contains the tract centroid" or "assign to the district that contains the majority of the tract's land area"). These rules must be part of the deterministic build, not ad hoc operator decisions. They must be published alongside the build manifest so that independent verifiers can evaluate not just whether the root is correctly computed, but whether the resolution strategy is fair.

**Pitfall of Approach 1:** Any fixed algorithm for ambiguity resolution will produce edge cases where the algorithm's output is politically counterintuitive. A centroid-based assignment could place a dense urban neighborhood in the wrong district because the tract's centroid falls in an adjacent industrial zone. No algorithm is politically neutral. Mitigation: document the algorithm's limitations explicitly and provide a dispute resolution mechanism where affected residents can petition for manual review of their tract's assignment. This is an off-chain governance process, not a protocol-level mechanism.

**Approach 2: Multiple independent tree builders.** The walkaway roadmap (Section 7) describes permissionless tree building at Phase 2-3. When multiple operators can submit trees with zkVM proofs, the interpretive monopoly breaks. If two operators build trees from the same TIGER data with different ambiguity resolution algorithms, both trees can be registered (the registries support multiple active roots). Users in ambiguous tracts could prove constituency using whichever tree includes them. This is the strongest mitigation: competition among tree builders eliminates the single cartographer problem.

**Pitfall of Approach 2:** Multiple active trees create complexity for verifiers (congressional offices must check proofs against any active root, not just one) and for users (which tree am I in? which tree should I use?). It also creates a potential for conflicting claims — the same user proving membership in different districts via different trees. Mitigation: the frontend should abstract tree selection from the user. The client queries all active roots, finds the one that includes the user's cell, and generates a proof against it. If a user is included in multiple trees with different district assignments, the client should surface this conflict to the user and let them choose, with a note explaining that their cell falls in an ambiguous zone.

**Approach 3: Explicit positioning as supplementary channel.** The protocol must never claim to replace phone calls, letters, or town halls. Its public communications, documentation, congressional office onboarding materials, and marketing must position it as one additional channel alongside existing ones. Congressional offices must be advised to treat verified messages as signal, not as the only legitimate input. The protocol's value proposition to offices is "constituent verification without PII exposure," not "the only way to know if someone is really your constituent."

**Pitfall of Approach 3:** This positioning is a social commitment, not an architectural guarantee. If the protocol succeeds at scale, congressional offices may de facto prefer verified messages because they are easier to process, filter, and aggregate. The displacement of traditional channels happens through market dynamics, not protocol design. Mitigation: the protocol should actively support interoperability with existing constituent management systems, including import of phone-call and letter data. The goal is to add verification to existing channels, not to replace them.

**Approach 4: Congressional office API design that prevents legitimacy hierarchy.** The API that delivers verified messages to congressional offices should not create a separate queue, inbox, or priority tier for verified vs. unverified messages. Both should appear in the same feed. The verification status should be metadata on the message, not a routing decision. This prevents offices from building workflows that systematically deprioritize unverified voices.

**Pitfall of Approach 4:** Offices will build their own filtering regardless of API design. If verification status is available as metadata, third-party CRM integrations will filter by it. The only way to prevent filtering is to not provide the metadata — but then the verification is useless to the office. This is a genuine tension with no clean resolution. The protocol must accept that verification data will be used for prioritization and focus on ensuring that the verification itself is accurate and inclusive rather than trying to prevent its downstream use.

### 11.3 Attestation Graphs and Social Scoring Drift

**The concern:** Once civic participation generates reputation, institutions optimize for reputation scores. A "high reputation" constituent gets faster access, more attention, better outcomes. Reputation becomes a currency. Users farm it. Institutions require it. The difference between "civic reputation" and "social credit" becomes a distinction without a difference.

**Why this risk is architectural, not hypothetical:**

The protocol's Phase 2 roadmap includes reputation tracking. The `docs/roadmap/phase-2/reputation.md` describes a ReputationAgent that tracks civic activity. Even if the initial design is narrow (tracking message delivery, office responses, campaign participation), any metric that affects outcomes will be gamed. This is Goodhart's Law: when a measure becomes a target, it ceases to be a good measure.

The Chinese Social Credit System is not primarily a technology problem — it is a governance problem. The technology (surveillance cameras, payment tracking, behavioral scoring) serves the governance objective (population compliance). The relevant question for this protocol is not "does the technology enable social scoring?" (any database with user activity does) but "does the governance structure prevent social scoring from being imposed?"

**Approaches to mitigation:**

**Approach 1: Reputation as invisible signal, never visible score.** This is the most critical architectural decision in the reputation system's design. The user must never see a number, a tier, a badge, or any representation of their reputation. The reputation system operates as a *backend signal* to receiving offices, not a *frontend status* for users.

If a congressional office receives 10,000 messages on a bill, the office's triage system might use reputation signals to identify which messages come from constituents with a history of substantive engagement (as opposed to copy-paste form letters from out-of-district bots). This is legitimate and useful. But the user who sent a substantive message must never know that their message was "ranked higher" due to reputation. They must never be incentivized to chase a score.

Implementation: the reputation computation runs server-side. The API to offices includes a signal (not a score — a categorical signal like "established constituent" vs. "new constituent" vs. "unverified"), but the API to users includes no reputation data whatsoever. The client has no endpoint for querying reputation. The frontend has no reputation display. The user's experience is binary: you are verified, or you are not. There is no gradient visible to you.

**Pitfall of Approach 1:** Determined users can infer their reputation by observing outcomes (if their messages consistently get responses, they deduce high reputation). Mitigation: this is acceptable. Inference from outcomes is slow, noisy, and non-transferable. The user cannot prove their inferred reputation to a third party. They cannot display it. They cannot trade it. The absence of a concrete, portable score prevents the market dynamics that create social credit systems.

**Approach 2: No reputation composability.** The reputation signal must not be exportable, attestable, or provable to any system outside the protocol. There must be no "export my civic reputation" feature. No Verifiable Credential for reputation. No EAS attestation for civic activity score. No integration with Gitcoin Passport, Human Passport, or any identity aggregation system.

This is a deliberate refusal to participate in the composable identity stack that much of the web3 ecosystem is building. Composable reputation is social credit by another name. When reputation can move between systems, it becomes a universal score. The protocol must be an island: it produces verification of constituency (a fact about geography), not verification of civic virtue (a judgment about behavior).

**Pitfall of Approach 2:** This limits the protocol's network effects. Other protocols and platforms will want to integrate civic reputation as a signal (for governance weight, for grant eligibility, for content moderation). Refusing composability means refusing partnerships and integrations that could accelerate adoption. Mitigation: the cost of social credit drift is higher than the cost of slower adoption. The protocol must accept slower growth in exchange for maintaining the boundary between geographic verification (safe to compose) and behavioral reputation (unsafe to compose).

**Approach 3: Reputation decay and non-accumulation.** If reputation signals exist at all, they must decay over time. A user who was active three years ago should not carry permanently elevated status. Reputation should reflect recent, sustained engagement — not historical accumulation. This prevents the formation of "civic aristocracies" where early adopters permanently outrank newcomers.

Implementation: reputation windows should be short (90 days of activity, not lifetime). The signal should be binary or categorical (active/inactive, new/established), not numerical. There should be no "all-time" metric. This aligns with the protocol's existing root lifecycle: roots expire, proofs expire, and reputation should expire too.

**Pitfall of Approach 3:** Decay incentivizes continuous participation, which itself creates behavioral pressure. "Use the protocol regularly or lose your status" is a mild form of the compliance dynamic that social credit systems create. Mitigation: the decay should be graceful (not cliff-edge), the categories should be coarse (not fine-grained), and the impact on outcomes should be marginal (not gatekeeping). An "established constituent" message and a "new constituent" message should both reach the office — the signal is triage priority, not access control.

**Approach 4: Formal prohibition in governance norms.** The governance documentation must include an explicit prohibition: "The protocol shall not produce, store, or expose a numerical reputation score for any user. Reputation signals shall be categorical, non-portable, non-composable, and invisible to the user. Any governance proposal to create a visible reputation score, a reputation export mechanism, or a reputation-gated feature shall be treated as a violation of protocol values and vetoed by the guardian."

This is a governance norm, not a code constraint. It could be violated by a future governance change. But documenting it explicitly creates a Schelling point: any deviation from this norm is visible, nameable, and resistible. It transforms "social credit drift" from a gradual, unnamed process into a specific, identifiable governance failure.

### 11.4 Proof-of-Personhood and Exclusion

**The concern:** Every verification gate excludes people who cannot pass it. The protocol requires: a smartphone with a modern browser (SharedArrayBuffer, WASM, WebCrypto), an internet connection sufficient for 14-25 seconds of proving, the ability to complete an identity verification flow with self.xyz or Didit.me, a US residential address that geocodes correctly via the Census API, and sufficient cognitive ability and digital literacy to navigate the registration and proving UX. These requirements exclude elderly people without smartphones, people with certain disabilities, undocumented residents, people whose addresses don't appear in Census data (new construction, rural routes, tribal lands), people experiencing homelessness, and people who distrust or cannot access identity verification services.

**Why this is not just a "Phase 1 limitation":**

Adding more identity providers (Human Passport, World ID, Proof of Humanity) distributes registrar trust but does not address the fundamental gate: digital access. Every identity provider requires a smartphone and internet. Every ZK proof requires a browser. The protocol's privacy properties depend on client-side computation, which means the computation must happen on the user's device. There is no server-side fallback that preserves privacy — if a server generates your proof, the server knows your secret.

This creates a structural tension between privacy and inclusion. The most privacy-preserving architecture (client-side proving, no server knowledge of user secrets) is also the most exclusionary (requires capable hardware and digital literacy). A less private architecture (server-assisted proving) would be more inclusive but would compromise the core privacy guarantee.

**Approaches to mitigation:**

**Approach 1: Assisted proving with split trust.** Design a protocol for assisted proof generation where a trusted helper (a library kiosk, a community center terminal, a civic organization's device) generates the proof on the user's behalf, but the helper learns as little as possible.

In the current architecture, proof generation requires: the user's secret (private), the user's cell ID (semi-private — derivable from address), the Merkle sibling path (public, available from the tree), and the district data (public). The secret is the sensitive input. An assisted proving protocol could use a two-party computation where the helper provides compute resources and the user provides their secret via a secure input mechanism (e.g., entering their secret on a hardware token or a sandboxed input field that the helper's device cannot read).

**Pitfall of Approach 1:** Two-party computation for ZK proving is an active research area, not a production technology. Noir/UltraHonk does not currently support MPC-based witness generation. The practical fallback is simpler but less secure: the user enters their secret on the helper's device, the proof is generated, and the secret is purged from memory. This requires trusting the helper's device, which is a weaker guarantee. Mitigation: for Phase 1, document that assisted proving is a known gap. For Phase 2, track the development of MPC-friendly proving frameworks (Aztec's protocol is exploring this direction) and integrate when available.

**Approach 2: Offline proof generation.** Allow users to generate proofs on their own devices without a network connection at the moment of proving. The user downloads the circuit, their Merkle path, and the tree data during an initial registration session (which requires internet), and then generates proofs offline as needed. This reduces the ongoing connectivity requirement to a one-time registration.

**Pitfall of Approach 2:** The Merkle path is only valid for the current tree root. When the tree is rebuilt (new users registered, district boundaries updated), the user's cached path becomes stale. They need to reconnect to download a new path. If tree rebuilds happen monthly, users need internet access at least monthly. Mitigation: set tree rebuild frequency to quarterly (aligning with the CellMapRegistry's 90-day grace period), maximizing the window during which cached proofs remain valid.

**Approach 3: Proxy registration through civic organizations.** Partner with civic organizations (League of Women Voters, NAACP local chapters, public libraries, community centers) to provide registration assistance. The organization operates a registered terminal where users can complete identity verification and initial proof generation with staff assistance. The organization does not retain user secrets — the registration flow generates the secret on-device and the user writes down or memorizes their recovery phrase.

**Pitfall of Approach 3:** This introduces a physical trust point. The organization's staff could shoulder-surf the user's secret. The organization's terminal could be compromised. The organization could selectively assist or deny assistance based on political orientation. Mitigation: design the registration UX so that the secret is generated and displayed only on the user's own device (even if the terminal provides compute for proving). If the user has no device, the terminal can generate the secret but the user must write it down on paper and the terminal must provably delete it (memory-zeroing, no persistent storage). These are UX constraints, not protocol constraints.

**Approach 4: Honest acknowledgment of exclusion.** The protocol must state, clearly and prominently, that it is not universal. It is an additional channel for civic participation available to people who meet certain technological prerequisites. It does not replace existing channels. It does not claim to represent "all constituents" — it represents "constituents who choose and are able to use this tool."

This honesty has a practical consequence: the protocol must never report statistics like "80% of District 9 constituents support HR-4521" based solely on verified messages. The verified population is a non-representative sample of the total population. Any aggregate statistics must carry a caveat: "Among verified constituents who chose to participate via this protocol."

**Pitfall of Approach 4:** Honest framing limits the protocol's political impact. Congressional offices may discount the protocol's signals if they know the participant pool is non-representative. Mitigation: the protocol's value proposition is not "we represent everyone." It is "we guarantee that each message comes from one real person in your district, without revealing who they are." Verification of individual constituency is valuable even when the aggregate is non-representative. An office that receives 500 verified messages from unique constituents knows those are 500 real people — not 500 bot accounts, not 50 people sending 10 messages each, not out-of-district astroturfing. That signal has value independent of representativeness.

**Approach 5: Separate verification from proving.** Consider a design where identity verification (proving you are a real person in a district) and action proving (submitting a verified message) are two distinct steps with different hardware requirements. Verification could happen once, in person, at a high-capability terminal (community center, library). The verification step produces a credential (encrypted, stored on any device — even a basic phone or a smart card). The proving step uses this credential and can be done on lower-capability hardware or even via SMS with a server-assisted flow (where the server knows the credential but not the user's identity, because the credential is pseudonymous).

**Pitfall of Approach 5:** This is a significant architectural change that would require rethinking the client-server trust boundary. The current architecture assumes the client holds the secret and generates the proof. A credential-based architecture introduces a bearer token that could be stolen, shared, or sold. Mitigation: credentials can be bound to a hardware attestation (WebAuthn/FIDO2) on the user's device, preventing extraction and transfer. This is a Phase 2+ consideration that requires careful cryptographic design.

### 11.5 Governance and Soft Power Capture

**The concern:** Token-weighted governance reproduces plutocracy. Reputation-weighted governance reproduces meritocratic oligarchy. Single-founder governance is honest autocracy. All three concentrate power. The protocol's "progressive decentralization" roadmap is a promissory note that most protocols never cash, because the incentives to relinquish control are weaker than the incentives to retain it.

**Why this concern is grounded in evidence:**

Academic research on DAO governance confirms that decentralization in DeFi is often illusory. Studies of Compound and Uniswap governance show extreme concentration: a small number of addresses control the majority of voting power. The MakerDAO/Sky rebrand vote was dominated by just four entities. Progressive decentralization as practiced by most protocols consists of: launching with a founder key, promising a multisig, promising a DAO, and then stalling at the multisig stage because the multisig members are all affiliated with the founding team.

The Astria shared sequencer project raised $18 million and shut down in December 2025. The Nouns DAO experienced a $27 million rage-quit event where speculators extracted treasury value. These are not outliers — they are the modal outcomes of crypto governance experiments.

**What makes this protocol's governance different from most (and what doesn't):**

The protocol is different in that its TimelockGovernance contract is unusually honest about its limitations. The NatSpec documentation explicitly says "Founder compromise = governance compromise" and "NOT LLM agents, NOT VPN-separated keys from same person." This is a level of candor that most protocols lack.

The protocol is also different in that its governance scope is deliberately limited. Governance controls: which tree roots are active, which verifiers are deployed, which action domains are whitelisted, and whether the protocol is paused. Governance does not control: user secrets, proof generation, message content, or district boundaries (those are determined by Census data). This bounded scope means that even a fully compromised governance can only disrupt the protocol's operation (censorship, incorrect district mapping) — it cannot surveil, deanonymize, or forge proofs.

The protocol is not different in that it relies on a single founder key with no independent check on its power (until the guardian veto is implemented) and no mechanism for the community to override or exit governance decisions (until rage-quit is implemented).

**Approaches to mitigation:**

**Approach 1: Governance minimization, not governance maximization.** The protocol should be designed so that governance has as little to do as possible. The ideal end state is not "a DAO votes on tree updates" — it is "tree updates happen automatically via zkVM proofs and no one votes on anything." Every governance function that can be automated should be automated. Every governance function that can be removed should be removed.

Concretely: once zkVM-proven tree construction is deployed (Phase 2), the `registerCellMapRoot` function should accept a zkVM receipt directly, without requiring governance to call it. Anyone who produces a valid proof of correct tree construction from published TIGER data can register a root. Governance is no longer in the loop. This eliminates governance capture for the most critical function in the protocol.

**Pitfall of Approach 1:** Governance minimization reduces the protocol's ability to respond to novel situations. If Census data has a systematic error, there is no governance body to decide "use the state commission's data instead." If a new type of district needs to be added (water districts, school districts in a new configuration), there is no governance body to update the taxonomy. Mitigation: maintain governance for exception handling (pause, emergency response) but automate the routine path. The governance scope should shrink over time, not grow.

**Approach 2: Governance ossification with emergency escape hatch.** The Phase 3 end state should be: all governance functions are disabled except `pause` and `unpause`. No new roots can be registered by governance — only by zkVM proof. No verifiers can be changed — the verifier is immutable. No action domains can be added or revoked — the whitelist is fixed or governed by a deterministic rule (e.g., any keccak256 hash of a valid bill number is an allowed action domain). The governance key retains only the ability to pause the protocol in an emergency, with the understanding that the community can deploy a new instance if governance refuses to unpause.

This is the Uniswap v4 model: deploy the contract, remove the admin keys, and let the protocol run. The cost is inflexibility — bugs cannot be patched, features cannot be added. The benefit is maximal trust — no one can change the rules.

**Pitfall of Approach 2:** Premature ossification locks in bugs. If the verifier has a subtle flaw, there is no way to fix it without deploying an entirely new protocol and migrating all users. Mitigation: ossification should happen late, after extensive auditing (Trail of Bits engagement is planned for Q1 2026) and real-world usage. The timeline in Section 7 places ossification at Phase 3 (12-24 months post-launch). This gives time for bugs to surface and be fixed before governance is renounced.

**Approach 3: Credible commitment to decentralization via self-destructing governance.** Deploy a governance contract with a built-in countdown: after a specified date (e.g., 18 months post-deployment), the governance key automatically loses the ability to register roots. The countdown is hardcoded in the contract — it cannot be extended by governance. This makes the "progressive decentralization" commitment credible because it is enforced by code, not by the founder's willingness to relinquish power.

**Pitfall of Approach 3:** A fixed countdown doesn't account for unforeseen circumstances. If the protocol isn't ready for governance minimization at the countdown date (zkVM proving isn't deployed, no independent tree builders exist), the governance key loses power prematurely and the protocol stalls. Mitigation: the countdown should be generous (18-24 months) and should disable only root registration, not emergency pause. This gives the protocol a long runway while making the commitment credible.

**Approach 4: Rage-quit mechanism for registered users.** Implement an on-chain mechanism where registered users can signal distrust in governance. If a threshold of unique nullifiers (distinct users who have previously verified at least one proof) signal distrust within a time window, governance operations are frozen. This is the Lido dual governance model adapted for a non-financial protocol: instead of escrowing economic value, users escrow their proven constituency (a proof that they are real, verified participants, not Sybil accounts).

**Pitfall of Approach 4:** Rage-quit mechanisms can be gamed. A coordinated group could manufacture the threshold to freeze governance and hold the protocol hostage. In Lido's model, the cost of ragequit is economic (stETH must be escrowed). In this protocol, the cost is identity-based (you must have a valid proof to signal), which means the attacker would need control of a threshold number of real user identities. Mitigation: set the threshold high enough that organic distrust (hundreds or thousands of unique users) is required, not a handful of determined attackers.

**Approach 5: Founder as caretaker, not owner.** The founder's relationship to the protocol should be framed — in documentation, in public communications, and in the founder's own understanding — as temporary stewardship, not ownership. The governance key is a janitorial function: keep the lights on until the building can run itself. The language matters. "Governance" implies authority. "Maintenance" implies service. The founder maintains the protocol until it doesn't need maintaining.

**Pitfall of Approach 5:** Framing doesn't bind. A founder who calls themselves a "caretaker" still holds the keys. The constraint is cultural, not cryptographic. Mitigation: pair the cultural framing with the mechanical constraints in Approaches 1-4. The credible commitment (self-destructing governance, rage-quit) gives the cultural framing teeth. Neither alone is sufficient; together, they create a governance structure that is both honest about its current centralization and credible about its commitment to dissolution.

### 11.6 Summary of Sociopolitical Risk Posture

| Risk | Severity | Protocol Defense | Residual Exposure |
|------|----------|-----------------|-------------------|
| **Identity coercion** | High | Proofs reveal less than status quo; action-scoped nullifiers prevent cross-context linkage; no public verified/unverified distinction | Social demand for proof generation in coercive contexts cannot be prevented by code |
| **Civic rail capture** | High | Open-source pipeline; deterministic build; multiple tree builders at Phase 2; explicit positioning as supplementary channel | Interpretive power over geographic edge cases persists until permissionless tree building |
| **Social scoring drift** | Medium | Reputation invisible to users; non-composable; non-portable; decay-based; formally prohibited in governance norms | Institutions downstream of the protocol may construct their own scoring from verification metadata |
| **Exclusion** | High | Multi-provider identity; offline proving capability; assisted proving via civic organizations; honest acknowledgment of non-universality | Digital access requirements exclude the most vulnerable; no protocol-level fix for this structural tension |
| **Governance capture** | Medium | Bounded governance scope; timelocked operations; honest threat model; self-destructing governance timeline; rage-quit mechanism | Single founder key until guardian veto deployed; promissory decentralization until code enforces it |
| **Coordinated astroturfing** | High | Nullifier uniqueness (one proof per action); geographic diversity tracking (districtCount); structural signal architecture (temporal entropy, template diversity); public coordination dashboard | Content uniqueness is unreliable in post-LLM landscape; well-funded astroturfers can use real verified identities; protocol intentionally does not block coordinated campaigns, only makes patterns visible |

The overarching principle: these risks are not bugs to be fixed. They are tensions to be managed. The protocol cannot eliminate the possibility that its tools will be misused by powerful actors. It can constrain the misuse surface through architectural decisions (action-scoped proofs, invisible reputation, non-composable credentials) and honest positioning (supplementary channel, non-universal, explicitly centralized during Phase 1). The protocol's integrity depends not only on its cryptography but on the discipline to resist optimizing for adoption at the expense of the values it was built to serve.

---

## Appendix A: Timelock Reference

Complete timelock durations across the contract system, including gaps identified in Section 5.2.

| Operation | Current Duration | Recommended | Contract |
|-----------|-----------------|-------------|----------|
| Governance transfer | 7 days | 7 days (no change) | TimelockGovernance |
| Root registration (new) | None | 7 days | UserRootRegistry, CellMapRegistry, DistrictRegistry |
| Root deactivation | 7 days | 7 days (no change) | UserRootRegistry, CellMapRegistry, DistrictRegistry |
| Root expiry | 7 days | 7 days (no change) | UserRootRegistry, CellMapRegistry, DistrictRegistry |
| Root reactivation | 7 days | 7 days (no change) | UserRootRegistry, CellMapRegistry, DistrictRegistry |
| Action domain registration | 7 days | 7 days (no change) | DistrictGate |
| Action domain revocation | None | 7 days | DistrictGate |
| Verifier registration | 14 days | 14 days (no change) | VerifierRegistry |
| Verifier upgrade | 14 days | 14 days (no change) | VerifierRegistry |
| Campaign registry change | 7 days | 7 days (no change) | DistrictGate |
| Campaign flagging | 24 hours | 24 hours (no change) | CampaignRegistry |
| Caller authorization | 7 days | 7 days (no change) | NullifierRegistry |
| Caller revocation | 7 days | 7 days (no change) | NullifierRegistry |
| Contract pause | None | None (emergency use) | DistrictGate, NullifierRegistry, CampaignRegistry |
| Creator whitelist | None | Consider 24 hours | CampaignRegistry |

## Appendix B: Grace Period Reference

| Registry | Grace Period | Rationale |
|----------|-------------|-----------|
| UserRootRegistry | 30 days | Individual user transitions; affected user must act |
| CellMapRegistry | 90 days | Systemic redistricting transitions; all users in affected area must update |
| DistrictRegistry (legacy single-tree) | 30 days | Backward compatibility with pre-two-tree roots |

## Appendix C: Event Monitoring Checklist

Events that community monitors should flag for immediate review:

**Critical (investigate within 1 hour):**
- `GovernanceTransferInitiated` — Who is the target? Was this expected?
- `VerifierProposed` — Compare bytecode against reproducible build
- `ContractPaused` — Why? Is there an active attack, or is this governance abuse?
- `ActionDomainRevoked` — Which domain? Are legitimate actions being blocked?

**High (investigate within 24 hours):**
- `UserRootRegistered` / `CellMapRootRegistered` — Does the root match a published build manifest?
- `RootOperationInitiated` (deactivation) — Is this expected? Are users being warned?
- `TwoTreeRegistriesProposed` — Are the proposed registry addresses legitimate contracts?

**Normal (review weekly):**
- `ActionDomainProposed` / `ActionDomainActivated` — New action scopes opening
- `CampaignRegistryChangeProposed` — Integration changes
- `RootExpirySet` — Root deprecation on schedule

**Coordination Integrity (review daily when coordination indexer is deployed):**
- `CampaignCreated` with `templateCount = 1` and `participantCount > 100` — Single-template mass campaign; potential astroturfing signal
- `TwoTreeProofVerified` burst — More than 50 proofs for the same `actionDomain` within 1 hour; low temporal entropy
- Campaign `districtCount / participantCount < 0.1` — Extreme geographic concentration; inconsistent with organic constituent engagement
- Campaign where 90%+ participants have `authorityLevel = 1` — Self-attested-only mass campaign; weaker constituent signal

---

*This specification is a living document. It will be updated as mitigations are implemented and as the landscape evolves. The version number increments with each substantive change. The date reflects the last update.*
