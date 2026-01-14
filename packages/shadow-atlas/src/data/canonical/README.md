# Canonical Data Files

**ARCHITECTURE**: This directory contains authoritative geographic data extracted from TypeScript constants into JSON format for optimal separation of data and code.

## Files

### place-geoids.json (534KB)

Canonical Place (Incorporated Cities/Towns/Villages) GEOIDs by state.

**Source**: Census TIGER/Line 2024 shapefiles
**Generated**: 2026-01-02T19:05:09.650Z
**Total Places**: 32,041 nationally

**Structure**:
```json
{
  "meta": {
    "source": "Census TIGER/Line 2024",
    "generated": "2026-01-02T19:05:09.650Z",
    "nationalTotal": 32041,
    "description": "...",
    "format": "GEOID FORMAT: SSPPPPP",
    "includes": [...],
    "specialCases": [...]
  },
  "expectedCounts": {
    "01": 594,  // Alabama
    "06": 1618, // California
    ...
  },
  "geoids": {
    "01": ["0100100", "0100124", ...],
    "06": ["0644000", ...], // 0644000 = Los Angeles
    ...
  }
}
```

**GEOID Format**: SSPPPPP (State FIPS 2 digits + Place FIPS 5 digits)
- `0644000` = Los Angeles city, California
- `3651000` = New York city, New York
- `4835000` = Houston city, Texas

**Includes**:
- Incorporated places (cities, towns, villages, boroughs)
- Census Designated Places (CDPs) - unincorporated communities

**Special Cases**:
- New England states (ME, MA, NH, RI, VT) use Minor Civil Divisions (MCDs) as primary local government, so incorporated place counts are lower
- Virginia includes independent cities (Richmond, Norfolk)
- Consolidated city-counties (San Francisco, Denver) have single GEOID
- Some places span county lines

## Usage

**DO NOT** import JSON directly. Use typed loaders in `src/data/loaders/`:

```typescript
import {
  NATIONAL_PLACE_TOTAL,
  getPlaceGeoidsForState,
} from '../data/loaders/place-geoids-loader';

const totalPlaces = NATIONAL_PLACE_TOTAL; // 32041
const caPlaces = getPlaceGeoidsForState('06'); // 1618 California places
```

## Maintenance

**Update frequency**: Annually after Census TIGER/Line release

**Extraction process**:
```bash
# 1. Download TIGER/Line PLACE shapefiles for all states
# 2. Run extraction script
npm run extract:place-geoids

# 3. Validate extracted data
npm test src/data/loaders/place-geoids-loader-comparison.test.ts
```

**Validation**: Comparison tests ensure zero data loss between TypeScript and JSON formats.

## Migration History

**WS-A2 (2026-01-10)**: Extracted from `src/validators/place-geoids.ts` (371KB) to JSON (534KB) + typed loader (4KB code).

**Benefits**:
- Data/code separation: JSON for data, TypeScript for logic
- Smaller code footprint: 371KB → 4KB TypeScript
- Type safety maintained: Typed loaders with validation
- Zero data loss: Comparison tests validate exact match

## Related

- **Loader**: `src/data/loaders/place-geoids-loader.ts`
- **Tests**: `src/data/loaders/place-geoids-loader.test.ts`
- **Comparison**: `src/data/loaders/place-geoids-loader-comparison.test.ts`
- **Extraction Script**: `scripts/extract-place-geoids-to-json.ts`
