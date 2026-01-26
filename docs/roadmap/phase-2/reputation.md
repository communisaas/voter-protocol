# Reputation System Specification

> **⚠️ PHASE 2 SPECIFICATION - NOT IMPLEMENTED ⚠️**
>
> This describes the **future reputation system** that requires the VOTER token (not yet launched). The current implementation has only client-side interfaces. This is Phase 2 architecture requiring token deployment and smart contract implementation.

**Phase 1 (3 months)**: Reputation-only signals (template adoption, bill tracking, professional credentials, civic velocity, peer endorsements).

**Phase 2 (12-18 months)**: Challenge markets + impact verification add economic validation and legislative outcome tracking.

---

**Status**: Phase 1 (reputation-only), Phase 2 (challenge markets + impact verification)
**Implementation Status**: Phase 2 (Minimal Implementation - Client Interface Only)

**Implementation Progress:**
- ✅ Client contract interface (ERC-8004 ABI definitions)
- ✅ TypeScript types for reputation scores and tiers
- ❌ Smart contract deployment
- ❌ On-chain reputation tracking
- ❌ Professional credential verification
- ❌ Template adoption counters
- ❌ Bill tracking registry
- ❌ Peer endorsement system
- ❌ Challenge markets (Phase 2 feature)
- ❌ Impact verification (Phase 2 feature)

**Note:** Only the client-side interface exists in `/packages/client/src/contracts/reputation-registry.ts`. No backend implementation, smart contracts, or actual reputation tracking is deployed.
**Standard**: ERC-8004 (three-registry system: identity, reputation, validation)
**Research Basis**: McDonald 2018 congressional staffer needs, Gitcoin quadratic funding
**Last Updated**: December 2025
**Principle**: **Concrete, verifiable signals only. No abstract AI-determined quality scores.**

---

## Executive Summary: First Principles

### The Problem

Decision-makers (congressional staffers, state legislators, corporate boards, journalists, nonprofit leaders) need domain expertise signals to filter civic input. They don't need generic "trust scores" or abstract "quality scores" determined by agents.

### McDonald 2018 Research

Congressional staffers value **concrete behaviors**:
- Professional credentials (nurses on healthcare, teachers on education)
- Bill tracking patterns (which legislation constituents follow)
- Niche expertise ("small surprising things like bills they may have missed")
- **NOT**: Grammar scores, readability grades, AI-determined "quality"

### First Principles Reputation Signals

Phase 1 (Reputation-Only, No Token):
1. **Identity Verified**: NFC passport or government ID (binary: verified or not)
2. **Professional Credentials**: License number verified via state API (multiplier: 2.0x)
3. **Template Adoption**: How many people used your templates (crowd wisdom)
4. **Bill Tracking**: Legislative bills you actively follow (informed engagement)
5. **Peer Endorsements**: On-chain attestations from verified users (community vouching)
6. **Civic Velocity**: Active months with at least 1 send (consistency signal)

Phase 2 (Challenge Markets + Impact Verification):
7. **Challenge Accuracy**: Win rate in economic dispute resolution (cryptographic proof)
8. **Impact Verified**: Templates that provably influenced legislative outcomes (10x multiplier)

Phase 2+ (Congressional CMS Required):
9. **Citation Count**: Congressional Record citations (objective scraping)
10. **Response Correlation**: Office response rate (email tracking)

---

## Reputation Dimensions (Concrete, Verifiable Signals)

### Phase 1 Signals (No Token Dependencies, No CMS Dependencies)

**1. Template Adoption** (verifiable: on-chain template usage counters)
- How many people have used your templates
- How many unique congressional districts reached
- Average reputation of template adopters (aggregate only, privacy-preserving)

**2. Bill Tracking Depth** (verifiable: on-chain bill tracking registry)
- How many bills you actively track
- How long you've been tracking each bill
- How many templates you've created about tracked bills

**3. Professional Credentials** (verifiable: license numbers, employment APIs, peer attestations)
- Verified license number via state API (nurses, doctors, lawyers)
- Employment confirmation via Plaid Work / Truework API
- Peer endorsements from 3+ verified users in same role

**4. Civic Velocity** (verifiable: on-chain verified sends per time period)
- Verified sends per month (aggregate)
- Consistency of participation (active months / total months)
- No "quality" judgment - only frequency

**5. Peer Endorsements** (verifiable: on-chain ERC-8004 attestations)
- Cryptographic attestations from other verified users
- Endorsement count by domain
- Endorsement decay (expire after 12 months)

### Phase 2 Signals (Token Economics + Challenge Markets)

**6. Challenge Accuracy** (verifiable: on-chain challenge market results)
- **Win rate**: % of challenges won (cryptographic proof via multi-agent consensus)
- **Domain expertise multiplier**: Healthcare professional challenging healthcare claim gets 2x, climate scientist gets 3x
- **Staked reputation**: Losing challenges burns reputation in that domain (ERC-8004 attestations)
- **Gaming resistance**: Quadratic scaling prevents money from dominating facts (100 people at $10 each > 1 person at $1000)

**Challenge Market Mechanics** (ARCHITECTURE.md integration):
```solidity
// Domain expertise amplifies influence in challenges
function getStakeWeight(
    address challenger,
    bytes32 templateDomain
) public view returns (uint256) {
    uint256 baseStake = challengeStakes[challenger];
    uint256 expertiseScore = reputationRegistry.getExpertiseScore(challenger, templateDomain);

    // Healthcare nurse challenging healthcare template gets 2x multiplier
    // Climate scientist challenging climate template gets 3x multiplier
    uint256 multiplier = _getDomainMultiplier(expertiseScore);

    return (baseStake * multiplier) / 100;
}

// Losing challenges burns reputation
function _resolveChallenge(bytes32 challengeId, bool challengerWins) internal {
    Challenge storage c = challenges[challengeId];

    if (challengerWins) {
        reputationRegistry.updateChallengeRecord(c.challenger, true);
        // Winner receives quadratic-weighted stake
    } else {
        reputationRegistry.updateChallengeRecord(c.challenger, false);
        // Loser loses staked reputation in this domain
        reputationRegistry.burnDomainReputation(c.challenger, c.templateDomain, 10);
    }
}
```

**8. Impact Verified** (verifiable: Congressional Record correlation analysis)
- **Legislative outcomes**: Templates that provably influenced floor speeches, position changes, or votes
- **10x reward multiplier**: Verified impact triggers 10x token rewards (Phase 2)
- **Confidence scoring**: Direct citation (40%), temporal correlation (30%), geographic clustering (20%), alternative explanations (-10%)
- **Causal evidence**: ChromaDB vector search + GPT-5 reasoning + statistical significance testing

**Impact Verification Mechanics** (ARCHITECTURE.md integration):
```solidity
// Impact attestation triggers 10x multiplier
function verifyAndReward(bytes32 attestationId) external onlyRole(IMPACT_AGENT_ROLE) {
    ImpactAttestation storage attestation = attestations[attestationId];

    // Calculate reward multiplier based on confidence
    uint256 multiplier = _calculateRewardMultiplier(attestation.confidenceLevel);
    // High confidence (>80%): 10x multiplier
    // Medium confidence (50-80%): 5x multiplier
    // Low confidence (<50%): 2x multiplier

    // Creator gets 10x base multiplier for proven impact
    uint256 creatorReward = baseReward * adopters.length * multiplier * 10;
    voterToken.mint(attestation.templateCreator, creatorReward);

    // Update reputation registry with impact attestation
    reputationRegistry.addImpactAttestation(
        attestation.templateCreator,
        attestation.templateHash,
        attestation.scores.totalScore,
        attestation.evidenceIPFS
    );
}
```

### Phase 2+ Signals (Congressional CMS Required)

**7. Citation Count** (verifiable: Congressional Record scraping)
- Times congressional offices cited your input in floor speeches
- Citations in committee hearings
- Citations in press releases or legislation

**8. Response Correlation** (verifiable: congressional office email tracking)
- % of your messages that get office responses
- Average response time
- Response type (form letter vs personalized vs meeting request)

---

## Data Model: First Principles (Simplified)

### Core Principle: Minimal Viable Reputation

**What decision-makers actually need:**
1. **Is this person verified?** (identity verification)
2. **Do they have relevant credentials?** (professional licenses)
3. **Have others validated their work?** (template adoption, peer endorsements)
4. **Are they consistently engaged?** (civic velocity, bill tracking)
5. **Have they proven impact?** (challenge wins, legislative citations - Phase 2+)

### 1. Expertise Domain Registry (Simplified)

**Purpose**: Track domain expertise with **concrete, verifiable signals only**

**Communique Schema** (external repo: `prisma/schema.prisma`):
```prisma
model UserExpertise {
  id                     String   @id @default(cuid())
  user_id                String
  domain_id              String   // "healthcare", "climate", "housing"

  // Phase 1: Reputation-only signals
  templates_contributed  Int      @default(0)  // Templates created
  templates_adopted      Int      @default(0)  // Templates others used (crowd wisdom)
  bills_tracked          Int      @default(0)  // Bills followed (informed engagement)
  peer_endorsements      Int      @default(0)  // On-chain attestations
  verified_sends         Int      @default(0)  // Messages sent (aggregate)
  active_months          Int      @default(0)  // Consistency signal

  // Phase 2: Challenge market signals
  challenge_wins         Int      @default(0)  // Successful challenges
  challenge_losses       Int      @default(0)  // Failed challenges
  reputation_burned      Int      @default(0)  // Reputation lost in failed challenges

  // Phase 2: Impact verification signals
  impact_attestations    Int      @default(0)  // Verified legislative impact events
  impact_confidence_avg  Float?                 // Average confidence of impact attestations

  // Metadata
  first_activity         DateTime @default(now())
  last_activity          DateTime @updatedAt

  // Relations
  user                   User     @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@unique([user_id, domain_id])
  @@map("user_expertise")
}
```

**VOTER Protocol Contract** (`contracts/ReputationRegistry.sol`):
```solidity
// ERC-8004 Reputation Registry - First Principles (Concrete Signals Only)
struct ExpertiseDomain {
    bytes32 domain_id;              // keccak256("healthcare")

    // Phase 1: Reputation-only signals
    uint16 templates_contributed;   // Templates created
    uint16 templates_adopted;       // Templates others used (crowd wisdom)
    uint16 bills_tracked;           // Bills followed (informed engagement)
    uint16 peer_endorsements;       // On-chain attestations
    uint32 verified_sends;          // Messages sent (aggregate)
    uint16 active_months;           // Consistency signal

    // Phase 2: Challenge market signals
    uint16 challenge_wins;          // Successful challenges
    uint16 challenge_losses;        // Failed challenges
    uint16 reputation_burned;       // Reputation lost (permanent penalty)

    // Phase 2: Impact verification signals
    uint16 impact_attestations;     // Verified legislative impact events
    uint16 impact_confidence_avg;   // Average confidence (0-10000 basis points)

    // Metadata
    uint256 first_activity;
    uint256 last_activity;
}

mapping(address => mapping(bytes32 => ExpertiseDomain)) public userExpertise;

event ExpertiseUpdated(
    address indexed user,
    bytes32 indexed domain,
    uint16 templates_adopted,
    uint16 challenge_wins,
    uint16 impact_attestations,
    uint256 timestamp
);
```

**Reputation Calculation** (deterministic, no LLM calls):
```solidity
/**
 * @notice Calculate expertise score from concrete, verifiable signals
 * @dev First principles approach: template adoption (crowd wisdom),
 *      bill tracking (informed engagement), peer endorsements (community vouching),
 *      civic velocity (consistency), challenge wins (economic validation),
 *      impact attestations (proven outcomes)
 * @return Expertise score 0-100, multiplied by professional credential multiplier
 */
function calculateExpertiseScore(
    address user,
    bytes32 domain
) public view returns (uint256) {
    ExpertiseDomain memory expertise = userExpertise[user][domain];

    // Phase 1 signals (0-70 points)
    uint256 template_signal = min(expertise.templates_adopted * 5, 25);  // Max 25 (crowd wisdom)
    uint256 bill_signal = min(expertise.bills_tracked * 3, 10);          // Max 10 (informed engagement)
    uint256 endorsement_signal = min(expertise.peer_endorsements * 2, 15); // Max 15 (community vouching)
    uint256 velocity_signal = min(expertise.active_months * 2, 10);      // Max 10 (consistency)
    uint256 contribution_signal = min(expertise.templates_contributed * 2, 10); // Max 10 (creation)

    uint256 base_score = template_signal + bill_signal + endorsement_signal +
                         velocity_signal + contribution_signal;

    // Phase 2 signals (0-30 additional points)
    uint256 challenge_signal = 0;
    if (expertise.challenge_wins + expertise.challenge_losses > 0) {
        // Win rate bonus (max 15 points)
        uint256 win_rate = (expertise.challenge_wins * 100) /
                           (expertise.challenge_wins + expertise.challenge_losses);
        challenge_signal = (win_rate * 15) / 100;

        // Subtract burned reputation (permanent penalty)
        if (challenge_signal > expertise.reputation_burned) {
            challenge_signal -= expertise.reputation_burned;
        } else {
            challenge_signal = 0;
        }
    }

    uint256 impact_signal = min(expertise.impact_attestations * 5, 15); // Max 15 (proven outcomes)

    uint256 phase2_score = challenge_signal + impact_signal;

    // Combined score (0-100)
    uint256 total_score = min(base_score + phase2_score, 100);

    // Apply professional role multiplier (verified credentials: 2.0x, endorsed: 1.5x, self-attested: 1.0x)
    uint256 role_multiplier = _getRoleMultiplier(user, domain);

    return (total_score * role_multiplier) / 100; // Final score 0-200 (100 base * 2.0x max multiplier)
}

/**
 * @notice Update challenge record (Phase 2)
 * @dev Losing challenges burns reputation permanently in that domain
 */
function updateChallengeRecord(
    address user,
    bytes32 domain,
    bool won
) external onlyRole(CHALLENGE_RESOLVER_ROLE) {
    ExpertiseDomain storage expertise = userExpertise[user][domain];

    if (won) {
        expertise.challenge_wins++;
    } else {
        expertise.challenge_losses++;
        expertise.reputation_burned += 10; // Permanent -10 point penalty
    }

    expertise.last_activity = block.timestamp;

    emit ChallengeRecordUpdated(user, domain, won, block.timestamp);
}

/**
 * @notice Add impact attestation (Phase 2)
 * @dev Verified legislative impact triggers 10x reward multiplier
 */
function addImpactAttestation(
    address user,
    bytes32 domain,
    bytes32 templateHash,
    uint16 confidenceScore,
    string calldata evidenceIPFS
) external onlyRole(IMPACT_AGENT_ROLE) {
    ExpertiseDomain storage expertise = userExpertise[user][domain];

    expertise.impact_attestations++;

    // Update rolling average confidence
    if (expertise.impact_confidence_avg == 0) {
        expertise.impact_confidence_avg = confidenceScore;
    } else {
        expertise.impact_confidence_avg = uint16(
            (expertise.impact_confidence_avg + confidenceScore) / 2
        );
    }

    expertise.last_activity = block.timestamp;

    emit ImpactAttestationAdded(user, domain, templateHash, confidenceScore, evidenceIPFS, block.timestamp);
}
```

### 2. Professional Role Registry (Unchanged - Already Concrete)

**Purpose**: Verifiable expertise credentials (license numbers, employment confirmation)

**Attestation Tiers** (determines expertise multiplier):

| Tier | Weight | Verification Method | Example |
|------|--------|---------------------|---------|
| **Verified** | 2.0x | State API, license number, employment confirmation | Nursing board license #123456 via California API |
| **Endorsed** | 1.5x | 3+ verified users in same role attest | 3 verified nurses endorse user's nursing claim |
| **Self-Attested** | 1.0x | No verification | User claims to be a nurse (no multiplier) |

### 3. Bill Tracking Registry (Unchanged - Already Concrete)

**Purpose**: Verifiable legislative engagement

**Communique Schema**:
```prisma
model BillTracking {
  id                     String   @id @default(cuid())
  user_id                String
  bill_id                String

  // Concrete engagement signals
  tracked_since          DateTime @default(now())
  templates_created      Int      @default(0) // Templates about this bill
  messages_sent          Int      @default(0) // Messages about this bill (aggregate)

  // Relations
  user                   User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  bill                   Bill     @relation(fields: [bill_id], references: [id])

  @@unique([user_id, bill_id])
  @@map("bill_tracking")
}
```

### 4. User Reputation (Revised - No Quality Scores)

**Communique Schema** (replaces current User model fields):
```prisma
model User {
  id                     String   @id @default(cuid())
  email                  String   @unique
  name                   String?

  // Verification (replaces trust_score)
  verification_method    String?              // 'nfc-passport' | 'government-id'
  verification_tier      String               @default("verified") // 'verified' | 'endorsed' | 'cited'
  verified_at            DateTime?

  // CONCRETE SIGNALS (no abstract quality scores)
  templates_contributed  Int                  @default(0)  // Count
  template_adoption_rate Float                @default(0.0) // % of templates others used
  peer_endorsements      Int                  @default(0)   // On-chain attestations
  verified_sends         Int                  @default(0)   // Total (aggregate)
  active_months          Int                  @default(0)   // Engagement velocity

  // Phase 2 fields (token economics)
  token_stake            Float?               // VOTER tokens staked
  challenge_wins         Int                  @default(0)
  challenge_losses       Int                  @default(0)

  // Phase 2+ fields (CMS dependency)
  response_correlation   Float?               // % of messages with office responses
  citation_count         Int                  @default(0)   // Congressional citations

  // Relations
  expertise              UserExpertise[]
  bills_tracked          BillTracking[]
  professional_roles     UserProfessionalRole[]

  createdAt              DateTime             @default(now()) @map("created_at")
  updatedAt              DateTime             @updatedAt @map("updated_at")
}
```

**VOTER Protocol Contract**:
```solidity
// ERC-8004 Reputation Registry (NO QUALITY SCORES)
struct UserReputation {
    // Verification tier
    uint8 verification_tier;        // 0=verified, 1=endorsed, 2=cited
    uint256 verified_at;

    // CONCRETE SIGNALS ONLY
    uint16 templates_contributed;
    uint16 template_adoption_rate;  // 0-10000 (basis points)
    uint16 peer_endorsements;
    uint32 verified_sends;
    uint16 active_months;

    // Phase 2 fields
    uint256 token_stake;
    uint16 challenge_wins;
    uint16 challenge_losses;

    // Phase 2+ fields (CMS)
    uint16 response_correlation;    // 0-10000 (basis points)
    uint16 citation_count;
}

mapping(address => UserReputation) public userReputations;

event ReputationUpdated(
    address indexed user,
    uint16 templates_contributed,
    uint16 template_adoption_rate,
    uint16 peer_endorsements,
    uint256 timestamp
);
```

### 5. Template Reputation (Revised - No Quality Scores)

**Purpose**: Aggregate adoption signals without individual tracking

**Communique Schema** (updated Template model):
```prisma
model Template {
  id                     String   @id @default(cuid())
  title                  String

  // AGGREGATE USAGE (privacy-preserving, NO individual tracking)
  verified_sends         Int      @default(0) @map("verified_sends")
  unique_districts       Int      @default(0) @map("unique_districts")
  avg_reputation         Float?   @map("avg_reputation") // Average adopter reputation

  // MODERATION SIGNALS (safety only, not quality)
  flagged_by_moderation  Boolean  @default(false)   // OpenAI API flagged
  consensus_approved     Boolean  @default(false)   // Multi-agent approved (binary)

  // CONGRESSIONAL DASHBOARD SIGNALS (what McDonald 2018 says they need)
  policy_areas           String[] @default([])      // ["healthcare", "climate"]
  related_bills          String[] @default([])      // ["H.R. 1234", "S. 567"]

  // Aggregate pools (expertise distribution)
  expertise_breakdown    Json?    // { professional: 15, industry: 8, community: 12 }
  verification_breakdown Json?    // { nfc_passport: 10, government_id: 5 }
  reputation_distribution Json?   // { verified: 8, endorsed: 5, cited: 2 }

  // Phase 2+ fields (CMS dependency)
  office_response_rate   Float?   // % of offices that responded
  citation_rate          Float?   // % of offices that cited content

  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")
}
```

**VOTER Protocol Contract**:
```solidity
struct TemplateReputation {
    // Aggregate usage (privacy-preserving)
    uint32 verified_sends;
    uint16 unique_districts;
    uint16 avg_reputation;          // 0-10000 (basis points)

    // MODERATION SIGNALS (safety only, not quality)
    bool flagged_by_moderation;
    bool consensus_approved;

    // CONGRESSIONAL DASHBOARD SIGNALS (McDonald 2018 research)
    bytes32[] policy_areas;         // ["healthcare", "climate"] as hashes
    bytes32[] related_bills;        // ["H.R. 1234", "S. 567"] as hashes

    // Aggregate pools (expertise distribution)
    uint16 professional_senders;    // Verified professionals (nurses, teachers)
    uint16 industry_senders;        // Work in affected sector
    uint16 community_senders;       // Impacted residents

    // Phase 2+ fields (CMS dependency)
    uint16 office_response_rate;    // 0-10000 (basis points)
    uint16 citation_rate;           // 0-10000 (basis points)
}

mapping(bytes32 => TemplateReputation) public templateReputations;

event TemplateReputationUpdated(
    bytes32 indexed template_id,
    uint32 verified_sends,
    bool consensus_approved,
    uint256 timestamp
);
```

---

## Agent Architecture Integration (Revised)

### ReputationAgent Implementation (DETERMINISTIC - NO LLM QUALITY SCORING)

**Purpose**: Update reputation based on **concrete, verifiable behaviors**

**LangGraph Workflow** (no LLM calls for scoring):
```python
from langgraph.graph import StateGraph
from typing import TypedDict

class ReputationState(TypedDict):
    user_address: str
    domain: str
    # CONCRETE SIGNALS ONLY
    templates_contributed: int
    templates_adopted: int
    bills_tracked: int
    peer_endorsements: int
    verified_sends: int
    active_months: int
    professional_role: str
    attestation_level: str

reputation_graph = StateGraph(ReputationState)

def fetch_user_data(state: ReputationState) -> ReputationState:
    """Fetch user expertise from on-chain registry (NO QUALITY SCORES)"""
    user_expertise = reputation_registry.get_expertise(state["user_address"], state["domain"])
    user_roles = reputation_registry.get_roles(state["user_address"])
    bills = reputation_registry.get_bills_tracked(state["user_address"])

    return {
        **state,
        "templates_contributed": user_expertise.templates_contributed,
        "templates_adopted": user_expertise.templates_adopted,
        "bills_tracked": len(bills),
        "peer_endorsements": user_expertise.peer_endorsements,
        "verified_sends": user_expertise.verified_sends,
        "active_months": user_expertise.active_months,
        "professional_role": user_roles[0].role_id if user_roles else None,
        "attestation_level": user_roles[0].attestation_level if user_roles else "self-attested"
    }

def calculate_base_score(state: ReputationState) -> ReputationState:
    """
    Calculate reputation from CONCRETE SIGNALS (no LLM calls)
    Formula: weighted sum of verifiable behaviors
    """
    # Template adoption signal (max 30 points)
    template_signal = min(state["templates_adopted"] * 5, 30)

    # Bill tracking signal (max 15 points)
    bill_signal = min(state["bills_tracked"] * 3, 15)

    # Peer endorsement signal (max 20 points)
    endorsement_signal = min(state["peer_endorsements"] * 2, 20)

    # Civic velocity signal (max 20 points)
    velocity_signal = min(state["active_months"] * 2, 20)

    # Contribution signal (max 15 points)
    contribution_signal = min(state["templates_contributed"] * 3, 15)

    base_score = (template_signal + bill_signal + endorsement_signal +
                  velocity_signal + contribution_signal)

    return {**state, "base_score": base_score}

def apply_role_multiplier(state: ReputationState) -> ReputationState:
    """Apply professional credential multiplier (VERIFIABLE ONLY)"""
    role_multipliers = {
        "verified": 2.0,      # License number verified via API
        "endorsed": 1.5,      # 3+ verified users attested
        "self-attested": 1.0  # No verification (no boost)
    }

    multiplier = role_multipliers.get(state["attestation_level"], 1.0)
    final_score = min(int(state["base_score"] * multiplier), 100)

    return {**state, "final_score": final_score}

def update_on_chain(state: ReputationState) -> ReputationState:
    """Update ERC-8004 reputation registry with CONCRETE SIGNALS"""
    evidence_hash = keccak256(
        abi.encode([
            "templates_adopted", state["templates_adopted"],
            "bills_tracked", state["bills_tracked"],
            "peer_endorsements", state["peer_endorsements"],
            "active_months", state["active_months"],
            "role", state["professional_role"]
        ])
    )

    reputation_registry.update_reputation(
        agent=REPUTATION_AGENT_ADDRESS,
        domain=state["domain"],
        score=state["final_score"],
        evidence_hash=evidence_hash
    )

    return state

# Build workflow (DETERMINISTIC - NO LLM INFERENCE)
reputation_graph.add_node("fetch_data", fetch_user_data)
reputation_graph.add_node("base_score", calculate_base_score)
reputation_graph.add_node("role_multiplier", apply_role_multiplier)
reputation_graph.add_node("update_chain", update_on_chain)

reputation_graph.add_edge("fetch_data", "base_score")
reputation_graph.add_edge("base_score", "role_multiplier")
reputation_graph.add_edge("role_multiplier", "update_chain")

reputation_graph.set_entry_point("fetch_data")
reputation_workflow = reputation_graph.compile()
```

**Key Changes from Original**:
1. ❌ **Removed**: `template_quality` (abstract AI judgment)
2. ❌ **Removed**: `message_quality_score` (agent-determined heuristic)
3. ✅ **Added**: `templates_adopted` (verifiable usage count)
4. ✅ **Added**: `active_months` (verifiable engagement velocity)
5. ✅ **Added**: `bills_tracked` (verifiable legislative engagement)

**Gas Costs** (as of 2025‑11‑15):
- Reputation update: < $0.01 typical on Scroll L2 (conservative range $0.0001–$0.005)
- **No LLM API calls** (fully deterministic)

---

## Template Moderation (Revised - No Quality Scores)

**Purpose**: Safety moderation without abstract "quality" judgment

**3-Layer Moderation Stack**:

### Layer 1: Pattern Matching (FREE)
```typescript
function containsProhibitedPatterns(content: string): boolean {
  // Concrete pattern matching (no AI judgment)
  const prohibited = [
    /\b(fuck|shit|asshole)\b/gi,  // Profanity
    /\b(kill|murder|harm)\b/gi,    // Violence
    /\b(nigger|kike|faggot)\b/gi   // Hate speech
  ];

  return prohibited.some(pattern => pattern.test(content));
}
```

### Layer 2: OpenAI Moderation API (FREE, 20 req/min)
```typescript
const moderationResult = await moderateTemplate({
  title,
  message_body
});

// CONCRETE SIGNAL: flagged or not flagged
if (moderationResult.flagged) {
  return {
    approved: false,
    flagged_categories: moderationResult.categories,
    timestamp: new Date()
  };
}
```

### Layer 3: Multi-Agent Consensus (Safety Only, Not Quality)
```typescript
// Agents vote: approve/reject (binary), not "quality score"
const consensusResult = await getMultiAgentConsensus({
  title,
  message_body,
  category
});

// CONCRETE SIGNAL: approved or rejected
return {
  approved: consensusResult.approved,  // boolean, not score
  consensus_type: consensusResult.consensus_type, // "unanimous" | "majority" | "split"
  votes: consensusResult.votes.map(v => ({
    agent: v.agent,
    approved: v.approved,  // boolean, not score
    confidence: v.confidence
  }))
};
```

**Stored Moderation Signals** (safety only):
- `flagged_by_moderation: boolean` - OpenAI API flagged content
- `consensus_approved: boolean` - Multi-agent approved (binary)

**Stored Congressional Dashboard Signals** (McDonald 2018 research):
- `policy_areas: string[]` - Which policy domains this template addresses
- `related_bills: string[]` - Which legislation this template references
- `expertise_breakdown: json` - Distribution of sender expertise (professional vs industry vs community)

**NO abstract "quality" metrics**. Only safety moderation + congressional filtering signals.

---

## Congressional Dashboard Design (Revised)

**Purpose**: Filter by CONCRETE signals, not abstract "quality"

**Dashboard Filters**:
```typescript
interface CongressionalFilters {
  // Policy expertise
  domain: string;                     // "healthcare", "climate"
  professional_roles: string[];       // "nurse", "teacher"
  attestation_level: 'verified' | 'endorsed' | 'all';

  // Concrete engagement signals
  min_bills_tracked: number;          // Minimum bills followed
  min_templates_contributed: number;  // Minimum templates created
  min_template_adoption: number;      // Minimum templates others used
  min_peer_endorsements: number;      // Minimum on-chain attestations
  min_active_months: number;          // Minimum engagement velocity

  // Bill tracking
  bill_id?: string;                   // Filter by specific bill

  // ❌ REMOVED: min_quality_score (too brittle)
}
```

**Message Card Signals** (concrete, verifiable):
```
┌─────────────────────────────────────────────────────┐
│ Jane Smith - Registered Nurse (Verified ✓)          │
│ 🏥 Healthcare | Following 5 bills | 15 endorsements │
│ 12 templates contributed | 8 adopted by others      │
│ Active for 6 months | 45 verified sends             │
├─────────────────────────────────────────────────────┤
│ "I'm writing as a frontline nurse about the        │
│ impact of Medicare cuts on rural hospitals..."     │
│                                                     │
│ [Read Full Message] [Bills Tracked] [Credentials]  │
└─────────────────────────────────────────────────────┘
```

**NO "quality score" displayed**. Only concrete behaviors.

---

## Migration Path (Revised)

### Week 1-2: Remove Quality Scores
1. **Drop fields**: `message_quality_score`, `quality_score`, `grammar_score`, `clarity_score`, `completeness_score`
2. **Add fields**: `templates_adopted`, `active_months`, `grammar_errors`, `readability_grade`, `word_count`
3. **Migrate data**: Calculate `templates_adopted` from existing usage data
4. **Update contracts**: Deploy revised `ReputationRegistry.sol` without quality score storage

### Week 3-4: Bill Tracking Integration (Unchanged)
- Create `Bill`, `BillTracking` tables
- Integrate Congress.gov API
- Link bill tracking to reputation calculation

### Week 5-6: Template Moderation (Revised)
- Remove abstract "quality" scoring from multi-agent consensus
- Keep binary approve/reject decisions only
- Add Grammarly API integration for concrete grammar error counts
- Add Flesch-Kincaid readability scoring

### Week 7-8: Congressional Dashboard (Revised)
- Remove "quality score" filter slider
- Add concrete signal filters (bills tracked, templates adopted, endorsements)
- Update message cards to show concrete behaviors only

---

## Success Metrics (Revised)

### Phase 1 Metrics

**User Engagement** (concrete, measurable):
- % of users with at least 1 expertise domain: Target 60%+
- % of users with verified professional roles: Target 20%+
- Average bills tracked per user: Target 2+
- Templates contributed per user: Target 3+
- **Template adoption rate**: % of templates used by others (target 40%+)
- **Active months**: Average engagement velocity (target 4+ months)

**Template Adoption** (concrete, not "quality"):
- % of templates adopted by others: Target 40%+
- Average adopters per template: Target 5+
- Unique districts reached per template: Target 10+
- **NOT MEASURED**: Abstract "quality scores"

**Congressional Dashboard Usage**:
- % of messages filtered by concrete signals: Target 50%+
- Most common filters: Professional role (30%), bills tracked (25%), endorsements (20%)
- **NOT MEASURED**: "Quality score" filtering (removed)

---

## First Principles Architecture Summary

### What We Build (Phase-by-Phase)

**Phase 1: Reputation-Only (3 months to launch)**
- **Identity Verification**: NFC passport (self.xyz) or government ID (Didit.me) - both FREE
- **Professional Credentials**: License number verification via state APIs (2.0x multiplier)
- **Template Adoption**: Crowd wisdom signal (how many people use your templates)
- **Bill Tracking**: Legislative engagement depth (informed participation)
- **Peer Endorsements**: On-chain ERC-8004 attestations (community vouching)
- **Civic Velocity**: Consistency signal (active months with at least 1 send)

**Phase 2: Challenge Markets + Impact Verification (12-18 months)**
- **Challenge Accuracy**: Win rate in economic dispute resolution
  - Domain expertise multiplies stake weight (healthcare nurse gets 2x on healthcare challenges)
  - Losing burns reputation permanently (-10 points per loss)
  - Quadratic scaling prevents money from dominating facts (100 people at $10 > 1 person at $1000)
- **Impact Verified**: Templates that provably influenced legislative outcomes
  - 10x reward multiplier for verified impact
  - Confidence scoring: Direct citation (40%), temporal correlation (30%), geographic clustering (20%), alternative explanations (-10%)
  - ChromaDB vector search + GPT-5 reasoning + statistical significance testing

**Phase 2+: Congressional CMS Integration (when available)**
- **Citation Count**: Congressional Record scraping (objective counting)
- **Response Correlation**: Office response rate (email tracking)

### Concrete Signals Only (No Abstract Quality Scores)

✅ **What We Measure**:
1. **Template adoption** - Real usage counts (crowd wisdom)
2. **Bill tracking** - Legislative engagement (informed participation)
3. **Professional credentials** - Verified licenses (state API checks)
4. **Civic velocity** - Active months (consistency)
5. **Peer endorsements** - On-chain attestations (community vouching)
6. **Challenge wins** - Economic validation (cryptographic proof)
7. **Impact attestations** - Proven outcomes (Congressional Record correlation)
8. **Citation count** - Congressional citations (objective scraping)

❌ **What We Don't Measure**:
1. ~~Abstract "message quality score"~~ - Too brittle, agent-determined
2. ~~Grammar errors, readability grades~~ - Irrelevant to congressional filtering
3. ~~Multi-agent "quality" consensus~~ - Safety only (binary approve/reject)
4. ~~AI-determined "clarity" or "completeness"~~ - Subjective heuristics

### Moderation vs Reputation (Critical Distinction)

**Content Moderation (Safety Only)**:
- Multi-agent consensus: Binary approve/reject (not quality scoring)
- Pattern matching: Profanity, violence, hate speech
- OpenAI Moderation API: Illegal content flagging
- **Purpose**: Safety, not quality assessment

**Reputation Signals (Congressional Dashboard)**:
- Policy areas: Which domains template addresses (healthcare, climate, housing)
- Related bills: Which legislation template references (H.R. 1234, S. 567)
- Expertise distribution: Professional vs industry vs community sender breakdown
- **Purpose**: Domain expertise filtering (McDonald 2018 research)

### Challenge Market Integration (Phase 2)

**How Reputation Affects Challenges**:
```solidity
// Domain expertise multiplies stake weight
function getStakeWeight(address challenger, bytes32 templateDomain) public view returns (uint256) {
    uint256 baseStake = challengeStakes[challenger];
    uint256 expertiseScore = reputationRegistry.getExpertiseScore(challenger, templateDomain);

    // Healthcare professional challenging healthcare template gets 2x-3x multiplier
    uint256 multiplier = _getDomainMultiplier(expertiseScore);

    return (baseStake * multiplier) / 100;
}
```

**How Challenges Affect Reputation**:
```solidity
// Losing challenges burns reputation permanently
function _resolveChallenge(bytes32 challengeId, bool challengerWins) internal {
    if (!challengerWins) {
        // Permanent -10 point penalty in this domain
        reputationRegistry.burnDomainReputation(challenger, templateDomain, 10);
    }
}
```

### Impact Verification Integration (Phase 2)

**How Impact Affects Reputation**:
- Each verified impact attestation: +5 points (max 15)
- Average confidence score tracked (0-10000 basis points)
- On-chain evidence hash stored (IPFS CID of full analysis)

**How Impact Triggers Rewards**:
```solidity
// 10x multiplier for verified legislative impact
function verifyAndReward(bytes32 attestationId) external {
    uint256 multiplier = _calculateRewardMultiplier(attestation.confidenceLevel);
    // High confidence (>80%): 10x
    // Medium confidence (50-80%): 5x
    // Low confidence (<50%): 2x

    uint256 creatorReward = baseReward * adopters.length * multiplier * 10;
    voterToken.mint(templateCreator, creatorReward);
}
```

### Why This Approach Works

**For Decision-Makers (Congressional Staffers, Corporate Boards, Journalists)**:
- Filter by domain expertise (show me healthcare professionals tracking Medicare bills)
- Filter by professional credentials (show me verified nurses, not self-attested)
- Filter by engagement depth (show me constituents following 5+ related bills)
- Filter by community vouching (show me users with 10+ peer endorsements)

**For Template Creators**:
- Clear reputation formula (no black box AI scoring)
- Positive feedback loop (template adoption → higher reputation → more visibility)
- Economic incentives aligned (challenge accuracy → stake rewards + reputation boost)
- Impact rewards (proven legislative outcomes → 10x multiplier)

**For Platform Integrity**:
- Gaming resistance (quadratic scaling, domain expertise weighting, reputation burning)
- Transparency (all signals verifiable on-chain, no abstract AI judgments)
- Scalability (deterministic calculations, no per-query LLM calls)
- Privacy-preserving (aggregate pools, no individual tracking)

### Ruthlessly Empirical

Congressional staffers need **domain expertise filters**, not abstract "quality scores". McDonald 2018 research says they filter by:
1. Professional role (is this person a nurse, teacher, small business owner?)
2. Bill tracking (are they following relevant legislation?)
3. Niche expertise ("small surprising things like bills they may have missed")

This system gives them exactly that: **structured reputation registries for filtering by policy expertise + concrete engagement signals**.

Challenge markets (Phase 2) add economic validation. Impact verification (Phase 2) adds outcome tracking. But Phase 1 launches with the minimal viable reputation system decision-makers actually need.

---

## Agent Architecture


## Executive Summary

The ReputationAgent provides domain-specific credential verification for civic participants across ANY decision-making body (Congress, HOAs, universities, corporations, nonprofits). It uses agent-interpreted free-text credentials to determine credibility multipliers (2.0x verified → 1.0x self-attested) for decision-maker filtering.

**Core Insight**: Decision-makers don't care about abstract quality scores. They care about **"Does this person know what they're talking about?"**

**Why Gemini 2.5 Flash**: Credential parsing is a bounded task that benefits from:
- **Cost efficiency**: Free tier (1M tokens/day) vs OpenAI GPT-4o ($5-30/million tokens)
- **Proven track record**: Already used in Shadow Atlas for LLM validation (TECH-STACK-AND-INTEGRATION.md:72-78)
- **Structured output**: Guaranteed JSON parsing (8K output tokens per request)
- **Model diversity**: Different from OpenAI-based content moderation agents (consensus reliability)

---

## Architecture

### 1. Agent Responsibilities

**ReputationAgent Handles** (voter-protocol):
- Credential parsing from free-text claims
- State API verification routing (nursing boards, IAAP, APICS, ISA, GPA)
- Credibility multiplier calculation (deterministic scoring)
- Multi-model consensus for disputed credentials
- API endpoint for verification requests

**Communique Handles** (frontend repo):
- UserExpertise database schema (stores verification results)
- UI components for credential input
- Congressional dashboard filtering interfaces
- Template delivery pipeline integration
- API calls to ReputationAgent for verification

### 2. Verification Flow

```
User Input (Communique)
    ↓
POST /reputation/verify (voter-protocol API)
    ↓
Gemini 2.5 Flash: Parse credential claim
    ↓
Route to State API Verifier (nursing, IAAP, APICS, etc.)
    ↓
Calculate Credibility Multiplier (2.0x → 1.5x → 1.3x → 1.0x)
    ↓
Return Verification Result
    ↓
Communique: Store in UserExpertise table
    ↓
Decision-Maker Dashboard: Filter by multiplier
```

---

## Model Selection: Gemini 2.5 Flash

### Why Gemini 2.5 Flash (NOT OpenAI GPT-4o)

**Cost Analysis** (2025 pricing):
- **Gemini 2.5 Flash**: FREE tier (1M tokens/day), structured JSON output guaranteed
- **OpenAI GPT-4o**: $5/M input + $15/M output tokens
- **Estimated usage**: 50K credential verifications/month = ~100M tokens
- **Savings**: $100-300/month (free vs $500-2000/month OpenAI)

**Technical Advantages**:
1. **Proven in Production**: Already used for Shadow Atlas LLM validation
   ```typescript
   // From voter-protocol TECH-STACK-AND-INTEGRATION.md:72-78
   // Gemini 2.5 Flash: LLM validation for ambiguous sources
   // - Batch inference (30 cities/request)
   // - 1M tokens/day free tier
   // - 8K token output per request
   // - Structured JSON output (parsing guaranteed)
   ```

2. **Model Diversity**: Multi-agent consensus requires diverse models
   - Content moderation: OpenAI GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Pro
   - Credential verification: **Gemini 2.5 Flash** (different from content agents)
   - Prevents correlated failures across agent types

3. **Structured Output Reliability**:
   - Gemini API guarantees JSON schema compliance
   - OpenAI sometimes fails JSON parsing on complex schemas
   - Credential verification requires deterministic parsing (can't retry users)

### Model Comparison (Research Summary)

Based on WebSearch results (2025-11-09):

**Gemini 2.5 Flash:**
- Free tier: 250K tokens/minute, 500 requests/day
- Paid tier: $0.10 input / $0.40 output per million tokens
- Latency: ~1-2 seconds for credential parsing
- Accuracy: Sufficient for credential extraction (not complex reasoning)

**Gemini 2.5 Flash-Lite** (considered but rejected):
- Even cheaper: Same free tier quotas
- Lower accuracy on complex credential patterns
- Risk: Missed credential formats → false negatives → user frustration

**Gemini 2.5 Pro** (considered but rejected):
- Higher reasoning capability (deep technical analysis)
- 15x more expensive than Flash ($1.50 input / $6.00 output)
- Overkill for credential parsing (bounded task, not open-ended reasoning)

**OpenAI GPT-4o** (original Communique implementation - WRONG):
- Expensive: $5 input / $15 output per million tokens
- Already used in content moderation (model correlation risk)
- No cost advantage over Gemini for this task

### Decision Matrix

| Criteria | Gemini 2.5 Flash | OpenAI GPT-4o | Gemini 2.5 Pro |
|----------|------------------|---------------|----------------|
| **Cost (50K requests/month)** | FREE | $500-2000 | $750-3000 |
| **Structured JSON** | Guaranteed | Sometimes fails | Guaranteed |
| **Model diversity** | ✅ Different from content agents | ❌ Same as content agents | ✅ Different |
| **Proven in voter-protocol** | ✅ Shadow Atlas | ❌ Not used | ❌ Not used |
| **Latency** | 1-2s | 2-3s | 3-5s |
| **Accuracy for credential parsing** | Sufficient | Overkill | Overkill |

**Winner: Gemini 2.5 Flash** - Free tier, proven in production, model diversity, structured output guarantee.

---

## Credibility Multiplier System

### Verification Tiers

**2.0x - State API Verified**:
- Nursing: California RN License #482901 → verified via CA Board of Registered Nursing API
- Arborist: ISA Certification #WE-8901A → verified via International Society of Arboriculture API
- Accessibility: IAAP CPACC certified → verified via IAAP Certified Professional Directory
- Supply Chain: APICS CSCP certified → verified via APICS Certification Verification API
- Grant Writing: GPC certified → verified via Grant Professionals Association lookup

**1.5x - Peer Endorsed**:
- 3+ verified users (2.0x multiplier) vouch for this person in this domain
- Cross-verified expertise attestations
- Example: "3 verified nurses attest this person is a healthcare professional"

**1.3x - Agent Verified**:
- Gemini found credential patterns but couldn't verify via state API
- Format validation passed (e.g., "CA RN License #123456" matches nursing pattern)
- Example: License number format correct, but state API unavailable

**1.0x - Self-Attested**:
- No verification possible
- User claims expertise but no supporting evidence
- Baseline credibility (not penalized, just not boosted)

### Domain-Specific Verification Strategies

```typescript
// Domain routing patterns
const VERIFICATION_STRATEGIES = {
  healthcare: {
    patterns: ['RN', 'Registered Nurse', 'Physician', 'Medical', 'Healthcare'],
    verifiers: [
      verifyNursingLicense,      // State nursing boards (CA, TX, FL, NY, etc.)
      verifyMedicalLicense,      // State medical boards
      verifyHealthcareCert       // IAAP, ACHE, AHIMA certifications
    ]
  },

  arborist: {
    patterns: ['ISA', 'Certified Arborist', 'Tree Care', 'Arboriculture'],
    verifiers: [
      verifyISACertification,    // International Society of Arboriculture
      verifyCLARBCertification   // Council of Landscape Architectural Registration Boards
    ]
  },

  accessibility_consultant: {
    patterns: ['IAAP', 'CPACC', 'WAS', 'Accessibility Consultant'],
    verifiers: [
      verifyIAAPCertification    // IAAP Certified Professional Directory
    ]
  },

  supply_chain_manager: {
    patterns: ['APICS', 'CSCP', 'CPIM', 'Supply Chain'],
    verifiers: [
      verifyAPICScertification   // APICS Certification Verification API
    ]
  },

  grant_writer: {
    patterns: ['GPC', 'Grant Professional', 'Grant Writer'],
    verifiers: [
      verifyGPACertification     // Grant Professionals Association
    ]
  },

  // ... extensible for any domain
};
```

---

## API Specification

### POST /reputation/verify

**Purpose**: Verify user credentials and return credibility multiplier

**Request**:
```typescript
interface VerificationRequest {
  user_id: string;                    // Communique user ID
  domain: string;                     // "healthcare" | "arborist" | "accessibility" | etc.
  organization_type?: string;         // "congress" | "hoa" | "university" | "corporate"
  professional_role?: string;         // "Registered Nurse" | "Certified Arborist" | etc.
  experience_description?: string;    // Free-text backstory
  credentials_claim?: string;         // "CA RN License #482901" | "ISA Cert #WE-8901A"
}
```

**Response**:
```typescript
interface VerificationResult {
  verification_status: 'state_api_verified' | 'peer_endorsed' | 'agent_verified' | 'unverified';
  credential_multiplier: number;      // 2.0 | 1.5 | 1.3 | 1.0
  verified_by_agent: 'gemini' | 'state_api' | 'peer_consensus' | null;
  verification_evidence: {
    method: string;                    // "california_nursing_board_api"
    license_number?: string;           // Extracted credential number
    license_status?: string;           // "active" | "inactive" | "suspended"
    verified_at?: string;              // ISO timestamp
    confidence?: number;               // 0.0 - 1.0 (agent confidence)
  } | null;
}
```

**Example Request**:
```json
POST /reputation/verify
{
  "user_id": "user_abc123",
  "domain": "healthcare",
  "organization_type": "congress",
  "professional_role": "Registered Nurse",
  "experience_description": "I've worked in pediatric oncology for 12 years at Children's Hospital Oakland.",
  "credentials_claim": "CA RN License #482901, PALS certified"
}
```

**Example Response** (State API Verified):
```json
{
  "verification_status": "state_api_verified",
  "credential_multiplier": 2.0,
  "verified_by_agent": "state_api",
  "verification_evidence": {
    "method": "california_nursing_board_api",
    "license_number": "482901",
    "license_status": "active",
    "verified_at": "2025-11-09T10:30:00Z",
    "confidence": 1.0
  }
}
```

**Example Response** (Agent Verified):
```json
{
  "verification_status": "agent_verified",
  "credential_multiplier": 1.3,
  "verified_by_agent": "gemini",
  "verification_evidence": {
    "method": "pattern_matching",
    "license_number": "482901",
    "confidence": 0.85,
    "note": "License number format matches CA nursing pattern, but state API unavailable"
  }
}
```

### GET /reputation/experts

**Purpose**: Query verified experts in a domain (for decision-maker dashboards)

**Query Parameters**:
- `domain` (required): Domain to filter by
- `min_multiplier` (optional, default 1.5): Minimum credibility multiplier
- `organization_type` (optional): Filter by organization type
- `limit` (optional, default 100): Max results
- `offset` (optional, default 0): Pagination offset

**Response** (Privacy-Preserving Aggregates):
```typescript
interface ExpertQueryResult {
  domain: string;
  min_multiplier: number;
  expert_count: number;
  verification_breakdown: {
    state_api_verified: number;
    peer_endorsed: number;
    agent_verified: number;
  };
  avg_messages_sent: number;
  avg_templates_created: number;
  avg_issues_tracked: number;
  top_roles: Record<string, number>;  // { "Registered Nurse": 15, "Physician": 8 }
}
```

**Example Request**:
```
GET /reputation/experts?domain=healthcare&min_multiplier=1.5&organization_type=congress
```

**Example Response**:
```json
{
  "domain": "healthcare",
  "min_multiplier": 1.5,
  "expert_count": 47,
  "verification_breakdown": {
    "state_api_verified": 23,
    "peer_endorsed": 18,
    "agent_verified": 6
  },
  "avg_messages_sent": 4.2,
  "avg_templates_created": 1.8,
  "avg_issues_tracked": 2.3,
  "top_roles": {
    "Registered Nurse": 15,
    "Physician": 8,
    "Medical Researcher": 4
  }
}
```

---

## Implementation Details

### 1. Gemini 2.5 Flash Integration

**Credential Parsing Prompt**:
```typescript
const credentialParsingPrompt = `You are a credential verification agent. Analyze this credential claim and extract structured information.

Credential Claim: "${credentials_claim}"
Domain: "${domain}"
Professional Role: "${professional_role}"

Extract the following information in JSON format:
{
  "credential_type": "license" | "certification" | "degree" | "experience",
  "issuing_authority": string,          // e.g., "California Board of Registered Nursing"
  "credential_number": string | null,   // e.g., "482901"
  "credential_format": string | null,   // e.g., "CA RN License #XXXXXX"
  "verification_strategy": string,      // "nursing_board_api" | "iaap_directory" | etc.
  "confidence": number,                 // 0.0 - 1.0
  "extracted_facts": string[]           // ["12 years experience", "pediatric oncology"]
}

Guidelines:
- Extract license/certification numbers precisely (no prefixes/suffixes)
- Identify issuing authority from context clues
- Determine appropriate verification strategy
- Return confidence score based on clarity of claim
`;
```

**Gemini API Call**:
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',  // Structured output guarantee
    temperature: 0,                        // Deterministic parsing
  }
});

const result = await model.generateContent(credentialParsingPrompt);
const parsed = JSON.parse(result.response.text());
```

### 2. State API Verification

**Example: California Nursing Board API**:
```typescript
async function verifyNursingLicense(
  licenseNumber: string,
  state: string
): Promise<StateAPIResult> {
  const apiEndpoints: Record<string, string> = {
    'CA': 'https://search.dca.ca.gov/rn/lookup',
    'TX': 'https://www.bon.texas.gov/olv/verification',
    'FL': 'https://appsmqa.doh.state.fl.us/nursinglicensure'
  };

  const endpoint = apiEndpoints[state];
  if (!endpoint) {
    return {
      verified: false,
      method: 'state_api_unavailable',
      reason: `No API integration for state: ${state}`
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_number: licenseNumber })
    });

    const data = await response.json();

    if (data.status === 'active') {
      return {
        verified: true,
        method: 'state_api_verified',
        credential_multiplier: 2.0,
        evidence: {
          license_number: licenseNumber,
          license_status: 'active',
          verified_at: new Date().toISOString()
        }
      };
    } else {
      return {
        verified: false,
        method: 'state_api_inactive',
        reason: `License status: ${data.status}`
      };
    }
  } catch (error) {
    // Fallback to agent verification if API fails
    return {
      verified: false,
      method: 'state_api_error',
      reason: error.message
    };
  }
}
```

### 3. Multi-Model Consensus for Disputed Credentials

**When to Use Consensus**:
- User disputes agent verification result
- State API returns ambiguous result
- Multiple credential formats claimed

**Consensus Process**:
```typescript
async function getCredentialConsensus(
  credentials_claim: string,
  domain: string
): Promise<ConsensusResult> {
  // Query 3 models in parallel
  const [geminiResult, claudeResult, openaiResult] = await Promise.all([
    parseCredentialWithGemini(credentials_claim, domain),
    parseCredentialWithClaude(credentials_claim, domain),
    parseCredentialWithOpenAI(credentials_claim, domain)
  ]);

  // Extract verification strategies
  const strategies = [
    geminiResult.verification_strategy,
    claudeResult.verification_strategy,
    openaiResult.verification_strategy
  ];

  // Majority consensus (2/3 agreement)
  const strategyCount: Record<string, number> = {};
  strategies.forEach(s => {
    strategyCount[s] = (strategyCount[s] || 0) + 1;
  });

  const consensusStrategy = Object.keys(strategyCount)
    .find(s => strategyCount[s] >= 2);

  if (consensusStrategy) {
    return {
      consensus: true,
      verification_strategy: consensusStrategy,
      confidence: strategyCount[consensusStrategy] / 3,
      agent_votes: { gemini: geminiResult, claude: claudeResult, openai: openaiResult }
    };
  } else {
    return {
      consensus: false,
      reason: 'No majority agreement on verification strategy',
      fallback_multiplier: 1.0  // Default to self-attested
    };
  }
}
```

---

## Universal Applicability (Zero Overengineering)

**Same schema, zero changes needed for any domain:**

### Congress: Healthcare Bill
```json
{
  "domain": "healthcare",
  "organization_type": "congress",
  "professional_role": "Registered Nurse",
  "credentials_claim": "CA RN License #482901",
  "verification_status": "state_api_verified",
  "credential_multiplier": 2.0
}
```

### HOA: Tree Removal Proposal
```json
{
  "domain": "hoa_landscaping",
  "organization_type": "hoa",
  "professional_role": "Certified Arborist",
  "credentials_claim": "ISA Certification #WE-8901A",
  "verification_status": "state_api_verified",
  "credential_multiplier": 2.0
}
```

### University: Accessibility Proposal
```json
{
  "domain": "university_accessibility",
  "organization_type": "university",
  "professional_role": "Accessibility Consultant",
  "credentials_claim": "IAAP CPACC certified, 8 years university consulting",
  "verification_status": "state_api_verified",
  "credential_multiplier": 2.0
}
```

### Corporate Board: Supply Chain Issue
```json
{
  "domain": "corporate_supply_chain",
  "organization_type": "corporate",
  "professional_role": "Supply Chain Manager",
  "credentials_claim": "APICS CSCP certified, 15 years automotive supply chain",
  "verification_status": "state_api_verified",
  "credential_multiplier": 2.0
}
```

---

## Integration with Communique (external repo)

### Communique Database Schema (UserExpertise)

**Already implemented in Communique** (external repo: `prisma/schema.prisma`):
```prisma
model UserExpertise {
  id                     String   @id @default(cuid())
  user_id                String   @map("user_id")

  // Domain context (flexible, not rigid enum)
  domain                 String   // "healthcare" | "hoa_landscaping" | etc.
  organization_type      String?  @map("organization_type")

  // FREE-TEXT CREDENTIALS (agent parses/verifies)
  professional_role      String?  @map("professional_role")
  experience_description String?  @map("experience_description")
  credentials_claim      String?  @map("credentials_claim")

  // AGENT VERIFICATION RESULTS (from voter-protocol ReputationAgent)
  verification_status    String   @default("unverified") @map("verification_status")
  verification_evidence  Json?    @map("verification_evidence")
  verified_at            DateTime? @map("verified_at")
  verified_by_agent      String?  @map("verified_by_agent")
  credential_multiplier  Float    @default(1.0) @map("credential_multiplier")

  // CONCRETE USAGE SIGNALS (tracked by Communique)
  issues_tracked         String[] @default([]) @map("issues_tracked")
  templates_created      Int      @default(0) @map("templates_created")
  messages_sent          Int      @default(0) @map("messages_sent")
  peer_endorsements      Int      @default(0) @map("peer_endorsements")
  active_months          Int      @default(0) @map("active_months")

  @@unique([user_id, domain])
  @@map("user_expertise")
}
```

### Communique API Endpoints

**POST /api/expertise/verify** (Communique → voter-protocol proxy):
```typescript
// src/routes/api/expertise/verify/+server.ts
export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session?.userId) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();

  // Call voter-protocol ReputationAgent API
  const verificationResult = await fetch(
    `${process.env.VOTER_PROTOCOL_API_URL}/reputation/verify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOTER_API_KEY}`
      },
      body: JSON.stringify({
        user_id: session.userId,
        domain: body.domain,
        organization_type: body.organization_type,
        professional_role: body.professional_role,
        experience_description: body.experience_description,
        credentials_claim: body.credentials_claim
      })
    }
  );

  const verification = await verificationResult.json();

  // Store result in Communique database
  const expertise = await db.userExpertise.upsert({
    where: {
      user_id_domain: {
        user_id: session.userId,
        domain: body.domain
      }
    },
    create: {
      user_id: session.userId,
      domain: body.domain,
      organization_type: body.organization_type,
      professional_role: body.professional_role,
      experience_description: body.experience_description,
      credentials_claim: body.credentials_claim,
      verification_status: verification.verification_status,
      verification_evidence: verification.verification_evidence,
      verified_at: verification.verification_evidence?.verified_at
        ? new Date(verification.verification_evidence.verified_at)
        : null,
      verified_by_agent: verification.verified_by_agent,
      credential_multiplier: verification.credential_multiplier
    },
    update: {
      verification_status: verification.verification_status,
      verification_evidence: verification.verification_evidence,
      verified_at: verification.verification_evidence?.verified_at
        ? new Date(verification.verification_evidence.verified_at)
        : null,
      verified_by_agent: verification.verified_by_agent,
      credential_multiplier: verification.credential_multiplier
    }
  });

  return json({ success: true, expertise });
};
```

---

## Testing Strategy

### 1. Unit Tests (Gemini Parsing)

```typescript
describe('ReputationAgent - Credential Parsing', () => {
  it('should extract nursing license from free-text', async () => {
    const result = await parseCredentialWithGemini(
      'CA RN License #482901, PALS certified',
      'healthcare'
    );

    expect(result.credential_type).toBe('license');
    expect(result.credential_number).toBe('482901');
    expect(result.verification_strategy).toBe('nursing_board_api');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('should handle ISA arborist certification', async () => {
    const result = await parseCredentialWithGemini(
      'ISA Certified Arborist #WE-8901A',
      'arborist'
    );

    expect(result.credential_type).toBe('certification');
    expect(result.credential_number).toBe('WE-8901A');
    expect(result.verification_strategy).toBe('isa_verification_api');
  });
});
```

### 2. Integration Tests (State API Verification)

```typescript
describe('ReputationAgent - State API Integration', () => {
  it('should verify active CA nursing license', async () => {
    const result = await verifyNursingLicense('482901', 'CA');

    expect(result.verified).toBe(true);
    expect(result.method).toBe('state_api_verified');
    expect(result.credential_multiplier).toBe(2.0);
    expect(result.evidence.license_status).toBe('active');
  });

  it('should fallback to agent verification if API unavailable', async () => {
    // Mock API failure
    mockStateAPIUnavailable();

    const result = await verifyCredentials({
      credentials_claim: 'CA RN License #482901',
      domain: 'healthcare'
    });

    expect(result.verification_status).toBe('agent_verified');
    expect(result.credential_multiplier).toBe(1.3);
  });
});
```

### 3. End-to-End Tests (Communique → voter-protocol)

```typescript
describe('ReputationAgent - E2E Integration', () => {
  it('should verify credentials via voter-protocol API', async () => {
    const response = await fetch('/api/expertise/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authenticatedSession
      },
      body: JSON.stringify({
        domain: 'healthcare',
        professional_role: 'Registered Nurse',
        credentials_claim: 'CA RN License #482901'
      })
    });

    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.expertise.verification_status).toBe('state_api_verified');
    expect(data.expertise.credential_multiplier).toBe(2.0);
  });
});
```

---

## Phase 2 Extensions (12-18 Months)

### On-Chain Attestations

**Phase 1** (current): PostgreSQL storage in Communique
**Phase 2**: On-chain ERC-8004 attestations on Scroll zkEVM

```solidity
// ReputationRegistry.sol (Phase 2)
contract ReputationRegistry {
  struct DomainExpertise {
    bytes32 domain;              // keccak256("healthcare")
    uint256 credentialMultiplier; // 2.0x = 2000 (basis points)
    uint256 verifiedAt;          // Unix timestamp
    address verifiedBy;          // ReputationAgent contract
    bytes32 evidenceIPFSHash;    // IPFS hash of verification evidence
  }

  mapping(address => mapping(bytes32 => DomainExpertise)) public expertise;

  function attestExpertise(
    address user,
    bytes32 domain,
    uint256 multiplier,
    bytes32 evidenceHash
  ) external onlyVerifiedAgent {
    expertise[user][domain] = DomainExpertise({
      domain: domain,
      credentialMultiplier: multiplier,
      verifiedAt: block.timestamp,
      verifiedBy: msg.sender,
      evidenceIPFSHash: evidenceHash
    });

    emit ExpertiseAttested(user, domain, multiplier);
  }
}
```

### Challenge Markets for Disputed Credentials

```typescript
// Phase 2: Users can challenge disputed credentials
interface CredentialChallenge {
  challenger: string;           // User disputing credential
  stake: bigint;               // VOTER tokens staked on challenge
  evidence: string;            // IPFS hash of counter-evidence
  consensus_result: {
    approved: boolean;         // 3-model consensus (Gemini, Claude, OpenAI)
    confidence: number;
    reasoning: string[];
  };
  resolution: 'upheld' | 'rejected' | 'pending';
  resolved_at: Date | null;
}
```

---

## Success Metrics

### Phase 1 (Current)

**Adoption Metrics**:
- % of users who add domain expertise credentials
- % of expertise records with state API verification (2.0x)
- % of templates with inferred domain tracking

**Usage Metrics** (Congressional Staffers):
- % of staffers using filtering by credential multiplier
- Avg messages reviewed per staffer (with vs without filtering)
- % of filtered messages that receive office responses

**Quality Metrics**:
- Agent parsing accuracy (% credentials correctly extracted)
- State API verification success rate
- False positive rate (self-attested claiming verified credentials)

### Phase 2 (12-18 Months)

**On-Chain Metrics**:
- On-chain attestations vs off-chain verifications
- Challenge market participation rate
- Credential dispute resolution accuracy (human appeals vs agent decisions)

---

## Cost Analysis

### Gemini 2.5 Flash Free Tier

**Expected Usage** (50K credential verifications/month):
- Avg prompt size: 500 tokens (credential claim + domain context)
- Avg response size: 200 tokens (structured JSON output)
- Total tokens/verification: 700 tokens
- Total tokens/month: 50K * 700 = 35M tokens

**Free Tier Limits**:
- 1M tokens/day = 30M tokens/month
- **Status**: Within free tier BUT tight (117% of limit)

**Mitigation**:
1. **Batch credential parsing**: Parse multiple credentials in single request (30 credentials/request like Shadow Atlas)
2. **Cache parsed results**: Don't re-parse identical credential claims
3. **Upgrade to paid tier** if needed: $0.10/M input + $0.40/M output = ~$17.50/month

**Comparison to OpenAI GPT-4o**:
- OpenAI cost: 50K verifications * 700 tokens = $5/M * 35M = $175/month input + $15/M * 35M = $525/month output = **$700/month**
- Gemini cost: **FREE** (or $17.50/month if exceed free tier)
- **Savings**: $682.50/month

---

## Documentation References

**Related Specifications**:
- [PHASE-1-REPUTATION-IMPLEMENTATION.md](PHASE-1-REPUTATION-IMPLEMENTATION.md) - Phase 1 reputation system design
- [REPUTATION-REGISTRY-SPEC.md](REPUTATION-REGISTRY-SPEC.md) - On-chain reputation registry (Phase 2)
- [TECH-STACK-AND-INTEGRATION.md](../docs/TECH-STACK-AND-INTEGRATION.md) - Gemini 2.5 Flash integration patterns

**voter-protocol Integration**:
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Agent consensus mechanisms

**Communique Integration** (external repo):
- See `docs/specs/universal-credibility.md` in communique repo - Frontend implementation

---

**Implementation Status**: ✅ Specification complete, ready for voter-protocol implementation
**Next Milestone**: Cloudflare Workers deployment for ReputationAgent API endpoint
**Cost Efficiency**: FREE tier (Gemini 2.5 Flash) vs $700/month (OpenAI GPT-4o) = $8,400/year savings
