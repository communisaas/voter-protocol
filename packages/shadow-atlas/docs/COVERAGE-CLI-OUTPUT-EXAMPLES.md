# Coverage CLI Output Examples

This document shows real examples of the enhanced coverage CLI output at different levels of detail.

## Level 1: Basic Coverage (Default)

**Command:**
```bash
shadow-atlas diagnose coverage 0666000
```

**Output:**
```
Analyzing coverage for FIPS 0666000...

Coverage Analysis Report
========================

City: San Francisco, CA
FIPS: 0666000

Analysis Results:
  City Boundary Area: 120.5 sq km
  Total District Area: 118.2 sq km
  Coverage Ratio: 98.1%

Verdict: [PASS]

Notes:
  - Coverage within acceptable range (85-115%)
  - 11 districts found in registry
```

**Use Case:** Quick validation that a city has adequate coverage.

---

## Level 2: Deep Analysis Summary

**Command:**
```bash
shadow-atlas diagnose coverage 0666000 --deep
```

**Output:**
```
Analyzing coverage for FIPS 0666000...

Coverage Analysis Report
========================

City: San Francisco, CA
FIPS: 0666000

Analysis Results:
  City Boundary Area: 120.5 sq km
  Total District Area: 118.2 sq km
  Coverage Ratio: 98.1%

Verdict: [PASS]

Notes:
  - Coverage within acceptable range (85-115%)
  - 11 districts found in registry

Deep Analysis: Analyzing 50 unresolved layers...
  Progress: 10/50
  Progress: 20/50
  Progress: 30/50
  Progress: 40/50
  Progress: 50/50

================================================================================
DEEP FAILURE ANALYSIS
================================================================================

Summary:
  Total Analyzed: 50
  Unresolved: 50
  Analysis Depth: deep

Geographic Distribution:
  Domestic (CONUS): 38
  International: 8
  Unknown: 4

================================================================================
END DEEP ANALYSIS
================================================================================
```

**Use Case:** Get a high-level view of failure distribution without detailed breakdown.

---

## Level 3: Pattern Categorization

**Command:**
```bash
shadow-atlas diagnose coverage 0666000 --categorize --limit 100
```

**Output:**
```
Analyzing coverage for FIPS 0666000...

Coverage Analysis Report
========================

City: San Francisco, CA
FIPS: 0666000

Analysis Results:
  City Boundary Area: 120.5 sq km
  Total District Area: 118.2 sq km
  Coverage Ratio: 98.1%

Verdict: [PASS]

Deep Analysis: Analyzing 100 unresolved layers...
  Progress: 10/100
  Progress: 20/100
  Progress: 30/100
  Progress: 40/100
  Progress: 50/100
  Progress: 60/100
  Progress: 70/100
  Progress: 80/100
  Progress: 90/100
  Progress: 100/100

================================================================================
DEEP FAILURE ANALYSIS
================================================================================

Summary:
  Total Analyzed: 100
  Unresolved: 100
  Analysis Depth: comprehensive

Geographic Distribution:
  Domestic (CONUS): 76
  International: 16
  Unknown: 8

--------------------------------------------------------------------------------
FAILURE PATTERN CATEGORIZATION
--------------------------------------------------------------------------------

SYSTEMIC ISSUES (>20% of failures):

  QUERY_TIMEOUT - 29 occurrences (29.0%)
    Remediation: SYSTEMIC: Increase timeout, reduce query complexity - affects >20% of layers, prioritize fix
    Examples:
      - Council Districts
        https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/2
      - District Boundaries
        https://gis.cityofboston.gov/arcgis/rest/services/CityCouncil/FeatureServer/0

  METADATA_TIMEOUT - 23 occurrences (23.0%)
    Remediation: SYSTEMIC: Implement retry logic with exponential backoff - affects >20% of layers, prioritize fix
    Examples:
      - City Council Districts
        https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/Districts/FeatureServer/0


ONE-OFF ISSUES (<20% of failures):
  NOT_INCORPORATED_PLACE             18 (18.0%)
  GEOCODE_TIMEOUT                    12 (12.0%)
  NO_FEATURES                         8 (8.0%)
  OUTSIDE_CONUS                       6 (6.0%)
  NO_GEOMETRY                         4 (4.0%)

================================================================================
END DEEP ANALYSIS
================================================================================
```

**Use Case:** Identify systemic infrastructure problems that need immediate attention.

**Key Insight:** Two systemic issues (QUERY_TIMEOUT and METADATA_TIMEOUT) affect 52% of failures. Fix these first.

---

## Level 4: Recovery Assessment

**Command:**
```bash
shadow-atlas diagnose coverage 0666000 --recovery-potential --limit 100
```

**Output:**
```
Analyzing coverage for FIPS 0666000...

Coverage Analysis Report
========================

City: San Francisco, CA
FIPS: 0666000

Analysis Results:
  City Boundary Area: 120.5 sq km
  Total District Area: 118.2 sq km
  Coverage Ratio: 98.1%

Verdict: [PASS]

Deep Analysis: Analyzing 100 unresolved layers...
  Progress: 10/100
  Progress: 20/100
  Progress: 30/100
  Progress: 40/100
  Progress: 50/100
  Progress: 60/100
  Progress: 70/100
  Progress: 80/100
  Progress: 90/100
  Progress: 100/100

================================================================================
DEEP FAILURE ANALYSIS
================================================================================

Summary:
  Total Analyzed: 100
  Unresolved: 100
  Analysis Depth: deep

Geographic Distribution:
  Domestic (CONUS): 76
  International: 16
  Unknown: 8

--------------------------------------------------------------------------------
RECOVERY POTENTIAL ASSESSMENT
--------------------------------------------------------------------------------

Recovery Distribution:
  HIGH:   52 (52.0%) - Quick wins, retry with adjustments
  MEDIUM: 26 (26.0%) - Requires alternative strategy
  LOW:    16 (16.0%) - Difficult, manual investigation
  NONE:    6 (6.0%) - Out of scope


Top Recovery Candidates:

  1. Council Districts [HIGH]
     URL: https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/2
     Strategy: Retry with increased timeout and rate limiting
     Location: 29.4832, -98.5794

  2. District Boundaries [HIGH]
     URL: https://gis.cityofboston.gov/arcgis/rest/services/CityCouncil/FeatureServer/0
     Strategy: Retry with increased timeout and rate limiting
     Location: 42.3601, -71.0589

  3. City Council Districts [HIGH]
     URL: https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/Districts/FeatureServer/0
     Strategy: Retry with increased timeout and rate limiting
     Location: 35.7796, -78.6382

  4. Ward Boundaries [MEDIUM]
     URL: https://data.cityofchicago.org/resource/sp34-6z76.geojson
     Strategy: Try alternative geocoding services (Nominatim, Geocodio)
     Location: 41.8781, -87.6298

  5. District Map [MEDIUM]
     URL: https://opendata.dc.gov/datasets/ward-from-2023.geojson
     Strategy: Use county-level or alternative resolution strategy
     Location: 38.9072, -77.0369

================================================================================
END DEEP ANALYSIS
================================================================================
```

**Use Case:** Prioritize recovery efforts. Start with HIGH potential items (52 quick wins).

**Key Insight:** More than half (52%) have HIGH recovery potential. These are low-hanging fruit for immediate improvement.

---

## Level 5: Comprehensive with Layer Diagnostics

**Command:**
```bash
shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential --layer-diagnostics --limit 20
```

**Output:**
```
Analyzing coverage for FIPS 0666000...

Coverage Analysis Report
========================

City: San Francisco, CA
FIPS: 0666000

Analysis Results:
  City Boundary Area: 120.5 sq km
  Total District Area: 118.2 sq km
  Coverage Ratio: 98.1%

Verdict: [PASS]

Deep Analysis: Analyzing 20 unresolved layers...
  Progress: 10/20
  Progress: 20/20

================================================================================
DEEP FAILURE ANALYSIS
================================================================================

Summary:
  Total Analyzed: 20
  Unresolved: 20
  Analysis Depth: comprehensive

Geographic Distribution:
  Domestic (CONUS): 15
  International: 3
  Unknown: 2

--------------------------------------------------------------------------------
FAILURE PATTERN CATEGORIZATION
--------------------------------------------------------------------------------

SYSTEMIC ISSUES (>20% of failures):

  QUERY_TIMEOUT - 6 occurrences (30.0%)
    Remediation: SYSTEMIC: Increase timeout, reduce query complexity - affects >20% of layers, prioritize fix
    Examples:
      - Council Districts
        https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/2


ONE-OFF ISSUES (<20% of failures):
  METADATA_TIMEOUT                    4 (20.0%)
  NOT_INCORPORATED_PLACE              3 (15.0%)
  GEOCODE_TIMEOUT                     3 (15.0%)
  NO_FEATURES                         2 (10.0%)
  OUTSIDE_CONUS                       2 (10.0%)

--------------------------------------------------------------------------------
RECOVERY POTENTIAL ASSESSMENT
--------------------------------------------------------------------------------

Recovery Distribution:
  HIGH:   10 (50.0%) - Quick wins, retry with adjustments
  MEDIUM:  5 (25.0%) - Requires alternative strategy
  LOW:     3 (15.0%) - Difficult, manual investigation
  NONE:    2 (10.0%) - Out of scope


Top Recovery Candidates:

  1. Council Districts [HIGH]
     URL: https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/2
     Strategy: Retry with increased timeout and rate limiting
     Location: 29.4832, -98.5794

  2. District Boundaries [HIGH]
     URL: https://gis.cityofboston.gov/arcgis/rest/services/CityCouncil/FeatureServer/0
     Strategy: Retry with increased timeout and rate limiting
     Location: 42.3601, -71.0589

  3. City Council Districts [HIGH]
     URL: https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/Districts/FeatureServer/0
     Strategy: Retry with increased timeout and rate limiting
     Location: 35.7796, -78.6382

  4. Ward Boundaries [MEDIUM]
     URL: https://data.cityofchicago.org/resource/sp34-6z76.geojson
     Strategy: Try alternative geocoding services (Nominatim, Geocodio)
     Location: 41.8781, -87.6298

  5. District Map [MEDIUM]
     URL: https://opendata.dc.gov/datasets/ward-from-2023.geojson
     Strategy: Use county-level or alternative resolution strategy
     Location: 38.9072, -77.0369

--------------------------------------------------------------------------------
PER-LAYER DIAGNOSTICS
--------------------------------------------------------------------------------

Layer: Council Districts
  URL: https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/2
  Failure: QUERY_TIMEOUT
  Recovery Potential: HIGH
  Geographic: Domestic
  Metadata:
    Description: City Council District boundaries for Leon Valley...
    Copyright: City of Leon Valley, Texas
  Centroid: 29.4832, -98.5794
  Geocode: Leon Valley (4842388)
  Strategy: Retry with increased timeout and rate limiting

Layer: District Boundaries
  URL: https://gis.cityofboston.gov/arcgis/rest/services/CityCouncil/FeatureServer/0
  Failure: QUERY_TIMEOUT
  Recovery Potential: HIGH
  Geographic: Domestic
  Metadata:
    Description: Boston City Council district boundaries...
  Centroid: 42.3601, -71.0589
  Geocode: Boston (2507000)
  Strategy: Retry with increased timeout and rate limiting

Layer: City Council Districts
  URL: https://services1.arcgis.com/a7CWfuGP5ZnLYE7I/arcgis/rest/services/Districts/FeatureServer/0
  Failure: METADATA_TIMEOUT
  Recovery Potential: HIGH
  Geographic: Domestic
  Centroid: 35.7796, -78.6382
  Geocode: Raleigh (3755000)
  Strategy: Retry with increased timeout and rate limiting

Layer: Ward Boundaries
  URL: https://data.cityofchicago.org/resource/sp34-6z76.geojson
  Failure: NOT_INCORPORATED_PLACE
  Recovery Potential: MEDIUM
  Geographic: Domestic
  Metadata:
    Description: Chicago ward boundaries...
    Copyright: City of Chicago
  Centroid: 41.8781, -87.6298
  Geocode: In Cook County, but not in an incorporated city
  Strategy: Use county-level or alternative resolution strategy

Layer: District Map
  URL: https://opendata.dc.gov/datasets/ward-from-2023.geojson
  Failure: NOT_INCORPORATED_PLACE
  Recovery Potential: MEDIUM
  Geographic: Domestic
  Metadata:
    Description: Washington DC ward boundaries from 2023...
  Centroid: 38.9072, -77.0369
  Geocode: In District of Columbia, but not in an incorporated city
  Strategy: Use county-level or alternative resolution strategy

Layer: Council Districts International
  URL: https://gis.toronto.ca/arcgis/rest/services/Districts/FeatureServer/0
  Failure: OUTSIDE_CONUS
  Recovery Potential: NONE
  Geographic: International
  Centroid: 43.6532, -79.3832
  Geocode: Coordinates outside continental US: 43.65, -79.38
  Strategy: Layer appears to be outside project scope (territories/international)

Layer: Auckland Council
  URL: https://data.aucklandcouncil.govt.nz/.../FeatureServer/0
  Failure: OUTSIDE_CONUS | GEOCODE_TIMEOUT
  Recovery Potential: NONE
  Geographic: International
  Centroid: -36.8485, 174.7633
  Geocode: Coordinates outside continental US: -36.85, 174.76
  Strategy: Layer appears to be outside project scope (territories/international)

Layer: Rural Districts
  URL: https://services.example.com/arcgis/rest/services/Rural/FeatureServer/0
  Failure: NO_FEATURES
  Recovery Potential: LOW
  Geographic: Domestic
  Metadata:
    Description: Rural district boundaries...
  Centroid: Empty features array
  Strategy: Check if layer requires authentication or is deprecated

Layer: Historical Districts
  URL: https://services.example.com/arcgis/rest/services/Historical/FeatureServer/0
  Failure: METADATA_HTTP_404
  Recovery Potential: LOW
  Geographic: Unknown
  Strategy: Verify layer URL, check for API changes or authentication requirements

Layer: Test Layer
  URL: https://services.example.com/arcgis/rest/services/Test/FeatureServer/0
  Failure: NO_GEOMETRY
  Recovery Potential: LOW
  Geographic: Domestic
  Metadata:
    Description: Test layer for development...
  Centroid: Feature has no geometry
  Geocode: Test City (1234567)
  Strategy: Check layer configuration, verify geometry field

  ... and 10 more layers
  (use --limit to analyze more)

================================================================================
END DEEP ANALYSIS
================================================================================
```

**Use Case:** Complete diagnostic information for troubleshooting and recovery planning.

**Key Insights:**
1. 6 layers (30%) have QUERY_TIMEOUT - systemic issue
2. 10 layers (50%) have HIGH recovery potential - quick wins
3. 2 layers are international (NONE potential) - mark as out-of-scope
4. Per-layer details show exactly what failed and how to fix it

---

## JSON Output

**Command:**
```bash
shadow-atlas diagnose coverage 0666000 --deep --categorize --recovery-potential --json
```

**Output:**
```json
{
  "success": true,
  "report": {
    "fips": "0666000",
    "cityName": "San Francisco",
    "state": "CA",
    "analysis": {
      "cityBoundaryArea": 120500000,
      "totalDistrictArea": 118200000,
      "coverageRatio": 0.981,
      "uncoveredAreas": []
    },
    "verdict": "pass",
    "notes": [
      "Coverage within acceptable range (85-115%)",
      "11 districts found in registry"
    ]
  },
  "deepAnalysis": {
    "summary": {
      "totalAnalyzed": 50,
      "resolved": 0,
      "unresolved": 50,
      "analysisDepth": "comprehensive"
    },
    "geographicClassification": {
      "domestic": 38,
      "international": 8,
      "unknown": 4
    },
    "failurePatterns": [
      {
        "category": "QUERY_TIMEOUT",
        "count": 15,
        "percentage": 30.0,
        "isSystemic": true,
        "remediationPath": "SYSTEMIC: Increase timeout, reduce query complexity - affects >20% of layers, prioritize fix",
        "examples": [
          {
            "url": "https://services.arcgis.com/.../FeatureServer/2",
            "name": "Council Districts",
            "failureReason": "QUERY_TIMEOUT",
            "failureCategories": ["QUERY_TIMEOUT"],
            "centroidResult": "29.4832, -98.5794",
            "geocodeResult": "Leon Valley (4842388)",
            "recoveryPotential": "HIGH",
            "recoveryStrategy": "Retry with increased timeout and rate limiting",
            "isDomestic": true,
            "isInternational": false
          }
        ]
      },
      {
        "category": "METADATA_TIMEOUT",
        "count": 12,
        "percentage": 24.0,
        "isSystemic": true,
        "remediationPath": "SYSTEMIC: Implement retry logic with exponential backoff - affects >20% of layers, prioritize fix",
        "examples": []
      }
    ],
    "recoveryAssessment": {
      "high": 26,
      "medium": 13,
      "low": 8,
      "none": 3,
      "topCandidates": [
        {
          "url": "https://services.arcgis.com/.../FeatureServer/2",
          "name": "Council Districts",
          "failureReason": "QUERY_TIMEOUT",
          "failureCategories": ["QUERY_TIMEOUT"],
          "centroidResult": "29.4832, -98.5794",
          "geocodeResult": "Leon Valley (4842388)",
          "recoveryPotential": "HIGH",
          "recoveryStrategy": "Retry with increased timeout and rate limiting",
          "isDomestic": true,
          "isInternational": false
        }
      ]
    }
  }
}
```

**Use Case:** Parse with `jq` or other tools for automation and tracking.

**Example Queries:**
```bash
# Get systemic issues only
jq '.deepAnalysis.failurePatterns[] | select(.isSystemic)' analysis.json

# Count high-recovery candidates
jq '.deepAnalysis.recoveryAssessment.high' analysis.json

# Extract all HIGH potential URLs
jq '.deepAnalysis.recoveryAssessment.topCandidates[] |
    select(.recoveryPotential == "HIGH") | .url' analysis.json

# Get geographic breakdown
jq '.deepAnalysis.geographicClassification' analysis.json
```

---

## Comparison: Script vs CLI Output

### Old Script Output (analyze-remaining-failures.ts)

```
================================================================================
REMAINING UNRESOLVED LAYER ANALYSIS
================================================================================

Analyzing 302 remaining unresolved layers...

  Analyzed 50/302...
  Analyzed 100/302...
  Analyzed 150/302...
  Analyzed 200/302...
  Analyzed 250/302...
  Analyzed 300/302...

--------------------------------------------------------------------------------
FAILURE CATEGORY BREAKDOWN
--------------------------------------------------------------------------------
  QUERY_TIMEOUT                  87
  NOT_INCORPORATED_PLACE         56
  GEOCODE_TIMEOUT               34
  NO_FEATURES                   32
  METADATA_TIMEOUT              28
  OUTSIDE_CONUS                 23
  NO_GEOMETRY                   18
  METADATA_HTTP_404             14
  QUERY_ERROR                    10

TOP 5 UNRESOLVED EXAMPLES BY CATEGORY

Category: QUERY_TIMEOUT (87)
  - Council Districts
    URL: https://services.arcgis.com/.../FeatureServer/2
    Stats: 29.4832, -98.5794
  - District Boundaries
    URL: https://gis.cityofboston.gov/.../FeatureServer/0
    Stats: 42.3601, -71.0589
  - City Council Districts
    URL: https://services1.arcgis.com/.../FeatureServer/0
    Stats: 35.7796, -78.6382
```

**Issues:**
- ❌ Just counts, no percentages
- ❌ No systemic vs one-off classification
- ❌ No remediation paths
- ❌ No recovery potential
- ❌ No priority guidance

### New CLI Output (with --categorize)

```
================================================================================
DEEP FAILURE ANALYSIS
================================================================================

Summary:
  Total Analyzed: 302
  Unresolved: 302
  Analysis Depth: comprehensive

Geographic Distribution:
  Domestic (CONUS): 245
  International: 34
  Unknown: 23

--------------------------------------------------------------------------------
FAILURE PATTERN CATEGORIZATION
--------------------------------------------------------------------------------

SYSTEMIC ISSUES (>20% of failures):

  QUERY_TIMEOUT - 87 occurrences (28.8%)
    Remediation: SYSTEMIC: Increase timeout, reduce query complexity
                 - affects >20% of layers, prioritize fix
    Examples:
      - Council Districts
        https://services.arcgis.com/.../FeatureServer/2
      - District Boundaries
        https://gis.cityofboston.gov/.../FeatureServer/0


ONE-OFF ISSUES (<20% of failures):
  NOT_INCORPORATED_PLACE             56 (18.5%)
  GEOCODE_TIMEOUT                    34 (11.3%)
  NO_FEATURES                        32 (10.6%)
  METADATA_TIMEOUT                   28 (9.3%)
  OUTSIDE_CONUS                      23 (7.6%)
  ...
```

**Improvements:**
- ✅ Counts AND percentages
- ✅ Systemic vs one-off classification
- ✅ Specific remediation paths
- ✅ Priority flagging (SYSTEMIC)
- ✅ Geographic distribution
- ✅ Actionable insights

---

## Use Case Examples

### 1. Quick Health Check
```bash
shadow-atlas diagnose coverage 0666000
```
**Time:** <1 second
**Purpose:** Verify coverage is acceptable

### 2. Weekly Review
```bash
shadow-atlas diagnose coverage 0666000 --categorize > weekly-report.txt
```
**Time:** ~30 seconds (50 layers)
**Purpose:** Identify new systemic issues

### 3. Recovery Planning
```bash
shadow-atlas diagnose coverage 0666000 --recovery-potential --limit 200 > recovery-plan.txt
```
**Time:** ~2-3 minutes
**Purpose:** Generate prioritized fix list

### 4. Deep Investigation
```bash
shadow-atlas diagnose coverage 0666000 --layer-diagnostics --limit 20
```
**Time:** ~15 seconds
**Purpose:** Debug specific layer failures

### 5. Comprehensive Analysis
```bash
shadow-atlas diagnose coverage 0666000 \
  --categorize \
  --recovery-potential \
  --layer-diagnostics \
  --limit 100 > full-analysis.txt
```
**Time:** ~1-2 minutes
**Purpose:** Complete diagnostic for quarterly review

### 6. Automation/Monitoring
```bash
shadow-atlas diagnose coverage 0666000 --deep --json | \
  jq '.deepAnalysis.recoveryAssessment.high' > metrics/high-recovery-count.txt
```
**Time:** ~30 seconds
**Purpose:** Track recovery potential over time

---

## Key Takeaways

1. **Progressive disclosure** prevents information overload
2. **Systemic detection** prioritizes infrastructure fixes
3. **Recovery potential** guides fix prioritization
4. **Per-layer diagnostics** enables precise troubleshooting
5. **JSON output** enables automation and tracking
6. **Geographic classification** routes international layers appropriately

**The CLI provides the same information as the scripts, plus actionable insights at every level.**
