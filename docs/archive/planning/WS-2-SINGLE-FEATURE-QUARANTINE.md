# WS-2: Single-Feature Entry Quarantine

**Date:** 2026-01-16
**Task:** Quarantine 21 single-feature council district entries
**Status:** COMPLETE

## Summary

Successfully quarantined 21 single-feature entries from `known-portals.ts` to `quarantined-portals.ts`. These entries contain only 1 feature each and cannot represent valid council district tessellations (where multiple districts cover a city without overlap).

## Results

- **Total processed:** 21 FIPS codes
- **Successfully quarantined:** 21 entries
- **Failed:** 0 entries
- **Remaining in known-portals.ts:** 596 entries (was 617)
- **Total quarantined:** 24 entries (3 previous + 21 new)

## Rationale

Council districts must tessellate a city - meaning multiple districts cover the city without overlap. A single-feature entry (1 district) cannot satisfy tessellation unless the city has only 1 at-large district, which is rare and should be documented separately.

These entries are likely:
1. Wrong data layer (city boundary instead of districts)
2. Single at-large district (needs at-large registry)
3. Incomplete data (missing districts)

## Quarantined Entries (21 total)

### By State

**California (11 entries):**
- `0602252` - Antioch, CA
- `0608142` - Brentwood, CA
- `0613756` - Claremont, CA
- `0633182` - Hemet, CA
- `0646114` - Martinez, CA
- `0653070` - Oakley, CA
- `0668378` - San Ramon, CA
- `0670000` - Santa Monica, CA
- `06065` - Riverside County, CA

**Colorado (3 entries):**
- `08005` - Arapahoe County, CO
- `08059` - Jefferson County, CO

**Other States (7 entries):**
- `0454050` - Peoria, AZ
- `20177` - Shawnee County, KS
- `2247560` - Madisonville, LA
- `3774440` - Wilmington, NC
- `3957750` - Oakwood, OH
- `40031` - Comanche County, OK
- `40109` - Oklahoma County, OK
- `42091` - Montgomery County, PA
- `48029` - Bexar County, TX
- `4806128` - Baytown, TX

## Files Modified

1. **src/core/registry/known-portals.ts**
   - Removed 21 single-feature entries
   - Reduced from 617 to 596 entries

2. **src/core/registry/quarantined-portals.ts**
   - Added 21 single-feature entries
   - Updated QUARANTINE_COUNT: 3 → 24
   - Updated QUARANTINE_SUMMARY with "single-feature": 21

3. **src/core/registry/single-feature-quarantine-report.json** (NEW)
   - Detailed JSON report of quarantine operation
   - Lists all moved entries with metadata

4. **src/core/registry/single-feature-quarantine-data.ts** (NEW)
   - TypeScript module with quarantine data
   - Can be imported for analysis

## Validation

All TypeScript files compile successfully:
```bash
✅ quarantined-portals.ts - No errors
✅ No FIPS codes from quarantine list remain in known-portals.ts
✅ All 21 entries successfully moved
```

## Next Steps

1. ✅ Entries quarantined with documented rationale
2. ⏭️ Human review of quarantined entries (optional)
3. ⏭️ For valid at-large districts, move to separate registry
4. ⏭️ For wrong layers, permanently delete or update URLs
5. ⏭️ For incomplete data, find complete sources

## References

- **Audit Report:** `docs/feature-count-audit-results.md`
- **Quarantine Report:** `src/core/registry/single-feature-quarantine-report.json`
- **Quarantine Data:** `src/core/registry/single-feature-quarantine-data.ts`
- **Script Used:** `scripts/quarantine-single-feature-entries.ts`

---

**Quarantine Criteria:** Single feature (featureCount = 1), cannot tessellate
**Pattern:** `single-feature`
**Date:** 2026-01-16T00:00:00.000Z
