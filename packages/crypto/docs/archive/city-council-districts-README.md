> **ARCHIVED [2026-02-20]:** 37-city prototype dataset from November 2025. Production now has 716+ portals in shadow-atlas. See the shadow-atlas package for current district boundary data.

# City Council District GIS Data

**Last Updated:** 2025-11-15
**Cities:** 37
**Format:** GeoJSON (WGS84)

## Data Sources

| City | State | Districts | Source | License |
|------|-------|-----------|--------|---------|
| New York | NY | 51 | [socrata](https://data.cityofnewyork.us) | Open Data |
| Los Angeles | CA | 10 | [arcgis](https://geohub.lacity.org) | Open Data |
| Chicago | IL | 50 | [socrata](https://data.cityofchicago.org) | Open Data |
| Houston | TX | 7 | [arcgis](https://houston-mycity.opendata.arcgis.com) | Open Data |
| Philadelphia | PA | 10 | [arcgis](https://www.opendataphilly.org) | Open Data |
| San Francisco | CA | 11 | [socrata](https://data.sfgov.org) | Open Data |
| San Jose | CA | 10 | [arcgis](https://data.sanjoseca.gov) | Open Data |
| Phoenix | AZ | 8 | [arcgis](https://maps.phoenix.gov/pub/rest/services) | Open Data |
| San Antonio | TX | 10 | [arcgis](https://opendata-cosagis.opendata.arcgis.com) | Open Data |
| San Diego | CA | 9 | [arcgis](https://data.sandiego.gov) | Open Data |
| Dallas | TX | 14 | [arcgis](https://gisservices-dallasgis.opendata.arcgis.com) | Open Data |
| Fort Worth | TX | 13 | [arcgis](https://data.fortworthtexas.gov) | Open Data |
| Austin | TX | 10 | [socrata](https://data.austintexas.gov) | Open Data |
| Charlotte | NC | 7 | [arcgis](https://data.charlottenc.gov) | Open Data |
| Columbus | OH | 9 | [arcgis](https://opendata.columbus.gov) | Open Data |
| Indianapolis | IN | 25 | [arcgis](https://data.indy.gov) | Open Data |
| Washington | DC | 8 | [arcgis](https://opendata.dc.gov) | Open Data |
| Nashville | TN | 13 | [arcgis](https://data.nashville.gov) | Open Data |
| Las Vegas | NV | 91 | [arcgis](https://geocommons-lasvegas.opendata.arcgis.com) | Open Data |
| Boston | MA | 9 | [arcgis](https://data.boston.gov) | Open Data |
| Detroit | MI | 7 | [arcgis](https://data.detroitmi.gov) | Open Data |
| Louisville | KY | 26 | [arcgis](https://data.louisvilleky.gov) | Open Data |
| Memphis | TN | 7 | [socrata](https://data.memphistn.gov) | Open Data |
| Albuquerque | NM | 9 | [arcgis](https://hub.arcgis.com) | Open Data |
| Tucson | AZ | 6 | [arcgis](https://gisdata.tucsonaz.gov) | Open Data |
| Sacramento | CA | 8 | [arcgis](https://data.cityofsacramento.org) | Open Data |
| Kansas City | MO | 6 | [socrata](https://data.kcmo.org) | Open Data |
| Omaha | NE | 7 | [arcgis](https://data.dogis.org) | Open Data |
| Long Beach | CA | 9 | [arcgis](https://data-longbeach.opendata.arcgis.com) | Open Data |
| Oakland | CA | 7 | [socrata](https://data.oaklandca.gov) | Open Data |
| Minneapolis | MN | 13 | [arcgis](https://opendata.minneapolismn.gov) | Open Data |
| Tampa | FL | 4 | [arcgis](https://city-tampa.opendata.arcgis.com) | Open Data |
| New Orleans | LA | 5 | [socrata](https://data.nola.gov) | Open Data |
| Bakersfield | CA | 7 | [arcgis](https://bakersfielddatalibrary-cob.opendata.arcgis.com) | Open Data |
| Anaheim | CA | 6 | [arcgis](https://data-anaheim.opendata.arcgis.com) | Open Data |
| Honolulu | HI | 9 | [arcgis](https://honolulu-cchnl.opendata.arcgis.com) | Open Data |
| Santa Ana | CA | 6 | [arcgis](https://gis-santa-ana.opendata.arcgis.com) | Open Data |

## File Format

All files are standardized GeoJSON (EPSG:4326 WGS84 projection):

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "district": "1",
        "name": "District 1",
        "representative": "Council Member Name"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
```

## Usage

```typescript
import fs from 'fs';

// Load city council districts
const districts = JSON.parse(
  fs.readFileSync('city-council-districts/new-york.geojson', 'utf-8')
);

// Find district for a coordinate
import * as turf from '@turf/turf';
const point = turf.point([-73.935242, 40.730610]); // Manhattan

for (const district of districts.features) {
  if (turf.booleanPointInPolygon(point, district)) {
    console.log(`Found: ${district.properties.name}`);
  }
}
```

## Data Updates

City council districts are redistricted every 10 years after the census, with occasional special elections triggering boundary changes.

**Update Process:**
1. Monitor municipal open data portals for boundary updates
2. Re-run `npx tsx scripts/collect-city-council-gis.ts --all`
3. Validate topology with `npx tsx scripts/validate-city-council-gis.ts`
4. Commit with version tag (e.g., `nyc-2025-redistricting`)

## License

All data sourced from municipal open data portals under public domain or open data licenses. See individual city portals for specific license terms.

**Collection Script:** `/scripts/collect-city-council-gis.ts`
**Generated:** 2025-11-15
