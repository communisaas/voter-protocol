# Overlap Magnitude Analysis: Quick Stats

**Date**: 2026-01-16  
**Analysis**: 24 exclusivity failures

## Bottom Line

**🚨 100% are true topology errors (not tolerance-sensitive)**

- **0 cities** with edge rounding (<1,000 sq m)
- **0 cities** with ambiguous overlaps (1K-150K sq m)
- **24 cities** with topology errors (>150K sq m)

## Verdict

✅ **Current tolerance is correct** (`OVERLAP_EPSILON = 150,000 sq m`)  
❌ **Do NOT increase tolerance**  
🔧 **Source data must be fixed**

## Overlap Magnitude Distribution

| Range | Count | % | Classification |
|-------|-------|---|----------------|
| <1,000 sq m | 0 | 0% | Edge rounding (tolerance-fixable) |
| 1K-150K sq m | 0 | 0% | Ambiguous (review needed) |
| 150K-10M sq m | 4 | 17% | Moderate topology error |
| 10M-100M sq m | 14 | 58% | Severe topology error |
| >100M sq m | 6 | 25% | Catastrophic topology error |

## Top 10 Worst Offenders

| Rank | City | Max Overlap (sq m) | Likely Cause |
|------|------|-------------------|--------------|
| 1 | Buckeye, AZ | 457,241,065 | County data (76 districts) |
| 2 | Fernley, NV | 297,469,595 | Wrong layer/corruption |
| 3 | Glendale, AZ | 134,122,807 | Broken tessellation |
| 4 | Sherman, TX | 125,016,160 | Complete failure |
| 5 | Elk Grove, CA | 90,114,954 | Wrong granularity (26 districts) |
| 6 | Carson, CA | 83,135,705 | LA County layer |
| 7 | Milton, GA | 56,795,991 | Boundary errors |
| 8 | La Porte, TX | 51,215,958 | Overlapping definitions |
| 9 | Odessa, TX | 46,005,068 | Incorrect boundaries |
| 10 | Ocala, FL | 45,820,688 | Complete overlap |

## Root Cause Breakdown

| Cause | Count | % |
|-------|-------|---|
| Wrong source layer | 14 | 58% |
| Broken tessellation | 9 | 38% |
| Wrong city data | 1 | 4% |

## Scale Reference

To put these numbers in perspective:

- **Current tolerance**: 150,000 sq m ≈ 387m × 387m (4 city blocks)
- **Smallest failure**: 192,233 sq m (1.3× tolerance) - Chattahoochee Hills, GA
- **Largest failure**: 457,241,065 sq m (3,048× tolerance) - Buckeye, AZ
- **Median failure**: 34,242,146 sq m (228× tolerance)

**Even the "smallest" failure is 28% larger than tolerance.**

## Recommendations

1. ❌ **Do not adjust tolerance** - would mask real errors
2. ✅ **Mark these 24 cities invalid** in registry
3. ✅ **Implement pre-registration validation** (tessellation proof before adding)
4. ✅ **Manual source discovery** for each city
5. ✅ **Build expected district count table** (Wikipedia/city websites)

## Files

- **Full analysis**: `overlap-magnitude-results.json` (28K tokens)
- **Summary report**: `OVERLAP-MAGNITUDE-ANALYSIS-SUMMARY.md`
- **Visual breakdown**: `overlap-magnitude-visual.txt`
- **Action plan**: `EXCLUSIVITY-FAILURE-ACTION-PLAN.md`
- **Analysis script**: `../scripts/overlap-magnitude-analysis.ts`

## Run Analysis

```bash
npm run analyze:overlap-magnitude
```

---

**Conclusion**: The tessellation proof is working perfectly. These are real data quality issues that require source fixes, not tolerance adjustments.
