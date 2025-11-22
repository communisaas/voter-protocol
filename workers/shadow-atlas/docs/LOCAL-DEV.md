# Local Development Guide - Shadow Atlas

**Status**: ✅ Local environment working
**Last Updated**: 2025-11-09

## Quick Start

```bash
# 1. Navigate to Shadow Atlas directory
cd /Users/noot/Documents/voter-protocol/workers/shadow-atlas

# 2. Install dependencies (already done)
npm install

# 3. Initialize local D1 database (already done)
wrangler d1 create shadow-atlas
# Database ID: b702700e-38d7-4cd3-90bf-91df793614eb

# 4. Load schema
wrangler d1 execute shadow-atlas --local --file=schema.sql

# 5. Load test data (5 cities: NYC, LA, Chicago, Austin, SF)
npx tsx src/bootstrap/test-bootstrap.ts > test-bootstrap.sql
wrangler d1 execute shadow-atlas --local --file=test-bootstrap.sql

# 6. Verify data loaded
wrangler d1 execute shadow-atlas --local --command="SELECT * FROM municipalities ORDER BY population DESC"
```

## Current Status

✅ **Working**:
- Local D1 database created
- Schema initialized (8 tables)
- Test data loaded (5 municipalities)
- Test bootstrap script functional

📊 **Database Contents**:
```
municipalities: 5 rows
  - ny-new-york (8.3M population)
  - ca-los-angeles (3.9M)
  - il-chicago (2.7M)
  - tx-austin (962K)
  - ca-san-francisco (874K)

municipality_state: 5 rows (all status = 'pending')
```

## Useful Commands

### Database Operations

```bash
# Query municipalities
wrangler d1 execute shadow-atlas --local --command="
  SELECT id, name, state, population
  FROM municipalities
  ORDER BY population DESC
"

# Check pipeline status
wrangler d1 execute shadow-atlas --local --command="
  SELECT
    discovery_status,
    COUNT(*) as count
  FROM municipality_state
  GROUP BY discovery_status
"

# Reset database (caution: deletes all data)
wrangler d1 execute shadow-atlas --local --command="
  DELETE FROM municipalities;
  DELETE FROM municipality_state;
  DELETE FROM sources;
  DELETE FROM artifacts;
  DELETE FROM events;
"
```

### Development Workflow

```bash
# Start local dev server (when workers are implemented)
wrangler dev --local --persist

# Run TypeScript scripts directly
npx tsx src/bootstrap/test-bootstrap.ts

# Type check
npx tsc --noEmit

# Test (when tests are written)
npm test
```

## Cost Reality Check (2025 Validated)

See `CLOUDFLARE-FREE-TIER-ANALYSIS.md` for full details.

**Key Finding**: Shadow Atlas costs **$60/year** (Workers Paid at $5/month), NOT free.

- ✅ Monthly PIP API: FREE (within tier limits)
- ❌ Bootstrap: Requires Workers Paid (Durable Objects)
- ✅ Quarterly updates: FREE (within daily DO limit)
- ❌ 500M addresses: Must use R2 Parquet, not D1 (exceeds 5GB limit)

**Bottom Line**: Budget $5/month from Day 1.

## Discovery Scanner Status

✅ **Phase 2A - Heuristic Scoring**: VALIDATED (`src/discovery/arcgis-scanner.ts`)
- Austin: 80/100 (AUTO-SELECT) ✅
- Scoring logic: Name match (40pts) + Geometry (20pts) + Fields (20pts)
- **Limitation**: Only validated with 1 city (need 3+ for confidence)

🚧 **Phase 2B - Gemini-Powered Discovery**: READY FOR TESTING (`src/discovery/gemini-discovery.ts`)
- **FREE Google Search grounding** (15 RPM, included in Gemini 2.5 Flash free tier)
- Discovers real, current ArcGIS URLs by querying: "Find official ArcGIS REST API for [City] council districts"
- Returns citations + source URLs from government websites
- **Replaces Google Custom Search API** (saves $5 per 1000 queries)

📋 **Test Gemini Discovery**:
```bash
# 1. Get free API key (2 minutes): https://aistudio.google.com/apikey
export GEMINI_API_KEY="AIzaSy..."

# 2. Run discovery test (3 cities: SF, Austin, Chicago)
npx tsx src/discovery/test-gemini-discovery.ts

# Expected: Discover + validate real URLs, score with heuristics
```

📋 **Next Steps**:
1. ✅ **Test Gemini Discovery** (validate 3+ cities to confirm heuristics generalize)
2. **Implement Socrata Scanner** (fallback for non-ArcGIS cities)
3. **Deploy Durable Objects** (download GeoJSON without 30s timeout)
4. **Build Merkle Tree Pipeline** (address → district mapping)

## Files Reference

```
workers/shadow-atlas/
├── schema.sql                          # D1 database schema (8 tables)
├── test-bootstrap.sql                  # Generated test data (5 cities)
├── wrangler.toml                       # Cloudflare Workers config
├── package.json                        # Dependencies
├── tsconfig.json                       # TypeScript config
├── README.md                           # Project overview
├── CLOUDFLARE-FREE-TIER-ANALYSIS.md   # Cost validation
├── GEMINI-SETUP.md                     # 🆕 Gemini API setup guide
├── LOCAL-DEV.md                        # This file
└── src/
    ├── bootstrap/
    │   ├── test-bootstrap.ts           # Test data generator
    │   └── census-tiger-parser.ts      # Full Census parser (not yet used)
    └── discovery/
        ├── arcgis-scanner.ts           # ✅ Heuristic scoring (validated 1/5 cities)
        ├── gemini-discovery.ts         # 🆕 Gemini-powered URL discovery (FREE)
        ├── test-gemini-discovery.ts    # 🆕 Gemini test (3 cities, requires API key)
        ├── test-arcgis-scanner.ts      # Mock test suite (5/5 cities)
        ├── test-live-arcgis.ts         # Live API test (Austin 80/100)
        └── test-all-cities.ts          # Multi-city validation (0/5 - stale URLs)
```

## Troubleshooting

### "Database not found"
```bash
# Re-create database
wrangler d1 create shadow-atlas
# Update database_id in wrangler.toml
```

### "Table already exists"
```bash
# Drop all tables and recreate
wrangler d1 execute shadow-atlas --local --command="
  DROP TABLE IF EXISTS municipalities;
  DROP TABLE IF EXISTS municipality_state;
  DROP TABLE IF EXISTS sources;
  DROP TABLE IF EXISTS artifacts;
  DROP TABLE IF EXISTS district_bboxes;
  DROP TABLE IF EXISTS events;
  DROP TABLE IF EXISTS district_addresses;
  DROP TABLE IF EXISTS merkle_roots;
"
# Then reload schema
wrangler d1 execute shadow-atlas --local --file=schema.sql
```

### "Cannot find module @turf/turf"
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Database Schema Summary

**8 Tables**:
1. `municipalities` - 19,616 U.S. cities (bootstrapped from Census)
2. `municipality_state` - Current pipeline status (event-sourced + snapshot)
3. `sources` - Discovered data sources (ArcGIS, Socrata, etc.)
4. `artifacts` - GeoJSON files stored in R2
5. `district_bboxes` - Spatial index for fast PIP lookups
6. `events` - Complete provenance audit trail
7. `district_addresses` - Address→district mapping (500M rows, use R2 instead)
8. `merkle_roots` - Published Merkle tree roots + IPFS CIDs

**Key Design**: Event-sourced + snapshot hybrid prevents D1 capacity issues.

---

**Status**: Local development environment ready. Next: Implement discovery scanners.
