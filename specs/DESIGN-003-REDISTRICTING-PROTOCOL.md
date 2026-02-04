# Redistricting Emergency Protocol Design Specification

> **Spec ID:** DESIGN-003
> **Version:** 1.0.0
> **Status:** DRAFT
> **Last Updated:** 2026-02-01
> **Authors:** Voter Protocol Team
> **Related Specs:** DATA-INTEGRITY-SPEC, SHADOW-ATLAS-SPEC, DISTRICT-TAXONOMY

---

## 1. Executive Summary

### 1.1 The Problem

When federal or state courts order redistricting due to constitutional violations (racial gerrymandering, malapportionment, Voting Rights Act violations), the authoritative boundary data enters an indeterminate state:

1. **TIGER/Line Lag:** Census Bureau TIGER/Line data updates annually (July), creating a 6-12 month gap between court-ordered redistricting and official federal data release
2. **Proof Invalidation:** Existing ZK proofs may reference districts that no longer exist or have changed boundaries
3. **Voter Disenfranchisement:** Users cannot prove residency in newly-created or modified districts
4. **Legal Uncertainty:** During litigation appeals, boundaries may change multiple times

**Real-World Example: Alabama Congressional Districts (2023-2024)**
```
Timeline: Allen v. Milligan / Singleton v. Allen
────────────────────────────────────────────────────────────────────
Jun 2023:  SCOTUS rules Alabama violated VRA Section 2
           -> State ordered to create 2nd majority-Black district

Jul 2023:  Alabama legislature passes "remedial" map
           -> District Court rejects as non-compliant

Oct 2023:  Court-appointed special master draws new map
           -> Effective immediately for 2024 primaries

Jul 2024:  TIGER 2024 finally reflects new boundaries
           -> 12-month gap where official data was stale
────────────────────────────────────────────────────────────────────
IMPACT: Any system using only TIGER data served incorrect districts
        for 12+ months during active litigation
```

### 1.2 Design Goals

1. **Zero Disenfranchisement:** No valid voter should be unable to prove district membership during redistricting
2. **Dual Validity:** Both old and new boundaries accepted during transition periods
3. **Rapid Ingestion:** Emergency data from state sources integrated within 72 hours of court order
4. **Transparent Provenance:** Clear audit trail of which boundaries are court-ordered vs. standard TIGER
5. **Rollback Capability:** Ability to revert if court orders are stayed or overturned

### 1.3 Solution Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REDISTRICTING EMERGENCY PROTOCOL                          │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ PHASE 1: DETECTION                                                      │ │
│  │   • PACER docket monitoring for redistricting cases                    │ │
│  │   • State redistricting commission RSS feeds                           │ │
│  │   • Manual admin trigger with audit logging                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ PHASE 2: DUAL-VALIDITY WINDOW                                           │ │
│  │   • Old epoch root: VALID (epoch N)                                    │ │
│  │   • New epoch root: VALID (epoch N+1, emergency flag)                  │ │
│  │   • Configurable window: 30-90 days (default 30)                       │ │
│  │   • Overlapping proofs accepted from either epoch                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ PHASE 3: EMERGENCY DATA INGESTION                                       │ │
│  │   • State official provides court-approved shapefile                   │ │
│  │   • Validate against court order boundary descriptions                 │ │
│  │   • Generate new Merkle tree with PROVISIONAL flag                     │ │
│  │   • Publish to IPFS with emergency provenance metadata                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ PHASE 4: USER NOTIFICATION                                              │ │
│  │   • Email/push to users with affected district_hash                    │ │
│  │   • In-app banner: "Your district boundaries may have changed"         │ │
│  │   • Prompt for proof regeneration with new epoch                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ PHASE 5: CONVERGENCE                                                    │ │
│  │   • TIGER release incorporates court-ordered boundaries                │ │
│  │   • Emergency epoch deprecated, standard epoch becomes canonical       │ │
│  │   • Dual-validity window closes                                        │ │
│  │   • Audit log archived with full provenance                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Problem Statement

### 2.1 Why Redistricting Creates Emergencies

Redistricting emergencies occur when the legal definition of districts changes faster than official data sources can update. This creates a conflict between:

- **Legal Reality:** Courts have ordered new boundaries that are legally binding
- **Data Reality:** TIGER/Line and other authoritative sources still show old boundaries
- **Proof Reality:** ZK proofs reference old district hashes that no longer correspond to legal districts

### 2.2 Common Redistricting Triggers

| Trigger | Legal Basis | Typical Timeline | Example Cases |
|---------|-------------|------------------|---------------|
| **Racial Gerrymandering** | VRA Section 2, 14th/15th Amendment | 6-24 months litigation | Allen v. Milligan (AL), Alexander v. SCGOP (SC) |
| **Partisan Gerrymandering** | State constitutions | 3-18 months | Moore v. Harper (NC), LWV v. Commonwealth (PA) |
| **Malapportionment** | One person, one vote | 1-6 months | Post-census population shifts |
| **Prison Gerrymandering** | State laws (growing) | Varies | NY, CA, WA state-level reforms |
| **Post-Census Redistricting** | Constitutional mandate | 12-24 months (decennial) | Every state post-2020, post-2030 |

### 2.3 The Data Lag Problem

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        REDISTRICTING DATA LAG TIMELINE                       │
│                                                                              │
│  Court Order                    State Implementation           TIGER Release │
│      │                                │                              │       │
│      ▼                                ▼                              ▼       │
│ ─────●──────────────────────────────●─────────────────────────────●─────── │
│      │                                │                              │       │
│      │◀──────── GAP 1 ───────────▶│◀────────── GAP 2 ──────────▶│       │
│      │    (State compliance)         │    (Federal data update)      │       │
│      │    2-6 months typical         │    6-12 months typical        │       │
│      │                                │                              │       │
│  ┌───┴───────────────────────────────┴─────────────────────────────┴───┐   │
│  │                                                                      │   │
│  │  During these gaps, voters in affected districts cannot generate    │   │
│  │  valid proofs if the system only accepts current TIGER boundaries   │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Affected Populations

Redistricting emergencies disproportionately affect:

1. **Voters in Newly-Created Districts:** Cannot prove membership until data updates
2. **Voters in Dissolved Districts:** Old proofs reference non-existent districts
3. **Voters in Boundary-Changed Districts:** May be in different district than proof claims
4. **Voters in Litigation Zones:** Boundaries may change multiple times during appeals

**Scale Estimate (2020-2024 cycle):**
- 15+ states had redistricting litigation
- 50+ congressional districts affected
- 200+ state legislative districts affected
- Estimated 10-20 million voters in affected districts

---

## 3. Threat Model

### 3.1 Risks of Stale Data (Type I Errors)

| Risk | Description | Impact | Likelihood |
|------|-------------|--------|------------|
| **False Negative** | Valid voter cannot prove residency in new district | Disenfranchisement | HIGH during litigation |
| **Wrong District Claim** | Voter proves old district that no longer represents them | Misdirected representation | MEDIUM |
| **Orphaned Proofs** | Existing proofs reference deleted districts | Proof invalidation | HIGH after court orders |

### 3.2 Risks of Premature Data (Type II Errors)

| Risk | Description | Impact | Likelihood |
|------|-------------|--------|------------|
| **False Positive** | Voter proves residency in district that gets overturned on appeal | Invalid claims | LOW (stays rare) |
| **Conflicting Claims** | Same voter has valid proofs in contradictory districts | Sybil risk | MEDIUM during dual-validity |
| **Premature Adoption** | System adopts boundaries that are later modified | Data inconsistency | MEDIUM |

### 3.3 Malicious Actor Threats

| Threat | Attack Vector | Mitigation |
|--------|---------------|------------|
| **Fake Court Orders** | Forged documents claiming redistricting | Require PACER docket verification |
| **Rushed Bad Data** | Submitting incorrect shapefiles as "emergency" | Validate against court order text |
| **Dual-Validity Exploitation** | Generate proofs in both old and new districts | Nullifier scoping prevents double-voting |
| **Timing Attacks** | Exploit window between epochs | Grace periods with overlap tracking |

### 3.4 Acceptable Risk Tradeoffs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RISK TOLERANCE MATRIX                                │
│                                                                              │
│  Voter Disenfranchisement Risk                                              │
│         │                                                                    │
│    HIGH │  ■ UNACCEPTABLE                                                   │
│         │  ■ Current TIGER-only approach during redistricting               │
│         │                                                                    │
│  MEDIUM │  □ Emergency protocol without validation                           │
│         │  □ Accepting any state-provided data                              │
│         │                                                                    │
│     LOW │  ✓ ACCEPTABLE                                                     │
│         │  ✓ Emergency protocol with PACER + court order validation         │
│         │  ✓ Dual-validity with nullifier scoping                           │
│         │                                                                    │
│         └────────────────────────────────────────────────────────────────── │
│                 LOW              MEDIUM              HIGH                    │
│                        Bad Data Ingestion Risk                               │
│                                                                              │
│  DESIGN TARGET: Lower-left quadrant (low risk of both error types)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detection System

### 4.1 PACER Monitoring Architecture

The Public Access to Court Electronic Records (PACER) system provides authoritative information about federal court cases. The detection system monitors PACER for redistricting-related filings.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PACER MONITORING ARCHITECTURE                          │
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │   PACER API     │                                                        │
│  │  (via RECAP)    │ ◀──── Daily polling (4 AM UTC)                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      CASE FILTER                                     │   │
│  │                                                                      │   │
│  │  Keywords: "redistricting" | "reapportionment" | "gerrymandering"   │   │
│  │            | "VRA" | "Voting Rights Act" | "one person one vote"    │   │
│  │                                                                      │   │
│  │  Courts:   All federal district courts                              │   │
│  │            All circuit courts of appeal                             │   │
│  │            Supreme Court                                             │   │
│  │                                                                      │   │
│  │  Document Types: Orders, Judgments, Injunctions, Stays              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      EVENT CLASSIFIER                                │   │
│  │                                                                      │   │
│  │  Priority 1 (EMERGENCY): Court orders new map implementation       │   │
│  │  Priority 2 (HIGH):      Injunction against current map            │   │
│  │  Priority 3 (MEDIUM):    Court finds constitutional violation      │   │
│  │  Priority 4 (LOW):       New lawsuit filed                         │   │
│  │  Priority 5 (WATCH):     Appeal filed on redistricting case        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      ALERT DISPATCHER                                │   │
│  │                                                                      │   │
│  │  Priority 1-2: Immediate admin notification + auto-flag state      │   │
│  │  Priority 3:   Admin notification within 24 hours                  │   │
│  │  Priority 4-5: Weekly digest to monitoring team                    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 State Redistricting Commission Monitoring

Many states have independent redistricting commissions with public meeting schedules and RSS feeds.

```typescript
interface RedistrictingCommissionFeed {
  readonly state: string;                    // ISO 3166-2 code (e.g., "US-CA")
  readonly commissionName: string;           // "CA Citizens Redistricting Commission"
  readonly feedUrl: string | null;           // RSS/Atom feed URL
  readonly meetingCalendarUrl: string | null;
  readonly mapPublicationUrl: string | null; // Where official maps are posted
  readonly pollFrequency: 'hourly' | 'daily' | 'weekly';
}

// Known feeds (subset)
const COMMISSION_FEEDS: RedistrictingCommissionFeed[] = [
  {
    state: 'US-CA',
    commissionName: 'California Citizens Redistricting Commission',
    feedUrl: 'https://www.wedrawthelinesca.org/feed',
    meetingCalendarUrl: 'https://www.wedrawthelinesca.org/meetings',
    mapPublicationUrl: 'https://www.wedrawthelinesca.org/final_maps',
    pollFrequency: 'daily',
  },
  {
    state: 'US-AZ',
    commissionName: 'Arizona Independent Redistricting Commission',
    feedUrl: null, // No RSS
    meetingCalendarUrl: 'https://irc.az.gov/meetings',
    mapPublicationUrl: 'https://irc.az.gov/final-maps',
    pollFrequency: 'weekly',
  },
  // ... additional states
];
```

### 4.3 Manual Trigger Protocol

Administrators can manually flag a redistricting emergency when automated detection misses an event.

```typescript
interface ManualEmergencyTrigger {
  readonly triggeredBy: string;              // Admin identifier
  readonly triggeredAt: string;              // ISO 8601 timestamp
  readonly state: string;                    // Affected state(s)
  readonly districtType: BoundaryType;       // congressional, state_senate, etc.
  readonly justification: string;            // Free-text explanation
  readonly courtCase: string | null;         // PACER case number if applicable
  readonly documentUrls: string[];           // Supporting documentation
  readonly requiredApprovals: number;        // Multi-sig threshold (default: 2)
  readonly approvals: AdminApproval[];
}

interface AdminApproval {
  readonly admin: string;
  readonly approvedAt: string;
  readonly signature: string;                // Ed25519 signature over trigger hash
}
```

**Manual Trigger Requirements:**
1. At least 2 admin approvals required
2. Supporting documentation must include one of:
   - PACER court order document
   - State government official announcement
   - News coverage from 2+ reputable sources
3. All triggers logged to immutable audit trail

### 4.4 Detection Data Structures

```typescript
interface RedistrictingEvent {
  readonly eventId: string;                  // UUID
  readonly detectedAt: string;               // ISO 8601
  readonly detectionSource: 'pacer' | 'commission' | 'manual' | 'media';
  readonly priority: 1 | 2 | 3 | 4 | 5;

  // Affected jurisdiction
  readonly state: string;                    // US-AL, US-TX, etc.
  readonly districtType: BoundaryType;
  readonly affectedDistricts: string[];      // District IDs

  // Court case details (if applicable)
  readonly courtCase: {
    readonly caseNumber: string;             // e.g., "2:21-cv-01291"
    readonly court: string;                  // "N.D. Ala."
    readonly caseName: string;               // "Allen v. Milligan"
    readonly docketUrl: string;              // PACER link
  } | null;

  // Boundary change details
  readonly changeType: 'new_map' | 'injunction' | 'stay' | 'remand' | 'appeal';
  readonly effectiveDate: string | null;     // When new boundaries take effect
  readonly complianceDeadline: string | null; // Court-ordered deadline

  // Processing status
  readonly status: 'detected' | 'verified' | 'data_requested' | 'data_received'
                 | 'validating' | 'ingested' | 'active' | 'converged' | 'rejected';
}
```

---

## 5. Dual-Validity Window

### 5.1 Concept

During a redistricting emergency, both the old epoch (pre-redistricting) and new epoch (post-redistricting) Merkle roots are considered valid for proof verification. This ensures:

1. Users with existing proofs can still use them during transition
2. Users who regenerate proofs with new boundaries are accepted
3. No voter is disenfranchised due to timing of proof generation

### 5.2 Window Configuration

```typescript
interface DualValidityWindow {
  readonly emergencyEventId: string;         // Links to RedistrictingEvent
  readonly state: string;
  readonly districtType: BoundaryType;

  // Epoch references
  readonly oldEpoch: {
    readonly epochNumber: number;
    readonly globalRoot: bigint;
    readonly activatedAt: string;
  };
  readonly newEpoch: {
    readonly epochNumber: number;
    readonly globalRoot: bigint;
    readonly activatedAt: string;
    readonly emergencyFlag: true;            // Marks as emergency epoch
    readonly provenanceHash: string;         // Hash of ingestion provenance
  };

  // Window timing
  readonly windowOpenedAt: string;           // When dual-validity began
  readonly windowDuration: number;           // Days (default: 30)
  readonly windowClosesAt: string;           // Computed: openedAt + duration
  readonly extendedTo: string | null;        // If window was extended

  // Status
  readonly status: 'active' | 'extended' | 'closing' | 'closed';
}
```

### 5.3 Proof Verification During Dual-Validity

```
ALGORITHM: VerifyProofDuringDualValidity
INPUT: proof, districtHash, nullifier, claimedRoot
OUTPUT: {valid: boolean, epoch: number, warning: string | null}

1. # Check if claimed root matches current epoch
   IF claimedRoot == currentEpoch.globalRoot THEN
     RETURN {valid: true, epoch: currentEpoch.number, warning: null}
   END IF

2. # Check if dual-validity window is active for this district
   dualWindow := FindActiveDualValidityWindow(districtHash)

   IF dualWindow == NULL THEN
     # No active window - only current epoch valid
     IF claimedRoot != currentEpoch.globalRoot THEN
       RETURN {valid: false, epoch: null, warning: "Stale epoch - please regenerate proof"}
     END IF
   END IF

3. # Dual-validity window is active
   IF claimedRoot == dualWindow.oldEpoch.globalRoot THEN
     # Valid under old epoch during transition
     RETURN {
       valid: true,
       epoch: dualWindow.oldEpoch.number,
       warning: "Your district may have changed - consider regenerating proof"
     }
   ELSE IF claimedRoot == dualWindow.newEpoch.globalRoot THEN
     # Valid under new emergency epoch
     RETURN {valid: true, epoch: dualWindow.newEpoch.number, warning: null}
   ELSE
     # Root doesn't match either valid epoch
     RETURN {valid: false, epoch: null, warning: "Invalid epoch root"}
   END IF

4. RETURN {valid: false, epoch: null, warning: "Verification failed"}
```

### 5.4 Window Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DUAL-VALIDITY WINDOW LIFECYCLE                            │
│                                                                              │
│   Day 0              Day 1-7           Day 8-30          Day 31+            │
│     │                  │                  │                 │                │
│     ▼                  ▼                  ▼                 ▼                │
│  ┌──────┐          ┌──────┐          ┌──────┐          ┌──────┐            │
│  │DETECT│ ────────▶│INGEST│ ────────▶│ACTIVE│ ────────▶│CLOSE │            │
│  └──────┘          └──────┘          └──────┘          └──────┘            │
│     │                  │                  │                 │                │
│     │                  │                  │                 │                │
│  Detection          Emergency          Both epochs       Only new           │
│  verified           epoch created      accepted          epoch valid        │
│                     Old epoch still                                          │
│                     primary                                                  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  EPOCH VALIDITY:                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Old Epoch (N):    [========VALID========][========VALID========][INVALID]  │
│  New Epoch (N+1):              [===========VALID===========][====VALID===]  │
│                                                                              │
│                    │←──── Dual-Validity Window (30 days) ────▶│             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.5 Window Extension Protocol

In cases where litigation is ongoing or state compliance is delayed, the dual-validity window can be extended:

```typescript
interface WindowExtension {
  readonly extensionId: string;
  readonly windowId: string;                 // DualValidityWindow reference
  readonly requestedBy: string;              // Admin identifier
  readonly requestedAt: string;
  readonly newClosesAt: string;              // Extended close date
  readonly reason: 'appeal_pending' | 'state_noncompliance' | 'data_issues' | 'other';
  readonly justification: string;            // Free-text explanation
  readonly approvals: AdminApproval[];       // Requires 2 admin approvals
  readonly maxExtension: number;             // Days (hard limit: 90 days total)
}
```

**Extension Rules:**
- Maximum 2 extensions per window
- Maximum total window duration: 90 days
- Each extension requires multi-admin approval
- Extension requests logged to audit trail

---

## 6. Emergency Data Ingestion

### 6.1 Data Request Protocol

When a redistricting event is verified, the system initiates a request for authoritative boundary data from the state.

```typescript
interface EmergencyDataRequest {
  readonly requestId: string;
  readonly eventId: string;                  // RedistrictingEvent reference
  readonly state: string;
  readonly districtType: BoundaryType;

  // Request details
  readonly requestedFrom: {
    readonly entity: string;                 // "Alabama Secretary of State"
    readonly contactEmail: string;
    readonly requestSentAt: string;
  };

  // Expected data format
  readonly expectedFormat: 'shapefile' | 'geojson' | 'geopackage';
  readonly expectedCRS: 'EPSG:4326';         // WGS 84 required
  readonly requiredAttributes: string[];     // ['GEOID', 'NAMELSAD', 'ALAND']

  // Court order reference
  readonly courtOrderReference: {
    readonly caseNumber: string;
    readonly orderDate: string;
    readonly orderDocumentHash: string;      // SHA-256 of court order PDF
    readonly boundaryDescription: string;    // Extracted from court order
  };

  // Status tracking
  readonly status: 'pending' | 'received' | 'validating' | 'accepted' | 'rejected';
  readonly receivedAt: string | null;
  readonly dataHash: string | null;          // SHA-256 of received data
}
```

### 6.2 Validation Pipeline

Emergency data undergoes rigorous validation before ingestion:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EMERGENCY DATA VALIDATION PIPELINE                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 1: FORMAT VALIDATION                                           │   │
│  │   • Valid GeoJSON/Shapefile structure                               │   │
│  │   • WGS 84 coordinate system (EPSG:4326)                            │   │
│  │   • Required attributes present (GEOID, NAMELSAD, etc.)             │   │
│  │   • No topology errors (self-intersections, gaps, overlaps)         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                            PASS    │    FAIL → Reject with specific errors  │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 2: COURT ORDER CROSS-VALIDATION                                │   │
│  │   • District count matches court order specification                │   │
│  │   • Named districts align with court order text                     │   │
│  │   • Geographic extent matches affected jurisdiction                 │   │
│  │   • Population distribution meets court requirements (if specified) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                            PASS    │    FAIL → Manual review required       │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 3: INTEGRITY CHECKS                                            │   │
│  │   • Full coverage of state/jurisdiction (no gaps)                   │   │
│  │   • No overlapping districts                                        │   │
│  │   • Reasonable population per district (within 5% of ideal)         │   │
│  │   • Contiguity requirements met                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                            PASS    │    FAIL → Flag for manual review       │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 4: ADMIN APPROVAL                                              │   │
│  │   • At least 2 admin approvals required                             │   │
│  │   • Validation report reviewed and signed                           │   │
│  │   • Emergency provenance metadata attached                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                            APPROVED │                                        │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 5: MERKLE TREE GENERATION                                      │   │
│  │   • Generate district leaf hashes                                   │   │
│  │   • Build hierarchical tree (global → continental → country → region)│   │
│  │   • Compute new epoch root with EMERGENCY flag                      │   │
│  │   • Publish to IPFS with provenance CID                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Provenance Metadata

Emergency epochs include additional provenance metadata for audit purposes:

```typescript
interface EmergencyProvenanceMetadata {
  readonly epochNumber: number;
  readonly emergencyFlag: true;              // Distinguishes from standard epochs

  // Event linkage
  readonly triggeringEvent: {
    readonly eventId: string;
    readonly detectionSource: string;
    readonly courtCase: string | null;
  };

  // Data source
  readonly dataSource: {
    readonly sourceEntity: string;           // "Alabama Secretary of State"
    readonly receivedAt: string;
    readonly dataHash: string;               // SHA-256 of source data
    readonly format: string;
  };

  // Court order reference
  readonly courtOrder: {
    readonly caseNumber: string;
    readonly orderDate: string;
    readonly orderHash: string;              // SHA-256 of court order PDF
    readonly orderIpfsCid: string;           // IPFS CID of archived order
  };

  // Validation record
  readonly validation: {
    readonly completedAt: string;
    readonly validatorVersion: string;
    readonly checksPerformed: string[];
    readonly warnings: string[];
  };

  // Approval chain
  readonly approvals: {
    readonly admin: string;
    readonly approvedAt: string;
    readonly signature: string;
  }[];

  // IPFS references
  readonly ipfsCids: {
    readonly provenanceManifest: string;
    readonly sourceData: string;
    readonly merkleTree: string;
    readonly courtOrderArchive: string;
  };
}
```

### 6.4 Merkle Tree Integration

Emergency epochs integrate into the existing global hierarchical tree structure:

```typescript
interface EmergencyEpochTree {
  // Standard tree structure (unchanged)
  readonly globalRoot: bigint;
  readonly continentalRoots: Map<string, bigint>;
  readonly countryRoots: Map<string, bigint>;
  readonly regionRoots: Map<string, bigint>;
  readonly districtLeaves: Map<string, DistrictLeaf>;

  // Emergency-specific metadata
  readonly epochMetadata: {
    readonly epochNumber: number;
    readonly createdAt: string;
    readonly emergencyFlag: true;
    readonly provenanceCid: string;          // IPFS CID of EmergencyProvenanceMetadata
  };

  // Affected regions only
  readonly affectedRegions: string[];        // e.g., ["US-AL"] for Alabama
  readonly unchangedRegionRoots: Map<string, bigint>;  // Inherited from previous epoch
}
```

**Key Principle:** Only affected regions are rebuilt. Unchanged regions inherit their roots from the previous epoch, minimizing computation and enabling efficient incremental updates.

---

## 7. Notification System

### 7.1 User Notification Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      USER NOTIFICATION ARCHITECTURE                          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ NOTIFICATION TRIGGERS                                                │   │
│  │   • Emergency epoch activated for user's district                   │   │
│  │   • Dual-validity window opened                                     │   │
│  │   • User's existing proof may be stale                              │   │
│  │   • Dual-validity window closing (7-day warning)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ USER MATCHING                                                        │   │
│  │                                                                      │   │
│  │  For each user with notification preferences:                       │   │
│  │    1. Check if user's district_hash matches affected districts     │   │
│  │    2. Check if user has proofs in affected epoch                   │   │
│  │    3. Queue notification based on user preferences                 │   │
│  │                                                                      │   │
│  │  NOTE: System does NOT know user addresses - only district_hashes   │   │
│  │        This preserves privacy while enabling targeted notifications│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ NOTIFICATION CHANNELS                                                │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │   │
│  │  │   Email     │  │  Push       │  │  In-App     │                 │   │
│  │  │   (opt-in)  │  │  (opt-in)   │  │  Banner     │                 │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │   │
│  │                                                                      │   │
│  │  Privacy: Notifications sent without revealing user addresses       │   │
│  │  Frequency: Max 1 notification per event type per user             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Notification Types

```typescript
type NotificationType =
  | 'redistricting_detected'       // Initial detection of redistricting event
  | 'dual_validity_opened'         // Dual-validity window is now active
  | 'proof_may_be_stale'           // User's proof references old epoch
  | 'action_recommended'           // Regenerate proof recommended
  | 'window_closing_soon'          // 7-day warning before window closes
  | 'window_closed'                // Dual-validity window has ended
  | 'new_epoch_canonical';         // Emergency epoch became standard epoch

interface UserNotification {
  readonly notificationId: string;
  readonly type: NotificationType;
  readonly userId: string;                   // Opaque user identifier
  readonly districtHash: string;             // Affected district (no address)
  readonly createdAt: string;
  readonly expiresAt: string;

  // Content (privacy-preserving)
  readonly title: string;
  readonly body: string;
  readonly actionUrl: string | null;         // Deep link to proof regeneration

  // Delivery tracking
  readonly channels: ('email' | 'push' | 'in_app')[];
  readonly deliveredVia: ('email' | 'push' | 'in_app')[];
  readonly readAt: string | null;
  readonly actedOnAt: string | null;         // User clicked action
}
```

### 7.3 Notification Templates

**Template: Redistricting Detected**
```
Subject: District boundary changes may affect you

Your district boundaries may have changed due to a court-ordered redistricting.

What this means:
- Your existing proofs are still valid during the transition period
- You may want to regenerate your proof to reflect new boundaries
- Both old and new boundaries will be accepted for the next 30 days

Affected district: [DISTRICT_NAME] ([STATE])
Court case: [CASE_NAME] ([CASE_NUMBER])

[Regenerate Proof Button]

Questions? Visit our FAQ at [HELP_URL]
```

**Template: Window Closing Soon**
```
Subject: Action recommended - district proof update

Your district proof will no longer be valid under old boundaries in 7 days.

After [CLOSE_DATE], only proofs generated with the new [DISTRICT_TYPE]
boundaries will be accepted.

Please regenerate your proof before the transition period ends.

[Regenerate Proof Button]

If you've already regenerated your proof, you can ignore this message.
```

### 7.4 In-App Banner Specification

```typescript
interface InAppBanner {
  readonly bannerId: string;
  readonly type: 'info' | 'warning' | 'action_required';
  readonly title: string;
  readonly message: string;
  readonly dismissible: boolean;
  readonly actionButton: {
    readonly label: string;
    readonly url: string;
  } | null;
  readonly showUntil: string;                // ISO 8601 expiration

  // Targeting
  readonly targetDistrictHashes: string[];   // Show only to affected users
  readonly targetEpochs: number[];           // Show only to users with these epochs
}

// Example banner during dual-validity
const redistrictingBanner: InAppBanner = {
  bannerId: 'redistrict-AL-2024-01',
  type: 'warning',
  title: 'Your district may have changed',
  message: 'A court has ordered new boundaries for Alabama congressional districts. ' +
           'Your existing proof is still valid, but you may want to regenerate it ' +
           'to ensure it reflects your current district.',
  dismissible: true,
  actionButton: {
    label: 'Regenerate Proof',
    url: '/proof/regenerate?district=congressional&state=AL'
  },
  showUntil: '2024-06-15T00:00:00Z',
  targetDistrictHashes: ['0x1234...', '0x5678...'],  // Affected district hashes
  targetEpochs: [42, 43],                            // Old and new epochs
};
```

---

## 8. Rollback Procedure

### 8.1 Rollback Triggers

Emergency epochs may need to be rolled back if:

1. **Court Order Stayed:** Appeals court issues stay pending appeal
2. **Data Errors Discovered:** Ingested data found to be incorrect
3. **Court Order Overturned:** Higher court reverses redistricting order
4. **Compliance Invalidated:** State's remedial map rejected by court

### 8.2 Rollback Protocol

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ROLLBACK PROTOCOL                                    │
│                                                                              │
│  TRIGGER: Rollback condition detected                                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: ASSESS IMPACT                                                │   │
│  │   • Count proofs generated under emergency epoch                    │   │
│  │   • Identify users who regenerated during dual-validity             │   │
│  │   • Estimate timeline for affected users                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: ADMIN APPROVAL                                               │   │
│  │   • Require 3 admin approvals for rollback (higher threshold)       │   │
│  │   • Document reason with supporting evidence                        │   │
│  │   • Notify legal/compliance team                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: EXTEND DUAL-VALIDITY                                         │   │
│  │   • If window still open: Extend to maximum (90 days)               │   │
│  │   • If window closed: Reopen with extended duration                 │   │
│  │   • Both old and emergency epochs remain valid                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: NOTIFY AFFECTED USERS                                        │   │
│  │   • Email/push: "District boundaries reverted - action may be needed"│   │
│  │   • In-app banner with regeneration prompt                          │   │
│  │   • Offer extended grace period                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: DEPRECATE EMERGENCY EPOCH                                    │   │
│  │   • Mark emergency epoch as DEPRECATED (not INVALID)                │   │
│  │   • Continue accepting during extended grace period                 │   │
│  │   • Log deprecation in provenance manifest                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: CONVERGENCE                                                  │   │
│  │   • After grace period: Only pre-emergency epoch valid              │   │
│  │   • Archive emergency epoch data with ROLLED_BACK status            │   │
│  │   • Complete audit trail logged                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Rollback Data Structures

```typescript
interface EpochRollback {
  readonly rollbackId: string;
  readonly emergencyEpoch: number;           // Epoch being rolled back
  readonly rollbackToEpoch: number;          // Epoch to restore as canonical
  readonly initiatedAt: string;
  readonly completedAt: string | null;

  // Reason
  readonly reason: 'court_stay' | 'data_error' | 'order_overturned' | 'compliance_rejected';
  readonly justification: string;
  readonly supportingDocuments: string[];    // IPFS CIDs

  // Approval chain (higher threshold)
  readonly requiredApprovals: 3;
  readonly approvals: AdminApproval[];

  // Impact assessment
  readonly impactAssessment: {
    readonly proofsAffected: number;
    readonly usersAffected: number;
    readonly gracePeriodExtension: number;   // Days
  };

  // Status
  readonly status: 'pending_approval' | 'approved' | 'in_progress' | 'completed' | 'failed';
}

interface DeprecatedEpoch {
  readonly epochNumber: number;
  readonly globalRoot: bigint;
  readonly deprecatedAt: string;
  readonly deprecationReason: string;
  readonly rollbackId: string;

  // Validity
  readonly validUntil: string;               // Extended grace period end
  readonly status: 'deprecated' | 'invalid';

  // Provenance
  readonly originalProvenance: EmergencyProvenanceMetadata;
  readonly rollbackProvenance: {
    readonly rollbackId: string;
    readonly completedAt: string;
    readonly archivedDataCid: string;
  };
}
```

### 8.4 Rollback-Proof Design

To minimize rollback impact, the system is designed with rollback resistance:

1. **Nullifier Independence:** Nullifiers are scoped to application context, not epoch. Rollback doesn't invalidate nullifier usage.
2. **District Hash Stability:** If court reinstates original boundaries, original district hashes are valid again.
3. **Grace Period Generosity:** Extended grace periods (up to 90 days) give users time to adapt.
4. **No Punitive Action:** Users who acted in good faith during emergency epoch are not penalized.

---

## 9. Implementation Phases

### 9.1 Phase Overview

| Phase | Scope | Timeline | Priority |
|-------|-------|----------|----------|
| **Phase 1: MVP** | Manual trigger + basic dual-validity | 4 weeks | P0 |
| **Phase 2: Detection** | PACER monitoring + auto-detection | 6 weeks | P1 |
| **Phase 3: Full Automation** | State feeds + auto-ingestion | 8 weeks | P2 |
| **Phase 4: Hardening** | Rollback + notification optimization | 4 weeks | P2 |

### 9.2 Phase 1: MVP (P0)

**Goal:** Enable manual emergency response with basic dual-validity support.

**Deliverables:**

1. **Manual Emergency Trigger**
   - Admin CLI command: `npx atlas:emergency:trigger --state US-AL --type congressional`
   - Requires 2 admin signatures
   - Logs to audit trail

2. **Emergency Data Ingestion**
   - Manual shapefile upload via admin interface
   - Basic format validation (GeoJSON/Shapefile)
   - Manual admin approval step

3. **Dual-Validity Window**
   - Hard-coded 30-day window
   - Contract supports multiple valid roots
   - Proof verification checks both epochs

4. **Basic Notifications**
   - In-app banner for affected users
   - Email notification (if opted in)

**Implementation Checklist:**
- [ ] `emergency/manual-trigger.ts` - Admin CLI for emergency trigger
- [ ] `emergency/data-ingestion.ts` - Manual data upload and validation
- [ ] `emergency/dual-validity.ts` - Dual-validity window management
- [ ] `contracts/EpochRegistry.sol` - Support for emergency epochs
- [ ] `notifications/redistricting.ts` - Basic notification templates
- [ ] Admin UI for emergency management

### 9.3 Phase 2: Detection (P1)

**Goal:** Automate detection of redistricting events via PACER monitoring.

**Deliverables:**

1. **PACER Integration**
   - RECAP API integration for court docket monitoring
   - Keyword filtering for redistricting cases
   - Priority classification (P1-P5)

2. **State Commission Monitoring**
   - RSS feed polling for known commissions
   - Meeting calendar scraping (where RSS unavailable)
   - Map publication detection

3. **Alert System**
   - Slack/email alerts to admin team
   - Dashboard for case tracking
   - Auto-flagging of P1-P2 events

**Implementation Checklist:**
- [ ] `detection/pacer-monitor.ts` - PACER API integration
- [ ] `detection/commission-feeds.ts` - State commission RSS polling
- [ ] `detection/event-classifier.ts` - Priority classification
- [ ] `detection/alert-dispatcher.ts` - Admin alerting
- [ ] Dashboard UI for case monitoring

### 9.4 Phase 3: Full Automation (P2)

**Goal:** Fully automated emergency response pipeline.

**Deliverables:**

1. **Auto-Request Protocol**
   - Automatic data requests to state officials
   - Template emails with court order reference
   - Follow-up tracking

2. **Validation Pipeline**
   - Automated format validation
   - Court order cross-validation
   - Topology and integrity checks

3. **Auto-Ingestion**
   - Approved data auto-ingested
   - Emergency epoch auto-generated
   - IPFS publication automated

4. **Convergence Detection**
   - TIGER release monitoring
   - Auto-convergence when TIGER matches emergency data
   - Window auto-close

**Implementation Checklist:**
- [ ] `ingestion/auto-request.ts` - Automated data requests
- [ ] `ingestion/validation-pipeline.ts` - Full validation suite
- [ ] `ingestion/auto-ingest.ts` - Automated ingestion workflow
- [ ] `convergence/tiger-monitor.ts` - TIGER release detection
- [ ] `convergence/auto-close.ts` - Window auto-closure

### 9.5 Phase 4: Hardening (P2)

**Goal:** Production hardening with rollback support and notification optimization.

**Deliverables:**

1. **Rollback System**
   - Full rollback protocol implementation
   - Epoch deprecation workflow
   - Grace period extension

2. **Notification Optimization**
   - A/B testing of notification copy
   - Frequency capping
   - Delivery optimization

3. **Monitoring & Alerting**
   - Prometheus metrics for emergency events
   - Grafana dashboards
   - PagerDuty integration

4. **Documentation & Training**
   - Runbook for emergency response
   - Admin training materials
   - User FAQ updates

**Implementation Checklist:**
- [ ] `rollback/rollback-protocol.ts` - Full rollback implementation
- [ ] `rollback/epoch-deprecation.ts` - Epoch lifecycle management
- [ ] `notifications/optimization.ts` - Notification A/B testing
- [ ] `monitoring/emergency-metrics.ts` - Prometheus metrics
- [ ] Documentation and runbooks

---

## 10. Testing Strategy

### 10.1 Test Scenarios

| Scenario | Description | Expected Outcome |
|----------|-------------|------------------|
| **Happy Path** | Court orders redistricting, data ingested, window opens/closes | Users notified, proofs work throughout |
| **Rapid Succession** | Multiple redistricting events for same state | Each handled independently, windows don't conflict |
| **Appeal Stay** | Emergency epoch created, then court issues stay | Rollback executed, users notified, grace period extended |
| **Data Rejection** | State provides invalid data | Validation catches errors, admin notified, no epoch created |
| **TIGER Convergence** | TIGER release matches emergency data | Window auto-closes, emergency epoch becomes standard |
| **Partial Overlap** | Some districts change, others don't | Only affected district trees rebuilt |

### 10.2 Integration Tests

```typescript
describe('Redistricting Emergency Protocol', () => {
  describe('Detection', () => {
    it('should detect redistricting case from PACER filing');
    it('should classify priority correctly based on document type');
    it('should alert admins for P1-P2 events within 1 hour');
  });

  describe('Dual-Validity', () => {
    it('should accept proofs from both old and new epochs during window');
    it('should reject old epoch proofs after window closes');
    it('should extend window when requested with valid justification');
  });

  describe('Ingestion', () => {
    it('should validate shapefile format and topology');
    it('should reject data that doesnt match court order');
    it('should generate correct Merkle tree for affected regions');
  });

  describe('Notifications', () => {
    it('should notify affected users within 24 hours of window opening');
    it('should send 7-day warning before window closes');
    it('should not notify users in unaffected districts');
  });

  describe('Rollback', () => {
    it('should extend grace period when rollback initiated');
    it('should mark emergency epoch as deprecated');
    it('should continue accepting deprecated epoch during grace period');
  });
});
```

### 10.3 Load Testing

**Scenario:** Alabama-scale redistricting affecting 1M+ voters

| Metric | Target | Rationale |
|--------|--------|-----------|
| Detection latency | <4 hours | PACER polling frequency |
| Ingestion time | <24 hours | Including validation and approval |
| Notification delivery | <48 hours | All affected users notified |
| Proof verification overhead | <10ms | Dual-root check shouldn't add significant latency |

---

## 11. Cost Analysis

### 11.1 Operational Costs

| Component | Frequency | Cost/Year | Notes |
|-----------|-----------|-----------|-------|
| PACER API (via RECAP) | Daily polling | $0 | RECAP provides free API |
| State RSS polling | Hourly | $0 | Public feeds |
| IPFS pinning (emergency epochs) | Per event | ~$5/event | Small data, ~10 events/year |
| Admin time (per event) | 4-8 hours | ~$500/event | Validation and approval |
| Notification delivery | Per user | ~$0.01/user | Email/push costs |
| **Total (10 events/year)** | | **~$5,500** | Assuming 100K affected users/year |

### 11.2 Development Costs

| Phase | Effort | Cost (at $150/hr) |
|-------|--------|-------------------|
| Phase 1: MVP | 160 hours | $24,000 |
| Phase 2: Detection | 240 hours | $36,000 |
| Phase 3: Full Automation | 320 hours | $48,000 |
| Phase 4: Hardening | 160 hours | $24,000 |
| **Total** | **880 hours** | **$132,000** |

---

## 12. Security Considerations

### 12.1 Access Control

| Role | Permissions |
|------|-------------|
| **System** | Detection, auto-alerts, monitoring |
| **Admin (L1)** | View events, approve data, trigger notifications |
| **Admin (L2)** | Approve emergency triggers, approve ingestion |
| **Admin (L3)** | Approve rollbacks, extend windows beyond 30 days |

### 12.2 Audit Trail

All actions logged with:
- Actor (admin ID or "system")
- Timestamp (UTC)
- Action type
- Affected entities
- Justification (for manual actions)
- Digital signature (for approvals)

### 12.3 Attack Surface

| Attack Vector | Mitigation |
|---------------|------------|
| Fake court orders | PACER verification required |
| Malicious data injection | Multi-admin approval + validation pipeline |
| Premature window closure | Requires 2+ admin approvals |
| Notification spam | Frequency capping, opt-in channels |
| Rollback abuse | Requires 3 admin approvals |

---

## 13. Open Questions

1. **PACER Access:** Should we use RECAP (free but delayed) or direct PACER (real-time but costs $0.10/page)?

2. **State Data Agreements:** Should we proactively establish data-sharing agreements with state election offices?

3. **International Applicability:** How does this protocol adapt to non-US redistricting (e.g., UK boundary reviews)?

4. **Litigation Insurance:** Should affected users be offered "litigation insurance" - guaranteed proof validity regardless of outcome?

5. **Multi-State Coordination:** How do we handle cases affecting multiple states (e.g., federal court orders)?

---

## 14. References

### 14.1 Legal References

- **Voting Rights Act Section 2:** 52 U.S.C. § 10301
- **Shaw v. Reno (1993):** Racial gerrymandering standard
- **Rucho v. Common Cause (2019):** Federal courts cannot adjudicate partisan gerrymandering
- **Allen v. Milligan (2023):** VRA Section 2 requirements for redistricting

### 14.2 Data Sources

- **PACER:** https://pacer.uscourts.gov/
- **RECAP Archive:** https://www.courtlistener.com/recap/
- **Census TIGER:** https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **Redistricting Data Hub:** https://redistrictingdatahub.org/

### 14.3 Related Specifications

- `DATA-INTEGRITY-SPEC.md` - Data freshness and provenance
- `SHADOW-ATLAS-SPEC.md` - Merkle tree architecture
- `DISTRICT-TAXONOMY.md` - District type classifications

---

## Appendix A: Example Court Order Analysis

### Allen v. Milligan (Alabama Congressional Districts)

**Case:** 2:21-cv-01291-AMM (N.D. Ala.)

**Key Dates:**
- June 8, 2023: Supreme Court affirms district court finding of VRA violation
- July 21, 2023: Alabama legislature passes SB 5 (remedial map)
- September 5, 2023: District court rejects SB 5 as non-compliant
- October 5, 2023: Special master submits court-drawn map
- October 20, 2023: District court adopts special master map
- July 2024: TIGER 2024 released with new boundaries

**Emergency Protocol Application:**

1. **Detection:** PACER monitor detects October 20, 2023 order adopting new map
2. **Classification:** Priority 1 (court orders new map implementation)
3. **Data Request:** Request shapefiles from Alabama Secretary of State
4. **Validation:** Cross-validate against court order boundary descriptions
5. **Ingestion:** Generate emergency epoch with new AL congressional districts
6. **Dual-Validity:** 30-day window opens (extends to January 2024)
7. **Notification:** Alert ~1M Alabama voters in affected districts
8. **Convergence:** July 2024 TIGER release matches emergency data; window closes

---

## Appendix B: Notification Copy Library

### Email Templates

**Subject Lines:**
- "Important: Your district boundaries may have changed"
- "Action recommended: Regenerate your district proof"
- "Update: Your district proof will expire in 7 days"
- "Good news: Your district boundaries have been confirmed"

**Body Copy Library:**
- [See Section 7.3 for full templates]

### In-App Banner Copy

**Warning Level:**
- "Your district may have changed due to court-ordered redistricting. [Learn More]"

**Action Required Level:**
- "Action needed: Regenerate your proof by [DATE] to continue using [APP_NAME]. [Regenerate Now]"

**Info Level:**
- "District boundaries in [STATE] are being updated. No action needed if your proof was generated after [DATE]."

---

*This specification is subject to revision as the protocol is implemented and real-world redistricting events provide feedback.*

**Version History:**
| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-01 | Initial specification |

**Authors:** Voter Protocol Team
**License:** MIT
