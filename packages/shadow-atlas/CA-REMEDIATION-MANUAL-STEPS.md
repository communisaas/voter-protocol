# California Containment Failure Remediation - Manual Steps

**Date**: 2026-01-16
**Scope**: 10 California cities with containment failures
**Issue**: Registry points to wrong data sources (LA County, other cities, regional data)

## Summary

- **6 cities** have wrong data sources → quarantine
- **4 cities** are at-large (no geographic districts) → add to governance registry
- **Note**: Santa Monica (0670000) is already in MANUAL_QUARANTINE_ENTRIES, can be left as-is or moved to main quarantine

## Step 1: Remove from known-portals.ts

Remove these 10 FIPS codes from `src/core/registry/known-portals.ts`:

```
0622804  (Escondido - wrong layer, 53 features)
0622678  (Encinitas - 99.9% overflow)
0611530  (Carson - LA City districts not Carson)
0683332  (Walnut - West Covina districts)
0656700  (Perris - wrong geometry)
0646842  (Menifee - Perris districts)
0632548  (Hawthorne - at-large city)
0670000  (Santa Monica - at-large city, already quarantined)
0667112  (San Jacinto - at-large city)
0639003  (La Cañada Flintridge - at-large city)
```

## Step 2: Add at-large cities to governance-structures.ts

Add these 4 entries to `src/core/registry/governance-structures.ts` in the AT-LARGE CITIES section:

```typescript
'0632548': { // Hawthorne, CA
  cityFips: '0632548',
  cityName: 'Hawthorne',
  state: 'CA',
  structure: 'at-large',
  councilSize: 5,
  atLargeSeats: 5,
  source: 'https://ballotpedia.org/Hawthorne,_California',
  lastVerified: '2026-01-16',
  notes: 'All 5 council members (mayor + 4) elected at-large',
},

'0667112': { // San Jacinto, CA
  cityFips: '0667112',
  cityName: 'San Jacinto',
  state: 'CA',
  structure: 'at-large',
  councilSize: 5,
  atLargeSeats: 5,
  source: 'https://www.sanjacintoca.gov/city_departments/city-clerk/city-council',
  lastVerified: '2026-01-16',
  notes: 'All 5 council members elected at-large',
},

'0639003': { // La Cañada Flintridge, CA
  cityFips: '0639003',
  cityName: 'La Cañada Flintridge',
  state: 'CA',
  structure: 'at-large',
  councilSize: 5,
  atLargeSeats: 5,
  source: 'https://lcf.ca.gov/city-clerk/city-council/',
  lastVerified: '2026-01-16',
  notes: 'All 5 council members elected at-large with rotating mayor',
},
```

**Note**: Santa Monica (0670000) is already in MANUAL_QUARANTINE_ENTRIES in quarantined-portals.ts. It should also be added to governance-structures.ts:

```typescript
'0670000': { // Santa Monica, CA
  cityFips: '0670000',
  cityName: 'Santa Monica',
  state: 'CA',
  structure: 'at-large',
  councilSize: 7,
  atLargeSeats: 7,
  source: 'https://www.santamonica.gov/topic-explainers/city-council',
  lastVerified: '2026-01-16',
  notes: 'All 7 council members elected at-large',
},
```

## Step 3: Add quarantined entries to quarantined-portals.ts

Due to Santa Monica already being in MANUAL_QUARANTINE_ENTRIES with featureCount: 1, we should UPDATE it with the correct WS-3 reason.

**Option A**: Update Santa Monica's quarantine reason in MANUAL_QUARANTINE_ENTRIES:

Change the `quarantineReason` for FIPS `0670000` from:
```typescript
quarantineReason: 'SINGLE_FEATURE - Only 1 feature, cannot tessellate city into districts',
```

To:
```typescript
quarantineReason: 'WS-3 containment failure: At-large city (no geographic districts) + wrong data layer (LA City Council District 11)',
```

And update `matchedPattern` from `'single-feature'` to `'containment_failure_at_large'`.

**Add these 6 new entries** to the main `QUARANTINED_PORTALS` object (before the closing `};`):

```typescript
'0622804': {
  cityFips: '0622804',
  cityName: 'Escondido',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services8.arcgis.com/bLT9wzACSnOhnxN5/arcgis/rest/services/Crime_Free_Multi_Housing_Map_WFL1/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 53,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 63,
  discoveredBy: 'automated',
  notes: 'Escondido CA - 53 districts, bulk ingested from "COUNCIL_DISTRICTS"',
  quarantineReason: 'WS-3 containment failure (94.3%): Wrong data layer - Crime Free Multi Housing Map contains 53 features instead of 4 city council districts',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0622678': {
  cityFips: '0622678',
  cityName: 'Encinitas',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services.arcgis.com/ay9ePoQ2UfAX3U38/arcgis/rest/services/Council_District/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 4,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 63,
  discoveredBy: 'automated',
  notes: 'Encinitas CA - 4 districts, bulk ingested from "Council District"',
  quarantineReason: 'WS-3 containment failure (99.9%): District geometry completely outside city boundary despite correct feature count',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0611530': {
  cityFips: '0611530',
  cityName: 'Carson',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services5.arcgis.com/7nsPwEMP38bSkCjy/arcgis/rest/services/Dockless_ForHireTeam_LA_Boundaries_gdb/FeatureServer/5/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 15,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 88,
  discoveredBy: 'automated',
  notes: 'Carson CA - 15 districts, bulk ingested from "LA_City_Council_Districts"',
  quarantineReason: 'WS-3 containment failure (100%): Wrong city data - URL points to LA City Council districts (15) not Carson city districts',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0683332': {
  cityFips: '0683332',
  cityName: 'Walnut',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services8.arcgis.com/WV8ogNubjFL2BKPt/arcgis/rest/services/West_Covina_Council_Districts/FeatureServer/2/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 55,
  discoveredBy: 'automated',
  notes: 'Walnut CA - 5 districts, bulk ingested from "Council_Districts_20220405_c"',
  quarantineReason: 'WS-3 containment failure (100%): Wrong city data - URL explicitly points to West Covina Council Districts not Walnut',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0656700': {
  cityFips: '0656700',
  cityName: 'Perris',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services.arcgis.com/RjTKod25O4b8SbZx/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 4,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 63,
  discoveredBy: 'automated',
  notes: 'Perris CA - 4 districts, bulk ingested from "Council Districts"',
  quarantineReason: 'WS-3 containment failure (100%): District geometry completely outside city boundary despite correct feature count (4)',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0646842': {
  cityFips: '0646842',
  cityName: 'Menifee',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services7.arcgis.com/LNp9QekVQ7pNnS4Q/arcgis/rest/services/Council_Districts_Perris/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 63,
  discoveredBy: 'automated',
  notes: 'Menifee CA - 5 districts, bulk ingested from "Perris Council Districts"',
  quarantineReason: 'WS-3 containment failure (100%): Wrong city data - URL explicitly points to Perris Council Districts not Menifee',
  matchedPattern: 'containment_failure',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},
```

**Add at-large cities** to MANUAL_QUARANTINE_ENTRIES (or move to main QUARANTINED_PORTALS):

```typescript
'0632548': {
  cityFips: '0632548',
  cityName: 'Hawthorne',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services2.arcgis.com/OCysFFatYM3MITwS/arcgis/rest/services/Regional_Council_Districts_SCAG_Region/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 52,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 55,
  discoveredBy: 'automated',
  notes: 'Hawthorne CA - 52 districts, bulk ingested from "Regional_Council_Districts_-_SCAG_Region"',
  quarantineReason: 'WS-3 containment failure (99.9%): At-large city with no geographic districts + wrong data (regional planning layer)',
  matchedPattern: 'containment_failure_at_large',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0667112': {
  cityFips: '0667112',
  cityName: 'San Jacinto',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services7.arcgis.com/uFAr0LUPy14bDaLg/arcgis/rest/services/Hemet_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 88,
  discoveredBy: 'automated',
  notes: 'San Jacinto CA - 5 districts, bulk ingested from "Hemet_City_Council_Districts"',
  quarantineReason: 'WS-3 containment failure (100%): At-large city with no geographic districts + wrong data (Hemet city districts)',
  matchedPattern: 'containment_failure_at_large',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},

'0639003': {
  cityFips: '0639003',
  cityName: 'La Cañada Flintridge',
  state: 'CA',
  portalType: 'arcgis',
  downloadUrl: 'https://services2.arcgis.com/DEoxb4q3EJppiDKC/arcgis/rest/services/Enriched Council_District/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 7,
  lastVerified: '2026-01-15T00:00:00.000Z',
  confidence: 63,
  discoveredBy: 'automated',
  notes: 'La Cañada Flintridge CA - 7 districts, bulk ingested from "Enriched Council_District"',
  quarantineReason: 'WS-3 containment failure (99.9%): At-large city with no geographic districts + wrong data (likely LA County regional data)',
  matchedPattern: 'containment_failure_at_large',
  quarantinedAt: '2026-01-16T00:00:00.000Z',
},
```

## Step 4: Update quarantine counts and summary

Update `QUARANTINE_COUNT` to reflect new total (was 3, add 6 wrong data + 3 at-large = 12, total becomes 15 if adding to main object, or update MANUAL_QUARANTINE_ENTRIES count separately).

Update `QUARANTINE_SUMMARY` to include:
```typescript
export const QUARANTINE_SUMMARY = {
  "sewer": 1,
  "pavement": 1,
  "parcel": 1,
  "containment_failure": 6,  // New pattern for WS-3 wrong data
  "containment_failure_at_large": 4  // New pattern for WS-3 at-large cities
};
```

## Verification

After manual edits:

1. Run TypeScript compilation:
   ```bash
   npx tsc --noEmit
   ```

2. Verify no FIPS codes remain in known-portals.ts:
   ```bash
   grep -E "(0622804|0622678|0632548|0670000|0611530|0683332|0667112|0656700|0646842|0639003)" src/core/registry/known-portals.ts
   ```
   Should return nothing.

3. Verify all 10 FIPS codes in quarantined-portals.ts:
   ```bash
   grep -E "(0622804|0622678|0632548|0670000|0611530|0683332|0667112|0656700|0646842|0639003)" src/core/registry/quarantined-portals.ts
   ```
   Should return 10 matches.

4. Verify 4 at-large cities in governance-structures.ts:
   ```bash
   grep -E "(0632548|0667112|0639003|0670000)" src/core/registry/governance-structures.ts
   ```
   Should return 4 matches.

## Success Criteria

- ✅ All 10 CA entries removed from known-portals.ts
- ✅ 6 wrong-data entries added to quarantined-portals.ts
- ✅ 4 at-large cities added to both quarantined-portals.ts AND governance-structures.ts
- ✅ No TypeScript compilation errors
- ✅ Rationale documented for each decision in quarantine entries

## References

- Full analysis: `src/core/registry/ca-remediation-report.json`
- Containment failure analysis: `docs/containment-failure-analysis.md`
- Web research sources documented in ca-remediation-report.json

