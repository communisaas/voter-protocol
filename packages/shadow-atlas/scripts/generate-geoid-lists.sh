#!/usr/bin/env bash
#
# Generate Canonical GEOID Lists from TIGER Shapefiles
#
# This script extracts GEOIDs from Census TIGER/Line shapefiles and
# generates TypeScript code for canonical GEOID reference lists.
#
# USAGE:
#   ./scripts/generate-geoid-lists.sh <layer> <state-fips>
#
# EXAMPLES:
#   ./scripts/generate-geoid-lists.sh sldu 01  # Alabama State Senate
#   ./scripts/generate-geoid-lists.sh sldl 06  # California State Assembly
#
# REQUIREMENTS:
#   - ogr2ogr (GDAL/OGR tools)
#   - jq (JSON processor)
#
# OUTPUT:
#   - TypeScript array literal for geoid-reference.ts
#
# WORKFLOW:
#   1. Download TIGER shapefile for layer + state
#   2. Extract GEOID field using ogr2ogr
#   3. Format as TypeScript readonly array
#   4. Manual: Paste into geoid-reference.ts
#
# Last Updated: 2025-12-31
# Data Vintage: 2024 TIGER/Line

set -euo pipefail

# Configuration
TIGER_BASE_URL="https://www2.census.gov/geo/tiger/TIGER2024"
CACHE_DIR="./data/tiger-cache/2024"

# Validate arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <layer> <state-fips>"
  echo ""
  echo "Layers:"
  echo "  cd    - Congressional Districts"
  echo "  sldu  - State Legislative Upper (State Senate)"
  echo "  sldl  - State Legislative Lower (State House)"
  echo ""
  echo "Example: $0 sldu 01  # Alabama State Senate"
  exit 1
fi

LAYER="$1"
STATE_FIPS="$2"

# Validate layer
case "$LAYER" in
  cd|sldu|sldl)
    ;;
  *)
    echo "ERROR: Invalid layer '$LAYER'. Must be cd, sldu, or sldl."
    exit 1
    ;;
esac

# Validate state FIPS (2 digits)
if ! [[ "$STATE_FIPS" =~ ^[0-9]{2}$ ]]; then
  echo "ERROR: Invalid state FIPS '$STATE_FIPS'. Must be 2 digits (01-78)."
  exit 1
fi

# Map layer to TIGER directory name
case "$LAYER" in
  cd)
    TIGER_DIR="CD"
    GEOID_FIELD="GEOID20"
    ;;
  sldu)
    TIGER_DIR="SLDU"
    GEOID_FIELD="GEOID20"
    ;;
  sldl)
    TIGER_DIR="SLDL"
    GEOID_FIELD="GEOID20"
    ;;
esac

# Construct TIGER shapefile URL
SHAPEFILE_NAME="tl_2024_${STATE_FIPS}_${LAYER}.zip"
TIGER_URL="${TIGER_BASE_URL}/${TIGER_DIR}/${SHAPEFILE_NAME}"
CACHE_PATH="${CACHE_DIR}/${TIGER_DIR}/${SHAPEFILE_NAME}"

# Create cache directory
mkdir -p "$(dirname "$CACHE_PATH")"

# Download shapefile if not cached
if [ ! -f "$CACHE_PATH" ]; then
  echo "Downloading $SHAPEFILE_NAME..."
  curl -sSL "$TIGER_URL" -o "$CACHE_PATH"
else
  echo "Using cached $SHAPEFILE_NAME"
fi

# Extract GEOIDs using ogr2ogr
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Extracting GEOIDs from shapefile..."
unzip -q "$CACHE_PATH" -d "$TEMP_DIR"

SHAPEFILE=$(find "$TEMP_DIR" -name "*.shp" | head -1)

if [ -z "$SHAPEFILE" ]; then
  echo "ERROR: No .shp file found in $SHAPEFILE_NAME"
  exit 1
fi

# Extract GEOIDs and format as TypeScript array
echo "Generating TypeScript array..."

GEOIDS=$(ogr2ogr -f GeoJSON -select "$GEOID_FIELD" /dev/stdout "$SHAPEFILE" \
  | jq -r ".features[].properties.${GEOID_FIELD}" \
  | sort \
  | uniq)

# Count GEOIDs
GEOID_COUNT=$(echo "$GEOIDS" | wc -l | tr -d ' ')

# Format as TypeScript readonly array
echo ""
echo "// State FIPS: $STATE_FIPS ($GEOID_COUNT districts)"
echo "'${STATE_FIPS}': ["
echo "$GEOIDS" | sed "s/^/  '/" | sed "s/$/',/"
echo "] as const,"
echo ""
echo "Total: $GEOID_COUNT GEOIDs"
