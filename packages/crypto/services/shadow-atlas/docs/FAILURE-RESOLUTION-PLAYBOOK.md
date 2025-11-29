# Shadow Atlas Failure Resolution Playbook

**Version**: 1.0
**Last Updated**: 2025-11-20
**Purpose**: Systematic approach to resolving discovery failures at scale

---

## Executive Summary

Based on 15-city PoC analysis, we identified **4 distinct failure patterns** affecting 5/15 cities (33% failure rate). Each pattern has specific resolution strategies that can be applied systematically as we scale to 19,495 US cities.

**Failure Taxonomy**:
1. **Type A**: Portal not indexed (Aurora, St. Paul)
2. **Type B**: Governance entity mismatch (Urban Honolulu)
3. **Type C**: Search term variations (St. Paul, Aurora)
4. **Type D**: Data doesn't exist publicly (to be discovered)

---

## Part 1: Failure Pattern Analysis

### Pattern A: Portal Exists But Not Indexed

**Symptoms**:
- "T1 failed: No portal data found"
- Manual search finds official city portal
- Data exists on city GIS server

**Root Cause**: City portal not indexed in ArcGIS Hub API or our known-portals registry

**Example Cases**:
- **Aurora, CO**: Data on `ags.auroragov.org/aurora/rest/services/OpenData/MapServer/22` (6 wards)
- **St. Paul, MN**: Data on `information.stpaul.gov` (7 wards)

**Resolution Strategy**:

1. **Immediate Fix** (5 min per city):
   ```typescript
   // Add to known-portals.ts
   '0804000': { // Aurora, CO
     cityName: 'Aurora',
     state: 'CO',
     downloadUrl: 'https://ags.auroragov.org/aurora/rest/services/OpenData/MapServer/22/query?where=1%3D1&outFields=*&f=geojson',
     featureCount: 6,
     confidence: 90,
     discoveredVia: 'manual-investigation',
     lastValidated: '2025-11-20',
     notes: 'City Council Wards - Not indexed in Hub API, found via direct MapServer query',
   }
   ```

2. **Medium-Term Fix** (2-3 hours):
   - Build direct MapServer/FeatureServer scanner
   - Pattern: `{city-domain}/arcgis/rest/services` or `gis.{city}.gov/rest/services`
   - Enumerate all layers in discovered services

3. **Long-Term Fix** (1-2 weeks):
   - Systematic crawl of municipal GIS endpoints for top 500 cities
   - Build domain discovery heuristics (`*.{cityname}.gov`, `gis.{cityname}.{state}.gov`)

**Affected Cities Estimate**: 15-25% of cities (2,900-4,900 cities)

---

### Pattern B: Governance Entity Mismatch

**Symptoms**:
- Census place name ≠ Governance entity name
- Search finds no results despite data existing
- Common with consolidated city-counties, CDPs

**Root Cause**: Discovery searches for Census name, but portals use governance name

**Example Cases**:
- **Urban Honolulu, HI**: Census CDP "Urban Honolulu" (FIPS: 1571550) vs Governance "City and County of Honolulu" (FIPS: 15003)
- **Indianapolis city (balance)**: Census place vs Marion County consolidated government
- **Nashville-Davidson**: Consolidated metropolitan government

**Resolution Strategy**:

1. **Create City Name Alias Registry**:
   ```typescript
   // File: registry/city-name-aliases.ts
   export const CITY_NAME_ALIASES: Record<string, {
     readonly searchName: string;
     readonly governanceName: string;
     readonly fipsLevel: 'place' | 'county' | 'consolidated';
     readonly reason: string;
   }> = {
     '1571550': { // Urban Honolulu
       searchName: 'Honolulu',
       governanceName: 'City and County of Honolulu',
       fipsLevel: 'county',
       reason: 'Census CDP differs from governance entity. Council districts are county-wide.',
     },
   };
   ```

2. **Multi-Pass Search**:
   ```typescript
   async search(city: CityTarget): Promise<PortalCandidate[]> {
     const searchNames = this.getSearchNames(city); // ['Urban Honolulu', 'Honolulu', 'City and County of Honolulu']

     for (const searchName of searchNames) {
       const results = await this.searchPortals({ ...city, name: searchName });
       if (results.length > 0) return results;
     }

     return [];
   }
   ```

3. **State-Specific Handling**:
   - **Hawaii**: ALL cities are CDPs → Always use county-level search
   - **Virginia**: Independent cities have unique FIPS codes
   - **Alaska**: Borough system differs from county system

**Affected Cities Estimate**: 2-5% of cities (400-1,000 cities)

**Special Cases**:
- All 4 Hawaiian counties (Honolulu, Hawaii, Maui, Kauai)
- 39 Virginia independent cities
- ~20 consolidated city-counties (Indianapolis, Nashville, Louisville, etc.)

---

### Pattern C: Search Term Variations

**Symptoms**:
- City uses "ward" but we search "council district"
- City name abbreviation differences ("St." vs "Saint")
- Portal metadata uses different terminology

**Root Cause**: Search query too specific or rigid

**Example Cases**:
- **St. Paul, MN**: Uses "Ward" not "District" → Search for "council district" misses
- **St. Cities**: "St. Paul" vs "Saint Paul" vs "St Paul"
- **Geographic terms**: "Borough" (AK), "Parish" (LA), "Ward" (many eastern cities)

**Resolution Strategy**:

1. **City Name Variations**:
   ```typescript
   function getCityNameVariations(cityName: string): readonly string[] {
     const variations = [cityName]; // Original name

     // St./Saint variations
     if (cityName.startsWith('St. ')) {
       variations.push(cityName.replace('St. ', 'Saint '));
       variations.push(cityName.replace('St. ', 'St '));
     } else if (cityName.startsWith('Saint ')) {
       variations.push(cityName.replace('Saint ', 'St. '));
       variations.push(cityName.replace('Saint ', 'St '));
     }

     // Other common variations
     // "Fort" vs "Ft.", "Mount" vs "Mt.", etc.

     return variations;
   }
   ```

2. **Terminology Synonyms**:
   ```typescript
   const DISTRICT_SYNONYMS = [
     'council district',
     'council ward',
     'ward',
     'district',
     'municipal district',
   ];

   // Generate search queries
   for (const synonym of DISTRICT_SYNONYMS) {
     const query = `${cityName} ${state} ${synonym}`;
     // Search...
   }
   ```

3. **State-Specific Terms**:
   ```typescript
   const STATE_TERMINOLOGY: Record<string, string[]> = {
     'AK': ['borough', 'assembly district'], // Alaska boroughs
     'LA': ['parish', 'council district'], // Louisiana parishes
     'CT': ['ward', 'district'], // Connecticut wards
     // ... more states
   };
   ```

**Affected Cities Estimate**: 10-15% of cities (2,000-3,000 cities)

**High-Impact Groups**:
- 15+ "St." cities with 100k+ population
- Eastern cities using "ward" terminology (Boston, Providence, Hartford, etc.)
- Cities with Fort/Ft. variations (Fort Worth, Ft. Lauderdale)

---

### Pattern D: Data Doesn't Exist Publicly

**Symptoms**:
- No portal, no GIS server, no data found anywhere
- City website has no open data section
- Manual contact required

**Root Cause**: City doesn't publish boundary data publicly

**Resolution Strategy**:

1. **Verify Governance Structure**:
   - Does city even have districts? (Many small cities are at-large)
   - Check city charter/website for council structure

2. **Alternative Sources**:
   - **State GIS clearinghouses**: Many states maintain municipal boundaries
   - **Regional planning agencies**: MPOs often have district data
   - **Census TIGER**: Limited district data but worth checking
   - **Academic datasets**: Some universities maintain local government datasets

3. **Direct Contact**:
   - Email city GIS department or clerk's office
   - Request via FOIA if necessary
   - Offer to host data on our infrastructure

4. **Fallback Strategy**:
   - Mark city as "Layer 2 only" (use Census PLACE boundaries)
   - Document for future manual addition
   - Flag for community contribution

**Affected Cities Estimate**: 5-10% of cities (1,000-2,000 cities), mostly smaller municipalities

---

## Part 2: Systematic Resolution Process

### Phase 1: Automated Fixes (No Manual Work)

**Target**: Resolve 60-70% of failures automatically

**Steps**:

1. **Deploy Enhanced Scanners** (Week 1):
   - Multi-term search variations
   - City name alias registry
   - Direct MapServer scanner

2. **Re-run Failed Cities** (Week 1):
   - 3 failed cities from PoC → Expected 2/3 to resolve
   - Track improvement rate

3. **Batch Processing** (Week 2-3):
   - Process all Top 500 cities with enhanced scanners
   - Identify persistent failures
   - Build failure classification dataset

**Expected Results**:
- Aurora, CO: ✅ RESOLVED (direct MapServer scan)
- St. Paul, MN: ✅ RESOLVED (name variations + "ward" synonym)
- Urban Honolulu, HI: ✅ RESOLVED (city name alias)

---

### Phase 2: Semi-Automated Fixes (Minimal Manual Work)

**Target**: Resolve 20-25% of failures with registry additions

**Steps**:

1. **State GIS Clearinghouse Integration** (Week 3-4):
   - Build state portal scanner
   - Index all state-maintained municipal boundaries
   - Prioritize states with comprehensive coverage (CO, MN, HI, WA, OR, CA)

2. **Known-Portals Expansion** (Ongoing):
   - Community contributions via GitHub issues
   - Systematic top-500 manual validation
   - Document portal URLs for future automation

3. **Governance Entity Mapping** (Week 4-5):
   - Systematic identification of consolidated city-counties
   - Hawaii-specific handling for all CDPs
   - Virginia independent cities mapping

**Expected Results**:
- Resolve 1,500-2,000 additional cities
- Build comprehensive state GIS registry
- Enable community-driven portal discovery

---

### Phase 3: Manual Investigation (Last Resort)

**Target**: Resolve final 5-15% of failures

**Steps**:

1. **Triage Failures** (Week 6):
   - Classify by population size (prioritize 100k+ cities)
   - Check if city has districts at all (many are at-large)
   - Identify data availability vs data discoverability issues

2. **High-Value Manual Work** (Week 6-8):
   - Focus on 100k+ population cities (~300 cities)
   - Direct outreach to city GIS departments
   - FOIA requests if necessary

3. **Community Crowdsourcing** (Ongoing):
   - GitHub issues for "Help us find [City] council districts"
   - Bounty system for data contributions
   - Local activists often know where data lives

**Expected Results**:
- Resolve 150-300 high-population cities
- Build relationships with city GIS departments
- Enable community-driven data discovery

---

## Part 3: Implementation Roadmap

### Week 1: Quick Wins

**Objective**: Fix Aurora, St. Paul, Honolulu + 50% of similar cases

**Tasks**:
1. ✅ Add Aurora, St. Paul, Honolulu to known-portals registry (3 entries)
2. ✅ Implement city name variations (St./Saint handling)
3. ✅ Add "ward" to district synonyms
4. ✅ Create city name alias registry (skeleton)
5. ⬜ Test enhanced scanners on 15-city PoC (expect 12/15 success)

**Success Metric**: 80% success rate on PoC cities

---

### Week 2-3: Scanner Enhancements

**Objective**: Build infrastructure for automatic resolution

**Tasks**:
1. ⬜ Direct MapServer/FeatureServer scanner
2. ⬜ Multi-pass search with name variations
3. ⬜ State-specific terminology handling
4. ⬜ Enhanced Portal API queries (broader keyword matching)

**Success Metric**: 70-75% success rate on Top 500 cities

---

### Week 4-5: State GIS Integration

**Objective**: Tap into authoritative state-level sources

**Tasks**:
1. ⬜ Build state GIS clearinghouse scanner
2. ⬜ Index 10-15 high-coverage states
3. ⬜ Governance entity mapping for special cases
4. ⬜ Automated state portal discovery

**Success Metric**: 80-85% coverage of Top 500 cities

---

### Week 6-8: Manual Resolution + Community

**Objective**: Close gap on high-value cities

**Tasks**:
1. ⬜ Manual investigation of 100k+ cities with no data
2. ⬜ Build GitHub issue templates for community contributions
3. ⬜ Direct outreach to top-50 cities missing data
4. ⬜ FOIA requests for critical cities

**Success Metric**: 90%+ coverage of 100k+ population cities

---

## Part 4: Monitoring & Metrics

### Key Performance Indicators

**Discovery Success Rate**:
- **Current**: 67% (10/15 cities in PoC)
- **Week 1 Target**: 80% (12/15 cities)
- **Week 3 Target**: 75% (375/500 top cities)
- **Week 5 Target**: 85% (425/500 top cities)
- **Week 8 Target**: 90%+ (100k+ population cities)

**False Positive Rate**:
- **Before validator integration**: 50% (5/10 successes returned wrong data)
- **After validator integration**: <5% target
- **Monitor**: Negative keyword rejections, district count validation failures

**Data Quality Metrics**:
- Expected district count match: 95%+
- Geographic validation pass rate: 98%+
- Negative keyword rejections: Track patterns for scanner improvement

---

### Automated Health Checks

**Daily**:
- Run registry validator (URLs return HTTP 200)
- Check for new city additions via GitHub Actions
- Monitor semantic validator rejection patterns

**Weekly**:
- Re-run failed cities from previous week
- Check for portal migrations (404s → new URLs)
- Update staleness flags (365+ days since validation)

**Monthly**:
- Full re-validation of known-portals registry
- District count verification against official sources
- Governance structure changes (redistricting, annexations)

---

## Part 5: Scaling to Global Coverage

### Lessons from US Failures → Global Strategy

**Pattern Recognition**:
1. **Governance entity mismatches** are universal (not just US Census CDPs)
2. **Terminology varies by country** (Council, Ward, Constituency, Riding, etc.)
3. **Federal systems** have state/provincial GIS that can fill gaps
4. **Name variations** exist globally (St./Saint, Fort/Ft., abbreviations)

**Global Adaptations**:

**United Kingdom** (433 local authorities):
- Terminology: "Council Wards" or "Electoral Divisions"
- Source: ONS Geography Portal (authoritative)
- Special case: London Boroughs vs Metropolitan Districts

**Canada** (444 municipalities):
- Terminology: "Wards" or "Electoral Districts"
- Source: Provincial GIS portals (highly variable quality)
- Special case: Indigenous governance structures

**Australia** (537 local government areas):
- Terminology: "Wards" or "Divisions"
- Source: State data portals (e.g., DataVic, data.gov.au)
- Special case: Unincorporated areas in outback regions

**European Union** (90,000+ municipalities):
- High variability by country
- Many countries have national GIS portals (UK, France, Germany)
- Language variations require translation layer

---

## Part 6: Tooling & Automation

### Failure Analysis Dashboard

**Build**: Web dashboard for monitoring discovery health

**Features**:
- Real-time success/failure metrics
- Failure pattern classification (A/B/C/D)
- Drill-down by state, population tier, governance type
- Community contribution tracking

**Tech Stack**: SvelteKit + D3.js + PostgreSQL

---

### Community Contribution Portal

**Build**: GitHub-integrated portal for crowdsourcing data

**Features**:
- "Help us find [City] council districts" issue template
- URL submission form with automated validation
- Bounty/recognition system for contributors
- Geographic coverage heatmap

---

### Automated Retry Orchestrator

**Build**: Background job system for persistent failures

**Logic**:
```typescript
// Exponential backoff for failures
const retrySchedule = {
  firstFail: '1 day',
  secondFail: '1 week',
  thirdFail: '1 month',
  persistentFail: 'manual investigation queue',
};

// Auto-retry with enhanced scanners
async function retryFailedCity(cityFips: string) {
  const failureHistory = await getFailureHistory(cityFips);

  if (failureHistory.attempts >= 3) {
    // Move to manual investigation queue
    await queueManualInvestigation(cityFips);
    return;
  }

  // Try with progressively more aggressive scanners
  const scanners = [
    'portal-api-enhanced', // Name variations + synonyms
    'direct-mapserver',     // Direct GIS server enumeration
    'state-gis-clearinghouse', // State-level sources
  ];

  for (const scanner of scanners) {
    const result = await runScanner(scanner, cityFips);
    if (result.success) return result;
  }

  // Log failure and schedule retry
  await scheduleRetry(cityFips, failureHistory.attempts + 1);
}
```

---

## Part 7: Cost-Benefit Analysis

### Manual Investigation Cost

**Assumptions**:
- 15 minutes per city (research + validation)
- $50/hour fully-loaded engineer cost
- 3,000 cities requiring manual work

**Total Cost**: 750 hours × $50 = **$37,500**

### Automation Development Cost

**Development Time**:
- Enhanced scanners: 40 hours
- State GIS integration: 60 hours
- Retry orchestrator: 30 hours
- Community portal: 40 hours

**Total Cost**: 170 hours × $150 = **$25,500**

### Automation ROI

**Cities Resolved Automatically**:
- Enhanced scanners: ~1,800 cities (60% of manual work)
- State GIS: ~600 cities (20% of manual work)
- **Total**: 2,400 cities automated

**Cost Savings**:
- Manual cost avoided: 2,400 cities × 15 min × $50/hr = **$30,000**
- Development cost: **$25,500**
- **Net savings: $4,500**

**Plus**:
- Automation scales globally (ROI multiplies)
- Community contributions reduce manual work
- Infrastructure reusable for quarterly updates

---

## Conclusion

**15-city PoC revealed systematic failure patterns, not random data gaps.**

**Key Findings**:
1. **67% baseline success** with portal scanners
2. **50% false positive rate** before validator integration
3. **3 distinct failure patterns** (portal indexing, governance mismatch, search terms)
4. **All failures have systematic solutions**

**With proposed fixes**:
- Week 1: 80% success rate (quick wins)
- Week 5: 85% success rate (automation complete)
- Week 8: 90%+ success rate for 100k+ cities (manual cleanup)

**Global scaling enabled by**:
- Pattern recognition from US failures
- Automated retry with progressively aggressive scanners
- Community-driven data discovery
- State/national GIS integration

**Shadow Atlas is production-ready for US Top 500 cities after Week 5 implementation.**
