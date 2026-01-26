# Analysis Output Directory

This directory contains analysis results, validation reports, and data quality assessments for the Shadow Atlas council district registry.

## Recent Analysis: Exclusivity Overlap Magnitude (2026-01-16)

### Quick Summary

**Mission**: Quantify overlap areas for 24 exclusivity failures to determine if they're tolerance-sensitive edge cases or true topology errors.

**Verdict**: 🚨 **100% are true topology errors** - Not tolerance-sensitive. All 24 failures are orders of magnitude larger than the current tolerance threshold.

### Key Files

1. **QUICK-STATS.md** ⭐ **START HERE**
   - One-page summary with key statistics
   - Top 10 worst offenders
   - Clear recommendations

2. **OVERLAP-MAGNITUDE-ANALYSIS-SUMMARY.md**
   - Detailed findings by severity category
   - Root cause analysis
   - Next steps and recommendations

3. **EXCLUSIVITY-FAILURE-ACTION-PLAN.md**
   - 5-week implementation plan
   - Technical implementation details
   - Registry schema updates
   - Success metrics

4. **overlap-magnitude-visual.txt**
   - Visual scale comparison
   - Log-scale visualization of overlaps
   - Easy-to-understand magnitude context

5. **overlap-magnitude-results.json** (85KB)
   - Complete raw data for all 24 cities
   - Pairwise overlap measurements
   - District-by-district details

### Analysis Script

Location: `/scripts/overlap-magnitude-analysis.ts`

Run with:
```bash
npm run analyze:overlap-magnitude
```

### Key Findings

| Classification | Count | % |
|---------------|-------|---|
| Edge Rounding (<1,000 sq m) | 0 | 0% |
| Ambiguous (1K-150K sq m) | 0 | 0% |
| **Topology Error (>150K sq m)** | **24** | **100%** |

**Root causes:**
- 58% wrong source layer (county vs city, precincts vs districts)
- 38% broken tessellation (overlapping boundaries)
- 4% wrong city data (using neighboring city)

### Recommendations

1. ❌ **Do NOT adjust tolerance** - current value is correct
2. ✅ Mark 24 cities as invalid in registry
3. ✅ Implement pre-registration validation
4. ✅ Manual source discovery for each city
5. ✅ Build expected district count table

### Scale Context

- **Current tolerance**: 150,000 sq m ≈ 387m × 387m (4 city blocks)
- **Smallest failure**: 192,233 sq m (1.3× tolerance)
- **Largest failure**: 457,241,065 sq m (3,048× tolerance)
- **Median failure**: 34,242,146 sq m (228× tolerance)

Even the "best" failure is 28% over tolerance - these are clearly not edge cases.

---

## Other Analysis Files

### ArcGIS Organization Fingerprints
- **arcgis-org-fingerprints.json** - Normalized organization domains
- **ARCGIS-ORG-ANALYSIS-SUMMARY.md** - Organization clustering analysis

### At-Large Research
- **at-large-research.json** - Cities with at-large council structures
- **at-large-research-summary.md** - At-large vs district analysis
- **at-large-research-findings.txt** - Detailed research notes

### Validation Reports
- **validation-2026-01-16.log** - Daily validation run results
- **multi-stage-validation-demo.json** - Multi-stage validation examples

### Water Coverage Analysis
- **water-coverage-analysis.json** - Coastal city water jurisdiction analysis

### Geometric Analysis
- **centroid-distance-results.json** - District centroid spacing analysis

---

## Directory Structure

```
analysis-output/
├── README.md (this file)
│
├── Overlap Magnitude Analysis (2026-01-16)
│   ├── QUICK-STATS.md ⭐ START HERE
│   ├── OVERLAP-MAGNITUDE-ANALYSIS-SUMMARY.md
│   ├── EXCLUSIVITY-FAILURE-ACTION-PLAN.md
│   ├── overlap-magnitude-visual.txt
│   └── overlap-magnitude-results.json
│
├── Organization Analysis
│   ├── arcgis-org-fingerprints.json
│   └── ARCGIS-ORG-ANALYSIS-SUMMARY.md
│
├── At-Large Research
│   ├── at-large-research.json
│   ├── at-large-research-summary.md
│   └── at-large-research-findings.txt
│
└── Validation & Quality
    ├── validation-2026-01-16.log
    ├── multi-stage-validation-demo.json
    ├── water-coverage-analysis.json
    └── centroid-distance-results.json
```

---

## Usage

### For Decision Makers
1. Read `QUICK-STATS.md` for the bottom line
2. Review `OVERLAP-MAGNITUDE-ANALYSIS-SUMMARY.md` for details
3. Check `EXCLUSIVITY-FAILURE-ACTION-PLAN.md` for implementation plan

### For Engineers
1. Review `overlap-magnitude-results.json` for raw data
2. Check `EXCLUSIVITY-FAILURE-ACTION-PLAN.md` for technical specs
3. Run `npm run analyze:overlap-magnitude` to regenerate

### For Researchers
1. All JSON files are available for further analysis
2. Scripts in `/scripts` can be modified for custom analyses
3. Validation logs track historical data quality

---

## Analysis Methodology

### Overlap Magnitude Classification

Overlaps classified by area:
- **<1,000 sq m**: Edge rounding (likely from coordinate precision)
- **1,000-150,000 sq m**: Ambiguous (needs manual review)
- **>150,000 sq m**: True topology error (source data problem)

### Data Sources

- District data: ArcGIS REST API endpoints from `KNOWN_PORTALS` registry
- Municipal boundaries: Census TIGER/Line (when available)
- Expected district counts: Wikipedia, city websites, manual research

### Validation Stack

1. **Exclusivity**: Pairwise intersection area calculation (`turf.intersect` + `turf.area`)
2. **Exhaustivity**: Union coverage vs municipal boundary
3. **Containment**: District union within boundary check
4. **Cardinality**: Feature count vs expected district count

---

## Contributing

When adding new analysis:

1. Create descriptive filename: `{analysis-type}-{date}.{ext}`
2. Include metadata: date, methodology, data sources
3. Add entry to this README
4. Commit analysis script to `/scripts` directory

## Questions?

See project documentation:
- Main README: `/README.md`
- Technical docs: `/docs/`
- Validation docs: `/src/validators/council/tessellation-proof.ts`

---

**Last Updated**: 2026-01-16
**Analysis Count**: 15 files
**Latest**: Exclusivity Overlap Magnitude Analysis
