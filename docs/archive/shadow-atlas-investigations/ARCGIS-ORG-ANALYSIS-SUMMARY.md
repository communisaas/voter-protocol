# ArcGIS Organization ID Fingerprinting Analysis

**Date**: 2026-01-16
**Analyst**: Automated codebase analysis
**Scope**: 42 failing containment test cities

## Executive Summary

Analysis of ArcGIS portal URLs reveals **16 HIGH-severity cases of metro/regional data bleeding** into suburban city entries. Organization IDs extracted from `services.arcgis.com/{ORG_ID}/` patterns expose wrong-jurisdiction data sources.

### Critical Findings

**13 cities require immediate quarantine:**
- 4 CA cities using wrong municipality data (San Jacinto→Hemet, Walnut→West Covina, Menifee→Perris, Poway→SD Regional)
- 4 cities using county data instead of city (Barberton→Summit County, Goose Creek/Bluffton SC→County, Annapolis→AA County)
- 3 cities using regional/metro data (Jacksonville Beach→Jax, Winter Springs→73-district regional, Little Rock→BPADD)
- 2 additional severe cases (Opelika→Lee County, DeQuincy→22 districts anomaly)

## Methodology

Extracted organization IDs from failing portal entries:
```
https://services.arcgis.com/{ORG_ID}/arcgis/rest/services/...
```

Cross-referenced layer names against expected city names to detect mismatches.

## Pattern Categories

### 1. Suburban City Using Metro City Data

**Evidence**: Layer name explicitly references different city

| City | Uses Data From | Org ID | Evidence |
|------|---------------|---------|----------|
| San Jacinto, CA | Hemet | `uFAr0LUPy14bDaLg` | Layer: `Hemet_Council_Districts` |
| Walnut, CA | West Covina | `WV8ogNubjFL2BKPt` | Layer: `West_Covina_Council_Districts` |
| Menifee, CA | Perris | `LNp9QekVQ7pNnS4Q` | Layer: `Council_Districts_Perris` |
| Jacksonville Beach, FL | Jacksonville | `r24cv1JRnR3HZXVQ` | Layer: `Jax_VZAP_WFL1` |

### 2. City Using County Data

**Evidence**: Layer explicitly references county jurisdiction

| City | Uses Data From | Org ID | Evidence |
|------|---------------|---------|----------|
| Barberton, OH | Summit County | `YvJkKP3I2NydFmVT` | Layer: `Summit_County_Council_Districts` |
| Goose Creek, SC | County | `maPS0LX4n9AZQoiS` | Layer 94: `County Council Districts` |
| Bluffton, SC | Beaufort County | `nZwqO8atLsfAXkOG` | Layer: `Beaufort_County_Council` |
| Annapolis, MD | Anne Arundel County | `VjAUDGF6sTvUJATh` | Layer: `AACC_Footprint_by_Council_District` |
| Opelika, AL | Lee County | `NybqoDIlkNhsZunt` | Layer: `LEE_HB_7_WFL1` |

### 3. Regional Data Bleeding

**Evidence**: District counts wildly incorrect or regional acronyms

| City | Suspicious Pattern | Org ID | Evidence |
|------|-------------------|---------|----------|
| Poway, CA | 13 districts | `xOaE01KwGK9Fvnfr` | SDRVC acronym (San Diego Regional) |
| Winter Springs, FL | 73 districts | `H65mZknxx42pSkN4` | BWCF_Jurisdiction_Reference (multi-city) |
| Little Rock, AR | 20 wards | `wyoDVuo3QgawYe6R` | BPADD regional planning district |
| DeQuincy, LA | 22 districts | `T7YR8Q3OOFw14uBe` | Small city with impossible district count |

### 4. Non-Authoritative Layers

**Evidence**: Using secondary/derived data layers instead of official council districts

| City | Layer Type | Severity | Issue |
|------|-----------|----------|-------|
| Escondido, CA | Crime housing map | MEDIUM | 53 districts from `Crime_Free_Multi_Housing_Map` |
| Port Arthur, TX | Rehab map | MEDIUM | Using `Rehab_Map1` not primary council layer |
| La Cañada Flintridge, CA | Enriched data | MEDIUM | "Enriched" prefix suggests derived/analytics data |

## Known Metro Organization IDs (Reference)

From prior Houston/San Antonio analysis:
- `su8ic9KbA7PYVxPS` → City of Houston
- `g1fRTDLeMgspWrYp` → City of San Antonio
- `NummVBqZSIJKUeVR` → Houston metro region

**Note**: None of the failing cities analyzed here use these known IDs, but pattern is identical (suburban cities using metro/county data).

## Self-Hosted vs Shared Hosting

**Observation**: All failing cities use `services.arcgis.com/*` shared hosting pattern.

**Contrast**: Successful entries like Noblesville, IN use `gis1.hamiltoncounty.in.gov` (self-hosted, more trustworthy).

**Implication**: Self-hosted GIS servers generally more reliable for jurisdiction correctness.

## Recommendations

### Immediate Actions

1. **Quarantine 13 HIGH-severity cities** - Remove from production registry until correct sources found
2. **Investigate 5 MEDIUM-severity cities** - Manual verification of district counts and layer appropriateness
3. **Flag all `services.arcgis.com` entries** - Require additional validation vs self-hosted portals

### Source Correction Strategy

For quarantined cities, search for:
- Official city GIS portals (`gis.cityname.gov`, `maps.cityname.gov`)
- City open data portals (`data.cityname.gov`)
- State GIS clearinghouses with city-specific layers
- Direct ArcGIS REST endpoints from city-owned servers

### Validation Checklist

Before re-adding quarantined cities:
- ✅ Layer name matches city name (not county/metro)
- ✅ District count matches known city council size
- ✅ Self-hosted server preferred over shared hosting
- ✅ Manual spot-check of 2-3 district geometries

### Future Prevention

1. **Org ID allowlist**: Build trusted org IDs from verified city portals
2. **District count validation**: Auto-reject if count >2x expected for city size
3. **Layer name parsing**: Flag entries where layer name doesn't contain city name
4. **Prefer self-hosted**: Score self-hosted servers higher than shared hosting

## Files Generated

- `/analysis-output/arcgis-org-fingerprints.json` - Complete analysis with all org IDs, evidence, and recommendations

## State-by-State Impact

| State | HIGH Severity | MEDIUM Severity | Notes |
|-------|---------------|-----------------|-------|
| CA | 4 | 3 | Highest concentration of metro bleeding |
| FL | 2 | 0 | Jacksonville/regional issues |
| SC | 2 | 0 | County data bleeding |
| OH | 1 | 0 | Summit County issue |
| MD | 1 | 0 | Anne Arundel County issue |
| AL | 1 | 0 | Lee County issue |
| AR | 1 | 0 | Regional planning district |
| LA | 1 | 0 | Data quality anomaly |
| TX | 0 | 1 | Port Arthur rehab layer |
| NY | 0 | 1 | Third-party platform |

## Success Examples

**Cities with clean org IDs:**
- Knoxville, TN: `QWaOgwdmpqI9HUzf` - Explicit city name match, correct district count
- Bremerton, WA: `m9zYNmX49ddkBsgd` - City-coded identifier in layer

These demonstrate correct city-specific portals for comparison.

---

**Next Step**: Manual source research for 13 quarantined cities to find authoritative GIS portals.
