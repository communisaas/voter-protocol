# Statewide Ward Extraction - Quick Start

## Prerequisites

### System Requirements

```bash
# Required tools
- Node.js 18+ (TypeScript execution)
- GDAL/OGR (shapefile → GeoJSON conversion)
- unzip (shapefile extraction)

# Install GDAL (macOS)
brew install gdal

# Install GDAL (Ubuntu/Debian)
sudo apt-get install gdal-bin

# Verify installation
ogr2ogr --version
# Should output: GDAL 3.x.x
```

### Directory Setup

```bash
cd packages/crypto/services/shadow-atlas

# Ensure output directory exists (created automatically)
mkdir -p data/statewide-wards
```

## Quick Start

### Extract Wisconsin (50+ cities)

```bash
npx tsx scripts/extract-statewide-wards.ts --state WI
```

**Expected output**:
```
========================================
  STATEWIDE WARD BATCH EXTRACTION
========================================

======================================================================
  WISCONSIN WARD EXTRACTION
======================================================================

Step 1: Downloading statewide data...
  Source: https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip
  ✅ Downloaded to data/statewide-wards/WI/statewide-WI.zip

Step 2: Extracting shapefile...
  ✅ Extracted to data/statewide-wards/WI/extracted

Step 3: Converting to GeoJSON...
  Converting WI_MunicipalWards.shp...
  ✅ Converted to data/statewide-wards/WI/statewide-WI.geojson

Step 4: Loading and splitting by city...
  Loaded 1,234 features
  Found 52 cities with ward data

Step 5: Processing individual cities...

  Processing: Milwaukee...
    FIPS: 5553000
    Wards: 15
    ✅ Written to data/statewide-wards/WI/cities/5553000.geojson

  Processing: Madison...
    FIPS: 5548000
    Wards: 20
    ✅ Written to data/statewide-wards/WI/cities/5548000.geojson

  ... (50 more cities)

======================================================================
  WISCONSIN EXTRACTION COMPLETE
======================================================================

  Cities extracted: 52
  Registry entries: 52
  Output directory: data/statewide-wards/WI
```

**Runtime**: ~3-5 minutes (download + processing)

### Extract Massachusetts (40+ cities)

```bash
npx tsx scripts/extract-statewide-wards.ts --state MA
```

**Expected output**: Similar to Wisconsin, 40+ cities extracted.

**Runtime**: ~4-6 minutes (larger shapefile)

### Extract Both States

```bash
npx tsx scripts/extract-statewide-wards.ts --state all
```

**Runtime**: ~8-12 minutes total

## Output Files

After extraction, you'll have:

```
data/statewide-wards/
├── WI/
│   ├── statewide-WI.zip              # Downloaded shapefile (50-100 MB)
│   ├── extracted/                     # Temporary shapefiles
│   │   ├── WI_MunicipalWards.shp
│   │   ├── WI_MunicipalWards.dbf
│   │   └── ...
│   ├── statewide-WI.geojson          # Converted statewide data
│   ├── cities/                        # ⭐ Individual city ward files
│   │   ├── 5553000.geojson           # Milwaukee
│   │   ├── 5548000.geojson           # Madison
│   │   └── ... (50+ files)
│   ├── registry-entries.json         # ⭐ KnownPortal entries (ADD THESE TO REGISTRY)
│   └── extraction-summary.json       # Metadata + stats
│
└── MA/
    ├── statewide-MA.zip
    ├── cities/
    │   ├── 2507000.geojson           # Boston
    │   ├── 2582000.geojson           # Worcester
    │   └── ... (40+ files)
    ├── registry-entries.json         # ⭐ KnownPortal entries
    └── extraction-summary.json
```

## Next Steps

### 1. Review Extraction Summary

```bash
# Check Wisconsin summary
cat data/statewide-wards/WI/extraction-summary.json

# Check Massachusetts summary
cat data/statewide-wards/MA/extraction-summary.json
```

**Look for**:
- `citiesFound` matches `expectedCities` (50+ for WI, 40+ for MA)
- No cities with 0 wards or >50 wards (data quality check)

### 2. Spot-Check City Files

```bash
# Verify Milwaukee has 15 wards
cat data/statewide-wards/WI/cities/5553000.geojson | \
  jq '.features | length'

# Should output: 15

# Verify Boston has 22 wards
cat data/statewide-wards/MA/cities/2507000.geojson | \
  jq '.features | length'

# Should output: 22
```

### 3. Review Registry Entries

```bash
# View Wisconsin registry entries
cat data/statewide-wards/WI/registry-entries.json | jq '.[0]'

# Example output:
{
  "cityFips": "5553000",
  "cityName": "Milwaukee",
  "state": "WI",
  "portalType": "state-gis",
  "downloadUrl": "statewide-extraction/WI/5553000.geojson",
  "featureCount": 15,
  "lastVerified": "2025-12-13T00:00:00.000Z",
  "confidence": 100,
  "discoveredBy": "automated",
  "notes": "Wisconsin Legislative Technology Services Bureau (LTSB) - Spring 2023 Municipal Wards"
}
```

### 4. Add to Known Portals Registry

**Manual step** (after validation):

1. Copy entries from `registry-entries.json`
2. Paste into `registry/known-portals.ts`
3. Update download URLs to point to local files or IPFS (Phase 4)

**Example** (add to `known-portals.ts`):

```typescript
// STATEWIDE EXTRACTION - Wisconsin (2025-12-13)
// Source: WI LTSB Municipal Wards Spring 2023 (statutory data collection)

'5553000': {
  cityFips: '5553000',
  cityName: 'Milwaukee',
  state: 'WI',
  portalType: 'state-gis',
  downloadUrl: 'https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip',
  featureCount: 15,
  lastVerified: '2025-12-13T00:00:00.000Z',
  confidence: 100,
  discoveredBy: 'automated',
  notes: 'WI LTSB Statewide Municipal Wards - Spring 2023 (statutory collection)',
},

'5548000': {
  cityFips: '5548000',
  cityName: 'Madison',
  state: 'WI',
  portalType: 'state-gis',
  downloadUrl: 'https://web.s3.wisc.edu/rml-gisdata/WI_MunicipalWards_Spring_2023.zip',
  featureCount: 20,
  lastVerified: '2025-12-13T00:00:00.000Z',
  confidence: 100,
  discoveredBy: 'automated',
  notes: 'WI LTSB Statewide Municipal Wards - Spring 2023 (statutory collection)',
},

// ... repeat for all 50+ cities
```

## Troubleshooting

### Download Fails

**Error**: `Download failed: HTTP 404`

**Solution**:
- Check if state has moved data URL
- Visit portal URL in browser to find new download link
- Update `STATE_CONFIGS` in `extract-statewide-wards.ts`

### GDAL Not Found

**Error**: `ogr2ogr: command not found`

**Solution**:
```bash
# macOS
brew install gdal

# Ubuntu/Debian
sudo apt-get install gdal-bin

# Verify
which ogr2ogr
```

### Shapefile Conversion Fails

**Error**: `Conversion failed: Unable to open datasource`

**Solution**:
- Check shapefile was extracted correctly
- Verify `.shp`, `.shx`, `.dbf` files all present
- Try manual conversion:
  ```bash
  cd data/statewide-wards/WI/extracted
  ogr2ogr -f GeoJSON output.geojson WI_MunicipalWards.shp
  ```

### No FIPS Match

**Warning**: `⚠️ No FIPS code found - skipping`

**Cause**: City name in statewide data doesn't match Census PLACE name

**Solution**:
- Check `extraction-summary.json` for city name
- Look up correct Census PLACE name via [TIGERweb](https://tigerweb.geo.census.gov/)
- Add city name alias to `registry/city-name-aliases.ts`

**Example**:
```typescript
// Consolidated city-county name variations
'Urban Honolulu': {
  censusName: 'Urban Honolulu CDP',
  governanceName: 'City and County of Honolulu',
  fips: '1571550',
  state: 'HI',
},
```

## Advanced Usage

### Skip Download (Use Existing Data)

```bash
# If you already downloaded the shapefile, skip download step
npx tsx scripts/extract-statewide-wards.ts --state WI --skip-download
```

**Use case**: Re-running extraction after fixing field mapping

### Dry Run (Preview)

```bash
# See what would be extracted without downloading
npx tsx scripts/extract-statewide-wards.ts --state WI --dry-run
```

**Output**:
```
[DRY RUN] Extraction plan:

Wisconsin:
  Portal: https://geodata.wisc.edu/catalog/...
  Download: https://web.s3.wisc.edu/rml-gisdata/...
  Expected cities: 50
  Confidence: 100
```

### Custom Output Directory

```bash
# Store extracted data elsewhere
npx tsx scripts/extract-statewide-wards.ts \
  --state WI \
  --output-dir /path/to/custom/dir
```

## Validation Checklist

Before adding to production registry:

- [ ] Extraction completed without errors
- [ ] City count matches expected (50+ WI, 40+ MA)
- [ ] Spot-check 5 cities: ward count matches official records
- [ ] All GeoJSON files are valid (no geometry errors)
- [ ] FIPS codes verified against Census PLACE data
- [ ] `registry-entries.json` reviewed for correctness

## Resources

- **Full Documentation**: [STATEWIDE-WARD-EXTRACTION.md](../docs/STATEWIDE-WARD-EXTRACTION.md)
- **ROADMAP**: [ROADMAP.md - Phase 1C](../ROADMAP.md#1c-statewide-gis-extraction-week-2-3)
- **Wisconsin Portal**: https://gis-ltsb.hub.arcgis.com/
- **Massachusetts Portal**: https://www.mass.gov/orgs/massgis-bureau-of-geographic-information

## Support

**Issues/Questions**:
1. Check [STATEWIDE-WARD-EXTRACTION.md](../docs/STATEWIDE-WARD-EXTRACTION.md) for detailed docs
2. Search existing issues on GitHub
3. Open new issue with:
   - Error message
   - State being extracted
   - Output logs
   - OS + Node.js version
