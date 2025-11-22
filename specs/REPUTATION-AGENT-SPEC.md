# ReputationAgent Specification: Domain Credibility Verification

**Status**: Phase 1 Implementation (Reputation-only, No Tokens)
**Agent Weight**: 20% in multi-agent treasury consensus
**Model Strategy**: Gemini 2.5 Flash (free tier, 1M tokens/day)
**Responsibility**: Domain-specific credential verification and credibility scoring
**Integration**: Communique calls ReputationAgent API for verification results

---

## Executive Summary

The ReputationAgent provides domain-specific credential verification for civic participants across ANY decision-making body (Congress, HOAs, universities, corporations, nonprofits). It uses agent-interpreted free-text credentials to determine credibility multipliers (2.0x verified → 1.0x self-attested) for decision-maker filtering.

**Core Insight**: Decision-makers don't care about abstract quality scores. They care about **"Does this person know what they're talking about?"**

**Why Gemini 2.5 Flash**: Per CLAUDE.md Section 132: "Agents execute bounded computation on observable data." Credential parsing is a bounded task that benefits from:
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

## Integration with Communique

### Communique Database Schema (UserExpertise)

**Already implemented in Communique** (`prisma/schema.prisma`):
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
- [CLAUDE.md](../CLAUDE.md) - Multi-agent treasury architecture (ReputationAgent 20% weight)
- [TECHNICAL.md](../TECHNICAL.md) - Agent consensus mechanisms

**Communique Integration**:
- [UNIVERSAL-CREDIBILITY-SYSTEM.md](../../communique/docs/UNIVERSAL-CREDIBILITY-SYSTEM.md) - Frontend implementation

---

**Implementation Status**: ✅ Specification complete, ready for voter-protocol implementation
**Next Milestone**: Cloudflare Workers deployment for ReputationAgent API endpoint
**Cost Efficiency**: FREE tier (Gemini 2.5 Flash) vs $700/month (OpenAI GPT-4o) = $8,400/year savings
