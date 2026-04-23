# Adversarial Attack Domains & Agent Roster

> **Created:** 2026-02-01
> **Purpose:** Reference document for systematic adversarial security review
> **Status:** Active - domains and agents available for deployment

---

## Executive Summary

This document catalogs the complete attack surface of voter-protocol and shadow-atlas, organized into 12 attack domains with 10 specialized adversarial agent profiles. Each agent is designed with deep background context and incentive framing to maximize vulnerability discovery.

---

## Part I: Attack Domain Taxonomy

### Domain 1: Cryptographic Foundations

**Scope:** ZK proof system, hash functions, nullifier security, randomness

**Attack Surface:**
- Circuit constraint soundness (can non-members forge proofs?)
- Hash collision vectors (cross-arity: hash2 vs hash4)
- Nullifier predictability (given actionDomain, predict victim's nullifier?)
- Domain separation completeness (every hash context unique?)
- Poseidon2 security margin (8 internal, 56 external rounds)
- Side-channel leakage in WASM proof generation
- Nullifier Sybil resistance (is nullifier deterministic per real human?)
- Leaf preimage completeness (does the leaf bind all security-critical fields?)

**Key Files:**
- `packages/crypto/noir/three_tree_membership/src/main.nr` - Current circuit constraints (single-tree `district_membership` is dead code — see CRYPTOGRAPHY-SPEC §11.1)
- `packages/crypto/src/poseidon2.ts` - TypeScript hash implementation
- `packages/noir-prover/src/fixtures.ts` - Test fixture generation

**Known Mitigations:**
- BA-003: DOMAIN_HASH2 (0x48324d) for pair hashing
- SA-007: DOMAIN_HASH1 (0x48314d) for single hashing
- SA-011: user_secret != 0 constraint
- CVE-001/003: Leaf computed inside circuit from user_secret
- DECIDED: Leaf = H4(secret, cellId, salt, authorityLevel) with DOMAIN_HASH4
- DECIDED: Nullifier = H2(identityCommitment, actionDomain) — identity-bound, not secret-bound

---

### Domain 2: Smart Contract Security

**Scope:** Access control, governance, timelocks, cross-contract trust

**Attack Surface:**
- Governance single point of failure (Phase 1 "honest" assumption)
- Timelock bypass vectors
- Verifier contract injection (malicious verifier accepts invalid proofs)
- Cross-contract trust boundaries (Gate trusts Registry trusts Verifier)
- Reentrancy on CampaignRegistry callbacks
- Front-running / MEV extraction on proof submissions

**Key Files:**
- `contracts/src/DistrictGate.sol` - Main verification orchestrator
- `contracts/src/DistrictRegistry.sol` - Root lifecycle management
- `contracts/src/NullifierRegistry.sol` - Double-vote prevention
- `contracts/src/CampaignRegistry.sol` - Participation tracking
- `contracts/src/VerifierRegistry.sol` - Depth-to-verifier routing

**Historical Finding (RESOLVED 2026-02):**
```
# Wave 2 (2026-02-01) claimed NullifierRegistry lacked governance timelock.
# Status: RESOLVED. NullifierRegistry now inherits TimelockGovernance
# (NullifierRegistry.sol:33), which serializes transferGovernance through the
# same propose/execute pattern used by DistrictRegistry / CampaignRegistry.
```

**Known Mitigations (verify against deployed timelocks, which are configurable):**
- SA-001: actionDomain whitelist — configurable timelock on add/remove (MIN 10 min; Scroll mainnet deploys with 7 days per `script/DeployScrollMainnet.s.sol`)
- SA-004: isValidRoot() lifecycle check (AbstractRootLifecycle)
- Verifier-depth upgrades — configurable timelock (typically 14 days at deploy)
- **Root registration is NOT timelocked** — only deactivation / expiry / reactivation carry the 7-day lifecycle timelock. A new root can be registered immediately by authorized operators.

---

### Domain 3: DevSecOps & CI/CD

**Scope:** Secrets management, build pipelines, deployment security

**Attack Surface:**
- Secrets in version control (.env files with credentials)
- NPM_TOKEN exposure in publish workflows
- DEPLOYER_PRIVATE_KEY in quarterly update workflow
- Kubeconfig base64-decoded in workflow logs
- Unverified nargo/bb binary downloads
- No image signing or SBOM attestation

**Key Files:**
- `.github/workflows/publish-*.yml` - NPM publishing
- `.github/workflows/shadow-atlas-quarterly.yml` - Quarterly updates
- `.github/workflows/shadow-atlas-cd.yml` - Container deployment
- `packages/shadow-atlas/.env` - EXPOSED CREDENTIALS
- `deploy/scripts/deploy.sh` - Deployment automation

**Critical Finding:**
```
# packages/shadow-atlas/.env - REAL CREDENTIALS IN REPO
RDH_USERNAME=ejmockler
RDH_PASSWORD=!Mocklee1337
```

**Immediate Actions Required:**
1. Remove .env from git history
2. Rotate RDH credentials
3. Rotate testnet private keys
4. Add pre-commit secret scanning

---

### Domain 4: Infrastructure & Kubernetes

**Scope:** Container security, RBAC, network policies, ingress

**Attack Surface:**
- `imagePullPolicy: IfNotPresent` bypasses registry auth
- `latest` image tag (deployment drift)
- CORS `*` on ingress (CSRF attacks)
- No RBAC ClusterRole restrictions
- No Pod Security Standards enforced
- Persistent volumes unencrypted
- Manual blue-green traffic switch (human error)

**Key Files:**
- `deploy/k8s/deployment.yaml` - Main deployment
- `deploy/k8s/ingress.yaml` - Ingress configuration
- `deploy/k8s/service.yaml` - Service definition
- `deploy/docker-compose.yml` - Local development

**Critical Misconfigurations:**
```yaml
# ingress.yaml - Allows ANY origin
nginx.ingress.kubernetes.io/cors-allow-origin: "*"

# deployment.yaml - Uses mutable tag
image: ghcr.io/voter-protocol/shadow-atlas:latest
imagePullPolicy: IfNotPresent
```

---

### Domain 5: Data Integrity (Shadow Atlas)

**Scope:** TIGER/Census ingestion, merkle trees, caching, geographic data

**Attack Surface:**
- TIGER checksum verification empty (no integrity check)
- No cryptographic signatures on Census downloads
- Merkle leaf injection via corrupted SQLite
- Cache poisoning via malformed JSON
- IPFS snapshot swap without on-chain verification
- Boundary geometry manipulation (digital gerrymandering)
- DNS/TLS interception on data fetches

**Key Files:**
- `packages/shadow-atlas/src/acquisition/tiger-ingestion-orchestrator.ts`
- `packages/shadow-atlas/src/core/global-merkle-tree.ts`
- `packages/shadow-atlas/src/serving/performance/cache-utils.ts`
- `packages/shadow-atlas/src/security/input-validator.ts`

**Known Mitigations:**
- SA-009: URL allowlist for SSRF prevention
- SA-014: Zod schema validation on JSON parsing
- SA-018: strictMode=true for TIGER downloads
- Domain separation in merkle leaf hashing

**Gaps:**
- No leaf set commitment (injection possible)
- No row-level HMAC on stored geometries
- Phase 2: On-chain root verification not implemented

---

### Domain 6: Authentication & Identity

**Scope:** OAuth flows, session management, identity verification, Sybil resistance

**Attack Surface:**
- OAuth state replay within 10-minute window
- Facebook access_token in URL query string
- Synthetic email generation for Twitter (lower trust_score)
- Session reset on deploy (in-memory rate limits)
- Account merging on identity verification (race condition)
- Credential expiration edge cases (6-month TTL)
- Re-registration Sybil (same person, new userSecret → new nullifier)
- Identity provider attestation forgery

**Key Files:**
- `communique/src/lib/server/oauth-providers.ts`
- `communique/src/routes/api/identity/verify/+server.ts`
- `communique/src/hooks.server.ts` - Rate limiting
- `communique/src/lib/session-credentials.ts`

**Known Mitigations:**
- PKCE on Google, LinkedIn, Coinbase
- HMAC-SHA256 webhook signature verification (Didit)
- Identity hash = SHA-256(passport + nationality + birthYear + salt)
- Transaction-based duplicate detection
- BA-010: CSRF origin checking
- DECIDED: self.xyz/didit mandatory for CWC path
- DECIDED: identityCommitment (from verification provider) anchors nullifier
- DECIDED: Shadow Atlas verifies attestation signature at registration

---

### Domain 7: Privacy & Anonymity

**Scope:** Anonymity sets, timing attacks, metadata leakage, coercion resistance

**Attack Surface:**
- Small anonymity sets (5 people with authority_level=4 in rural district)
- Timing correlation (proof submission + public action)
- IP address correlation (server logs + blockchain)
- Browser fingerprinting on Communique
- Proof artifacts as vote receipts (coercion)
- Cross-action nullifier linkability

**Privacy Model:**
```
Public outputs per proof (29 fields):
- user_root (Tree 1 root — identity commitment)
- cell_map_root (Tree 2 root — geographic commitment)
- districts[24] (24 district IDs for the cell)
- nullifier (identity-bound via H2(identityCommitment, actionDomain))
- action_domain (action identifier)
- authority_level (1-5, bound to leaf hash — reduces anonymity)

Anonymity set = |users in district with same authority_level|
Note: authority_level now cryptographically committed (not self-claimed)
```

**Documented in:** `SECURITY.md` - Privacy Guarantees & Limitations

---

### Domain 8: Game Theory & Economics

**Scope:** Sybil attacks, collusion, bribery, griefing, incentive alignment

**Attack Surface:**
- Multiple OAuth identities (5 providers × 1 account = 5 votes)
- Identity marketplace (buy/sell verified accounts)
- Voter + operator collusion (include attacker in multiple districts)
- Governance + attacker collusion (whitelist malicious actionDomains)
- Nullifier space exhaustion (block legitimate users)
- Gas price manipulation during voting windows
- Vote selling via nullifier + proof transfer

**Cross-Provider Dedup (ISSUE-001):**
- Design spec: `specs/DESIGN-001-CROSS-PROVIDER-DEDUP.md`
- Solution: self.xyz/didit mandatory for CWC. identityCommitment derived from verification credential anchors nullifier — cryptographic Sybil resistance.
- Status: DECIDED — identity verification mandatory, nullifier = H2(identityCommitment, actionDomain)

**Challenge Market Attack Vectors (Phase E3):**
- Front-running: Challenger sees valid root tx in mempool, submits identical root first
- Sybil challenge swarms: 1000 micro-challenges exhaust defender bond capacity
- Time-based attacks: Submit challenge at end of period when defender cannot respond
- Whale attacks: Large bondholder dominates challenge market, censors via economic power
- Political weaponization: Challenge as censorship tool against legitimate civic content
- Speculation dominance: Trading volume eclipses civic utility (>10x ratio triggers circuit breaker)
- AI consensus gaming: Train models to predict and exploit jury voting patterns

Full attack surface documented in [CHALLENGE-MARKET-ARCHITECTURE.md](../docs/CHALLENGE-MARKET-ARCHITECTURE.md) Section 13.

---

### Domain 9: Client-Side Security

**Scope:** Browser, WASM, wallet integration, phishing

**Attack Surface:**
- Malicious browser extension steals userSecret
- Clipboard attacks on proof/secret copy
- userSecret in WASM memory (extractable?)
- EIP-712 signature phishing
- Blind signing (user doesn't understand payload)
- Nonce manipulation for replay attacks

**Key Files:**
- `communique/src/lib/proof-generation.ts`
- `packages/noir-prover/src/prover.ts`
- `packages/noir-prover/src/hash.worker.ts`

**Memory Model:**
- WASM memory only grows (cannot shrink)
- Worker termination required to reclaim
- Singleton pattern prevents repeated init

---

### Domain 10: Supply Chain

**Scope:** Dependencies, compilers, build tools

**Attack Surface:**
- `@noir-lang/noir_js` v1.0.0-beta.16 (pre-release)
- `@aztec/bb.js` v2.1.8 (Barretenberg bindings)
- nargo compiler (unverified download)
- bb CLI tool (unverified download)
- npm audit allows failures in CI
- No dependency pinning (^/~ versions)

**Critical Dependencies:**
```json
"@aztec/bb.js": "^2.1.8",
"@noir-lang/noir_js": "^1.0.0-beta.16",
"circomlibjs": "^0.1.7"  // WARNING: Do not use - different Poseidon
```

**Supply Chain Hardening:**
1. Pin exact versions
2. Verify checksums on nargo/bb downloads
3. Generate and store SBOMs
4. Block CI on npm audit failures

---

### Domain 11: Temporal & Race Conditions

**Scope:** Redistricting, root expiration, timelock edges

**Attack Surface:**
- Redistricting window (old + new roots both valid = double voting?)
- Root expiration edge (submit proof at exact expiry timestamp)
- Timelock completion race (execute governance at exact block)
- Stale merkle paths (tree updated after path generated)
- Pre-generated proofs with old roots

**Redistricting Protocol:**
- Design spec: `specs/DESIGN-003-REDISTRICTING-PROTOCOL.md`
- Solution: PACER monitoring + 30-day dual validity
- Status: Design phase

---

### Domain 12: Regulatory & Compliance

**Scope:** Election law, privacy regulations, accessibility, audit trails

**Attack Surface:**
- Voter intimidation (is proof submission observable?)
- Equal access (accessibility for disabled voters)
- Audit requirements (sufficient trail for officials?)
- GDPR right to erasure (can user delete nullifiers?)
- Data retention policies
- Cross-border data flows (EU user data on US servers)

**Current State:**
- No PII stored on User table (privacy-preserving)
- District data stored as hash only
- Identity fingerprint in logs (first 16 chars)
- 6-month credential expiration

---

## Part II: Adversarial Agent Roster

### Agent 1: ZK Cryptanalyst

**Background:**
PhD in cryptography with specialization in zero-knowledge proof systems. Published papers on soundness attacks against SNARKs. Deep knowledge of Poseidon hash function internals, field arithmetic, and circuit constraint systems.

**Expertise:**
- Proof system soundness (Groth16, PLONK, UltraHonk)
- Hash function cryptanalysis
- Algebraic attacks on field arithmetic
- Circuit constraint satisfaction
- Side-channel analysis

**Attack Mandate:**
1. Find inputs that satisfy circuit constraints without valid membership
2. Discover hash collision paths across arity boundaries
3. Predict nullifiers without knowing userSecret
4. Extract private witnesses from proofs
5. Identify timing/power side channels in WASM execution

**Success Criteria:**
- Forge a valid proof for non-member
- Demonstrate hash collision in Poseidon2
- Predict nullifier from public information
- Link two proofs to same user across actionDomains

**Incentive Frame:**
> "The mathematics must be broken. Every proof system has assumptions - find where they fail. The protocol claims soundness - prove it wrong."

---

### Agent 2: Smart Contract Auditor

**Background:**
Senior smart contract security researcher with 50+ audit reports. Discovered vulnerabilities in major DeFi protocols. Expert in Solidity patterns, EVM internals, and MEV extraction.

**Expertise:**
- Reentrancy and state manipulation
- Access control bypass
- Governance attacks
- Flash loan vectors
- Front-running and sandwich attacks
- Gas griefing

**Attack Mandate:**
1. Capture governance without community detection
2. Bypass timelocks on critical operations
3. Inject malicious verifier that accepts invalid proofs
4. Front-run proof submissions for profit
5. Grief the system to make it unusable

**Success Criteria:**
- Execute governance transfer with < 7 days notice
- Deploy verifier that accepts arbitrary proofs
- Extract MEV from proof submissions
- DoS the verification system

**Incentive Frame:**
> "Governance is a single point of failure. The timelocks are theater. Find the path to total protocol control."

---

### Agent 3: DevSecOps Attacker

**Background:**
Offensive security engineer specializing in CI/CD pipeline attacks. Red team experience at major tech companies. Expert in secrets extraction, supply chain compromise, and container escape.

**Expertise:**
- GitHub Actions exploitation
- Secrets scanning and extraction
- Container image tampering
- Supply chain injection
- Kubernetes privilege escalation

**Attack Mandate:**
1. Extract all secrets from CI/CD pipelines
2. Inject malicious code into published packages
3. Tamper with container images post-build
4. Compromise deployment credentials
5. Establish persistence in infrastructure

**Success Criteria:**
- Obtain DEPLOYER_PRIVATE_KEY
- Publish malicious npm package version
- Modify deployed container without detection
- Access production Kubernetes cluster

**Incentive Frame:**
> "The build pipeline is the softest target. Developers trust their tools. Compromise the build, compromise everything downstream."

---

### Agent 4: Nation-State Actor

**Background:**
State-sponsored threat actor with resources for infrastructure attacks. Capable of BGP hijacking, DNS poisoning, and TLS interception. Goal: undermine democratic infrastructure.

**Expertise:**
- BGP route manipulation
- DNS cache poisoning
- Certificate authority compromise
- MITM on TLS connections
- Long-term persistence

**Attack Mandate:**
1. Intercept TIGER/Census data downloads
2. Poison district boundary data at source
3. Manipulate RPC responses from blockchain nodes
4. Compromise IPFS gateways serving snapshots
5. Deanonymize voters through traffic analysis

**Success Criteria:**
- Serve modified TIGER data to shadow-atlas
- Inject false district boundaries
- Cause verifier to accept invalid proofs via RPC manipulation
- Identify voters by correlating network traffic

**Incentive Frame:**
> "Democratic systems depend on trust in data sources. Corrupt the data, corrupt the democracy. The Census Bureau trusts TLS - we don't."

---

### Agent 5: Privacy Researcher

**Background:**
Academic researcher specializing in privacy-preserving systems. Published on deanonymization attacks against Tor, Zcash, and voting systems. Expert in traffic analysis and metadata exploitation.

**Expertise:**
- Anonymity set analysis
- Timing attacks
- Traffic correlation
- Metadata extraction
- Fingerprinting techniques

**Attack Mandate:**
1. Reduce anonymity sets to identify individuals
2. Correlate proof submissions with real identities
3. Link multiple proofs to same user
4. Extract district membership from timing patterns
5. Build voter profiles from public outputs

**Success Criteria:**
- Identify specific voter from proof submission
- Link proofs across different actionDomains
- Determine voting patterns for targeted individuals
- Map complete voter graph for a district

**Incentive Frame:**
> "Privacy is an illusion. Every system leaks information. The question is not if voters can be identified, but how many data points it takes."

---

### Agent 6: Game Theorist

**Background:**
Economist specializing in mechanism design and adversarial game theory. Advised on tokenomics for major protocols. Expert in finding dominant strategies that break intended equilibria.

**Expertise:**
- Mechanism design flaws
- Sybil attack economics
- Collusion modeling
- Griefing cost analysis
- Incentive misalignment

**Attack Mandate:**
1. Design profitable Sybil attack strategy
2. Model collusion between voters and operators
3. Calculate griefing cost/benefit ratios
4. Find vote buying/selling mechanisms
5. Identify incentive misalignments in governance

**Success Criteria:**
- Demonstrate Sybil attack with positive ROI
- Design undetectable collusion scheme
- Prove griefing is economically rational
- Create vote market that evades detection

**Incentive Frame:**
> "Every system has a dominant strategy. Find the one that breaks the game. If voting costs more to defend than to attack, the system fails."

---

### Agent 7: Data Integrity Auditor

**Background:**
Geographic information systems security specialist. Experience with election systems and Census data. Expert in merkle tree attacks and spatial data manipulation.

**Expertise:**
- GIS security
- Merkle tree manipulation
- Cache poisoning
- Data provenance verification
- Spatial data integrity

**Attack Mandate:**
1. Inject malicious leaves into merkle tree
2. Manipulate district boundaries post-ingestion
3. Poison filesystem and query caches
4. Corrupt IPFS snapshots
5. Bypass checksum verification

**Success Criteria:**
- Add unauthorized voter to district tree
- Shift district boundary to include/exclude addresses
- Serve poisoned cache entries
- Replace valid snapshot with malicious version

**Incentive Frame:**
> "The merkle tree is only as trustworthy as its leaves. Control the data source, control the tree. Control the tree, control who can vote where."

---

### Agent 8: Client Exploit Developer

**Background:**
Browser security researcher and exploit developer. Experience with Chrome/Firefox 0-days. Expert in WASM security, extension attacks, and wallet exploitation.

**Expertise:**
- Browser exploitation
- WASM memory attacks
- Extension malware
- Wallet draining
- Phishing campaigns

**Attack Mandate:**
1. Extract userSecret from WASM memory
2. Create malicious extension that steals proofs
3. Phish EIP-712 signatures for unauthorized actions
4. Intercept proof generation to steal credentials
5. Clone legitimate UI to capture secrets

**Success Criteria:**
- Dump userSecret from running prover
- Steal proof and replay for attacker benefit
- Obtain valid EIP-712 signature for malicious action
- Capture session credentials via phishing

**Incentive Frame:**
> "The browser is hostile territory. Users trust what they see. Own the client, own the user. Their secrets are one extension away."

---

### Agent 9: Kubernetes Security Engineer

**Background:**
Cloud security architect with offensive Kubernetes experience. Certified Kubernetes Security Specialist. Expert in container escape, RBAC bypass, and cluster compromise.

**Expertise:**
- Container escape techniques
- RBAC privilege escalation
- Service account exploitation
- Network policy bypass
- Secret theft from etcd

**Attack Mandate:**
1. Escape from shadow-atlas container
2. Access secrets from other namespaces
3. Modify running deployments
4. Intercept service-to-service traffic
5. Persist access across cluster upgrades

**Success Criteria:**
- Execute commands on host node
- Read secrets from production namespace
- Modify deployment without triggering alerts
- Establish C2 channel from within cluster

**Incentive Frame:**
> "Kubernetes security is configuration. Misconfigurations are everywhere. One pod escape, one lateral move, one secret - that's all it takes."

---

### Agent 10: Regulatory Compliance Auditor

**Background:**
Election law attorney with cybersecurity background. Advised state election commissions on voting system certification. Expert in VVSG, GDPR, and accessibility requirements.

**Expertise:**
- Election law compliance
- Privacy regulation (GDPR, CCPA)
- Accessibility standards (WCAG)
- Audit trail requirements
- Certification processes

**Attack Mandate:**
1. Identify election law violations
2. Find GDPR non-compliance issues
3. Assess accessibility barriers
4. Evaluate audit trail completeness
5. Determine certification blockers

**Success Criteria:**
- Document legal liability exposure
- Identify regulatory violations with penalties
- Find accessibility failures blocking deployment
- List certification requirements not met

**Incentive Frame:**
> "Technology doesn't matter if it's illegal to deploy. Every voting system faces regulatory scrutiny. Find the legal landmines before they explode."

---

## Part III: Deployment Protocol

### Pre-Attack Checklist

1. **Scope Confirmation**
   - [ ] Target repositories identified (voter-protocol, shadow-atlas, communique)
   - [ ] Attack domains assigned to agents
   - [ ] Success criteria defined
   - [ ] Out-of-scope areas documented

2. **Context Injection**
   - [ ] Provide exploration findings to each agent
   - [ ] Include relevant file paths and line numbers
   - [ ] Reference known mitigations
   - [ ] Highlight gaps and weaknesses

3. **Coordination**
   - [ ] Assign non-overlapping attack domains
   - [ ] Define escalation paths for critical findings
   - [ ] Set time limits per agent
   - [ ] Plan synthesis and deduplication

### Attack Execution

```
Phase 1: Discovery (30 min per agent)
├── Read assigned files
├── Map attack surface
├── Identify entry points
└── Document assumptions

Phase 2: Exploitation (60 min per agent)
├── Develop attack vectors
├── Test hypotheses against code
├── Document evidence (file:line)
└── Assess exploitability

Phase 3: Reporting (15 min per agent)
├── Severity classification
├── Proof of concept (if applicable)
├── Remediation recommendations
└── Residual risk assessment
```

### Post-Attack Synthesis

1. **Deduplication** - Merge overlapping findings
2. **Severity Calibration** - Normalize across agents
3. **False Positive Review** - Verify against actual code
4. **Remediation Planning** - Prioritize fixes
5. **Documentation** - Update this document with findings

---

## Part IV: Attack History

### Wave 1: Initial Remediation (2026-02-01)

**Agents Deployed:** 6 (ZK, Contract, Code Quality, Shadow Atlas, Integration, Communique)

**Critical Findings Confirmed:**
- HIGH-001: isValidRoot() never called (SA-004 non-functional) → **FIXED**
- MEDIUM-002: fixtures.ts hash mismatch (domain tag missing) → **FIXED**

**False Positives Identified:**
- Legacy DistrictGate issues (V1, not current V2)
- Noir version mismatch (compatible versions)

### Wave 2: Deep Exploration (2026-02-01)

**Agents Deployed:** 5 exploration agents

**New Findings:**
- CRITICAL: RDH credentials in .env
- CRITICAL: NullifierRegistry no timelock on governance transfer — **RESOLVED** (NullifierRegistry now inherits TimelockGovernance; `NullifierRegistry.sol:33`)
- HIGH: Kubernetes CORS *, imagePullPolicy IfNotPresent
- HIGH: NPM_TOKEN/DEPLOYER_PRIVATE_KEY in workflows
- MEDIUM: Facebook OAuth token in URL

**Status:** Documented; NullifierRegistry timelock resolved, remainder pending remediation

### Wave 3: Brutalist Round 3 — Two-Tree Architecture (2026-02-04)

**Agents Deployed:** 15 AI critics across 5 domains (architecture, crypto, contracts, prover, shadow-atlas)

**Confirmed Findings (10 valid, 9 rejected):**
- CRITICAL: BR3-001 front-running / proof theft (no EIP-712 on two-tree path)
- HIGH: BR3-002 single-tree prover silently substitutes public inputs
- HIGH: BR3-003 toHex() lacks BN254 modulus validation

**Status:** ALL 10 RESOLVED (2026-02-05)

### Wave 4: Coordination Integrity Review (2026-02-08)

**Agents Deployed:** Cross-repository data-flow analysis

**Confirmed Findings (7):**
- CRITICAL: CI-002 blockchain submission mocked
- HIGH: CI-001 proof-message content unbound
- HIGH: CI-003 mailto: bypasses proof requirements

**Status:** ALL IMPLEMENTED or DOCUMENTED

### Wave 5: Multi-Persona Security Assessment (2026-02-10)

**Agents Deployed:** 4 parallel brutalist instances with 7 critic agents (3 Claude, 3 Codex, 1 Gemini)

**Methodology:** Each instance was imbued with a distinct attacker persona:
1. **The Cryptanalyst** — PhD-level cryptographer (voter-protocol/packages/crypto)
2. **The Infrastructure Hacker** — Pentester with botnet (voter-protocol/packages/shadow-atlas)
3. **The Client-Side Predator** — Browser exploit specialist (communique)
4. **The Protocol Analyst** — Integration seam exploiter (cross-repo boundary)

**Critical Findings:**
- CRITICAL: BR5-001 authority_level not bound to leaf hash — any user can self-elevate to level 5
- CRITICAL: BR5-002 server-side proof non-verification — submissions accepted without ZK verification
- HIGH: BR5-003 skipCredentialCheck creates mock credentials in production UI
- HIGH: BR5-004 hash4/hash3 domain separation collision (broader than BR3-X09)
- HIGH: BR5-005 registration timing oracle defeats CR-006 error-parity fix
- HIGH: BR5-006 TwoTreeNoirProver.verifyProof doesn't check expected public inputs
- HIGH: BR5-007 registration state non-persistent (restart enables duplicate insertion)
- HIGH: BR5-008 npm package names unclaimed (supply chain name-squatting)

**Verified Secure:**
- Hash parity (H2/H3 TS↔Noir): IDENTICAL — golden vectors match
- BN254 modulus consistency: IDENTICAL across all declaration sites
- Nullifier formula (CVE-002): FIXED everywhere
- Registration mutex: SOUND (Promise-chain serialization)
- CR-006 anti-oracle (error codes): FIXED (identical 400 + same message)

**Triage:** 20 new findings confirmed, 7 cross-referenced to existing tracking, 5 false positives rejected
**Status:** TRIAGED — Remediation pending. Tracked in IMPLEMENTATION-GAP-ANALYSIS.md § "Brutalist Audit Round 5"

**Post-Assessment Architectural Decisions (2026-02-10):**
- **Nullifier Sybil vulnerability identified**: H2(userSecret, actionDomain) allows double-registration. DECIDED: H2(identityCommitment, actionDomain).
- **Authority level bound to leaf**: H4(secret, cellId, salt, authorityLevel) with DOMAIN_HASH4. Resolves BR5-001 + BR5-004.
- **Identity verification mandatory**: self.xyz/didit required for CWC path. Attestation verified by Shadow Atlas.
- **No MVP mode**: mvpAddress bypass, skipCredentialCheck, mock verification all marked for removal.
- **IPFS log replay**: Storacha (free 5GB, Filecoin-backed) primary + Lighthouse Beacon ($20 perpetual) backup.

### Wave 6: Verifiable Solo Operator Review (2026-02-15) — Cycle 10

**Agents Deployed:** Inter-wave engineering review of Wave 39-41 (Verifiable Solo Operator model)

**Scope:** Hash-chained insertion log, Ed25519 server signing, attestation binding, signed registration receipts

**Findings (12 total):**
- 0 P0 (Critical)
- 4 P1 (High) — ALL FIXED:
  - W40-002: Replace operation missing attestationHash forwarding
  - W40-004: Ephemeral signing key allowed in production (fail-closed guardrail added)
  - W40-005: Signature verification used engine-specific key ordering (explicit ordering)
  - W40-009: Missing rate limiting on GET /v1/signing-key endpoint
- 5 P2 (Medium) — Addressed:
  - W40-003: Rate limiter token-bucket refactored
  - Insertion log v2 backward compatibility verified
  - Registration receipt format standardized
  - CORS production guardrail strengthened
  - Error response parity for registration endpoints
- 3 P3 (Low) — Documented

**Key Implementation:**
- `packages/shadow-atlas/src/serving/signing.ts` — 170-line Ed25519 ServerSigner
- `packages/shadow-atlas/src/serving/insertion-log.ts` — v2 format (prevHash, sig, attestationHash)
- `packages/shadow-atlas/src/serving/api.ts` — Receipt generation, GET /v1/signing-key

**Status:** ALL P1s RESOLVED. See `docs/architecture/VERIFIABLE-SOLO-OPERATOR.md` for architecture documentation.

---

## Appendix A: Quick Reference

### File → Domain Mapping

| File Pattern | Domain |
|--------------|--------|
| `contracts/src/*.sol` | Smart Contract Security |
| `packages/crypto/noir/**` | Cryptographic Foundations |
| `packages/crypto/src/poseidon2.ts` | Cryptographic Foundations |
| `packages/noir-prover/**` | Client-Side Security |
| `packages/shadow-atlas/src/acquisition/**` | Data Integrity |
| `packages/shadow-atlas/src/core/**` | Data Integrity |
| `packages/shadow-atlas/src/security/**` | Data Integrity |
| `communique/src/routes/api/**` | Authentication & Identity |
| `communique/src/lib/server/**` | Authentication & Identity |
| `.github/workflows/**` | DevSecOps & CI/CD |
| `deploy/**` | Infrastructure & Kubernetes |

### Severity Definitions

| Level | Definition | Response Time |
|-------|------------|---------------|
| 🔴 CRITICAL | Immediate exploitation possible, severe impact | < 24 hours |
| 🟠 HIGH | Exploitation requires effort, significant impact | < 1 week |
| 🟡 MEDIUM | Limited exploitation, moderate impact | < 1 month |
| 🟢 LOW | Theoretical risk, minimal impact | Next release |

---

**Document Version:** 1.3
**Last Updated:** 2026-02-16
**Maintainer:** Distinguished Engineering Review
