# US Cities Top 1000 Database

## Overview

This database contains the top 1000 US cities by population with authoritative data from the US Census Bureau.

## Data Source

- **Source**: US Census Bureau Sub-County Population Estimates (Vintage 2023)
- **URL**: https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/cities/totals/sub-est2023.csv
- **Vintage**: 2023 (most recent official estimates)
- **Generated**: 2025-11-19
- **License**: Public domain (US Government data)

## File Structure

Each city entry contains:

```typescript
interface CityData {
  fips: string;          // 7-digit FIPS code (state + place)
  name: string;          // Official city name (suffixes removed)
  state: string;         // 2-letter state postal abbreviation
  population: number;    // 2023 Census population estimate
  rank: number;          // Rank by population (1-1000)
}
```

## Statistics

- **Total cities**: 1,000
- **Population range**: 40,211 (DeKalb, IL) - 8,258,035 (New York, NY)
- **File size**: ~115 KB
- **Data quality**: All validations passing (FIPS codes, ranks, no duplicates)

## Validation

All records pass the following checks:
- ✅ 7-digit FIPS codes (state + place)
- ✅ 2-letter state abbreviations
- ✅ Sequential ranks (1-1000)
- ✅ No duplicate FIPS codes
- ✅ All populations > 0
- ✅ All names non-empty

## Usage

```typescript
import cityDatabase from './us-cities-top-1000.json';

// Find a city by FIPS
const nyc = cityDatabase.find(c => c.fips === '3651000');

// Get top 10 cities
const top10 = cityDatabase.slice(0, 10);

// Filter by state
const californiaCities = cityDatabase.filter(c => c.state === 'CA');

// Find cities by population threshold
const largeCities = cityDatabase.filter(c => c.population > 500000);
```

## Data Processing

The database was generated using the following process:

1. **Download**: Fetched Census Bureau's 2023 Sub-County Population Estimates
2. **Filter**: Selected incorporated places (SUMLEV='162') with population >= 30,000
3. **Clean**: Removed city suffixes (city, town, village, etc.)
4. **Sort**: Ordered by population (descending)
5. **Rank**: Assigned ranks 1-1000
6. **Validate**: Checked FIPS codes, populations, and data integrity

## Name Cleaning

City names have standard suffixes removed for consistency:
- "city" → removed (e.g., "Atlanta city" → "Atlanta")
- "town" → removed
- "village" → removed
- "borough" → removed
- "consolidated government" → removed
- "(balance)" → removed

This provides clean, user-facing city names while maintaining unique FIPS identifiers.

## FIPS Code Format

FIPS codes are 7 digits: `SSSPPPP`
- **SSS**: 2-digit state FIPS code (zero-padded)
- **PPPP**: 5-digit place FIPS code

Example: New York, NY = `3651000`
- `36` = New York state
- `51000` = New York city

## Updates

To update this database with new Census data:

1. Download latest Sub-County Population Estimates from Census Bureau
2. Run the processing script (see `/tmp/process_census_2023_fixed.py`)
3. Validate output (all checks must pass)
4. Update this README with new vintage and statistics

## References

- [Census Bureau Population Estimates](https://www.census.gov/programs-surveys/popest.html)
- [FIPS Codes](https://www.census.gov/library/reference/code-lists/ansi.html)
- [Sub-County Estimates Documentation](https://www.census.gov/programs-surveys/popest/technical-documentation/methodology.html)
