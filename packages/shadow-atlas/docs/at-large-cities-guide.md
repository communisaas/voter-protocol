# At-Large Cities Guide

**Date**: 2026-01-16
**Purpose**: Document cities with at-large or proportional voting that have NO geographic council districts

## Overview

Some cities elect their entire council citywide (at-large) rather than from geographic districts. These cities must be excluded from tessellation validation because they have zero district polygons to validate.

## What is At-Large Voting?

### At-Large Elections
All council members are elected by voters across the entire city. There are no geographic ward boundaries dividing the city into districts.

**Example**: Morrisville, NC has a 5-member town council. All voters vote for all 5 positions. No geographic districts exist.

### Proportional Representation
Voters rank candidates, and seats are allocated proportionally using algorithms like Single Transferable Vote (STV). Still citywide, still no geographic districts.

**Example**: Cambridge, MA uses proportional representation with ranked-choice voting. 9 councillors elected citywide since 1941.

### Mixed Systems (NOT in this registry)
Some cities have both district-based and at-large seats. These cities DO have geographic districts and should be validated for the district-based seats.

**Example**: Los Angeles has 15 council districts BUT NOT at-large seats → NOT in at-large registry.

## Why Exclude From Tessellation?

Tessellation validation checks three properties:

1. **Containment**: Districts fit within city boundary
2. **Mutual Exclusion**: Districts don't overlap each other
3. **Completeness**: Districts cover entire city with no gaps

**At-large cities have ZERO district polygons.** Attempting tessellation validation would:
- Return 0 features (no districts to validate)
- Fail containment (0% of city covered)
- Fail completeness (100% gaps)
- Generate false negative failures

By excluding at-large cities, we prevent wasting compute on impossible validations and avoid polluting failure logs with structural non-issues.

## How Cities Enter This Registry

### Source 1: Containment Failure Analysis (WS-3)

The primary discovery mechanism is analyzing containment failures. When a city shows:
- **100% overflow** (districts completely outside city boundary)
- **Wrong feature count** (e.g., 11 districts for a city expecting 5)
- **Wrong data source** (county districts instead of city)

We investigate the city's charter:
- If the city uses **at-large voting** → Add to registry
- If the city has **real districts** → Fix the data source in `known-portals.ts`

### Source 2: Manual Research

Cities can be added proactively via:
- City charter review
- Municipal League directories
- Official government websites documenting election structure

### Source 3: Community Contributions

PRs welcome with:
- City FIPS code
- Council size (number of at-large seats)
- Election method (at-large or proportional)
- Source documentation (charter, official website)

## Current Registry Entries

### Confirmed At-Large Cities

#### Cambridge, MA (2511000)
- **Election Method**: Proportional representation (Plan E)
- **Council Size**: 9 councillors
- **Voting System**: Ranked-choice voting (Single Transferable Vote)
- **History**: Adopted proportional representation in 1941
- **Source**: Cambridge City Charter, Article II
- **Discovery**: WS-3 containment failure (100% overflow, Suffolk County data in registry)

One of the few US cities still using proportional representation. Considered a model system for democratic representation.

#### Morrisville, NC (3746060)
- **Election Method**: At-large
- **Council Size**: 5 members
- **Voting System**: Traditional at-large (voters elect all positions)
- **Source**: Morrisville Town Charter, Article III
- **Discovery**: WS-3 containment failure (100% overflow, Wake County commissioner districts in registry)

Typical at-large structure for small to mid-sized North Carolina towns.

#### Pearland, TX (4856348)
- **Election Method**: At-large
- **Council Size**: 8 members (mayor + 7 councillors)
- **Voting System**: Traditional at-large
- **Source**: Pearland City Charter, Article III
- **Discovery**: WS-3 containment failure (100% overflow, Houston city council districts in registry)

Houston suburb that retained at-large voting. Registry mistakenly contained Houston's 11 single-member districts (A-K).

### Candidate Cities (Pending Charter Verification)

#### Gresham, OR (4131250)
- **Suspected Method**: At-large
- **Council Size**: 6 members (estimated)
- **Discovery**: WS-3 containment failure (95% overflow, Multnomah County districts)
- **Status**: Needs official charter verification
- **Next Step**: Review Gresham City Charter to confirm at-large structure

#### Jenks, OK (4038350)
- **Suspected Method**: At-large
- **Council Size**: 4 members (estimated)
- **Discovery**: WS-3 containment failure (100% overflow, 13 features vs 4 expected)
- **Status**: Needs official charter verification
- **Next Step**: Review Jenks City Charter; small city likely at-large

## How to Add New At-Large Cities

### Step 1: Verify At-Large Structure

**Required Documentation**:
- City charter specifying at-large or proportional voting
- Official city website confirming no geographic districts
- Municipal League reference if charter unavailable

**Warning**: Do NOT add based on containment failures alone. Failures can indicate wrong data sources for cities with real districts.

### Step 2: Gather Metadata

Collect:
- **City FIPS code** (7-digit Census PLACE code)
- **City name** and state
- **Council size** (number of at-large seats)
- **Election method** (at-large or proportional)
- **Source** (charter article, official website URL)
- **Notes** (context, discovery method, unique details)

### Step 3: Add to Registry

Edit `/src/core/registry/at-large-cities.ts`:

```typescript
'FIPSCODE': {
  cityName: 'City Name',
  state: 'ST',
  councilSize: 5,
  electionMethod: 'at-large', // or 'proportional'
  source: 'City Charter, Article X',
  notes: 'Context about discovery or unique features',
},
```

### Step 4: Verify TypeScript Compilation

```bash
npm run typecheck
```

Ensure no type errors before committing.

### Step 5: Document Discovery

If discovered via containment failure:
- Update `docs/containment-failure-analysis.md`
- Cross-reference WS-3 analysis
- Note resolution (added to at-large registry)

## Integration with Validators

### Tessellation Validator

The tessellation validator should check the at-large registry BEFORE attempting validation:

```typescript
import { isAtLargeCity } from '@/core/registry/at-large-cities.js';

function validateTessellation(cityFips: string, districts: FeatureCollection) {
  // Early exit for at-large cities
  if (isAtLargeCity(cityFips)) {
    return {
      valid: true,
      skipped: true,
      reason: 'City uses at-large voting (no geographic districts)',
    };
  }

  // ... proceed with normal tessellation validation
}
```

### Containment Validator

Similarly, containment checks should skip at-large cities:

```typescript
import { isAtLargeCity, getAtLargeCityInfo } from '@/core/registry/at-large-cities.js';

function validateContainment(cityFips: string, districts: FeatureCollection, boundary: Polygon) {
  if (isAtLargeCity(cityFips)) {
    const info = getAtLargeCityInfo(cityFips);
    logger.info(`Skipping ${info?.cityName}, ${info?.state} - at-large voting`);
    return { valid: true, skipped: true };
  }

  // ... proceed with containment check
}
```

## Statistics and Reporting

Use registry helper functions for analysis:

```typescript
import { getAtLargeCityStats, getAtLargeCitiesByState } from '@/core/registry/at-large-cities.js';

const stats = getAtLargeCityStats();
// { total: 5, byMethod: { 'at-large': 4, 'proportional': 1 }, byState: { MA: 1, NC: 1, TX: 1, OR: 1, OK: 1 } }

const texasCities = getAtLargeCitiesByState('TX');
// [['4856348', { cityName: 'Pearland', ... }]]
```

## Historical Context

### Decline of At-Large Voting

At-large voting was common in early 20th century US cities. However:

- **1960s-1980s**: Voting Rights Act challenges led many cities to adopt district-based voting to ensure minority representation
- **2000s-2020s**: Continued legal pressure under state voting rights acts (CA, WA, OR)
- **Today**: Most large US cities use single-member districts

**Result**: At-large voting now concentrated in:
- Small cities/towns (<50,000 population)
- Cities with proportional representation (Cambridge, MA is rare exception)
- Some southern and western suburbs that haven't faced legal challenges

### Proportional Representation

Cambridge, MA is one of the last US cities using true proportional representation:
- **Peak (1940s-1950s)**: ~25 US cities used PR
- **Decline**: Cold War era campaigns associated PR with socialism
- **Today**: Cambridge + a handful of smaller cities

This makes Cambridge notable in the registry - it's a living example of electoral reform history.

## Maintenance Schedule

### Quarterly Review
- Verify existing entries still use at-large voting
- Check for city charter changes or redistricting
- Validate FIPS codes against Census updates

### Post-WS Analysis
- After each containment failure analysis (WS-3, WS-6, etc.)
- Review flagged cities for at-large structure
- Add confirmed at-large cities
- Remove cities that adopted district voting

### Annual Audit
- Cross-reference National League of Cities directories
- Check Municipal League state reports
- Verify proportional representation cities still use PR

## Related Documentation

- **WS-3 Containment Failure Analysis**: `/docs/containment-failure-analysis.md`
- **Known Portals Registry**: `/src/core/registry/known-portals.ts`
- **Tessellation Validator**: `/src/validators/tessellation-proof-validator.ts`
- **District Count Registry**: `/src/core/registry/district-count-registry.ts`

## Contributing

PRs welcome for:
- Adding confirmed at-large cities with charter documentation
- Updating council sizes or election methods
- Providing verification for candidate cities (Gresham, Jenks)
- Reporting cities that changed from at-large to district voting

**Quality Standards**:
- Must include source documentation (charter, official website)
- TypeScript must compile (`npm run typecheck`)
- Add explanatory notes for context
- Cross-reference discovery method (WS analysis, manual research, etc.)

## Questions?

- **"Should mixed systems be in this registry?"** → No. Only cities with ZERO geographic districts.
- **"What if a city has positions 1-3 by district, 4-5 at-large?"** → NOT in registry. Validate the 3 districts.
- **"Can at-large cities still use Shadow Atlas?"** → Yes, for state/federal districts. Just not city council.
- **"Why not just skip validation silently?"** → Transparency. Registry documents why we skip, provides election method context.

---

**Making democracy engaging is essential for its evolution in the attention economy.**
