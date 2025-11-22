#!/bin/bash
# Download remaining regional COG datasets using curl
# These are direct ArcGIS Feature Service GeoJSON export URLs

set -e

OUTPUT_DIR="/Users/noot/Documents/voter-protocol/packages/crypto/data/regional-consortiums"
mkdir -p "$OUTPUT_DIR"

echo "🚀 Downloading remaining regional COG datasets..."
echo ""

# ARC (Atlanta Regional Commission) - 75 cities
echo "📡 Downloading ARC (Atlanta Regional Commission)..."
curl -s "https://services.arcgis.com/HGJkS1j6M9YzjX3n/arcgis/rest/services/City_Limits_Atlanta_Region/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
  -o "$OUTPUT_DIR/arc.geojson" || echo "⚠️  ARC download failed, trying alternative..."

if [ ! -f "$OUTPUT_DIR/arc.geojson" ] || [ ! -s "$OUTPUT_DIR/arc.geojson" ]; then
  echo "Trying alternative ARC endpoint..."
  curl -s "https://opendata.atlantaregional.com/datasets/city-boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
    -o "$OUTPUT_DIR/arc.geojson"
fi

echo "✅ ARC downloaded"
echo ""

# MAPC (Metro Boston) - 101 municipalities
echo "📡 Downloading MAPC (Metro Boston Planning Council)..."
curl -s "https://services1.arcgis.com/ceiitspzDAHrdGO1/arcgis/rest/services/Municipal_Boundaries_Poly/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
  -o "$OUTPUT_DIR/mapc.geojson"
echo "✅ MAPC downloaded"
echo ""

# CMAP (Chicago Metropolitan Agency for Planning) - 284 cities
echo "📡 Downloading CMAP (Chicago Metropolitan Area)..."
curl -s "https://services.arcgis.com/rOo16HdIMeOBI4Mb/arcgis/rest/services/muni/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
  -o "$OUTPUT_DIR/cmap.geojson"
echo "✅ CMAP downloaded"
echo ""

# SEMCOG (Southeast Michigan Council of Governments) - 147 cities
echo "📡 Downloading SEMCOG (Southeast Michigan)..."
curl -s "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Communities/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
  -o "$OUTPUT_DIR/semcog.geojson"
echo "✅ SEMCOG downloaded"
echo ""

# NYMTC (New York Metro) - 347 municipalities
echo "📡 Downloading NYMTC (New York Metropolitan Area)..."
curl -s "https://services6.arcgis.com/FdXWDzDYfGO4Nqml/arcgis/rest/services/Municipalities/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson" \
  -o "$OUTPUT_DIR/nymtc.geojson"
echo "✅ NYMTC downloaded"
echo ""

echo "📊 Download Summary"
echo "==================="
for file in "$OUTPUT_DIR"/*.geojson; do
  if [ -f "$file" ]; then
    basename=$(basename "$file" .geojson)
    size=$(du -h "$file" | cut -f1)
    features=$(node -e "const fs = require('fs'); try { const data = JSON.parse(fs.readFileSync('$file', 'utf-8')); console.log(data.features?.length || 0); } catch(e) { console.log('ERROR'); }")
    echo "  $basename: $features features, $size"
  fi
done
echo ""
echo "✨ All downloads complete!"
