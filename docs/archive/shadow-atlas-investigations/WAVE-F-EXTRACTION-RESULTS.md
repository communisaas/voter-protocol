# Wave F URL Extraction Results
**Date:** 2026-01-18
**Task:** Extract FeatureServer URLs from 8 identified open data portals

## ✅ SUCCESSFULLY EXTRACTED (5/8)

### 1. Ocala FL (1250750) ✓
- **Status:** VERIFIED (6 features, 5 unique districts + 1 duplicate)
- **Source:** Municipal GIS
- **URL:** `https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0`
- **Query URL:** `https://gis.ocalafl.org/arcgis/rest/services/Public/Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson`
- **Features:** 6 records (5 unique districts: 1-5)
- **Note:** District 3 has duplicate entry (OBJECTID 441 and 449)
- **Confidence:** 90% (verified working, but has data quality issue with duplicate)

### 2. Elk Grove CA (0622020) ✓
- **Status:** VERIFIED (4 districts)
- **Source:** Sacramento County GIS (hosting for Elk Grove)
- **URL:** `https://mapservices.gis.saccounty.net/arcgis/rest/services/ELK_GROVE/MapServer/8`
- **Query URL:** `https://mapservices.gis.saccounty.net/arcgis/rest/services/ELK_GROVE/MapServer/8/query?where=1%3D1&outFields=*&f=geojson`
- **Features:** 4 districts (verified)
- **Fields:** DIST_NUM, MEMBER, DIST_ID
- **Confidence:** 95%

### 3. Glendale AZ (0427820) ✓
- **Status:** VERIFIED (6 districts + 1 "NONE" area)
- **Source:** Municipal ArcGIS Online
- **URL:** `https://services1.arcgis.com/9fVTQQSiODPjLUTa/arcgis/rest/services/Glendale_Council_Districts/FeatureServer/0`
- **Query URL:** `https://services1.arcgis.com/9fVTQQSiODPjLUTa/arcgis/rest/services/Glendale_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson`
- **Features:** 7 total (6 named districts: OCOTILLO, CACTUS, BARREL, SAHUARO, CHOLLA, YUCCA + 1 "NONE")
- **Confidence:** 95%

### 4. Buckeye AZ (0407940) ✓
- **Status:** VERIFIED (6 districts with duplicates)
- **Source:** Maricopa County Elections GIS (multi-city layer)
- **URL:** `https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0`
- **Query URL:** `https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Maricopa_County_City_Council_Districts/FeatureServer/0/query?where=Juris%3D%27Buckeye%27&outFields=*&f=geojson`
- **Features:** 12 records (6 unique districts, each appearing twice)
- **Filter Required:** `WHERE Juris = 'Buckeye'`
- **Districts:** BUCKEYE DIST 1-6
- **Confidence:** 90% (county source, has duplicate records)
- **Note:** Shares layer with Phoenix, Surprise, Peoria, Glendale, Mesa

### 5. Fernley NV (3224900) ✓
- **Status:** VERIFIED (5 wards)
- **Source:** City ArcGIS Online
- **URL:** `https://services8.arcgis.com/dzKn4YTRsauu7Rfk/arcgis/rest/services/Fernley_City_Council_Wards/FeatureServer/0`
- **Query URL:** `https://services8.arcgis.com/dzKn4YTRsauu7Rfk/arcgis/rest/services/Fernley_City_Council_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson`
- **Features:** 5 wards (Ward 1-5)
- **Confidence:** 95%

## ❌ EXTRACTION FAILED (3/8)

### 6. Sherman TX (4867496) ❌
- **Status:** NOT FOUND
- **Portal:** https://sherman-open-data-cityofsherman.hub.arcgis.com/
- **Investigation:**
  - ArcGIS Hub API searched - no council district datasets found
  - Only found "Emails to City Council" datasets (not boundaries)
  - Owner searches returned no results
- **Next Steps:**
  - Manual portal navigation required
  - Contact Sherman GIS department
  - May not be published as open data

### 7. Taylor TX (4871948) ❌
- **Status:** NOT FOUND
- **Portal:** https://city-of-taylor-open-data-mallard.hub.arcgis.com/
- **Referenced Dataset:** "City Council Districts for Taylor TX" (mentioned in original research)
- **Investigation:**
  - ArcGIS Hub API searched - no council district datasets found
  - Owner "mallard" searches returned no results
  - Dataset URL not accessible via standard API queries
- **Next Steps:**
  - Manual portal navigation
  - Dataset may have been removed or renamed
  - Contact planning@taylortx.gov

### 8. Carson CA (0611530) ❌
- **Status:** NOT FOUND
- **Portal:** https://gis.carson.ca.us/
- **Map App:** https://www.arcgis.com/apps/View/index.html?appid=050da2e0b2d542a685da155f784dddaa
- **Investigation:**
  - GIS portal returns 404 error (https://gis.carson.ca.us/arcgis/rest/services)
  - Map application contains no operational layers in standard format
  - ArcGIS Online searches for "Carson California districts" returned unrelated data
- **Next Steps:**
  - Portal may require authentication
  - Districts may be embedded in web map without direct API access
  - Manual inspection of map network requests needed
  - Alternative: Contact Carson GIS department

## SUMMARY

**Success Rate:** 62.5% (5/8 cities)
**Total Districts Extracted:** 27 districts across 5 cities
- Ocala: 5 districts (FL)
- Elk Grove: 4 districts (CA)
- Glendale: 6 districts (AZ)
- Buckeye: 6 districts (AZ)
- Fernley: 5 wards (NV)

**Data Quality Issues:**
- Ocala: Duplicate entry for District 3
- Buckeye: County-level source has duplicate records (each district appears twice)

**Blocked Cities:** Sherman TX, Taylor TX, Carson CA (require manual extraction or direct contact)
