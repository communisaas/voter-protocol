# Wave F Extraction - Quick Reference

**Status:** 5/8 COMPLETE (62.5% success rate)
**Date:** 2026-01-18

## ✅ Ready for Integration (Copy-Paste URLs)

```typescript
// Ocala FL (1250750) - 5 districts
'1250750': {
  cityFips: '1250750',
  cityName: 'Ocala',
  state: 'FL',
  downloadUrl: 'https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  confidence: 90,
}

// Elk Grove CA (0622020) - 4 districts
'0622020': {
  cityFips: '0622020',
  cityName: 'Elk Grove',
  state: 'CA',
  downloadUrl: 'https://mapservices.gis.saccounty.net/arcgis/rest/services/ELK_GROVE/MapServer/8/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 4,
  confidence: 95,
}

// Glendale AZ (0427820) - 6 districts
'0427820': {
  cityFips: '0427820',
  cityName: 'Glendale',
  state: 'AZ',
  downloadUrl: 'https://services1.arcgis.com/9fVTQQSiODPjLUTa/arcgis/rest/services/Glendale_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 6,
  confidence: 95,
}

// Buckeye AZ (0407940) - 6 districts [REQUIRES FILTER]
'0407940': {
  cityFips: '0407940',
  cityName: 'Buckeye',
  state: 'AZ',
  downloadUrl: 'https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0/query?where=Juris%3D%27Buckeye%27&outFields=*&f=geojson',
  featureCount: 6,
  confidence: 90,
  notes: 'Multi-city layer - MUST filter by Juris=Buckeye',
}

// Fernley NV (3224900) - 5 wards
'3224900': {
  cityFips: '3224900',
  cityName: 'Fernley',
  state: 'NV',
  downloadUrl: 'https://services8.arcgis.com/dzKn4YTRsauu7Rfk/arcgis/rest/services/Fernley_City_Council_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  featureCount: 5,
  confidence: 95,
}
```

## ❌ Manual Extraction Required

**Sherman TX (4867496):** https://sherman-open-data-cityofsherman.hub.arcgis.com/pages/gis-data
**Taylor TX (4871948):** https://city-of-taylor-open-data-mallard.hub.arcgis.com/datasets/city-council-districts-for-taylor-tx
**Carson CA (0611530):** https://gis.carson.ca.us/ (contact GIS dept)

## Testing Commands

```bash
# Test Ocala
curl "https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" | jq '.features | length'

# Test Elk Grove
curl "https://mapservices.gis.saccounty.net/arcgis/rest/services/ELK_GROVE/MapServer/8/query?where=1%3D1&outFields=*&f=geojson" | jq '.features | length'

# Test Glendale
curl "https://services1.arcgis.com/9fVTQQSiODPjLUTa/arcgis/rest/services/Glendale_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" | jq '.features | length'

# Test Buckeye (filtered)
curl "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0/query?where=Juris%3D%27Buckeye%27&outFields=*&f=geojson" | jq '.features | length'

# Test Fernley
curl "https://services8.arcgis.com/dzKn4YTRsauu7Rfk/arcgis/rest/services/Fernley_City_Council_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" | jq '.features | length'
```

## Expected Results

| City | FIPS | Expected | Actual | Status |
|------|------|----------|--------|--------|
| Ocala FL | 1250750 | 5 | 6* | ⚠️ Duplicate |
| Elk Grove CA | 0622020 | 4 | 4 | ✅ Clean |
| Glendale AZ | 0427820 | 6 | 7** | ✅ Clean |
| Buckeye AZ | 0407940 | 6 | 12*** | ⚠️ Duplicates |
| Fernley NV | 3224900 | 5 | 5 | ✅ Clean |

\* District 3 appears twice (OBJECTID 441 and 449)
\** Includes 1 "NONE" area for unincorporated regions (6 actual districts)
\*** Each district appears twice (12 features = 6 unique districts)

## Integration Priority

1. **HIGH PRIORITY (Clean):** Elk Grove, Fernley, Glendale
2. **MEDIUM PRIORITY (Minor issues):** Ocala, Buckeye
3. **LOW PRIORITY (Manual required):** Sherman, Taylor, Carson
