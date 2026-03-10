#!/usr/bin/env tsx
/**
 * Build District R-tree Database
 *
 * Downloads TIGER/Line shapefiles from Census FTP, transforms to GeoJSON,
 * normalizes, and builds a SQLite R-tree spatial index for <50ms PIP lookups.
 *
 * Requires: ogr2ogr (GDAL) installed
 *
 * Usage:
 *   npx tsx src/scripts/build-district-db.ts
 *   npx tsx src/scripts/build-district-db.ts --layers cd,county --output ./data/districts.db
 *   npx tsx src/scripts/build-district-db.ts --state 06  # California only (for testing)
 */

import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import * as turf from '@turf/turf';
import type { Geometry, Polygon, MultiPolygon, BBox } from 'geojson';

import { TIGERBoundaryProvider } from '../providers/tiger-boundary-provider.js';
import type { TIGERLayer } from '../providers/tiger-boundary-provider.js';
import { CanadaBoundaryProvider } from '../providers/international/canada-provider.js';
import { UKBoundaryProvider } from '../providers/international/uk-provider.js';
import { AustraliaBoundaryProvider } from '../providers/international/australia-provider.js';
import { NewZealandBoundaryProvider } from '../providers/international/nz-provider.js';
import { RTreeBuilder } from '../transformation/rtree-builder.js';
import type { NormalizedDistrict } from '../transformation/types.js';
import type { NormalizedBoundary } from '../core/types/provider.js';
import { loadWardRegistry } from '../hydration/ward-registry.js';
import { loadWardBoundaries } from '../hydration/ward-boundary-loader.js';
import { BatchOrchestrator } from '../services/batch-orchestrator.js';
import type { StatewideWardState } from '../services/batch-orchestrator.types.js';
import { SPECIAL_DISTRICT_PROVIDERS } from '../providers/special-district-provider.js';
import type { NormalizedSpecialDistrict } from '../providers/special-district-provider.js';

// ============================================================================
// CLI Args
// ============================================================================

const { values: args } = parseArgs({
  options: {
    layers: { type: 'string', default: 'cd,sldu,sldl,county' },
    output: { type: 'string', default: './data/shadow-atlas.db' },
    cache: { type: 'string', default: './data/tiger-cache' },
    year: { type: 'string', default: '2024' },
    state: { type: 'string' },      // Single state FIPS for testing (e.g. "06")
    'skip-verify': { type: 'boolean', default: false },
    'no-canada': { type: 'boolean', default: false },
    uk: { type: 'boolean', default: false },      // Include UK parliamentary constituencies
    au: { type: 'boolean', default: false },      // Include Australian federal divisions
    nz: { type: 'boolean', default: false },      // Include New Zealand electorates
    wards: { type: 'boolean', default: false },  // Include city council wards from portal registry
    'state-gis': { type: 'boolean', default: false },  // Include authoritative statewide ward data (WI LTSB, MassGIS)
    'special-districts': { type: 'boolean', default: false },  // Include special districts (fire, water, transit, etc.)
  },
  strict: false,
});

/**
 * Core civic layers for `--layers all` (excluding massive reference layers).
 * VTD (~200K), zcta (~33K), tract (~85K), bg (~242K) are separate build profiles.
 */
const ALL_CIVIC_LAYERS: TIGERLayer[] = [
  'cd', 'sldu', 'sldl', 'county', 'place', 'cousub',
  'unsd', 'elsd', 'scsd', 'aiannh', 'concity', 'submcd', 'anrc',
];

const layerArg = (args.layers as string).trim();
const rawTokens = layerArg.split(',').map(l => l.trim().toLowerCase());
const hasAll = rawTokens.includes('all');
const explicitLayers = rawTokens.filter(l => l !== 'all') as TIGERLayer[];
const layers: TIGERLayer[] = hasAll
  ? [...new Set([...ALL_CIVIC_LAYERS, ...explicitLayers])]
  : explicitLayers.length > 0 ? explicitLayers : layerArg.split(',').map(l => l.trim()) as TIGERLayer[];
const outputPath = args.output as string;
const cacheDir = args.cache as string;
const year = parseInt(args.year as string, 10);
const stateFips = args.state as string | undefined;
const skipVerify = args['skip-verify'] as boolean;
const noCanada = args['no-canada'] as boolean;
const includeUK = args.uk as boolean;
const includeAU = args.au as boolean;
const includeNZ = args.nz as boolean;
const includeWards = args.wards as boolean;
const includeStateGIS = args['state-gis'] as boolean;
const includeSpecialDistricts = args['special-districts'] as boolean;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute bounding box from GeoJSON geometry.
 */
function computeBBox(geometry: Geometry): readonly [number, number, number, number] {
  const bbox = turf.bbox(geometry) as BBox;
  // turf.bbox returns [minLon, minLat, maxLon, maxLat]
  return [bbox[0], bbox[1], bbox[2], bbox[3]] as const;
}

/**
 * Map TIGER admin level to NormalizedDistrict districtType.
 * RTreeBuilder expects 'council' | 'ward' | 'municipal' — we map federal/state
 * layers to the closest semantic match.
 */
function mapDistrictType(layer: string): 'council' | 'ward' | 'municipal' {
  switch (layer) {
    case 'cd':
    case 'sldu':
    case 'sldl':
      return 'council';   // legislative district
    case 'county':
    case 'cousub':
      return 'municipal';
    default:
      return 'ward';
  }
}

/**
 * Convert NormalizedBoundary (provider output) to NormalizedDistrict (R-tree input).
 */
function toNormalizedDistrict(boundary: NormalizedBoundary): NormalizedDistrict | null {
  const geom = boundary.geometry;
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') {
    return null; // Skip non-polygon geometries (points, lines)
  }

  const layer = (boundary.properties.layer as string) ?? '';
  const stateFipsCode = (boundary.properties.stateFips as string) ?? '';

  // Prefix ID with layer to avoid cross-layer GEOID collisions
  // (e.g., GEOID "06" could appear in both CD and COUNTY datasets)
  const prefixedId = `${layer}-${boundary.id}`;

  return {
    id: prefixedId,
    name: boundary.name,
    jurisdiction: `USA/${stateFipsCode}`,
    districtType: mapDistrictType(layer),
    geometry: geom as Polygon | MultiPolygon,
    provenance: {
      source: boundary.source.url,
      authority: 'federal' as const,
      timestamp: Date.now(),
      method: 'tiger-ftp-download',
      responseHash: boundary.source.checksum ?? '',
      jurisdiction: `USA/${stateFipsCode}`,
      httpStatus: 200,
      license: boundary.source.license ?? 'CC0-1.0',
      featureCount: 1,
      geometryType: geom.type as 'Polygon' | 'MultiPolygon',
      coordinateSystem: 'EPSG:4326',
    },
    bbox: computeBBox(geom),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(72));
  console.log('  Shadow Atlas — District R-tree Database Builder');
  console.log('='.repeat(72));
  console.log(`  Layers:  ${layers.join(', ')}`);
  console.log(`  Output:  ${outputPath}`);
  console.log(`  Cache:   ${cacheDir}`);
  console.log(`  Year:    ${year}`);
  console.log(`  State:   ${stateFips ?? 'ALL (national)'}`);
  console.log(`  Wards:   ${includeWards ? 'ENABLED (portal registry)' : 'disabled'}`);
  console.log(`  StateGIS:${includeStateGIS ? ' ENABLED (WI LTSB + MassGIS, authority=100%)' : ' disabled'}`);
  console.log(`  Special: ${includeSpecialDistricts ? `ENABLED (${SPECIAL_DISTRICT_PROVIDERS.size} providers registered)` : 'disabled'}`);
  console.log(`  Canada:  ${noCanada ? 'DISABLED' : 'enabled'}`);
  console.log(`  UK:      ${includeUK ? 'ENABLED' : 'disabled'}`);
  console.log(`  AU:      ${includeAU ? 'ENABLED' : 'disabled'}`);
  console.log(`  NZ:      ${includeNZ ? 'ENABLED' : 'disabled'}`);
  console.log(`  Verify:  ${skipVerify ? 'DISABLED' : 'enabled'}`);
  console.log('='.repeat(72));
  console.log();

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  // Create TIGER provider
  const provider = new TIGERBoundaryProvider({
    cacheDir,
    year,
    maxRetries: 3,
    retryDelayMs: 2000,
    verifyDownloads: !skipVerify,
    verificationOptions: {
      strictMode: false,       // Don't fail on missing checksums
      allowEmptyChecksums: true,
      verbose: false,
    },
  });

  const allDistricts: NormalizedDistrict[] = [];
  const layerStats: Array<{ layer: string; raw: number; normalized: number; duration: number }> = [];

  for (const layer of layers) {
    const start = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Downloading ${layer.toUpperCase()} layer...`);

    try {
      // Download raw shapefile data
      const rawFiles = await provider.downloadLayer({
        layer,
        stateFips,
        year,
      });

      console.log(`    Downloaded ${rawFiles.length} file(s)`);

      // Transform to NormalizedBoundary[]
      const boundaries = await provider.transform(rawFiles);
      console.log(`    Transformed ${boundaries.length} boundaries`);

      // Convert to NormalizedDistrict[] (adds bbox, provenance, districtType)
      let layerCount = 0;
      for (const boundary of boundaries) {
        const district = toNormalizedDistrict(boundary);
        if (district) {
          allDistricts.push(district);
          layerCount++;
        }
      }

      const duration = performance.now() - start;
      layerStats.push({ layer, raw: rawFiles.length, normalized: layerCount, duration });

      console.log(`    → ${layerCount} districts indexed (${(duration / 1000).toFixed(1)}s)`);
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`    ✗ FAILED: ${(error as Error).message}`);
      layerStats.push({ layer, raw: 0, normalized: 0, duration });
    }
  }

  // ---- Canadian Federal Electoral Districts ----
  if (!noCanada && !stateFips) {
    const canadaStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Fetching Canadian federal electoral districts...`);

    try {
      const canadaProvider = new CanadaBoundaryProvider();
      const canadaResult = await canadaProvider.extractFederalDistricts();

      if (canadaResult.success && canadaResult.boundaries.length > 0) {
        let canadaCount = 0;
        for (const riding of canadaResult.boundaries) {
          if (riding.geometry.type !== 'Polygon' && riding.geometry.type !== 'MultiPolygon') continue;
          const bbox = computeBBox(riding.geometry);
          allDistricts.push({
            id: `can-fed-${riding.id}`,
            name: riding.name,
            jurisdiction: `CAN/${riding.province}`,
            districtType: 'council',
            geometry: riding.geometry,
            provenance: {
              source: riding.source.endpoint,
              authority: 'federal' as const,
              timestamp: Date.now(),
              method: 'represent-api-fetch',
              responseHash: '',
              jurisdiction: `CAN/${riding.province}`,
              httpStatus: 200,
              license: 'OGL-CA',
              featureCount: 1,
              geometryType: riding.geometry.type as 'Polygon' | 'MultiPolygon',
              coordinateSystem: 'EPSG:4326',
            },
            bbox,
          });
          canadaCount++;
        }

        const canadaDuration = performance.now() - canadaStart;
        layerStats.push({ layer: 'can-fed', raw: 1, normalized: canadaCount, duration: canadaDuration });
        console.log(`    → ${canadaCount} Canadian ridings indexed (${(canadaDuration / 1000).toFixed(1)}s)`);
      } else {
        console.warn(`    ✗ Canadian extraction returned ${canadaResult.boundaries.length} boundaries`);
        layerStats.push({ layer: 'can-fed', raw: 0, normalized: 0, duration: performance.now() - canadaStart });
      }
    } catch (error) {
      const duration = performance.now() - canadaStart;
      console.error(`    ✗ Canadian extraction FAILED: ${(error as Error).message}`);
      layerStats.push({ layer: 'can-fed', raw: 0, normalized: 0, duration });
    }
  }

  // ---- UK Parliamentary Constituencies ----
  if (includeUK && !stateFips) {
    const ukStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Fetching UK parliamentary constituencies...`);

    try {
      const ukProvider = new UKBoundaryProvider();
      const ukResult = await ukProvider.extractParliamentaryConstituencies();

      if (ukResult.success && ukResult.boundaries.length > 0) {
        let ukCount = 0;
        for (const constituency of ukResult.boundaries) {
          if (constituency.geometry.type !== 'Polygon' && constituency.geometry.type !== 'MultiPolygon') continue;
          const bbox = computeBBox(constituency.geometry);
          allDistricts.push({
            id: `uk-parl-${constituency.id}`,
            name: constituency.name,
            jurisdiction: `GBR/${constituency.country}`,
            districtType: 'council',
            geometry: constituency.geometry,
            provenance: {
              source: constituency.source.endpoint,
              authority: 'federal' as const,
              timestamp: Date.now(),
              method: 'ons-arcgis-fetch',
              responseHash: '',
              jurisdiction: `GBR/${constituency.country}`,
              httpStatus: 200,
              license: 'OGL',
              featureCount: 1,
              geometryType: constituency.geometry.type as 'Polygon' | 'MultiPolygon',
              coordinateSystem: 'EPSG:4326',
            },
            bbox,
          });
          ukCount++;
        }

        const ukDuration = performance.now() - ukStart;
        layerStats.push({ layer: 'uk-parl', raw: 1, normalized: ukCount, duration: ukDuration });
        console.log(`    → ${ukCount} UK constituencies indexed (${(ukDuration / 1000).toFixed(1)}s)`);
      } else {
        console.warn(`    ✗ UK extraction returned ${ukResult.boundaries.length} boundaries`);
        layerStats.push({ layer: 'uk-parl', raw: 0, normalized: 0, duration: performance.now() - ukStart });
      }
    } catch (error) {
      const duration = performance.now() - ukStart;
      console.error(`    ✗ UK extraction FAILED: ${(error as Error).message}`);
      layerStats.push({ layer: 'uk-parl', raw: 0, normalized: 0, duration });
    }
  }

  // ---- Australian Federal Electoral Divisions ----
  if (includeAU && !stateFips) {
    const auStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Fetching Australian federal electoral divisions...`);

    try {
      const auProvider = new AustraliaBoundaryProvider();
      const auResult = await auProvider.extractFederalDivisions();

      if (auResult.success && auResult.boundaries.length > 0) {
        let auCount = 0;
        for (const division of auResult.boundaries) {
          if (division.geometry.type !== 'Polygon' && division.geometry.type !== 'MultiPolygon') continue;
          const bbox = computeBBox(division.geometry);
          allDistricts.push({
            id: `au-fed-${division.id}`,
            name: division.name,
            jurisdiction: `AUS/${division.state}`,
            districtType: 'council',
            geometry: division.geometry,
            provenance: {
              source: division.source.endpoint,
              authority: 'federal' as const,
              timestamp: Date.now(),
              method: 'aec-arcgis-fetch',
              responseHash: '',
              jurisdiction: `AUS/${division.state}`,
              httpStatus: 200,
              license: 'CC-BY-4.0',
              featureCount: 1,
              geometryType: division.geometry.type as 'Polygon' | 'MultiPolygon',
              coordinateSystem: 'EPSG:4326',
            },
            bbox,
          });
          auCount++;
        }

        const auDuration = performance.now() - auStart;
        layerStats.push({ layer: 'au-fed', raw: 1, normalized: auCount, duration: auDuration });
        console.log(`    → ${auCount} Australian divisions indexed (${(auDuration / 1000).toFixed(1)}s)`);
      } else {
        console.warn(`    ✗ Australian extraction returned ${auResult.boundaries.length} boundaries`);
        layerStats.push({ layer: 'au-fed', raw: 0, normalized: 0, duration: performance.now() - auStart });
      }
    } catch (error) {
      const duration = performance.now() - auStart;
      console.error(`    ✗ Australian extraction FAILED: ${(error as Error).message}`);
      layerStats.push({ layer: 'au-fed', raw: 0, normalized: 0, duration });
    }
  }

  // ---- New Zealand Electoral Districts ----
  if (includeNZ && !stateFips) {
    const nzStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Fetching New Zealand electoral districts...`);

    try {
      const nzProvider = new NewZealandBoundaryProvider();
      const nzResult = await nzProvider.extractAll();

      if (nzResult.totalBoundaries > 0) {
        let nzCount = 0;
        for (const layerResult of nzResult.layers) {
          for (const electorate of layerResult.boundaries) {
            if (electorate.geometry.type !== 'Polygon' && electorate.geometry.type !== 'MultiPolygon') continue;
            const bbox = computeBBox(electorate.geometry);
            // Use nz-gen- for general electorates and nz-maori- for Maori electorates
            const prefix = electorate.type === 'maori' ? 'nz-maori' : 'nz-gen';
            allDistricts.push({
              id: `${prefix}-${electorate.id}`,
              name: electorate.name,
              jurisdiction: `NZL/${electorate.region}`,
              districtType: 'council',
              geometry: electorate.geometry,
              provenance: {
                source: electorate.source.endpoint,
                authority: 'federal' as const,
                timestamp: Date.now(),
                method: 'stats-nz-arcgis-fetch',
                responseHash: '',
                jurisdiction: `NZL/${electorate.region}`,
                httpStatus: 200,
                license: 'CC-BY-4.0',
                featureCount: 1,
                geometryType: electorate.geometry.type as 'Polygon' | 'MultiPolygon',
                coordinateSystem: 'EPSG:4326',
              },
              bbox,
            });
            nzCount++;
          }
        }

        const nzDuration = performance.now() - nzStart;
        layerStats.push({ layer: 'nz-elec', raw: nzResult.layers.length, normalized: nzCount, duration: nzDuration });
        console.log(`    → ${nzCount} NZ electorates indexed (${(nzDuration / 1000).toFixed(1)}s)`);
      } else {
        console.warn(`    ✗ NZ extraction returned 0 boundaries`);
        layerStats.push({ layer: 'nz-elec', raw: 0, normalized: 0, duration: performance.now() - nzStart });
      }
    } catch (error) {
      const duration = performance.now() - nzStart;
      console.error(`    ✗ NZ extraction FAILED: ${(error as Error).message}`);
      layerStats.push({ layer: 'nz-elec', raw: 0, normalized: 0, duration });
    }
  }

  // ---- City Council Wards (from portal registry) ----
  if (includeWards && stateFips) {
    console.warn('    ⚠ --wards ignored when --state is set (ward registry is national-only)');
  }
  if (includeWards && !stateFips) {
    const wardStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Loading city council wards from portal registry...`);

    try {
      const registry = await loadWardRegistry({ minConfidence: 70 });
      const entries = Array.from(registry.entries.values());
      console.log(`    Registry: ${entries.length} cities with confidence >= 70`);

      const wardResult = await loadWardBoundaries(entries, {
        cacheDir: join(cacheDir, 'wards'),
        maxRetries: 3,
        log: (msg) => console.log(`    ${msg}`),
      });

      let wardCount = 0;
      for (const city of wardResult.loaded) {
        for (const ward of city.wards) {
          if (ward.geometry.type !== 'Polygon' && ward.geometry.type !== 'MultiPolygon') continue;
          const bbox = computeBBox(ward.geometry);
          // ID format: ward-{stateFips}{placeFips}-{wardNumber:02d}
          const wardId = `ward-${city.cityFips}-${String(ward.wardNumber).padStart(2, '0')}`;
          allDistricts.push({
            id: wardId,
            name: `${city.cityName} Ward ${ward.wardNumber}`,
            jurisdiction: `USA/${city.state}`,
            districtType: 'ward',
            geometry: ward.geometry,
            provenance: {
              source: `arcgis-featureserver/${city.cityFips}`,
              authority: 'municipal' as const,
              timestamp: Date.now(),
              method: 'portal-registry-download',
              responseHash: '',
              jurisdiction: `USA/${city.state}`,
              httpStatus: 200,
              license: 'public-domain',
              featureCount: 1,
              geometryType: ward.geometry.type as 'Polygon' | 'MultiPolygon',
              coordinateSystem: 'EPSG:4326',
            },
            bbox,
          });
          wardCount++;
        }
      }

      const wardDuration = performance.now() - wardStart;
      layerStats.push({ layer: 'ward', raw: wardResult.loaded.length, normalized: wardCount, duration: wardDuration });
      console.log(`    → ${wardCount} wards from ${wardResult.loaded.length} cities indexed (${(wardDuration / 1000).toFixed(1)}s)`);
      if (wardResult.failed.length > 0) {
        console.log(`    → ${wardResult.failed.length} cities failed to load`);
      }
    } catch (error) {
      const duration = performance.now() - wardStart;
      console.error(`    ✗ Ward ingestion FAILED: ${(error as Error).message}`);
      layerStats.push({ layer: 'ward', raw: 0, normalized: 0, duration });
    }
  }

  // ---- Statewide Ward Data from State GIS (authoritative, 100% confidence) ----
  // These override per-city portal wards for the same FIPS (higher authority).
  // NOTE: Portal wards (--wards) must be ingested BEFORE this block so the override
  // dedup scan finds them. Without --wards, state-GIS wards still ingest but no
  // override dedup occurs (existingWardFips will be empty).
  if (includeStateGIS && !stateFips) {
    const stateGISStart = performance.now();
    const stateGISStates: StatewideWardState[] = ['WI', 'MA'];
    console.log(`\n[${'▶'.padEnd(3)}] Extracting statewide wards from state GIS (${stateGISStates.join(', ')})...`);

    // Collect FIPS codes already ingested from portal wards, so we can track overrides
    const existingWardFips = new Set<string>();
    for (const d of allDistricts) {
      if (d.id.startsWith('ward-')) {
        const match = d.id.match(/^ward-(\d+)-\d+$/);
        if (match) existingWardFips.add(match[1]);
      }
    }

    const orchestrator = new BatchOrchestrator({
      extractorOptions: { retryAttempts: 3, retryDelayMs: 2000 },
    });

    let stateGISCount = 0;
    let overrideCount = 0;

    for (const stateCode of stateGISStates) {
      try {
        console.log(`    Extracting ${stateCode}...`);
        const result = await orchestrator.extractStatewideWards(stateCode, {
          onProgress: (progress) => {
            console.log(`      [${progress.step}] ${progress.message}`);
          },
        });

        console.log(`    ${stateCode}: ${result.citiesExtracted} cities, ${result.cities.length} entries`);

        for (const city of result.cities) {
          try {
            const raw = await readFile(city.outputPath, 'utf-8');
            const fc = JSON.parse(raw) as import('geojson').FeatureCollection;
            if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
              console.warn(`      ⚠ Invalid GeoJSON for ${city.name} (${city.fips}): not a FeatureCollection`);
              continue;
            }

            // Override portal wards for same FIPS — state GIS takes precedence
            if (existingWardFips.has(city.fips)) {
              const before = allDistricts.length;
              const fipsPrefix = `ward-${city.fips}-`;
              for (let i = allDistricts.length - 1; i >= 0; i--) {
                if (allDistricts[i].id.startsWith(fipsPrefix)) {
                  allDistricts.splice(i, 1);
                }
              }
              const removed = before - allDistricts.length;
              if (removed === 0) {
                console.warn(`      ⚠ FIPS ${city.fips} marked as override but 0 entries removed (format mismatch?)`);
              }
              overrideCount += removed;
            }

            for (let idx = 0; idx < fc.features.length; idx++) {
              const feature = fc.features[idx];
              const geom = feature.geometry;
              if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

              // Use WARD_NORMALIZED from BatchOrchestrator's normalizeWardNumbering()
              const wardNum = (feature.properties?.['WARD_NORMALIZED'] as number) ?? (idx + 1);
              const bbox = computeBBox(geom);
              const wardId = `ward-${city.fips}-${String(wardNum).padStart(2, '0')}`;

              allDistricts.push({
                id: wardId,
                name: `${city.name} Ward ${wardNum}`,
                jurisdiction: `USA/${city.state}`,
                districtType: 'ward',
                geometry: geom as Polygon | MultiPolygon,
                provenance: {
                  source: city.source,
                  authority: 'state-gis' as const,
                  timestamp: Date.now(),
                  method: 'state-gis-extraction',
                  responseHash: '',
                  jurisdiction: `USA/${city.state}`,
                  httpStatus: 200,
                  license: 'public-domain',
                  featureCount: 1,
                  geometryType: geom.type as 'Polygon' | 'MultiPolygon',
                  coordinateSystem: 'EPSG:4326',
                },
                bbox,
              });
              stateGISCount++;
            }
          } catch (err) {
            console.warn(`      ⚠ Failed to read ${city.name} (${city.fips}): ${(err as Error).message}`);
          }
        }
      } catch (error) {
        console.error(`    ✗ ${stateCode} extraction FAILED: ${(error as Error).message}`);
      }
    }

    const stateGISDuration = performance.now() - stateGISStart;
    layerStats.push({ layer: 'state-gis', raw: stateGISStates.length, normalized: stateGISCount, duration: stateGISDuration });
    console.log(`    → ${stateGISCount} state-GIS wards indexed (${overrideCount} portal overrides) (${(stateGISDuration / 1000).toFixed(1)}s)`);
    if (stateGISCount === 0) {
      console.warn('    ⚠ --state-gis produced 0 wards. Check ogr2ogr installation and network connectivity.');
    }
  } else if (includeStateGIS && stateFips) {
    console.warn('    ⚠ --state-gis ignored when --state is set (state GIS extraction is statewide-only)');
  }

  // ---- Special Districts (fire, water, transit, etc.) ----
  if (includeSpecialDistricts) {
    const specialStart = performance.now();
    console.log(`\n[${'▶'.padEnd(3)}] Ingesting special districts (${SPECIAL_DISTRICT_PROVIDERS.size} providers)...`);

    let specialCount = 0;
    for (const [key, provider] of SPECIAL_DISTRICT_PROVIDERS) {
      // Filter by --state if set
      if (stateFips && provider.stateFips !== stateFips) {
        console.log(`    Skipping ${key} (state ${provider.stateFips} != filter ${stateFips})`);
        continue;
      }
      try {
        console.log(`    Downloading ${key}...`);
        const rawFiles = await provider.download({ level: 'district' });
        const boundaries: NormalizedSpecialDistrict[] = await provider.transform(rawFiles);
        console.log(`    ${key}: ${boundaries.length} boundaries`);

        for (const boundary of boundaries) {
          const geom = boundary.geometry;
          if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

          const bbox = computeBBox(geom);
          const rawType = boundary.specialDistrictMetadata.districtType;
          // NOTE: specialDistrictMetadata (governance type, board seats, etc.) is intentionally
          // not stored in the R-tree — geometry-only store for PIP lookups. Metadata can be
          // recovered from the provider registry at query time if needed.
          // Use short prefix (fire, water, transit, ...) not full enum value (fire_district, ...)
          // to match parseRTreeDistrictId regex and LAYER_PRIORITY keys.
          const shortPrefix = rawType.replace(/_district$/, '');
          // Strip provider stateFips from boundary.id if already present (e.g. "06FD00001" → "FD00001")
          // to avoid double-encoding (fire-0606FD00001)
          const localId = boundary.id.startsWith(provider.stateFips)
            ? boundary.id.slice(provider.stateFips.length)
            : boundary.id;
          const prefixedId = `${shortPrefix}-${provider.stateFips}${localId}`;

          allDistricts.push({
            id: prefixedId,
            name: boundary.name,
            jurisdiction: `USA/${provider.stateFips}`,
            districtType: 'municipal',
            geometry: geom as Polygon | MultiPolygon,
            provenance: {
              source: boundary.source.url,
              authority: 'state-gis' as const,
              timestamp: Date.now(),
              method: 'special-district-provider',
              responseHash: boundary.source.checksum ?? '',
              jurisdiction: `USA/${provider.stateFips}`,
              httpStatus: 200,
              license: boundary.source.license ?? 'CC0-1.0',
              featureCount: 1,
              geometryType: geom.type as 'Polygon' | 'MultiPolygon',
              coordinateSystem: 'EPSG:4326',
            },
            bbox,
          });
          specialCount++;
        }
      } catch (error) {
        console.error(`    ✗ ${key} FAILED: ${(error as Error).message}`);
      }
    }

    const specialDuration = performance.now() - specialStart;
    layerStats.push({ layer: 'special', raw: SPECIAL_DISTRICT_PROVIDERS.size, normalized: specialCount, duration: specialDuration });
    console.log(`    → ${specialCount} special districts indexed (${(specialDuration / 1000).toFixed(1)}s)`);
  }

  if (allDistricts.length === 0) {
    console.error('\nNo districts to index. Aborting.');
    process.exit(1);
  }

  // Build R-tree SQLite database
  console.log(`\n[▶  ] Building R-tree spatial index (${allDistricts.length} districts)...`);
  const buildStart = performance.now();

  const builder = new RTreeBuilder();
  builder.build(allDistricts, outputPath);

  const buildDuration = performance.now() - buildStart;
  console.log(`    → R-tree built in ${(buildDuration / 1000).toFixed(1)}s`);

  // Validate
  console.log('\n[▶  ] Validating database...');
  const valid = builder.validateDatabase(outputPath);
  console.log(`    → Integrity: ${valid ? 'PASS' : 'FAIL'}`);

  // Benchmark
  console.log('\n[▶  ] Running benchmark...');
  const testPoints = [
    { lat: 37.7793, lon: -122.4193 },  // San Francisco (CA-11)
    { lat: 38.8977, lon: -77.0365 },   // White House (DC-AL)
    { lat: 40.7128, lon: -74.0060 },   // NYC (NY-10)
    { lat: 41.8781, lon: -87.6298 },   // Chicago (IL-7)
    { lat: 29.7604, lon: -95.3698 },   // Houston (TX-7)
    { lat: 33.4484, lon: -112.0740 },  // Phoenix (AZ-3)
    { lat: 47.6062, lon: -122.3321 },  // Seattle (WA-7)
    { lat: 25.7617, lon: -80.1918 },   // Miami (FL-27)
    { lat: 39.9526, lon: -75.1652 },   // Philadelphia (PA-3)
    { lat: 32.7767, lon: -96.7970 },   // Dallas (TX-30)
  ];
  builder.benchmarkQueries(outputPath, testPoints);

  // Summary
  console.log('\n' + '='.repeat(72));
  console.log('  Build Summary');
  console.log('='.repeat(72));
  console.log(`  Total districts: ${allDistricts.length}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Database valid: ${valid}`);
  console.log();
  console.log('  Per-layer breakdown:');
  for (const stat of layerStats) {
    console.log(`    ${stat.layer.padEnd(8)} ${String(stat.normalized).padStart(6)} districts  (${(stat.duration / 1000).toFixed(1)}s)`);
  }
  console.log('='.repeat(72));

  if (!valid) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
