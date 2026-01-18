# Wave E: Remediation Strategy

## Overview

Based on Wave D findings, apply targeted fixes to achieve **90%+ pass rate**.

---

## Remediation Decision Tree

```
For each failing city:
│
├─ Containment Failure (0% coverage)
│  ├─ Centroid > 50km from city center?
│  │  └─ YES → QUARANTINE (wrong data source)
│  └─ ArcGIS org ID mismatch?
│     └─ YES → QUARANTINE + find correct source
│
├─ Exclusivity Failure (overlaps detected)
│  ├─ Max overlap < 1,000 sq m?
│  │  └─ YES → PASS WITH WARNING (edge rounding)
│  ├─ Max overlap 1K-150K sq m?
│  │  └─ INVESTIGATE (tolerance vs source issue)
│  └─ Max overlap > 150K sq m?
│     └─ QUARANTINE (topology error in source)
│
├─ Exhaustivity Failure (coverage gaps)
│  ├─ Coverage < 50%?
│  │  ├─ City is at-large?
│  │  │  └─ YES → ADD TO AT_LARGE_CITIES
│  │  └─ NO → QUARANTINE (wrong data layer)
│  ├─ Coverage 50-85%?
│  │  └─ INVESTIGATE (partial data, annexation mismatch)
│  └─ Coverage > 115%?
│     └─ Related to containment → QUARANTINE
│
└─ Fetch/Boundary Failure
   └─ QUARANTINE (infrastructure issue)
```

---

## Remediation Actions by Category

### Category 1: Quarantine (Remove from Validation)

**Criteria**: Wrong data source, topology errors, infrastructure failures

**Action**: Move to `quarantined-portals.ts` with documented reason

**Expected**: ~30-40 entries

### Category 2: At-Large Registry (Exclude from Tessellation)

**Criteria**: Confirmed at-large voting (no geographic districts)

**Action**: Add to `at-large-cities.ts` with source documentation

**Expected**: ~5-10 entries

### Category 3: Tolerance Adjustment (Code Change)

**Criteria**: Edge rounding causing false positives

**Action**: Consider increasing `OVERLAP_EPSILON` OR implement "warn but pass"

**Risk**: May allow some real errors through

### Category 4: Source Correction (Manual Research)

**Criteria**: City has districts, but registry has wrong source

**Action**: Find correct GIS portal, update `known-portals.ts`

**Expected**: ~10-15 entries (high value, time intensive)

---

## Implementation Scripts

### 1. Batch Quarantine Script

```typescript
// scripts/batch-quarantine.ts
import { QUARANTINED_PORTALS } from '../src/core/registry/quarantined-portals.js';

const newQuarantines = [
  { fips: "...", reason: "centroid_distance_50km", pattern: "wrong_source" },
  // ... from D-2 results
];

// Generates code to add to quarantined-portals.ts
```

### 2. At-Large Registry Update

```typescript
// scripts/update-at-large.ts
import { AT_LARGE_CITIES } from '../src/core/registry/at-large-cities.js';

const confirmedAtLarge = [
  { fips: "...", city: "Sheridan, IN", method: "at-large", source: "Town Charter" },
  // ... from D-4 results
];
```

### 3. Soft Exclusivity Mode (Optional)

```typescript
// In tessellation-proof.ts
interface ValidationConfig {
  strictExclusivity: boolean;  // false = warn on small overlaps, don't fail
  smallOverlapThreshold: number; // 1000 sq m
}
```

---

## Success Metrics

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Pass Rate | 82.9% | **90%+** | Quarantine + at-large |
| Containment Failures | 40 | **<15** | Centroid triage |
| Exclusivity Failures | 24 | **<10** | Tolerance + quarantine |
| Exhaustivity Failures | 14 | **<5** | At-large detection |

---

## Risk Mitigation

### False Positive Quarantine

**Risk**: Quarantining valid data

**Mitigation**:
- Require centroid distance > 50km OR org ID mismatch
- Manual review for 10-50km range
- Restoration process documented

### Tolerance Creep

**Risk**: Increasing tolerance hides real errors

**Mitigation**:
- Log all "soft pass" entries for review
- Don't change tolerance unless D-3 strongly supports
- Consider "warn but pass" mode instead

### Incomplete At-Large Research

**Risk**: Missing at-large cities, false negatives

**Mitigation**:
- Require authoritative source (charter, official website)
- Mark "pending verification" entries
- Periodic re-review

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/core/registry/quarantined-portals.ts` | Add ~30-40 entries |
| `src/core/registry/at-large-cities.ts` | Add ~5-10 entries |
| `src/validators/council/tessellation-proof.ts` | Optional: soft exclusivity mode |
| `scripts/run-city-validation.ts` | Add soft-pass logging |
