/**
 * BubbleService — Geometry query for the Postal Bubble identity object.
 *
 * Given a center point + radius, returns all district fences and clipped
 * district polygons within the bubble extent. The client uses these to
 * determine resolution state (which districts are inside the bubble).
 *
 * All processing is local: R-tree spatial queries on SQLite, no external calls.
 * Postal code geocoding delegates to GeocodeService (Nominatim).
 */

import Database from 'better-sqlite3';
import { circle } from '@turf/circle';
import { intersect } from '@turf/intersect';
import { simplify } from '@turf/simplify';
import { lineString, polygon as turfPolygon, multiPolygon as turfMultiPolygon, featureCollection } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { GeoJSONPolygon } from './types.js';
import type { GeocodeService } from './geocode-service.js';
import type { OfficialsService } from './officials-service.js';
import { FIPS_TO_STATE } from '../db/fips-codes.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface BubbleQueryRequest {
  center: { lat: number; lng: number };
  radius: number;        // meters
  postal_code?: string;
  layers?: string[];
}

export interface FenceResult {
  id: string;
  layer: string;
  geometry: { type: 'LineString'; coordinates: number[][] };
  sides: [{ districtId: string; name: string }, { districtId: string; name: string }];
  landmark?: string;
  landmarkSource?: string;
}

export interface ClippedDistrict {
  id: string;
  name: string;
  display: string;
  layer: string;
  clipGeometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

export interface PostalExtent {
  centroid: { lat: number; lng: number };
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  radius: number;
  country: string;
}

export interface BubbleQueryResponse {
  center: { lat: number; lng: number };
  queryBbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  postalExtent?: PostalExtent;
  fences: FenceResult[];
  districts: ClippedDistrict[];
  officials?: Array<{ name: string; title: string; party: string; districtId: string }>;
  /** R33-M4: Indicates results were truncated to MAX_RESULTS cap */
  truncated?: boolean;
}

// ============================================================================
// Service
// ============================================================================

/** Buffer multiplier: query 20% larger than bubble to include fences at the edge */
const BBOX_BUFFER = 1.2;

/** Max vertices per fence after simplification */
const MAX_FENCE_VERTICES = 30;

/** Simplification tolerance in degrees (roughly ~100m at mid-latitudes) */
const SIMPLIFY_TOLERANCE = 0.001;

export class BubbleService {
  private readonly db: Database.Database;
  private readonly geocodeService: GeocodeService | null;
  private readonly officialsService: OfficialsService | null;

  // Prepared statements (lazy-init)
  private stmtFencesByBbox!: Database.Statement;
  private stmtDistrictsByBbox!: Database.Statement;

  constructor(
    dbPath: string,
    geocodeService: GeocodeService | null = null,
    officialsService: OfficialsService | null = null,
  ) {
    this.db = new Database(dbPath, { readonly: true });
    this.geocodeService = geocodeService;
    this.officialsService = officialsService;
    this.initStatements();
  }

  private initStatements(): void {
    // Fence query: R-tree spatial filter on fence bounding boxes
    // Returns fences whose bbox overlaps the query bbox
    this.stmtFencesByBbox = this.db.prepare(`
      SELECT f.*
      FROM fences f
      JOIN fence_rtree fr ON f.rowid = fr.id
      WHERE fr.max_lon >= ? AND fr.min_lon <= ?
        AND fr.max_lat >= ? AND fr.min_lat <= ?
    `);

    // District query: R-tree spatial filter on district bounding boxes
    this.stmtDistrictsByBbox = this.db.prepare(`
      SELECT d.id, d.name, d.jurisdiction, d.district_type, d.geometry
      FROM districts d
      JOIN rtree_index r ON d.rowid = r.id
      WHERE r.max_lon >= ? AND r.min_lon <= ?
        AND r.max_lat >= ? AND r.min_lat <= ?
    `);
  }

  /**
   * Execute a bubble query: return fences + clipped districts within the extent.
   */
  async query(req: BubbleQueryRequest): Promise<BubbleQueryResponse> {
    const start = performance.now();
    const { center, radius } = req;

    // Compute buffered bounding box (20% larger)
    const bufferedRadius = radius * BBOX_BUFFER;
    const bbox = this.radiusToBbox(center.lat, center.lng, bufferedRadius);

    // 1. Query fences within bbox
    const rawFences = this.stmtFencesByBbox.all(
      bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat,
    ) as FenceRow[];

    const fences: FenceResult[] = rawFences
      .filter(f => !req.layers || req.layers.includes(f.layer))
      .map(f => this.toFenceResult(f));

    // 2. Query districts within bbox
    const rawDistricts = this.stmtDistrictsByBbox.all(
      bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat,
    ) as DistrictRow[];

    // R35-F3: Apply layer filter BEFORE truncation so requested layers aren't silently dropped
    const layerFiltered = req.layers
      ? rawDistricts.filter(d => req.layers!.includes(this.extractLayer(d.id)))
      : rawDistricts;

    // Cap results to prevent unbounded Turf.js intersection work
    const MAX_RESULTS = 500;
    let truncated = false;
    if (layerFiltered.length > MAX_RESULTS) {
      logger.warn('bubble-query result cap exceeded, truncating', {
        lat: center.lat, lng: center.lng, radius,
        rawCount: layerFiltered.length, cap: MAX_RESULTS,
      });
      layerFiltered.length = MAX_RESULTS;
      truncated = true;
    }

    const bubbleCircle = circle([center.lng, center.lat], bufferedRadius / 1000, {
      steps: 32, units: 'kilometers',
    });

    const districts: ClippedDistrict[] = layerFiltered
      .map(d => this.toClippedDistrict(d, bubbleCircle))
      .filter((d): d is ClippedDistrict => d !== null);

    // 3. Postal extent (if postal_code provided)
    let postalExtent: PostalExtent | undefined;
    if (req.postal_code && this.geocodeService) {
      postalExtent = await this.geocodePostal(req.postal_code);
    }

    // 4. Officials at center (best guess)
    let officials: BubbleQueryResponse['officials'];
    if (this.officialsService) {
      officials = this.lookupOfficials(center.lat, center.lng, rawDistricts);
    }

    const elapsed = performance.now() - start;
    logger.debug('bubble-query', {
      lat: center.lat, lng: center.lng, radius,
      fenceCount: fences.length, districtCount: districts.length,
      elapsedMs: Math.round(elapsed * 100) / 100,
    });

    return {
      center,
      queryBbox: bbox,
      postalExtent,
      fences,
      districts,
      officials,
      ...(truncated ? { truncated } : {}),
    };
  }

  // ── Geometry helpers ─────────────────────────────────────────────────

  /**
   * Convert radius in meters to WGS84 bounding box.
   * Approximate: uses latitude-dependent longitude scaling.
   */
  private radiusToBbox(lat: number, lng: number, radiusM: number): {
    minLat: number; maxLat: number; minLng: number; maxLng: number;
  } {
    const latDelta = radiusM / 111_320; // 1° lat ≈ 111.32 km
    // R11-M2: Clamp cos(lat) to prevent near-infinite bbox at poles.
    // Math.cos(90° * π/180) ≈ 6e-17, producing lngDelta ≈ 7e12 degrees.
    const cosLat = Math.max(Math.cos(lat * Math.PI / 180), 0.01);
    const lngDelta = radiusM / (111_320 * cosLat);
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta,
    };
  }

  /** Extract layer prefix from district ID (e.g., "cd" from "cd-0612") */
  private extractLayer(districtId: string): string {
    const dash = districtId.indexOf('-');
    return dash > 0 ? districtId.substring(0, dash) : districtId;
  }

  /** Convert DB fence row to API response shape, simplifying geometry */
  private toFenceResult(row: FenceRow): FenceResult {
    let geometry: { type: 'LineString'; coordinates: number[][] };
    try {
      const parsed = JSON.parse(row.geometry);
      const line = lineString(parsed.coordinates);
      const simplified = simplify(line, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });

      // Cap vertex count
      let coords = simplified.geometry.coordinates;
      if (coords.length > MAX_FENCE_VERTICES) {
        const step = Math.ceil(coords.length / MAX_FENCE_VERTICES);
        coords = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
      }

      geometry = { type: 'LineString', coordinates: coords };
    } catch {
      geometry = { type: 'LineString', coordinates: [] };
    }

    return {
      id: row.id,
      layer: row.layer,
      geometry,
      sides: [
        { districtId: row.district_a_id, name: row.district_a_name },
        { districtId: row.district_b_id, name: row.district_b_name },
      ],
      landmark: row.landmark ?? undefined,
      landmarkSource: row.landmark_source ?? undefined,
    };
  }

  /** Clip district polygon to bubble circle and simplify */
  private toClippedDistrict(
    row: DistrictRow,
    bubbleCircle: Feature<Polygon>,
  ): ClippedDistrict | null {
    try {
      const geom = JSON.parse(row.geometry) as GeoJSONPolygon;
      const districtFeature = geom.type === 'MultiPolygon'
        ? turfMultiPolygon(geom.coordinates as number[][][][])
        : turfPolygon(geom.coordinates as number[][][]);

      const clipped = intersect(
        featureCollection([districtFeature as Feature<Polygon | MultiPolygon>, bubbleCircle]),
      );
      if (!clipped) return null;

      // Simplify
      const simplified = simplify(clipped, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });

      return {
        id: row.id,
        name: row.name,
        display: row.name,
        layer: this.extractLayer(row.id),
        clipGeometry: simplified.geometry as ClippedDistrict['clipGeometry'],
      };
    } catch (err) {
      logger.warn('bubble-service: failed to clip district', { id: row.id, err });
      return null;
    }
  }

  /** Geocode a postal code to an extent */
  private async geocodePostal(postalCode: string): Promise<PostalExtent | undefined> {
    if (!this.geocodeService) return undefined;

    try {
      // Use Nominatim search with postalcode param
      const result = await this.geocodeService.geocode({
        street: '',
        city: '',
        state: '',
        zip: postalCode,
      });

      if (!result) return undefined;

      // Approximate postal extent as a 2km circle
      const postalRadius = 2000;
      const bbox = this.radiusToBbox(result.lat, result.lng, postalRadius);

      return {
        centroid: { lat: result.lat, lng: result.lng },
        bbox,
        radius: postalRadius,
        country: result.country,
      };
    } catch (err) {
      logger.warn('bubble-service: postal geocode failed', { postalCode, err });
      return undefined;
    }
  }

  /** Look up officials at the bubble center point */
  private lookupOfficials(
    _lat: number,
    _lng: number,
    districts: DistrictRow[],
  ): BubbleQueryResponse['officials'] {
    if (!this.officialsService) return undefined;

    const officials: NonNullable<BubbleQueryResponse['officials']> = [];

    for (const d of districts) {
      const layer = this.extractLayer(d.id);

      if (layer === 'cd') {
        // District ID format: "cd-SSDD" where SS = state FIPS, DD = district
        const geoid = d.id.slice(3); // strip "cd-" → "0612"
        if (geoid.length < 4) continue;
        const stateFips = geoid.slice(0, 2);
        const districtNum = geoid.slice(2);
        const stateCode = FIPS_TO_STATE[stateFips];
        if (!stateCode) continue;

        // Census "98" = at-large/delegate
        const district = districtNum === '98' ? '00' : districtNum;
        const { result } = this.officialsService.getOfficials(stateCode, district);
        if (result?.house) {
          officials.push({
            name: result.house.name,
            title: result.house.is_voting ? 'U.S. Representative' : 'Delegate',
            party: result.house.party.charAt(0),
            districtId: d.id,
          });
        }
        for (const s of result?.senate ?? []) {
          officials.push({
            name: s.name,
            title: 'U.S. Senator',
            party: s.party.charAt(0),
            districtId: d.id,
          });
        }
      } else if (layer === 'can') {
        // Canadian riding: "can-fed-XXXXX" → riding code "XXXXX"
        const ridingCode = d.id.replace('can-fed-', '');
        const { result } = this.officialsService.getCanadianMP(ridingCode);
        if (result?.mp) {
          officials.push({
            name: result.mp.name,
            title: 'Member of Parliament',
            party: result.mp.party,
            districtId: d.id,
          });
        }
      }
    }

    return officials.length > 0 ? officials : undefined;
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// DB Row Types (internal)
// ============================================================================

interface FenceRow {
  id: string;
  layer: string;
  district_a_id: string;
  district_b_id: string;
  district_a_name: string;
  district_b_name: string;
  geometry: string;
  landmark: string | null;
  landmark_source: string | null;
  min_lon: number;
  max_lon: number;
  min_lat: number;
  max_lat: number;
}

interface DistrictRow {
  id: string;
  name: string;
  jurisdiction: string;
  district_type: string;
  geometry: string;
}
