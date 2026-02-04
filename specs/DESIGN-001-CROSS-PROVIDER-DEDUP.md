# DESIGN-001: Cross-Provider Identity Deduplication

**Version:** 1.0.0
**Date:** 2026-02-01
**Status:** DRAFT - Design Phase
**Author:** Security Architecture Team
**Related Issues:** ISSUE-001 (REMEDIATION-WAVE-PLAN Wave 6)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Threat Model](#2-threat-model)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Privacy Analysis](#4-privacy-analysis)
5. [Trust Score Integration](#5-trust-score-integration)
6. [Implementation Phases](#6-implementation-phases)
7. [Open Questions](#7-open-questions)

---

## 1. Problem Statement

### 1.1 Current State

The VOTER Protocol currently supports OAuth authentication via 5 providers:
- Google
- GitHub
- Microsoft
- Apple
- Discord

Each OAuth provider operates independently, with no cross-provider identity correlation. A user with accounts on all 5 providers can create 5 separate VOTER accounts, each appearing as a unique participant.

### 1.2 The Multi-Account Abuse Vector

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT STATE (VULNERABLE)                    │
│                                                                  │
│  Same Human (Alice)                                              │
│         │                                                        │
│         ├─→ Google OAuth  ──→ Account A  ──→ 1 vote              │
│         ├─→ GitHub OAuth  ──→ Account B  ──→ 1 vote              │
│         ├─→ Microsoft     ──→ Account C  ──→ 1 vote              │
│         ├─→ Apple OAuth   ──→ Account D  ──→ 1 vote              │
│         └─→ Discord OAuth ──→ Account E  ──→ 1 vote              │
│                                                                  │
│  Result: Alice has 5 votes, 5x normal influence                  │
│  Detection: NONE - accounts appear independent                   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Why This Matters

| Impact Area | Severity | Description |
|-------------|----------|-------------|
| **Democratic Integrity** | CRITICAL | One person should equal one voice in civic participation |
| **Reputation Gaming** | HIGH | Multi-account users can farm reputation across accounts |
| **Trust Score Inflation** | HIGH | Vouching networks can be gamed with self-vouching across accounts |
| **Template Manipulation** | MEDIUM | Same user can submit/support templates multiple times |
| **Challenge Market Gaming** | MEDIUM (Phase 2) | Multi-account staking for market manipulation |

### 1.4 Design Constraints

From `SECURITY.md` and `CROSS-REPO-IDENTITY-ARCHITECTURE.md`:

1. **No Central Identity Database** - Privacy-first architecture prohibits storing real-world identities
2. **Permissionless Access Preserved** - Basic participation must not require identity verification
3. **Cryptographic Enforcement** - Policy enforcement via cryptography, not promises
4. **Gradual Trust Escalation** - Higher stakes require higher verification levels

---

## 2. Threat Model

### 2.1 Adversary Profiles

| Adversary | Capability | Motivation | Cost Tolerance |
|-----------|------------|------------|----------------|
| **Casual Sybil** | Multiple email accounts, 1 phone | Amplify influence on specific issues | Low ($0) |
| **Motivated Sybil** | Multiple phones/SIMs, multiple IDs | Systematic influence campaigns | Medium ($50-500) |
| **Organized Attacker** | VoIP numbers, fake IDs, automation | Political manipulation, reputation farming | High ($1000+) |
| **Nation-State** | SIM farms, identity forgery at scale | Election interference | Very High ($100K+) |

### 2.2 Attack Vectors

#### A. Pre-Deduplication (Current Vulnerabilities)

| Attack | Description | Current Mitigation | Gap |
|--------|-------------|-------------------|-----|
| **Multi-OAuth** | Same person, 5 OAuth accounts | None | CRITICAL |
| **Email Aliasing** | `alice@gmail.com` vs `alice+tag@gmail.com` | OAuth provider normalizes | Partial |
| **Credential Sharing** | Multiple people share OAuth credentials | OAuth account ownership | Out of scope |

#### B. Post-Deduplication (Attacks on Proposed Solution)

| Attack | Description | Mitigation Strategy |
|--------|-------------|---------------------|
| **VoIP Numbers** | Use virtual phone numbers | Carrier detection, VoIP blocklist |
| **SIM Farm** | Use multiple physical SIMs | Rate limiting per device fingerprint |
| **Number Recycling** | Use recycled phone numbers | Time-based cooldown on number reuse |
| **OTP Interception** | SIM swap, SS7 attacks | Time-limited OTPs, carrier verification |
| **Family/Friend Numbers** | Borrow phones for verification | Acceptable risk (limited scale) |

### 2.3 Security Goals

| Goal | Description | Mechanism |
|------|-------------|-----------|
| **G1: Uniqueness** | One phone = one cross-provider identity | Phone hash registry |
| **G2: Privacy** | Phone number never stored in plaintext | One-way hash with pepper |
| **G3: Unlinkability** | Cannot link phone hash to specific accounts | Identity commitment indirection |
| **G4: Forward Secrecy** | Phone number change doesn't expose history | Epoch-based commitments |
| **G5: Audit Resistance** | Operator cannot enumerate phone numbers | Cryptographic commitment |

### 2.4 Non-Goals

- **Preventing dedicated attackers with SIM farms** - Out of scope, economic cost makes this acceptable
- **Preventing family number sharing** - Acceptable limited abuse vector
- **Cross-platform deduplication** - Only within VOTER protocol, not across other services

---

## 3. Proposed Architecture

### 3.1 Overview: Phone OTP as Cross-Provider Anchor

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEDUPLICATION ARCHITECTURE                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   CLIENT (Browser)                        │    │
│  │                                                           │    │
│  │  1. User enters phone number                              │    │
│  │  2. Receives OTP via SMS                                  │    │
│  │  3. Enters OTP for verification                           │    │
│  │  4. Client computes: phone_hash = H(phone || pepper)      │    │
│  │  5. Client computes: identity_commitment =                │    │
│  │                      H(account_id || phone_hash || nonce) │    │
│  │                                                           │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   SERVER (Backend)                        │    │
│  │                                                           │    │
│  │  6. Verify OTP is valid (standard flow)                   │    │
│  │  7. Check: phone_hash exists in registry?                 │    │
│  │     ├─→ YES: REJECT (phone already used)                  │    │
│  │     └─→ NO:  Continue                                     │    │
│  │  8. Store: (phone_hash, identity_commitment, timestamp)   │    │
│  │  9. Update account: verified_phone = true                 │    │
│  │  10. Increase trust_score                                 │    │
│  │                                                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Cryptographic Primitives

```typescript
// Phone hashing (client-side computation, server verification)
interface PhoneDedup {
  // Step 1: Normalize phone number (E.164 format)
  normalizedPhone: string;  // "+12025551234"

  // Step 2: Client computes phone hash (Poseidon2 for ZK compatibility)
  // Pepper is application-wide secret, prevents rainbow tables
  phoneHash: Field;  // Poseidon2(normalizedPhone, PEPPER)

  // Step 3: Identity commitment (binds account to phone without revealing either)
  // Nonce prevents replay attacks
  identityCommitment: Field;  // Poseidon2(accountId, phoneHash, nonce)

  // Step 4: Nullifier for cross-provider detection
  // If same phoneHash appears twice, accounts are linked
  dedupNullifier: Field;  // Poseidon2(phoneHash, DEDUP_DOMAIN)
}
```

### 3.3 Data Flow: Phone Verification

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        PHONE VERIFICATION FLOW                             │
│                                                                            │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐       │
│  │  Client  │      │  Server  │      │ OTP Svc  │      │ Registry │       │
│  └────┬─────┘      └────┬─────┘      └────┬─────┘      └────┬─────┘       │
│       │                 │                 │                 │              │
│       │ 1. POST /verify/init              │                 │              │
│       │    {phone: "+1..."}               │                 │              │
│       │─────────────────►                 │                 │              │
│       │                 │                 │                 │              │
│       │                 │ 2. SendOTP(phone)                 │              │
│       │                 │─────────────────►                 │              │
│       │                 │                 │                 │              │
│       │ 3. OTP sent     │◄────────────────│                 │              │
│       │◄────────────────│                 │                 │              │
│       │                 │                 │                 │              │
│       │ 4. POST /verify/complete          │                 │              │
│       │    {phone, otp, phoneHash}        │                 │              │
│       │─────────────────►                 │                 │              │
│       │                 │                 │                 │              │
│       │                 │ 5. VerifyOTP(phone, otp)          │              │
│       │                 │─────────────────►                 │              │
│       │                 │                 │                 │              │
│       │                 │◄────────────────│                 │              │
│       │                 │    valid/invalid │                │              │
│       │                 │                 │                 │              │
│       │                 │ 6. Verify phoneHash computation   │              │
│       │                 │    (server recomputes & compares) │              │
│       │                 │                 │                 │              │
│       │                 │ 7. CHECK phoneHash exists?        │              │
│       │                 │─────────────────────────────────► │              │
│       │                 │                 │                 │              │
│       │                 │◄────────────────────────────────  │              │
│       │                 │    exists: true/false             │              │
│       │                 │                 │                 │              │
│       │                 │ [If exists: REJECT]               │              │
│       │                 │                 │                 │              │
│       │                 │ 8. INSERT (phoneHash, commitment) │              │
│       │                 │─────────────────────────────────► │              │
│       │                 │                 │                 │              │
│       │ 9. Success      │                 │                 │              │
│       │    {verified: true}               │                 │              │
│       │◄────────────────│                 │                 │              │
│       │                 │                 │                 │              │
└───────┴─────────────────┴─────────────────┴─────────────────┴──────────────┘
```

### 3.4 Data Flow: Account Linking (Same User, Multiple OAuth)

Allows a verified user to link additional OAuth providers to their existing account:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        ACCOUNT LINKING FLOW                                │
│                                                                            │
│  PRECONDITION: User has Account A (Google) with verified phone             │
│  GOAL: Link Account B (GitHub) to same identity                            │
│                                                                            │
│  1. User logs into Account B (GitHub)                                      │
│  2. User initiates "Link to existing account"                              │
│  3. User authenticates to Account A (proves ownership)                     │
│  4. User provides phone OTP (proves phone ownership)                       │
│  5. Server verifies:                                                       │
│     - OTP is valid                                                         │
│     - phoneHash matches Account A's verified phone                         │
│     - Account B not already linked to different phone                      │
│  6. Server links Account B to Account A's identity                         │
│  7. Both accounts share: trust_score, reputation, verification_level       │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │     Account A (Google)     ←──── LINKED ────→    Account B (GitHub) │  │
│  │     ├─ phone_verified: ✓                         ├─ phone_verified: ✓│  │
│  │     ├─ trust_score: 85                           ├─ trust_score: 85  │  │
│  │     └─ identity_commitment: 0x7a...              └─ (same commitment)│  │
│  │                                                                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Database Schema

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- PHONE HASH REGISTRY (deduplication enforcement)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE phone_hash_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cryptographic identifiers (no PII)
  phone_hash BYTEA NOT NULL UNIQUE,           -- Poseidon2(phone, pepper), 32 bytes
  identity_commitment BYTEA NOT NULL,          -- Poseidon2(account_id, phone_hash, nonce)

  -- Verification metadata
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_method TEXT NOT NULL DEFAULT 'sms_otp',  -- 'sms_otp' | 'voice_otp' | 'whatsapp'
  carrier_type TEXT,                           -- 'mobile' | 'voip' | 'landline' | null

  -- Linkage (for account linking feature)
  primary_account_id UUID NOT NULL REFERENCES accounts(id),

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Index for dedup lookup
  CONSTRAINT phone_hash_unique UNIQUE (phone_hash)
);

-- Fast lookup for deduplication check
CREATE INDEX idx_phone_hash ON phone_hash_registry USING btree (phone_hash);

-- ═══════════════════════════════════════════════════════════════════════════
-- LINKED ACCOUNTS (multi-OAuth per identity)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE linked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The primary account (owns the phone verification)
  primary_account_id UUID NOT NULL REFERENCES accounts(id),

  -- The linked account (secondary OAuth)
  linked_account_id UUID NOT NULL REFERENCES accounts(id),

  -- Linking metadata
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  link_method TEXT NOT NULL DEFAULT 'phone_otp',  -- 'phone_otp' | 'identity_provider'

  -- Constraints
  CONSTRAINT no_self_link CHECK (primary_account_id != linked_account_id),
  CONSTRAINT unique_link UNIQUE (primary_account_id, linked_account_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PHONE VERIFICATION ATTEMPTS (rate limiting + fraud detection)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE phone_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anonymized tracking (no PII stored)
  phone_hash BYTEA NOT NULL,                   -- Hash even for failed attempts
  account_id UUID REFERENCES accounts(id),     -- NULL if pre-account-creation

  -- Attempt metadata
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  failure_reason TEXT,                         -- 'already_registered' | 'otp_invalid' | 'rate_limited' | 'voip_blocked'

  -- Fraud signals
  ip_hash BYTEA,                               -- H(IP), for rate limiting
  device_fingerprint_hash BYTEA,               -- H(fingerprint), for fraud detection

  -- Retention: 30 days (for fraud analysis)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

-- Fraud detection: many attempts from same IP/device
CREATE INDEX idx_attempts_ip ON phone_verification_attempts (ip_hash, attempted_at);
CREATE INDEX idx_attempts_device ON phone_verification_attempts (device_fingerprint_hash, attempted_at);
```

### 3.6 API Endpoints

```typescript
// POST /api/phone/verify/init
interface InitVerificationRequest {
  phone: string;              // E.164 format: "+12025551234"
  method?: 'sms' | 'voice';   // Default: 'sms'
}

interface InitVerificationResponse {
  sessionId: string;          // Temporary session for OTP verification
  expiresAt: number;          // Unix timestamp, typically 10 minutes
  method: 'sms' | 'voice';
}

// POST /api/phone/verify/complete
interface CompleteVerificationRequest {
  sessionId: string;
  otp: string;                // 6-digit code
  phoneHash: string;          // Client-computed Poseidon2 hash (hex)
  nonce: string;              // Random nonce for commitment
}

interface CompleteVerificationResponse {
  verified: boolean;
  error?: 'otp_invalid' | 'otp_expired' | 'phone_already_registered' | 'rate_limited';
  identityCommitment?: string;  // Returned on success
  trustScoreIncrease?: number;  // How much trust_score increased
}

// POST /api/account/link
interface LinkAccountRequest {
  targetAccountId: string;    // Account to link to
  otp: string;                // OTP sent to verified phone
  phoneHash: string;          // Must match target account's phone
}

interface LinkAccountResponse {
  linked: boolean;
  error?: 'phone_mismatch' | 'otp_invalid' | 'already_linked' | 'different_identity';
  linkedAccounts?: string[];  // All account IDs now linked
}
```

### 3.7 VoIP Detection and Blocking

To prevent abuse via virtual phone numbers:

```typescript
interface CarrierLookup {
  // Use carrier lookup service (Twilio, Nexmo, etc.)
  async function checkCarrier(phone: string): Promise<{
    carrierType: 'mobile' | 'voip' | 'landline' | 'unknown';
    carrier: string;
    countryCode: string;
  }>;
}

// VoIP blocking policy
const VOIP_POLICY = {
  // Known VoIP providers to block
  blockedCarriers: [
    'Google Voice',
    'TextNow',
    'Bandwidth.com',
    'Twilio',     // Block Twilio-issued numbers (not Twilio for sending)
    'Vonage',
    'Grasshopper',
  ],

  // Carrier types
  allowedTypes: ['mobile'],           // Only mobile numbers
  warnTypes: ['landline'],            // Allow with reduced trust
  blockedTypes: ['voip', 'unknown'],  // Block

  // Trust score adjustments
  trustAdjustment: {
    mobile: +20,      // Full trust increase
    landline: +10,    // Reduced trust (can't receive SMS, voice only)
    voip: 0,          // Blocked
    unknown: 0,       // Blocked
  }
};
```

---

## 4. Privacy Analysis

### 4.1 Data Stored vs Not Stored

| Data Element | Stored | Format | Purpose | Retention |
|--------------|--------|--------|---------|-----------|
| Phone number (plaintext) | NO | - | - | - |
| Phone hash | YES | Poseidon2 | Dedup lookup | Indefinite |
| Identity commitment | YES | Poseidon2 | Account binding | Indefinite |
| Account ID | YES | UUID | Linkage | Indefinite |
| Verification timestamp | YES | Timestamp | Audit | Indefinite |
| Carrier type | YES | Enum | VoIP detection | Indefinite |
| IP hash | YES | SHA-256 | Rate limiting | 30 days |
| Device fingerprint hash | YES | SHA-256 | Fraud detection | 30 days |
| OTP codes | NO | - | - | - |

### 4.2 Privacy Properties

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **Phone Unlinkability** | Operator cannot derive phone from hash | One-way Poseidon2 + pepper |
| **Cross-Service Unlinkability** | Hash useless outside VOTER | Application-specific pepper |
| **Account Pseudonymity** | Phone hash doesn't reveal account | Identity commitment indirection |
| **Rainbow Table Resistance** | Pre-computation attacks infeasible | 256-bit pepper, Poseidon2 security |
| **Timing Attack Resistance** | Verification timing doesn't leak info | Constant-time hash comparison |

### 4.3 Data Flow Privacy Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRIVACY FLOW ANALYSIS                                │
│                                                                              │
│  WHAT LEAVES THE DEVICE:                                                     │
│  ├─ Phone number (to OTP service, encrypted in transit)                      │
│  ├─ Phone hash (to server, no plaintext)                                     │
│  └─ OTP code (to server, ephemeral)                                          │
│                                                                              │
│  WHAT THE SERVER SEES:                                                       │
│  ├─ Phone hash (cannot reverse to phone number)                              │
│  ├─ OTP code (ephemeral, not stored)                                         │
│  ├─ Account ID (already known from session)                                  │
│  └─ Carrier type (from lookup service)                                       │
│                                                                              │
│  WHAT THE SERVER CANNOT DETERMINE:                                           │
│  ├─ Actual phone number                                                      │
│  ├─ Phone number from hash (one-way function)                                │
│  ├─ Which accounts share a phone (without exhaustive search)                 │
│  └─ Phone numbers of all users (no enumeration possible)                     │
│                                                                              │
│  WHAT AN ATTACKER WITH DATABASE ACCESS SEES:                                 │
│  ├─ Phone hashes (useless without pepper + exhaustive search)                │
│  ├─ Identity commitments (useless without account correlation)               │
│  └─ Timestamps (when accounts were verified, not phone numbers)              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Retention Policy

| Data Type | Retention | Rationale |
|-----------|-----------|-----------|
| Phone hash | Indefinite | Required for dedup (can't expire) |
| Identity commitment | Indefinite | Required for account binding |
| Verification attempts (success) | 90 days | Audit trail |
| Verification attempts (failure) | 30 days | Fraud detection |
| OTP codes | 0 (never stored) | Security best practice |
| Carrier lookup results | 30 days | Fraud pattern analysis |

### 4.5 GDPR/CCPA Considerations

| Requirement | Compliance Approach |
|-------------|---------------------|
| **Right to Access** | Phone hash is not PII (one-way hash); account data accessible |
| **Right to Deletion** | Account deletion removes linkage; hash remains (anonymized) |
| **Right to Portability** | Verification status portable; hash non-reversible |
| **Data Minimization** | Only hash stored, not phone number |
| **Purpose Limitation** | Hash used only for deduplication, not marketing |

---

## 5. Trust Score Integration

### 5.1 Current Trust Architecture

From `UNIFIED-PROOF-ARCHITECTURE.md` and `CROSS-REPO-IDENTITY-ARCHITECTURE.md`:

| Authority Level | Source | Trust Basis | Current Implementation |
|-----------------|--------|-------------|------------------------|
| **1** | Self-claimed | None | Account created |
| **2** | Location-hinted | IP/GPS | Not implemented |
| **3** | Socially vouched | Peer attestations | Planned Phase 2 |
| **4** | Document-verified | self.xyz/Didit.me | In progress |
| **5** | Government-issued | State ID + liveness | Planned Phase 2 |

### 5.2 Phone Verification as Trust Modifier

Phone verification adds a new dimension orthogonal to the authority level:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRUST SCORE COMPUTATION                              │
│                                                                              │
│  trust_score = base_score + authority_bonus + phone_bonus + activity_bonus   │
│                                                                              │
│  WHERE:                                                                      │
│    base_score = 10 (all accounts start here)                                 │
│                                                                              │
│    authority_bonus:                                                          │
│      Level 1 (self-claimed):     +0                                          │
│      Level 2 (location-hinted):  +5                                          │
│      Level 3 (socially vouched): +15                                         │
│      Level 4 (document-verified): +30                                        │
│      Level 5 (government-issued): +50                                        │
│                                                                              │
│    phone_bonus:                                                              │
│      Not verified:      +0                                                   │
│      Verified (mobile): +20                                                  │
│      Verified (landline): +10                                                │
│                                                                              │
│    activity_bonus:                                                           │
│      Per successful template: +1 (max 20)                                    │
│      Per challenge won:       +5 (max 25)                                    │
│      Account age (months):    +1 (max 12)                                    │
│                                                                              │
│  MAXIMUM POSSIBLE: 10 + 50 + 20 + 57 = 137                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Trust Score Gates

| Action | Minimum Trust Score | Minimum Authority | Phone Required? |
|--------|---------------------|-------------------|-----------------|
| View content | 0 | 1 | No |
| Submit template | 10 | 1 | No |
| Vote on template | 20 | 2 | Recommended |
| Create challenge | 40 | 3 | Yes |
| Participate in challenge market | 50 | 4 | Yes |
| Congressional messaging | 60 | 4 | Yes |
| Access premium features | 80 | 4 | Yes |

### 5.4 Multi-Account Detection Response

When a duplicate phone hash is detected:

```typescript
interface DuplicatePhoneResponse {
  // Option 1: Reject new verification
  action: 'reject';
  message: 'This phone number is already associated with another account.';
  suggestion: 'If you own both accounts, use the account linking feature.';

  // Option 2: Offer account linking (if user proves ownership of both)
  linkingAvailable: boolean;
  linkingUrl: '/settings/link-accounts';
}

// Trust score impact for linked accounts
interface LinkedAccountTrustPolicy {
  // Linked accounts share a single trust score
  sharedTrustScore: true;

  // Activities on any linked account contribute to shared score
  activityAggregation: 'sum';

  // But actions are still per-account (can't vote twice on same thing)
  actionDeduplication: 'per_identity_commitment';
}
```

---

## 6. Implementation Phases

### 6.1 Phase 1: MVP (4-6 weeks)

**Scope:** Basic phone deduplication, no account linking

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: MVP SCOPE                                   │
│                                                                              │
│  IMPLEMENT:                                                                  │
│  ✓ Phone verification endpoints (/verify/init, /verify/complete)            │
│  ✓ Phone hash registry table                                                │
│  ✓ Poseidon2 hashing (client + server)                                      │
│  ✓ Basic VoIP detection (carrier lookup)                                    │
│  ✓ Trust score bonus for verified phones                                    │
│  ✓ Duplicate phone rejection                                                │
│                                                                              │
│  DEFER:                                                                      │
│  ○ Account linking                                                          │
│  ○ Phone number change flow                                                 │
│  ○ Advanced fraud detection                                                 │
│  ○ International number support (US only in MVP)                            │
│                                                                              │
│  DEPENDENCIES:                                                               │
│  - OTP service provider (Twilio recommended)                                │
│  - Carrier lookup service (Twilio Lookup API)                               │
│  - @voter-protocol/crypto Poseidon2 implementation                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Deliverables:**
1. `packages/client/src/phone-verification.ts` - Client-side phone hashing
2. `communique/src/routes/api/phone/` - Verification endpoints
3. Database migrations for `phone_hash_registry`
4. Integration tests for deduplication flow
5. UI components for phone verification

### 6.2 Phase 2: Account Linking (2-3 weeks)

**Scope:** Allow users to link multiple OAuth accounts to one identity

**Deliverables:**
1. Account linking endpoints
2. Linked account trust score sharing
3. UI for managing linked accounts
4. Migration for existing multi-account users (manual linking option)

### 6.3 Phase 3: Advanced Fraud Detection (3-4 weeks)

**Scope:** ML-based fraud detection, international support

**Deliverables:**
1. Device fingerprinting integration
2. Behavioral analysis (verification timing patterns)
3. International phone number support (prioritized countries)
4. VoIP blocklist updates (automated via carrier data)
5. Admin dashboard for fraud review

### 6.4 Phase 4: ZK Integration (Future)

**Scope:** Prove phone verification in ZK proofs

**Deliverables:**
1. Phone verification nullifier in Noir circuit
2. On-chain verification of phone-verified identity
3. Privacy-preserving audit trail

### 6.5 Implementation Timeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION TIMELINE                              │
│                                                                              │
│  Week 1-2: Infrastructure                                                    │
│  ├─ Set up Twilio integration (OTP + Lookup)                                │
│  ├─ Implement Poseidon2 phone hashing (client)                              │
│  └─ Database schema + migrations                                            │
│                                                                              │
│  Week 3-4: Core Flow                                                         │
│  ├─ /verify/init endpoint                                                   │
│  ├─ /verify/complete endpoint                                               │
│  ├─ Deduplication check logic                                               │
│  └─ VoIP blocking                                                           │
│                                                                              │
│  Week 5-6: Integration + Testing                                            │
│  ├─ Trust score integration                                                 │
│  ├─ UI components                                                           │
│  ├─ Integration tests                                                       │
│  └─ Security review                                                         │
│                                                                              │
│  Week 7-8: Account Linking (Phase 2)                                        │
│  ├─ Linking endpoints                                                       │
│  ├─ Trust score sharing                                                     │
│  └─ UI for account management                                               │
│                                                                              │
│  Week 9+: Advanced Features (Phase 3)                                        │
│  ├─ Device fingerprinting                                                   │
│  ├─ International numbers                                                   │
│  └─ Fraud detection ML                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Open Questions

### 7.1 Technical Questions

| # | Question | Options | Recommendation | Decision Needed By |
|---|----------|---------|----------------|-------------------|
| Q1 | **Hash function for phone?** | SHA-256, Poseidon2, Argon2 | **Poseidon2** - ZK compatible, consistent with existing crypto | Phase 1 start |
| Q2 | **Where to compute phone hash?** | Client-only, Server-only, Both | **Both** - Client computes, server verifies | Phase 1 start |
| Q3 | **Pepper storage?** | Environment variable, HSM, KMS | **KMS** - AWS KMS for production, env var for dev | Phase 1 start |
| Q4 | **OTP provider?** | Twilio, AWS SNS, MessageBird | **Twilio** - Best carrier lookup, proven reliability | Phase 1 start |
| Q5 | **Phone number change flow?** | Re-verify, cooldown, manual review | **Cooldown (30 days) + re-verify** | Phase 2 |

### 7.2 Policy Questions

| # | Question | Options | Recommendation | Decision Needed By |
|---|----------|---------|----------------|-------------------|
| P1 | **VoIP policy?** | Block all, allow with reduced trust, allow all | **Block all** - Too easy to abuse | Phase 1 start |
| P2 | **Landline policy?** | Block, allow with voice OTP | **Allow with voice OTP** - Accessibility | Phase 1 start |
| P3 | **International support scope?** | US only, North America, Global | **US only for MVP** - Carrier lookup complexity | Phase 1 start |
| P4 | **Number recycling cooldown?** | 0, 30, 90, 180 days | **90 days** - Balance fraud vs legitimate reuse | Phase 2 |
| P5 | **Family/friend sharing policy?** | Block, allow, rate limit | **Allow** - Can't detect, limited abuse potential | Phase 1 |

### 7.3 UX Questions

| # | Question | Options | Recommendation | Decision Needed By |
|---|----------|---------|----------------|-------------------|
| U1 | **When to prompt for phone?** | On signup, first trusted action, manual | **First trusted action** - Don't gate signup | Phase 1 start |
| U2 | **Phone verification optional?** | Required for all, required for trusted actions, fully optional | **Required for trusted actions** | Phase 1 start |
| U3 | **Duplicate phone messaging?** | Generic error, suggest linking, reveal existing account | **Suggest linking** - Privacy + UX | Phase 1 start |
| U4 | **Phone verification expiry?** | Never, annually, on suspicious activity | **Never** (unless phone changed) | Phase 2 |

### 7.4 Security Questions

| # | Question | Options | Recommendation | Decision Needed By |
|---|----------|---------|----------------|-------------------|
| S1 | **Pepper rotation?** | Never, annually, on compromise | **On compromise only** - Rotation breaks all hashes | Before launch |
| S2 | **Rate limiting?** | Per IP, per device, per phone | **All three** - Defense in depth | Phase 1 start |
| S3 | **OTP validity window?** | 2, 5, 10 minutes | **5 minutes** - Balance security vs UX | Phase 1 start |
| S4 | **Max verification attempts?** | 3, 5, 10 per hour | **5 per hour** - Prevent brute force | Phase 1 start |
| S5 | **SIM swap protection?** | None, carrier check, behavioral | **Carrier check** if available | Phase 2 |

### 7.5 Unresolved Architectural Questions

| # | Question | Impact | Stakeholders |
|---|----------|--------|--------------|
| A1 | **Should phone hash be on-chain?** | Privacy vs auditability tradeoff | Security, Legal |
| A2 | **How does this interact with self.xyz/Didit.me?** | May have phone verification already | Identity team |
| A3 | **Should linked accounts share reputation history?** | Fairness vs abuse prevention | Product |
| A4 | **What happens if pepper is compromised?** | All phone hashes need regeneration | Security, Ops |
| A5 | **How do we handle jurisdiction-specific phone regulations?** | TCPA, GDPR, etc. | Legal |

---

## Appendix A: Cryptographic Details

### A.1 Phone Hash Computation

```typescript
import { poseidon2_hash } from '@voter-protocol/crypto';

// Constants
const PHONE_DOMAIN = 0x50484f4e; // "PHON" in hex
const PEPPER = loadFromKMS('phone-hash-pepper'); // 256-bit secret

/**
 * Compute phone hash for deduplication
 * @param phone E.164 formatted phone number (e.g., "+12025551234")
 * @returns Poseidon2 hash as hex string
 */
function computePhoneHash(phone: string): string {
  // Normalize to ensure consistent hashing
  const normalized = normalizePhone(phone); // -> "+12025551234"

  // Convert phone string to field elements
  const phoneFields = stringToFields(normalized);

  // Domain-separated hash with pepper
  const hash = poseidon2_hash([
    BigInt(PHONE_DOMAIN),
    PEPPER,
    ...phoneFields
  ]);

  return hash.toString(16).padStart(64, '0');
}

/**
 * Compute identity commitment (binds account to phone)
 */
function computeIdentityCommitment(
  accountId: string,
  phoneHash: string,
  nonce: string
): string {
  const COMMITMENT_DOMAIN = 0x434f4d4d; // "COMM" in hex

  const hash = poseidon2_hash([
    BigInt(COMMITMENT_DOMAIN),
    BigInt('0x' + accountId.replace(/-/g, '')), // UUID to bigint
    BigInt('0x' + phoneHash),
    BigInt('0x' + nonce)
  ]);

  return hash.toString(16).padStart(64, '0');
}
```

### A.2 Security Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Phone hash output | 256 bits | Poseidon2 native output |
| Pepper size | 256 bits | Match hash security level |
| Nonce size | 128 bits | Sufficient for replay prevention |
| OTP length | 6 digits | Standard, 1M combinations |
| OTP validity | 5 minutes | Balance security/UX |

---

## Appendix B: Error Codes

| Code | HTTP Status | Description | User Message |
|------|-------------|-------------|--------------|
| `PHONE_INVALID_FORMAT` | 400 | Phone not E.164 format | "Please enter a valid phone number" |
| `PHONE_ALREADY_REGISTERED` | 409 | Hash exists in registry | "This phone is linked to another account. Would you like to link your accounts?" |
| `PHONE_VOIP_BLOCKED` | 403 | VoIP number detected | "Virtual phone numbers are not supported. Please use a mobile number." |
| `OTP_INVALID` | 401 | Wrong OTP code | "Invalid code. Please try again." |
| `OTP_EXPIRED` | 401 | OTP session expired | "Code expired. Please request a new one." |
| `RATE_LIMITED` | 429 | Too many attempts | "Too many attempts. Please try again in X minutes." |
| `CARRIER_LOOKUP_FAILED` | 503 | Carrier API error | "Verification temporarily unavailable. Please try again." |

---

## Appendix C: Related Documents

- `SECURITY.md` - Overall security architecture
- `CROSS-REPO-IDENTITY-ARCHITECTURE.md` - Identity system analysis
- `UNIFIED-PROOF-ARCHITECTURE.md` - ZK proof design with authority levels
- `GOVERNANCE-VERIFICATION-SYSTEM-SPEC.md` - Future representative verification
- `specs/REMEDIATION-WAVE-PLAN.md` - Implementation tracking (Wave 6)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-01 | Security Architecture Team | Initial design specification |

---

**Next Steps:**
1. Review with security team for threat model validation
2. Review with legal for TCPA/GDPR compliance
3. Decision on open questions (Section 7)
4. Phase 1 implementation kickoff
