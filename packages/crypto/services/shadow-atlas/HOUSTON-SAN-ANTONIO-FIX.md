# Houston and San Antonio Registry Fix

**Status**: ✅ COMPLETED
**Date**: 2025-12-13
**Issue**: ArcGIS Hub download URLs redirect to temporary Azure blobs

## Problem Statement

Houston and San Antonio registry entries were using ArcGIS Hub download URLs (`hub.arcgis.com/api/download/v1/items/.../geojson`) which redirect to temporary Azure Blob Storage URLs that expire. This causes data acquisition failures when the temporary URLs expire.

**Root Cause**: Hub download API generates short-lived signed URLs to Azure blob storage instead of serving data directly from stable ArcGIS REST API endpoints.

## Solution

Use direct FeatureServer/MapServer query URLs instead of Hub download URLs:

```typescript
// ❌ BROKEN: Redirects to temporary blob
downloadUrl: 'https://hub.arcgis.com/api/download/v1/items/.../geojson'

// ✅ FIXED: Direct FeatureServer query
downloadUrl: 'https://services.arcgis.com/.../FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
```

## Implementation Details

### Houston (FIPS 4835000)

**Old URL** (broken):
```
https://hub.arcgis.com/api/download/v1/items/[id]/geojson
```

**New URL** (stable):
```
https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Administrative_Boundary/MapServer/2/query?where=1%3D1&outFields=*&f=geojson
```

**Verification**:
- Feature count: 11 districts (A-K)
- District field: `DISTRICT`
- Source: Official City of Houston MapServer
- Tested: 2025-12-13 ✅

### San Antonio (FIPS 4865000)

**Old URL** (broken):
```
https://hub.arcgis.com/api/download/v1/items/[id]/geojson
```

**New URL** (stable):
```
https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/RedistrictedCouncilDistricts2022/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson
```

**Verification**:
- Feature count: 10 districts (1-10)
- District field: `District`
- Source: Official CoSAGIS (City of San Antonio GIS)
- Service: RedistrictedCouncilDistricts2022 (most current boundaries)
- Tested: 2025-12-13 ✅

## Changes Made

### 1. Registry Updates (`known-portals.ts`)

Updated both entries with:
- Direct FeatureServer/MapServer URLs
- Updated `lastVerified` timestamps to 2025-12-13
- Added inline comments explaining why FeatureServer URLs are preferred
- Updated notes documenting the fix

### 2. Validator Enhancement (`registry-validator.ts`)

Added `isStableUrlPattern()` function that detects problematic URL patterns:

```typescript
function isStableUrlPattern(url: string): { stable: boolean; warning?: string }
```

**Detection Rules**:
- ❌ UNSTABLE: `hub.arcgis.com/api/download` → redirects to temp blobs
- ✅ STABLE: `/FeatureServer/` or `/MapServer/` → direct REST API
- ✅ STABLE: Socrata APIs (`api/geospatial`, `/resource/`)
- ✅ STABLE: `hub.arcgis.com/api/v3` → newer stable Hub API

**Integration**: Validator now checks URL pattern BEFORE making HTTP requests, flagging problematic URLs as warnings.

### 3. Test Coverage (`registry-validator.test.ts`)

Added 3 new tests:
- ✅ Detects unstable hub.arcgis.com download URLs
- ✅ Accepts stable FeatureServer URLs (San Antonio example)
- ✅ Accepts stable MapServer URLs (Houston example)

## Validation Results

```bash
# Houston
curl "https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Administrative_Boundary/MapServer/2/query?where=1%3D1&outFields=*&returnCountOnly=true&f=json"
# Response: {"count": 11} ✅

# San Antonio
curl "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/RedistrictedCouncilDistricts2022/FeatureServer/0/query?where=1%3D1&outFields=*&returnCountOnly=true&f=json"
# Response: {"count": 10} ✅
```

Both URLs return valid GeoJSON FeatureCollections with expected feature counts.

## Additional URLs Needing Fixes

The following registry entries still use hub.arcgis.com download URLs and should be migrated to stable FeatureServer URLs in future work:

1. **Columbus, OH** (FIPS 3918000) - 9 districts
2. **Indianapolis, IN** (FIPS 1836003) - 25 districts
3. **Charlotte, NC** (FIPS 3712000) - 7 districts
4. **Nashville, TN** (FIPS 4752006) - 35 districts
5. **Louisville, KY** (FIPS 2148006) - 26 districts

**Recommended Action**: Research direct FeatureServer URLs for these cities using the same methodology:

```bash
# Find available services
curl -s "https://services.arcgis.com/[orgId]/arcgis/rest/services?f=json" | jq -r '.services[] | select(.name | contains("Council")) | .name'

# Test FeatureServer URL
curl -s "https://services.arcgis.com/[orgId]/arcgis/rest/services/[serviceName]/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" | jq '{type: .type, count: (.features | length)}'
```

## Why This Matters

### Stability
- FeatureServer/MapServer URLs are permanent REST API endpoints
- Hub download URLs redirect to temporary signed URLs (expire in hours/days)
- Eliminates intermittent "URL not found" failures

### Performance
- Direct API queries avoid redirect overhead
- No dependency on Azure blob storage availability
- Consistent response times

### Maintenance
- URL pattern validator catches problematic entries automatically
- Future registry additions will be validated before merge
- Test suite ensures both cities remain functional

## Related Documentation

- `/packages/crypto/services/shadow-atlas/ROADMAP.md` - Phase 1A task completion
- `/packages/crypto/services/shadow-atlas/registry/known-portals.ts` - Registry source
- `/packages/crypto/services/shadow-atlas/services/registry-validator.ts` - Validation logic
- `/scripts/test-all-registry-urls.ts` - Full registry health check script

## Testing

Run registry validation:
```bash
cd /Users/noot/Documents/voter-protocol
npx tsx scripts/test-all-registry-urls.ts
```

Run unit tests:
```bash
npx vitest run packages/crypto/services/shadow-atlas/services/registry-validator.test.ts
```

Expected results:
- ✅ Houston: 11 features, valid GeoJSON
- ✅ San Antonio: 10 features, valid GeoJSON
- ✅ All URL validation tests pass
