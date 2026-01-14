#!/usr/bin/env npx tsx
/**
 * Phase 2 P1: Spatial Join - Census Places with Governance Districts
 *
 * Joins 4,294 elected governance districts with Census TIGER/Line 2024 place boundaries.
 *
 * What this script does:
 * 1. Loads Census place boundaries from census_places_2024.geojson
 * 2. Loads governance districts from comprehensive_classified_layers.jsonl
 * 3. For each district, queries ArcGIS layer geometry
 * 4. Performs spatial join (centroid-in-polygon or name matching)
 * 5. Enriches districts with Census place metadata
 * 6. Outputs enriched dataset to districts_with_places.jsonl
 *
 * Spatial Join Strategy:
 * - Primary: Fetch district centroid, test if inside Census place polygon
 * - Secondary: Name matching (e.g., "San Francisco Council Districts" → "San Francisco city")
 * - Tertiary: Mark as unmatched if no spatial or name match
 *
 * Runtime: ~2-4 hours (4,294 districts × ~2 sec/district geometry fetch)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { calculateCentroidFromBBox, pointInGeometry } from '../core/geo-utils.js';
import { logger } from '../core/utils/logger.js';

interface CensusPlace {
  type: 'Feature';
  properties: {
    place_fips: string;
    place_name: string;
    place_type: 'incorporated' | 'cdp';
    lsad: string;
    lsad_name: string;
    classfp: string;
    state_fips: string;
    state_name: string;
  };
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

interface GovernanceDistrict {
  service_url: string;
  layer_number: number;
  layer_url: string;
  layer_name: string;
  geometry_type: string;
  feature_count: number;
  fields: string[];
  district_type: string;
  tier: string;
  governance_level: string;
  elected: boolean;
  confidence: number;
  score: number;
  classification_reasons: string[];
  // NEW FIELDS TO ADD:
  place_fips?: string;
  place_name?: string;
  place_type?: 'incorporated' | 'cdp' | 'unmatched';
  lsad?: string;
  place_match_method?: 'centroid' | 'name' | 'none';
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Simple bounding box calculation (local BBox interface)
// Uses canonical calculateCentroidFromBBox internally
function getBBox(geometry: GeoJSON.Geometry): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  /**
   * Recursively processes GeoJSON coordinate arrays which can be:
   * - [lon, lat] for Point
   * - [[lon, lat], ...] for LineString
   * - [[[lon, lat], ...], ...] for Polygon
   * - [[[[lon, lat], ...], ...], ...] for MultiPolygon
   */
  function processCoords(coords: unknown): void {
    if (!Array.isArray(coords)) return;

    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      // Single coordinate pair [lon, lat]
      minX = Math.min(minX, coords[0]);
      maxX = Math.max(maxX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxY = Math.max(maxY, coords[1]);
    } else {
      // Nested array - recursively process each element
      for (const coord of coords) {
        processCoords(coord);
      }
    }
  }

  // GeometryCollection doesn't have coordinates, handle all geometry types
  if (geometry.type === 'GeometryCollection') {
    for (const geom of geometry.geometries) {
      const subBBox = getBBox(geom);
      minX = Math.min(minX, subBBox.minX);
      minY = Math.min(minY, subBBox.minY);
      maxX = Math.max(maxX, subBBox.maxX);
      maxY = Math.max(maxY, subBBox.maxY);
    }
  } else {
    // All other geometry types have coordinates property
    processCoords((geometry as GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPoint | GeoJSON.MultiLineString | GeoJSON.MultiPolygon).coordinates);
  }

  return { minX, minY, maxX, maxY };
}

// Calculate centroid from bounding box (approximation)
// CANONICAL: Uses calculateCentroidFromBBox from geo-utils.ts
function getCentroid(geometry: GeoJSON.Geometry): [number, number] {
  return calculateCentroidFromBBox(geometry);
}

// pointInPolygon and pointInGeometry moved to geo-utils.ts (imported above)

// Check if bounding boxes overlap (for spatial index optimization)
function bboxesOverlap(bbox1: BBox, bbox2: BBox): boolean {
  return !(bbox2.minX > bbox1.maxX || bbox2.maxX < bbox1.minX ||
           bbox2.minY > bbox1.maxY || bbox2.maxY < bbox1.minY);
}

// Fetch district geometry from ArcGIS layer
async function fetchDistrictGeometry(layerUrl: string, retries = 3): Promise<GeoJSON.Geometry | null> {
  const queryUrl = `${layerUrl}/query?where=1=1&outFields=*&f=geojson&resultRecordCount=1`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(queryUrl, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        return null;
      }

      const geojson = await response.json();

      if (geojson.features && geojson.features.length > 0) {
        return geojson.features[0].geometry;
      }

      return null;
    } catch (error) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      return null;
    }
  }

  return null;
}

// Name-based matching (fallback when geometry unavailable)
function matchPlaceByName(districtName: string, places: CensusPlace[]): CensusPlace | null {
  const normalizedName = districtName.toLowerCase();

  // Try exact match first
  for (const place of places) {
    if (normalizedName.includes(place.properties.place_name.toLowerCase())) {
      return place;
    }
  }

  return null;
}

// Spatial join: Find Census place for district
function findPlaceForDistrict(
  districtGeometry: GeoJSON.Geometry,
  places: CensusPlace[]
): CensusPlace | null {
  const centroid = getCentroid(districtGeometry);
  const districtBBox = getBBox(districtGeometry);

  // Filter candidates by bounding box overlap
  const candidates = places.filter(place => {
    const placeBBox = getBBox(place.geometry);
    return bboxesOverlap(districtBBox, placeBBox);
  });

  // Test centroid against candidate places
  for (const place of candidates) {
    if (pointInGeometry(centroid, place.geometry)) {
      return place;
    }
  }

  return null;
}

async function main() {
  logger.info('=============================================');
  logger.info('Spatial Join: Census Places with Districts');
  logger.info('=============================================\n');

  const dataDir = join(__dirname, 'data');

  // Load Census places
  const censusPlacesPath = join(dataDir, 'census_places_2024.geojson');
  if (!existsSync(censusPlacesPath)) {
    logger.error('ERROR: Census places file not found!');
    logger.error(`Expected: ${censusPlacesPath}`);
    logger.error('Run load-census-tiger-places.ts first.');
    process.exit(1);
  }

  logger.info('Loading Census places...');
  const censusPlacesData = readFileSync(censusPlacesPath, 'utf-8');
  const censusPlacesGeoJSON = JSON.parse(censusPlacesData);
  const censusPlaces: CensusPlace[] = censusPlacesGeoJSON.features;
  logger.info(`Loaded ${censusPlaces.length.toLocaleString()} Census places\n`);

  // Load governance districts
  const districtsPath = join(dataDir, 'comprehensive_classified_layers.jsonl');
  if (!existsSync(districtsPath)) {
    logger.error('ERROR: Governance districts file not found!');
    logger.error(`Expected: ${districtsPath}`);
    process.exit(1);
  }

  logger.info('Loading governance districts...');
  const districtsData = readFileSync(districtsPath, 'utf-8');
  const allDistricts: GovernanceDistrict[] = districtsData
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  // Filter to elected governance districts only
  const electedDistricts = allDistricts.filter(d => d.elected === true);
  logger.info(`Loaded ${electedDistricts.length.toLocaleString()} elected governance districts\n`);

  // Spatial join
  logger.info('Starting spatial join...\n');
  const enrichedDistricts: GovernanceDistrict[] = [];
  let matchedByCentroid = 0;
  let matchedByName = 0;
  let unmatched = 0;

  for (let i = 0; i < electedDistricts.length; i++) {
    const district = electedDistricts[i];

    if ((i + 1) % 100 === 0) {
      logger.info(`Progress: ${i + 1}/${electedDistricts.length} (${((i + 1) / electedDistricts.length * 100).toFixed(1)}%)`);
      logger.info(`  Matched: ${matchedByCentroid + matchedByName} (centroid: ${matchedByCentroid}, name: ${matchedByName})`);
      logger.info(`  Unmatched: ${unmatched}\n`);
    }

    // Fetch district geometry
    const geometry = await fetchDistrictGeometry(district.layer_url);

    if (!geometry) {
      // Geometry fetch failed - try name matching
      const placeByName = matchPlaceByName(district.layer_name, censusPlaces);

      if (placeByName) {
        enrichedDistricts.push({
          ...district,
          place_fips: placeByName.properties.place_fips,
          place_name: placeByName.properties.place_name,
          place_type: placeByName.properties.place_type,
          lsad: placeByName.properties.lsad_name,
          place_match_method: 'name',
        });
        matchedByName++;
      } else {
        enrichedDistricts.push({
          ...district,
          place_type: 'unmatched',
          place_match_method: 'none',
        });
        unmatched++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }

    // Spatial join
    const place = findPlaceForDistrict(geometry, censusPlaces);

    if (place) {
      enrichedDistricts.push({
        ...district,
        place_fips: place.properties.place_fips,
        place_name: place.properties.place_name,
        place_type: place.properties.place_type,
        lsad: place.properties.lsad_name,
        place_match_method: 'centroid',
      });
      matchedByCentroid++;
    } else {
      // Spatial join failed - try name matching as fallback
      const placeByName = matchPlaceByName(district.layer_name, censusPlaces);

      if (placeByName) {
        enrichedDistricts.push({
          ...district,
          place_fips: placeByName.properties.place_fips,
          place_name: placeByName.properties.place_name,
          place_type: placeByName.properties.place_type,
          lsad: placeByName.properties.lsad_name,
          place_match_method: 'name',
        });
        matchedByName++;
      } else {
        enrichedDistricts.push({
          ...district,
          place_type: 'unmatched',
          place_match_method: 'none',
        });
        unmatched++;
      }
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Save enriched districts
  const outputPath = join(dataDir, 'districts_with_places.jsonl');
  const outputData = enrichedDistricts.map(d => JSON.stringify(d)).join('\n');
  writeFileSync(outputPath, outputData);

  // Final statistics
  logger.info('\n=============================================');
  logger.info('Spatial Join Complete');
  logger.info('=============================================');
  logger.info(`Total districts processed: ${electedDistricts.length.toLocaleString()}`);
  logger.info(`  Matched by centroid: ${matchedByCentroid.toLocaleString()} (${((matchedByCentroid / electedDistricts.length) * 100).toFixed(1)}%)`);
  logger.info(`  Matched by name: ${matchedByName.toLocaleString()} (${((matchedByName / electedDistricts.length) * 100).toFixed(1)}%)`);
  logger.info(`  Unmatched: ${unmatched.toLocaleString()} (${((unmatched / electedDistricts.length) * 100).toFixed(1)}%)`);
  logger.info(`\nOutput: ${outputPath}`);
  logger.info('=============================================\n');
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
