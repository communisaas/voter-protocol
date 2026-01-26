# At-Large City Research Summary
**Date**: 2026-01-16
**Researcher**: Claude (Shadow Atlas Agent)
**Purpose**: Identify cities with at-large voting (no geographic districts) vs. cities with wrong data sources

## Executive Summary

Researched 8 cities with low coverage or exclusivity failures. Key finding: **Only 1 city confirmed at-large** (Milton, GA). Most low-coverage issues stem from wrong data sources, not at-large voting systems.

### Results at a Glance
- **Confirmed at-large**: 1 city (Milton, GA)
- **Has districts (wrong data)**: 5 cities
- **Formerly at-large (transitioned)**: 2 cities

---

## Confirmed At-Large Cities

### Milton, GA (FIPS: 1351670) ✅ ADDED TO REGISTRY

**Council Structure**: 6 councilmembers + mayor, all elected at-large

**Key Evidence**:
- All registered voters cast ballots for all council seats
- Councilmembers must reside in specific districts but are elected citywide
- Mayor elected at-large from anywhere in city

**Sources**:
- [City of Milton - Mayor & City Council](https://www.miltonga.gov/government/mayor-city-council)
- [Milton Elections Information](https://www.miltonga.gov/government/elections)

**Registry Entry**: Added to `src/core/registry/at-large-cities.ts` as FIPS `1351670`

---

## Cities with Districts (Wrong Data Sources)

### 1. Sheridan, IN (FIPS: 1869354)
**Coverage**: 4.2% (indicating wrong data)

**Actual Structure**: 4 town council districts (Sheridan 1-4)

**Evidence**:
- Hamilton County 2023 official district map shows 4 districts
- Each district elects representatives
- NOT at-large voting

**Source**: [Hamilton County Sheridan Town Council Districts Map 2023](https://www.hamiltoncounty.in.gov/DocumentCenter/View/18183/Sheridan-Town-Council-Districts-Map-2023-PDF)

**Recommendation**: Source correct Sheridan town council district boundaries. Current registry likely has county or state legislative data.

---

### 2. Bridgeport, CT (FIPS: 0908000)
**Coverage**: 10.6% (indicating wrong data)

**Actual Structure**: 10 city council districts, 2 members per district (20 total councilmembers)

**Evidence**:
- City council districts numbered 130-139
- Recent redistricting completed July 2023
- Each district covers specific neighborhoods
- Board of Education candidates elected citywide (separate from council)

**Sources**:
- [City of Bridgeport City Council](https://www.bridgeportct.gov/government/departments/city-council)
- [Bridgeport Local Redistricting](https://www.bridgeportct.gov/government/departments/registrar-voters/bridgeport-local-redistricting)

**Recommendation**: Registry likely has state legislative districts or county boundaries. Need Bridgeport city council district boundaries.

---

### 3. Lafayette, LA (FIPS: 2240735)
**Coverage**: 44.1% (suggesting partial or overlapping data)

**Actual Structure**: 5 city council single-member districts + 5 parish council districts (separate bodies)

**Evidence**:
- City-parish split approved by voters (home rule charter amendment)
- City residents vote for both parish AND city council members
- Recent redistricting after 2020 census
- City council districts target 24,275 population per district

**Sources**:
- [Lafayette Consolidated Government](https://lafayettela.gov/council/default)
- [Lafayette Redistricting 101 - The Current](https://thecurrentla.com/lafayette-redistricting-101/)

**Recommendation**: Registry may contain parish council districts OR overlap between city/parish boundaries. Need city council districts only, excluding parish districts.

---

### 4. Farmington, NM (FIPS: 3526190)
**Coverage**: 45.3% (indicating wrong data)

**Actual Structure**: 4 city council districts

**Evidence**:
- Councilors represent their specific districts
- Official district map available at city document center
- Elections held in November of odd-numbered years
- Mayor votes only to break ties; councilors vote on all matters

**Sources**:
- [City of Farmington City Council](https://www.fmtn.org/141/City-Council)
- [Farmington Municipal Elections](https://www.fmtn.org/145/Elections)
- [Official Municipal Election District Map](https://fmtn.org/DocumentCenter/View/1379/City-Council-Districts)

**Recommendation**: Registry likely has county or regional planning districts. Need official Farmington city council district boundaries.

---

### 5. Chattahoochee Hills, GA (FIPS: 1315828)
**Issues**: Exclusivity failures in small city

**Actual Structure**: 5 city council districts + at-large mayor

**Evidence**:
- Mayor elected at-large
- Council members elected BY district (not at-large)
- Current council: District 1 (Ruby Foster), District 2 (Richard Schmidt), District 3 (Scott Lightsey), District 4 (Camille Lowe), District 5 (Rodney Peek)
- 2025 elections for Districts 2 and 4

**Source**: [Chattahoochee Hills Mayor and City Council](https://www.chatthillsga.us/government/mayor_and_city_council.php)

**Recommendation**: Exclusivity failures likely due to wrong data source (county or regional data). Need correct city council district boundaries.

---

## Cities That Transitioned from At-Large to Districts

### 1. Meridian, ID (FIPS: 1652120) - TRANSITIONED 2023
**Coverage**: 40.0% (possibly outdated data)

**Former Structure**: At-large elections (all councilmembers elected citywide)

**Current Structure**: 6 geographic city council districts (since November 2023)

**Transition Details**:
- Idaho state law (passed 2020): Cities over 100,000 population must use district elections
- Meridian surpassed 100,000 in 2020 census (117,635 population)
- First district-based elections: November 2023
- Ideal population per district: 19,606
- Candidates must live in the district they represent

**Sources**:
- [City of Meridian City Council Districting](https://meridiancity.org/city-council/city-council-districts/)
- [Meridian Election Season Changes](https://meridiancity.org/mayor/2022/04/04/election-season-changes)
- [BoiseDev: Meridian moves to council districts](https://boisedev.com/news/2022/07/28/meridian-council-swap/)

**Recommendation**: Coverage issues suggest registry may still reflect pre-2023 at-large structure OR has wrong data source. Verify registry contains post-2023 district boundaries.

---

### 2. Big Bear Lake, CA (FIPS: 0606210) - TRANSITIONED 2018
**Issues**: Exclusivity failures

**Former Structure**: At-large elections

**Current Structure**: 4-5 by-district council seats (5 total councilmembers including mayor)

**Transition Details**:
- Ordinance No. 2018-459: Adopted by-district election system (2018)
- Ordinance No. 2022-502: New district map after 2020 census redistricting (April 2022)
- Councilmembers elected by-district for 4-year terms
- Candidates must reside in district they represent
- Elections held in November of even-numbered years

**Sources**:
- [City of Big Bear Lake City Council](https://www.citybigbearlake.com/index.php/en/government-main/city-council)
- [City of Big Bear Lake Elections](https://www.citybigbearlake.com/index.php/en/government-main/2020-election-2)
- [San Bernardino County: Big Bear Lake City Council Districts](https://open.sbcounty.gov/datasets/sbcounty::city-of-big-bear-lake-city-council-districts/about)

**Recommendation**: Exclusivity failures suggest data reflects pre-2018 at-large structure OR wrong source. Need current district boundaries reflecting 2022 redistricting.

---

## Key Insights

### 1. At-Large Voting is Rare
Of 8 cities researched, only 1 confirmed true at-large structure. Most low-coverage cities have districts but wrong data in registry.

### 2. District Residency ≠ At-Large Voting
Milton, GA has district residency requirements BUT at-large voting (all voters vote for all seats). This is the key distinction:
- **True at-large**: All voters vote for all seats (Milton, Cambridge MA, Morrisville NC)
- **District-based**: Voters only vote for their own district representative (Sheridan, Bridgeport, Lafayette, Farmington)

### 3. State Laws Driving Transitions
Both Idaho and California have pushed cities to adopt district elections:
- **Idaho**: Cities over 100,000 must use districts (Meridian transitioned 2023)
- **California**: California Voting Rights Act pressure (Big Bear Lake transitioned 2018)

### 4. Data Source Confusion Patterns

Common wrong data sources in registries:
- **County boundaries** instead of city boundaries (Sheridan, Farmington)
- **State legislative districts** instead of city council districts (Bridgeport)
- **Regional planning districts** instead of electoral districts (Hawthorne CA, per previous research)
- **Overlapping jurisdictions** (Lafayette: city + parish councils)
- **Outdated pre-transition data** (Meridian, Big Bear Lake)

---

## Registry Updates

### Added to At-Large Registry:
1. **Milton, GA (FIPS: 1351670)** - 6 councilmembers, true at-large voting

### No Changes Required:
- Gresham, OR (4131250) - Pending charter verification
- Jenks, OK (4038350) - Pending charter verification

These remain in registry with "pending verification" status until charter research confirms structure.

---

## Recommendations for Low-Coverage Cities

### Immediate Actions Required:

1. **Sheridan, IN**: Source official town council district boundaries from Hamilton County or Town of Sheridan
   - Remove current wrong data (likely county/state)
   - Expected districts: 4

2. **Bridgeport, CT**: Source official city council district boundaries from City Clerk
   - Remove current wrong data (likely state legislative)
   - Expected districts: 10 (numbered 130-139)

3. **Lafayette, LA**: Source city council districts separate from parish council
   - Ensure only CITY council districts in registry, not parish
   - Expected districts: 5 city + 5 parish (registry should have ONLY the 5 city districts)

4. **Farmington, NM**: Source official city council district map from document center
   - Remove current wrong data
   - Expected districts: 4
   - Official map URL: https://fmtn.org/DocumentCenter/View/1379/City-Council-Districts

5. **Meridian, ID**: Verify registry has post-2023 district boundaries
   - Expected districts: 6 (created 2022-2023)
   - If registry predates 2023, data is outdated

6. **Big Bear Lake, CA**: Verify registry has post-2022 redistricting boundaries
   - Expected districts: 4-5
   - If data predates 2022, redistricting boundaries missing

7. **Chattahoochee Hills, GA**: Source correct city council district boundaries
   - Expected districts: 5
   - Remove county/regional data if present

---

## Methodology Notes

### Research Process:
1. Web search for each city's charter, municipal code, and official government websites
2. Prioritized official .gov sources over third-party sites
3. Cross-referenced multiple sources for verification
4. Documented transition dates for formerly at-large cities
5. Verified FIPS codes against Census Bureau standards

### Source Quality:
- **Primary sources**: City official websites, municipal codes, city charters
- **Secondary sources**: Ballotpedia, news articles (for context only)
- **Geographic data**: Official district maps from city/county GIS departments

### Limitations:
- Could not access full text of some city charters (paywall/restricted access)
- Some cities have district maps but not detailed charter language online
- Transition dates for formerly at-large cities may be approximate

---

## Files Modified

1. **`src/core/registry/at-large-cities.ts`**
   - Added Milton, GA (FIPS: 1351670)
   - No removals (Gresham OR and Jenks OK remain pending verification)

2. **`analysis-output/at-large-research.json`**
   - Complete structured research findings
   - All sources and URLs documented

3. **`analysis-output/at-large-research-summary.md`**
   - This document (human-readable summary)

---

## Sources

### Primary Sources (Official Government Sites):
- [City of Milton, GA](https://www.miltonga.gov/government/mayor-city-council)
- [Hamilton County, IN - Sheridan Districts](https://www.hamiltoncounty.in.gov/DocumentCenter/View/18183/Sheridan-Town-Council-Districts-Map-2023-PDF)
- [City of Bridgeport, CT](https://www.bridgeportct.gov/government/departments/city-council)
- [Lafayette Consolidated Government](https://lafayettela.gov/council/default)
- [City of Farmington, NM](https://www.fmtn.org/141/City-Council)
- [City of Meridian, ID](https://meridiancity.org/city-council/city-council-districts/)
- [City of Big Bear Lake, CA](https://www.citybigbearlake.com/index.php/en/government-main/city-council)
- [Chattahoochee Hills, GA](https://www.chatthillsga.us/government/mayor_and_city_council.php)

### Census Resources:
- [Understanding Geographic Identifiers (GEOIDs)](https://www.census.gov/programs-surveys/geography/guidance/geo-identifiers.html)
- [Census Bureau Place FIPS Codes](https://www.census.gov/library/reference/code-lists/ansi.html)

### Secondary Sources (Context):
- Ballotpedia city pages (structure verification)
- The Current LA (Lafayette redistricting coverage)
- BoiseDev (Meridian transition coverage)

---

**Research Complete**: 2026-01-16
**Next Steps**: Source correct district boundaries for the 7 cities with wrong data
