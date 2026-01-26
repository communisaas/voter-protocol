#!/bin/bash
# Florida Aggregator Portal Verification Commands
# Generated: 2026-01-23
# Wave: wave-p-florida-aggregators

set -e

echo "===================================================================="
echo "Florida Municipal GIS Portal Verification"
echo "===================================================================="
echo ""

# ============================================================================
# 1. CAPE CORAL - OFFICIAL CITY PORTAL (RECOMMENDED UPDATE)
# ============================================================================
echo "1. CAPE CORAL (FIPS: 1210275)"
echo "   Official City IMS FeatureServer - RECOMMENDED"
echo "   URL: https://capeims.capecoral.gov/.../FeatureServer/25"
echo "--------------------------------------------------------------------"

echo "   Metadata:"
curl -s "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25?f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"   Layer Name: {d['name']}\"); print(f\"   Type: {d['type']}\"); print(f\"   Geometry: {d['geometryType']}\")"

echo ""
echo "   Feature Count:"
curl -s "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&returnCountOnly=true&f=json" | \
  python3 -c "import sys, json; print(f\"   Count: {json.load(sys.stdin)['count']} features\")"

echo ""
echo "   Sample Record:"
curl -s "https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&outFields=DISTRICT,COUNCIL_NAME,POPULATION&returnGeometry=false&resultRecordCount=1&f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin)['features'][0]['attributes']; print(f\"   District: {d['DISTRICT']}\"); print(f\"   Council Member: {d['COUNCIL_NAME']}\"); print(f\"   Population: {d['POPULATION']:,}\")"

echo ""
echo "   Download URL (GeoJSON):"
echo "   https://capeims.capecoral.gov/arcgis/rest/services/IMS/City_of_Cape_Coral_IMS_AGOL/FeatureServer/25/query?where=1%3D1&outFields=*&f=geojson"
echo ""
echo ""

# ============================================================================
# 2. CAPE CORAL - OLD URL (CURRENT REGISTRY)
# ============================================================================
echo "2. CAPE CORAL - OLD URL (Current Registry)"
echo "   ArcGIS Online Wayfinding Survey - LOWER PRIORITY"
echo "   URL: https://services.arcgis.com/.../FeatureServer/9"
echo "--------------------------------------------------------------------"

echo "   Feature Count:"
curl -s "https://services.arcgis.com/ZbVPNfkTF89LEyGa/arcgis/rest/services/City_of_Cape_Coral_Wayfinding_Survey_Map_WFL1/FeatureServer/9/query?where=1%3D1&returnCountOnly=true&f=json" | \
  python3 -c "import sys, json; print(f\"   Count: {json.load(sys.stdin)['count']} features\")"

echo ""
echo "   NOTE: Both URLs return 7 features, but official city portal"
echo "   has richer data (population, district pages, last edited 2024-11-22)"
echo ""
echo ""

# ============================================================================
# 3. HOLLYWOOD - ARCGIS ONLINE
# ============================================================================
echo "3. HOLLYWOOD (FIPS: 1232000)"
echo "   ArcGIS Online FeatureServer - WORKING"
echo "   URL: https://services1.arcgis.com/.../FeatureServer/17"
echo "--------------------------------------------------------------------"

echo "   Metadata:"
curl -s "https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17?f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"   Layer Name: {d['name']}\"); print(f\"   Type: {d['type']}\"); print(f\"   Fields: {', '.join([f['name'] for f in d['fields'][:5]])}...\")"

echo ""
echo "   Feature Count:"
curl -s "https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17/query?where=1%3D1&returnCountOnly=true&f=json" | \
  python3 -c "import sys, json; print(f\"   Count: {json.load(sys.stdin)['count']} features\")"

echo ""
echo "   Download URL (GeoJSON):"
echo "   https://services1.arcgis.com/lfAczuQbfdRGdFQE/ArcGIS/rest/services/Commission_Districts/FeatureServer/17/query?where=1%3D1&outFields=*&f=geojson"
echo ""
echo ""

# ============================================================================
# 4. ORLANDO/ORANGE COUNTY - COUNTY GIS
# ============================================================================
echo "4. ORLANDO/ORANGE COUNTY (FIPS: 1253000 city / 12095 county)"
echo "   Orange County GIS MapServer - WORKING"
echo "   URL: https://ocgis4.ocfl.net/.../MapServer/151"
echo "--------------------------------------------------------------------"

echo "   Metadata:"
curl -s "https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151?f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"   Layer Name: {d['name']}\"); print(f\"   Type: {d['type']}\"); print(f\"   Geometry: {d['geometryType']}\")"

echo ""
echo "   Feature Count:"
curl -s "https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151/query?where=1%3D1&returnCountOnly=true&f=json" | \
  python3 -c "import sys, json; print(f\"   Count: {json.load(sys.stdin)['count']} features\")"

echo ""
echo "   Sample Record:"
curl -s "https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin)['features'][0]['attributes']; print(f\"   District ID: {d['COMMISSIONERDISTRICTID']}\"); print(f\"   Commissioner: {d['COMMISSIONERNAME']}\")"

echo ""
echo "   Download URL (GeoJSON):"
echo "   https://ocgis4.ocfl.net/arcgis/rest/services/Public_Dynamic/MapServer/151/query?where=1%3D1&outFields=*&f=geojson"
echo ""
echo ""

# ============================================================================
# 5. FORT LAUDERDALE - BLOCKED
# ============================================================================
echo "5. FORT LAUDERDALE (FIPS: 1224000)"
echo "   City FeatureServer - BLOCKED (AUTHENTICATION REQUIRED)"
echo "   URL: https://gis.fortlauderdale.gov/.../FeatureServer/0"
echo "--------------------------------------------------------------------"

echo "   Attempting metadata query:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0?f=json")
echo "   HTTP Status: $HTTP_CODE"

echo ""
echo "   Error Response:"
curl -s "https://gis.fortlauderdale.gov/server/rest/services/CityCommissionDistricts/FeatureServer/0?f=json" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"   Code: {d.get('error', {}).get('code')}\"); print(f\"   Message: {d.get('error', {}).get('message')}\")" || echo "   [Unable to parse error]"

echo ""
echo "   STATUS: Portal requires authentication token (HTTP 499)"
echo "   ACTION: QUARANTINE - Not publicly accessible"
echo ""
echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo "===================================================================="
echo "VERIFICATION SUMMARY"
echo "===================================================================="
echo ""
echo "Working Portals: 3/4 (75%)"
echo "  ✅ Cape Coral (official city portal)"
echo "  ✅ Hollywood (ArcGIS Online)"
echo "  ✅ Orlando/Orange County (county GIS)"
echo ""
echo "Blocked Portals: 1/4 (25%)"
echo "  ❌ Fort Lauderdale (authentication required)"
echo ""
echo "Recommended Actions:"
echo "  1. UPDATE: Cape Coral - migrate to official city portal URL"
echo "  2. QUARANTINE: Fort Lauderdale - requires authentication"
echo ""
echo "New Portals Discovered: 0"
echo "  (All 4 cities were already in registry)"
echo ""
echo "===================================================================="
