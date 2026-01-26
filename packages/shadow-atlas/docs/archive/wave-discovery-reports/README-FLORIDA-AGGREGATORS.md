# Wave-P Florida Aggregator Verification - Complete Report

**Wave ID:** wave-p-florida-aggregators
**Date:** 2026-01-23
**Operator:** GIS Extraction Specialist
**Scope:** Verify 4 Florida city portals from regional-aggregators.ts

---

## Mission Summary

Verified the 4 verified Florida city council/commission district portals listed in `regional-aggregators.ts`:
1. Fort Lauderdale (4 commission districts)
2. Hollywood (6 commission districts)
3. Cape Coral (7 council districts)
4. Orange County/Orlando (6 commission districts)

**Objective:** Query endpoints, verify feature counts, cross-reference with existing registry, identify new cities, and resolve FIPS codes.

---

## Results

### Portal Verification Status

| City | Status | Feature Count | URL Status | Action Required |
|------|--------|---------------|------------|-----------------|
| **Fort Lauderdale** | ❌ BLOCKED | Cannot verify (expected 4) | URL correct but blocked | DEPRECATE - HTTP 499 auth required |
| **Hollywood** | ✅ WORKING | 6 (verified) | ❌ URL incorrect in aggregators | UPDATE aggregators URL |
| **Cape Coral** | ✅ WORKING | 7 (verified) | ✅ URL correct | UPDATE registry to match aggregators |
| **Orlando/Orange County** | ✅ WORKING | 6 (verified) | ✅ URL correct | None |

**Success Rate:** 75% (3/4 working)

---

## Key Findings

### 1. Fort Lauderdale Portal Blocked (CRITICAL)
- **Issue:** Portal now returns HTTP 499 "Token Required" for all endpoints
- **Impact:** Not publicly accessible as of 2026-01-23
- **Previous Status:** Was working during wave-k-fl-specialist verification
- **Recommendation:** Deprecate in regional-aggregators.ts, quarantine in registry

### 2. Hollywood URL Incorrect in Aggregators
- **Listed URL:** `https://maps.hollywoodfl.org/arcgis/rest/services/InformationTechnology/Commission_Districts/MapServer/35` (404 error)
- **Actual URL:** `https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17` (working)
- **Root Cause:** Hollywood uses ArcGIS Online, not self-hosted MapServer
- **Recommendation:** Update regional-aggregators.ts with correct ArcGIS Online URL

### 3. Cape Coral - Better URL Found
- **Registry URL (old):** ArcGIS Online wayfinding survey service (confidence: 63)
- **Aggregators URL (better):** Official city IMS FeatureServer (confidence: 95)
- **Data Quality:** Official portal has population, council names, district pages, last edited Nov 2024
- **Recommendation:** Update registry to use the official city portal URL from regional-aggregators.ts

### 4. Orange County - Perfect Match
- ✅ URL verified working
- ✅ Feature count matches (6 districts)
- ✅ Contains commissioner names
- ✅ No changes needed

---

## New Cities Discovered

**Count:** 0

All 4 cities were already in the registry (discovered by wave-k-fl-specialist, wave-l-fl-specialist, and automated processes).

**Output:** Empty NDJSON file created at `aggregator-florida-portals.ndjson`

---

## Data Quality Assessment

### High Quality Data (2 portals)
1. **Cape Coral** (Official City IMS)
   - Population by district
   - Council member names
   - District page URLs
   - Last edited: 2024-11-22 (recent)

2. **Hollywood** (ArcGIS Online)
   - Commissioner names
   - Email addresses
   - Website links
   - Redistricted: 2021-12-07 (post-2020 census)

### Medium Quality Data (1 portal)
3. **Orlando/Orange County**
   - Commissioner names
   - District IDs
   - Geometry data
   - Limited attributes

### Blocked (1 portal)
4. **Fort Lauderdale**
   - Cannot assess - authentication required
   - Previously had 4 commission districts

---

## Generated Files

### 1. `aggregator-florida-results.json` (6.8 KB)
Comprehensive JSON verification results with:
- Portal status for all 4 cities
- Feature counts and metadata
- Field names and sample data
- Recommendations for updates
- Data quality metrics

### 2. `aggregator-florida-portals.ndjson` (0 bytes)
Empty file - no new portals discovered (all 4 cities already in registry)

### 3. `aggregator-florida-action-plan.md` (9.1 KB)
Detailed action plan with:
- Portal-by-portal verification results
- Required registry updates
- Quarantine process for Fort Lauderdale
- Cape Coral URL migration plan
- Follow-up actions

### 4. `aggregator-florida-comparison.md` (14 KB)
Side-by-side comparison of:
- regional-aggregators.ts listings vs. actual verification results
- URL discrepancies and corrections
- Field name accuracy
- Required updates to aggregators.ts
- Lessons learned

### 5. `aggregator-florida-verification-commands.sh` (7.8 KB)
Executable shell script with:
- Curl commands to verify each portal
- Feature count queries
- Sample data extraction
- GeoJSON download URLs
- Status summary

### 6. `README-FLORIDA-AGGREGATORS.md` (this file)
Executive summary of entire verification wave

---

## Required Actions

### Priority 1: Update regional-aggregators.ts

#### Fort Lauderdale - Deprecate
```typescript
status: 'deprecated',  // was: 'active'
confidence: 0,         // was: 98
notes: 'BLOCKED as of 2026-01-23: Portal requires authentication token (HTTP 499). Contact Fort Lauderdale GIS for public access.'
```

#### Hollywood - Fix URL
```typescript
endpointUrl: 'https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17',
// was: 'https://maps.hollywoodfl.org/arcgis/rest/services/InformationTechnology/Commission_Districts/MapServer/35'
confidence: 95,  // was: 90
```

### Priority 2: Update Registry (known-portals.ndjson)

#### Cape Coral (line 155) - Upgrade to Official Portal
```diff
- "downloadUrl": "https://services.arcgis.com/ZbVPNfkTF89LEyGa/.../FeatureServer/9/..."
+ "downloadUrl": "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/..."
- "confidence": 63
+ "confidence": 95
- "portalType": "arcgis"
+ "portalType": "municipal-gis"
```

#### Fort Lauderdale (line 501) - Quarantine
Move to `quarantined-portals.generated.ts` or add quarantine flag:
```json
"quarantined": true,
"quarantineReason": "Authentication required - HTTP 499 Token Required as of 2026-01-23"
```

---

## Technical Insights

### Authentication Trends
Fort Lauderdale requiring tokens suggests municipalities may be restricting GIS access. This is a concerning trend for open data.

### Hosting Patterns
- **Hollywood:** ArcGIS Online (cloud-hosted, not self-hosted)
- **Cape Coral:** City-owned IMS server (self-hosted)
- **Orlando:** County GIS MapServer (regional infrastructure)
- **Fort Lauderdale:** City FeatureServer (now blocked)

### Data Freshness
- **Cape Coral:** Last edited November 2024 (excellent)
- **Hollywood:** Redistricted December 2021 post-2020 census (good)
- **Orlando:** Current as of verification (good)
- **Fort Lauderdale:** Unknown (blocked)

---

## Cross-Reference Insights

**Important Finding:** regional-aggregators.ts had the BETTER URL for Cape Coral compared to the registry. This suggests:
1. Aggregators are being manually curated with more recent research
2. Registry can lag behind aggregator improvements
3. Bidirectional verification is valuable (aggregators → registry AND registry → aggregators)

---

## Lessons Learned

1. **URL Volatility:** Portals can become restricted between verifications (Fort Lauderdale blocked within days)

2. **Hosting Assumptions:** Don't assume city portals are self-hosted (Hollywood uses ArcGIS Online)

3. **Multiple Working URLs:** Cities may have multiple valid endpoints with varying data quality (Cape Coral has 2 working URLs)

4. **Field Name Verification:** Always verify actual field names against documented field names

5. **Aggregators as Truth Source:** Sometimes regional-aggregators.ts has better URLs than the registry

---

## Follow-Up Actions

### Immediate
- ✅ Verification complete (this report)
- ⏳ Update regional-aggregators.ts (2 changes)
- ⏳ Update known-portals.ndjson (2 changes)
- ⏳ Quarantine Fort Lauderdale portal

### Short-Term
- Monitor Fort Lauderdale portal for public access restoration
- Contact Fort Lauderdale GIS team about data access
- Extract Cape Coral data before URL migration (backup old URL)
- Test Hollywood ArcGIS Online stability

### Long-Term
- Implement periodic verification of all Florida portals
- Track authentication requirement trends across municipalities
- Consider building alternative data sources for blocked portals
- Document hosting pattern preferences by state

---

## Verification Commands

To re-run this verification, execute:
```bash
./aggregator-florida-verification-commands.sh
```

Or manually verify using curl:
```bash
# Cape Coral feature count
curl -s "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&returnCountOnly=true&f=json"

# Hollywood feature count
curl -s "https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17/query?where=1%3D1&returnCountOnly=true&f=json"

# Orlando feature count
curl -s "https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151/query?where=1%3D1&returnCountOnly=true&f=json"

# Fort Lauderdale (will return HTTP 499)
curl -s "https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0?f=json"
```

---

## Conclusion

**Mission Status:** ✅ COMPLETE

**Portals Verified:** 4/4
**Working Portals:** 3/4 (75%)
**New Cities Found:** 0
**Updates Required:** 4 (2 to aggregators, 2 to registry)
**Critical Issues:** 1 (Fort Lauderdale blocked)

**Next Steps:** Apply the 4 required updates and monitor Fort Lauderdale portal status.

---

**Report Generated:** 2026-01-23
**Total Files:** 6 documents (44 KB total)
**Wave:** wave-p-florida-aggregators
**Operator:** GIS Extraction Specialist
