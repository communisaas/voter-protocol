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

// Simple bounding box calculation
function getBBox(geometry: GeoJSON.Geometry): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function processCoords(coords: any) {
    if (typeof coords[0] === 'number') {
      // Single coordinate pair [lon, lat]
      minX = Math.min(minX, coords[0]);
      maxX = Math.max(maxX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxY = Math.max(maxY, coords[1]);
    } else {
      // Nested array
      for (const coord of coords) {
        processCoords(coord);
      }
    }
  }

  processCoords(geometry.coordinates);

  return { minX, minY, maxX, maxY };
}

// Calculate centroid from bounding box (approximation)
function getCentroid(geometry: GeoJSON.Geometry): [number, number] {
  const bbox = getBBox(geometry);
  return [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
}

// Ray casting algorithm for point-in-polygon test
function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

// Check if point is in Polygon or MultiPolygon
function pointInGeometry(point: [number, number], geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  if (geometry.type === 'Polygon') {
    // Test against exterior ring (first ring)
    return pointInPolygon(point, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    // Test against any polygon in multipolygon
    for (const polygon of geometry.coordinates) {
      if (pointInPolygon(point, polygon[0])) {
        return true;
      }
    }
  }
  return false;
}

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
  console.log('=============================================');
  console.log('Spatial Join: Census Places with Districts');
  console.log('=============================================\n');

  const dataDir = join(__dirname, 'data');

  // Load Census places
  const censusPlacesPath = join(dataDir, 'census_places_2024.geojson');
  if (!existsSync(censusPlacesPath)) {
    console.error('ERROR: Census places file not found!');
    console.error(`Expected: ${censusPlacesPath}`);
    console.error('Run load-census-tiger-places.ts first.');
    process.exit(1);
  }

  console.log('Loading Census places...');
  const censusPlacesData = readFileSync(censusPlacesPath, 'utf-8');
  const censusPlacesGeoJSON = JSON.parse(censusPlacesData);
  const censusPlaces: CensusPlace[] = censusPlacesGeoJSON.features;
  console.log(`Loaded ${censusPlaces.length.toLocaleString()} Census places\n`);

  // Load governance districts
  const districtsPath = join(dataDir, 'comprehensive_classified_layers.jsonl');
  if (!existsSync(districtsPath)) {
    console.error('ERROR: Governance districts file not found!');
    console.error(`Expected: ${districtsPath}`);
    process.exit(1);
  }

  console.log('Loading governance districts...');
  const districtsData = readFileSync(districtsPath, 'utf-8');
  const allDistricts: GovernanceDistrict[] = districtsData
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  // Filter to elected governance districts only
  const electedDistricts = allDistricts.filter(d => d.elected === true);
  console.log(`Loaded ${electedDistricts.length.toLocaleString()} elected governance districts\n`);

  // Spatial join
  console.log('Starting spatial join...\n');
  const enrichedDistricts: GovernanceDistrict[] = [];
  let matchedByCentroid = 0;
  let matchedByName = 0;
  let unmatched = 0;

  for (let i = 0; i < electedDistricts.length; i++) {
    const district = electedDistricts[i];

    if ((i + 1) % 100 === 0) {
      console.log(`Progress: ${i + 1}/${electedDistricts.length} (${((i + 1) / electedDistricts.length * 100).toFixed(1)}%)`);
      console.log(`  Matched: ${matchedByCentroid + matchedByName} (centroid: ${matchedByCentroid}, name: ${matchedByName})`);
      console.log(`  Unmatched: ${unmatched}\n`);
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
  console.log('\n=============================================');
  console.log('Spatial Join Complete');
  console.log('=============================================');
  console.log(`Total districts processed: ${electedDistricts.length.toLocaleString()}`);
  console.log(`  Matched by centroid: ${matchedByCentroid.toLocaleString()} (${((matchedByCentroid / electedDistricts.length) * 100).toFixed(1)}%)`);
  console.log(`  Matched by name: ${matchedByName.toLocaleString()} (${((matchedByName / electedDistricts.length) * 100).toFixed(1)}%)`);
  console.log(`  Unmatched: ${unmatched.toLocaleString()} (${((unmatched / electedDistricts.length) * 100).toFixed(1)}%)`);
  console.log(`\nOutput: ${outputPath}`);
  console.log('=============================================\n');
}

main().catch(console.error);
