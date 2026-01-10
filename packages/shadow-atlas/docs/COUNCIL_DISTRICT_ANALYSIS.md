# Council District Edge Case Analysis

> **Status**: Analysis complete
> **Date**: 2026-01-09
> **Input**: 7,804 layers flagged as potential council districts

---

## Executive Summary

Of 7,804 ArcGIS Hub layers flagged as potential council districts, rigorous edge case analysis yields:

| Category | Count | % | Description |
|----------|-------|---|-------------|
| **ACCEPT** | 356 | 4.6% | Ready for Merkle commitment (34 cities) |
| **NEEDS_CITY_CONTEXT** | 3,163 | 40.5% | High-confidence but missing city FIPS |
| **REJECT** | 4,285 | 54.9% | Clear false positives |

### Final Resolution Results

After running the FIPS resolver on the 3,163 layers needing context:

| Category | Count | % | Description |
|----------|-------|---|-------------|
| **Resolved** | 2,890 | 91.4% | Successfully attributed to US cities/counties |
| **International (Rejected)** | 46 | 1.5% | Non-US layers (NZ, Canada, Australia, UK, HK, India) |
| **Unresolved** | 227 | 7.2% | Generic templates or geocoding failures |

**Total validated council district layers: 2,890**
**Unique cities/counties covered: 704**
**Unique states covered: 50** (all US states + DC)

---

## Resolution Quality

| Method | Count | Confidence | Description |
|--------|-------|------------|-------------|
| EXTENT_GEOCODE | 2,811 | 85% | Census Geocoder API reverse geocoding |
| NAME_PARSE | 40 | 75% | City/county name extraction from URL/name |
| PATTERN_MATCH | 29 | 75% | Additional city patterns identified |
| WKID_STATE | 10 | 40% | State Plane Coordinate fallback |

---

## Top Cities by Layer Count

| Rank | City | FIPS | Layers |
|------|------|------|--------|
| 1 | Washington, DC | 1150000 | 266 |
| 2 | Los Angeles, CA | 0644000 | 231 |
| 3 | New York, NY | 3651000 | 89 |
| 4 | St. Tammany Parish, LA | 22103 | 64 |
| 5 | Philadelphia, PA | 4260000 | 46 |
| 6 | Pittsburgh, PA | 4261000 | 43 |
| 7 | Houston, TX | 4835000 | 41 |
| 8 | Topeka, KS | 2071000 | 34 |
| 9 | Monterey Park, CA | 0648914 | 33 |
| 10 | South Fulton, GA | 1372122 | 32 |

---

## Top States by Layer Count

| State | Layers |
|-------|--------|
| CA | 675 |
| TX | 295 |
| DC | 266 |
| LA | 168 |
| NY | 144 |
| PA | 127 |
| GA | 103 |
| IN | 74 |
| FL | 70 |
| CO | 64 |

---

## International Layers Rejected

| Country | Count |
|---------|-------|
| New Zealand | 20 |
| Canada | 10 |
| India | 4 |
| Thailand/Myanmar | 4 |
| Australia | 3 |
| Hong Kong | 2 |
| UK | 2 |
| French/Quebec | 1 |

---

## False Positive Breakdown (Original 4,285 Rejections)

| Type | Count | Examples |
|------|-------|----------|
| Service Districts | 134 | Fire districts, police districts, utilities |
| Property/Parcels | 365 | Zoning, subdivisions, property lots |
| Infrastructure | 227 | Parks, hydrology, roads, facilities |
| Census/Electoral | 271 | Congressional, state legislative, VTDs |
| School Districts | 170 | ISD, USD, elementary/secondary |
| Aggregated Data | 94 | Demographics by district, crime stats |
| Historical Versions | 93 | Pre-2021 district boundaries |

---

## Validation Framework

### 7-Layer Validation

1. **Rejection Patterns** (95% confidence) - Fire, police, school, census, property
2. **Required Positive Signals** - council, ward, alderman, commissioner
3. **City Attribution** - FIPS from URL/name patterns or org lookup
4. **Historical Detection** - Flag data >5 years old
5. **Feature Count** - 3-60 typical, reject >100 (placeholder 1000/2000 ignored)
6. **Semantic Analysis** - Positive/negative keyword weighting
7. **Confidence Scoring** - Weighted sum with thresholds

### Thresholds

| Confidence | Action |
|------------|--------|
| ≥70% + city FIPS | ACCEPT |
| ≥60% no city | NEEDS_CITY_CONTEXT |
| ≥50% + city FIPS | ACCEPT (with warning) |
| ≥30% | NEEDS_CITY_CONTEXT |
| <30% | NEEDS_MANUAL_REVIEW |

---

## Key Files

- `src/validators/council-district-edge-cases.ts` - Edge case analyzer
- `src/validators/city-attribution.ts` - City FIPS attribution
- `src/validators/fips-resolver.ts` - Multi-strategy FIPS resolver
- `src/scripts/test-edge-case-analyzer.ts` - Analysis runner
- `src/scripts/categorize-unresolved.ts` - Unresolved layer categorization
- `src/scripts/finalize-council-districts.ts` - Final statistics generator
- `src/agents/data/edge-case-analysis-results.json` - Initial classification results
- `src/agents/data/attributed-council-districts.json` - Resolution results
- `src/agents/data/final-council-districts.json` - Final merged results

---

## FIPS Resolution Strategy

Multi-strategy FIPS resolver (`src/validators/fips-resolver.ts`):

1. **Org ID Lookup (95% confidence):** Matches ArcGIS organization IDs to a known city registry
2. **Name Parsing (75% confidence):** Extracts city/county names from service/layer names
3. **Metadata Parse (70% confidence):** Parses `copyrightText` and `description` fields
4. **Centroid Geocode (85% confidence):** Reverse geocodes via Census Geocoder API
5. **WKID State (40% confidence):** Fallback mapping of spatial reference ID to state

### Batch Processing & Resumability

- Processes layers in chunks of 100
- Saves progress incrementally
- Skips already resolved layers on restart

---

## Completed Phases

1. **[COMPLETED] Edge Case Classification:** 7,804 layers classified
2. **[COMPLETED] FIPS Resolution:** 90.5% resolution rate on candidate layers
3. **[COMPLETED] International Filtering:** 46 non-US layers identified and rejected
4. **[COMPLETED] Pattern Recovery:** 29 additional US layers recovered via patterns
5. **[COMPLETED] Final Statistics:** 2,890 layers across 704 cities in 50 states

---

## Next Steps

### Phase 1: Merkle Tree Commitment
- Extract geometry from each resolved layer
- Generate deterministic GEOIDs: `{cityFIPS}-CD{districtNum}`
- Add to municipal layer in Merkle tree

### Phase 2: Expected Count Validation
- Cross-reference resolved cities against expected district count registry
- Flag mismatches for manual review
- Build confidence score based on count match

### Phase 3: Continuous Discovery
- Weekly cron to scan ArcGIS Hub for new council district layers
- Auto-resolve FIPS using established pipeline
- Queue low-confidence results for manual curation

---

## Lessons Learned

1. **Placeholder counts**: ArcGIS Hub returns 1000/2000 as placeholder feature counts
2. **Geocoding is the key**: 97% of resolutions came from Census Geocoder API
3. **International layers pollute results**: ~1.5% of high-confidence layers were non-US
4. **Generic templates fail**: "ElectoralDistricts" template pattern across multiple orgs
5. **Org ID lookup is reliable**: Known org IDs provide 95% confidence attribution

---

**Making democracy engaging at the ward level.**
