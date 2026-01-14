/**
 * ArcGIS Hub Portal Scanner
 *
 * Searches ArcGIS Hub and ArcGIS Online for city council district boundaries.
 *
 * API Documentation:
 * - Hub Search: https://hub.arcgis.com/api/v3/datasets?filter[q]=<query>
 * - Portal Search: https://www.arcgis.com/sharing/rest/search
 *
 * Search Strategy:
 * 1. Query ArcGIS Hub API for "{city} council districts"
 * 2. Filter results by keywords (council, district, ward)
 * 3. Apply geographic filtering (bounding box + coordinate validation)
 * 4. Score candidates by title match quality (using SemanticLayerValidator)
 * 5. Return top candidates with download URLs
 *
 * Quality: ~50-70% success rate for US cities with open data portals (with geographic filtering)
 */

import { SemanticValidator } from '../../validators/semantic/validator.js';
import { getSearchNames } from '../../core/registry/city-name-aliases.js';
import { generateSearchQueries } from '../../core/utils/search-term-generator.js';

// STATE_BOUNDS imported from centralized geo-constants (eliminated duplicate)
import { STATE_BOUNDS } from '../../core/geo-constants.js';
// Canonical CityTarget imported from core/city-target.ts
import type { BaseCityTarget } from '../../core/city-target.js';
import { logger } from '../../core/utils/logger.js';

// CityTarget for ArcGIS Hub search (minimal version)
export type CityTarget = BaseCityTarget;

/**
 * ArcGIS Hub search result
 */
interface HubDataset {
  readonly id: string;
  readonly type: string;
  readonly attributes: {
    readonly name: string;
    readonly description?: string;
    readonly url?: string;
    readonly itemType?: string;
    readonly geometryType?: string;
    readonly recordCount?: number;
  };
}

// CANONICAL PORTAL TYPE IMPORT
import type { PortalType } from '../../core/types.js';

/**
 * Portal search candidate
 */
export interface PortalCandidate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly downloadUrl: string;
  readonly score: number;
  readonly portalType: PortalType;
  readonly featureCount?: number;
}

/**
 * ArcGIS Hub Scanner
 */
export class ArcGISHubScanner {
  private readonly HUB_API_BASE = 'https://hub.arcgis.com/api/v3';
  private readonly PORTAL_API_BASE = 'https://www.arcgis.com/sharing/rest';
  private readonly semanticValidator: SemanticValidator;

  constructor() {
    this.semanticValidator = new SemanticValidator();
  }

  /**
   * Search for council district datasets
   */
  async search(city: CityTarget): Promise<PortalCandidate[]> {
    const candidates: PortalCandidate[] = [];

    // Try Hub API first (cleaner, more reliable)
    try {
      const hubResults = await this.searchHub(city);
      candidates.push(...hubResults);
    } catch (error) {
      logger.warn('Hub search failed', {
        city: city.name,
        state: city.state,
        error: (error as Error).message
      });
    }

    // If Hub returns nothing, try Portal API (broader but noisier)
    if (candidates.length === 0) {
      try {
        const portalResults = await this.searchPortal(city);
        candidates.push(...portalResults);
      } catch (error) {
        logger.warn('Portal search failed', {
          city: city.name,
          state: city.state,
          error: (error as Error).message
        });
      }
    }

    // Apply geographic filtering to all candidates
    const geoFiltered = await this.filterByGeography(candidates, city);

    return this.rankCandidates(geoFiltered, city);
  }

  /**
   * Filter candidates by geographic validity (removes wrong-country matches)
   */
  private async filterByGeography(
    candidates: PortalCandidate[],
    city: CityTarget
  ): Promise<PortalCandidate[]> {
    const stateBounds = STATE_BOUNDS[city.state];
    if (!stateBounds) {
      // No bounds for this state, skip filtering
      return candidates;
    }

    const filtered: PortalCandidate[] = [];

    for (const candidate of candidates) {
      try {
        // Fetch a sample feature to validate coordinates
        const isValid = await this.validateGeography(candidate.downloadUrl, stateBounds);

        if (isValid) {
          filtered.push(candidate);
        } else {
          logger.debug('Filtered out candidate', {
            candidateTitle: candidate.title,
            city: city.name,
            state: city.state,
            reason: 'coordinates outside state bounds'
          });
        }
      } catch (error) {
        // If validation fails, be conservative and keep the candidate
        // (validation will catch issues later)
        filtered.push(candidate);
      }
    }

    return filtered;
  }

  /**
   * Validate that dataset coordinates fall within expected state bounds
   */
  private async validateGeography(
    downloadUrl: string,
    stateBounds: readonly [number, number, number, number]
  ): Promise<boolean> {
    try {
      // Fetch first feature to check coordinates
      const sampleUrl = downloadUrl.replace('where=1%3D1', 'where=1%3D1&resultRecordCount=1');
      const response = await fetch(sampleUrl);

      if (!response.ok) {
        return true; // Conservative: allow if we can't validate
      }

      const geojson = await response.json() as {
        type: string;
        features?: Array<{
          geometry?: {
            type: string;
            coordinates?: unknown;
          };
        }>;
      };

      if (!geojson.features || geojson.features.length === 0) {
        return true; // No features to validate
      }

      const feature = geojson.features[0];
      if (!feature.geometry || !feature.geometry.coordinates) {
        return true; // No geometry to validate
      }

      // Extract a sample coordinate from the geometry
      const coords = this.extractSampleCoordinate(feature.geometry.coordinates);
      if (!coords) {
        return true; // Can't extract coordinate
      }

      const [lon, lat] = coords;
      const [minLon, minLat, maxLon, maxLat] = stateBounds;

      // Check if coordinate is within state bounds (with 0.5 degree tolerance for border cities)
      const tolerance = 0.5;
      const isWithinBounds =
        lon >= minLon - tolerance &&
        lon <= maxLon + tolerance &&
        lat >= minLat - tolerance &&
        lat <= maxLat + tolerance;

      return isWithinBounds;
    } catch (error) {
      // Conservative: allow candidate if validation fails
      return true;
    }
  }

  /**
   * Extract a sample coordinate from GeoJSON geometry
   */
  private extractSampleCoordinate(coords: unknown): [number, number] | null {
    if (!Array.isArray(coords)) {
      return null;
    }

    // Handle different geometry types
    if (coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      // Point: [lon, lat]
      return [coords[0], coords[1]];
    }

    if (Array.isArray(coords[0])) {
      // Nested array (LineString, Polygon, MultiPolygon)
      return this.extractSampleCoordinate(coords[0]);
    }

    return null;
  }

  /**
   * Search ArcGIS Hub API with multi-pass search term variations
   */
  private async searchHub(city: CityTarget): Promise<PortalCandidate[]> {
    // Generate comprehensive search queries (name variations + terminology synonyms)
    const searchQueries = generateSearchQueries(city.name, city.state, 10);

    logger.info('Generated search query variations', {
      city: city.name,
      state: city.state,
      queryCount: searchQueries.length
    });

    const allCandidates: PortalCandidate[] = [];
    const seenDatasetIds = new Set<string>();

    for (const query of searchQueries) {
      logger.debug('Trying Hub API query', {
        city: city.name,
        state: city.state,
        query
      });

      try {
        // Use /datasets endpoint (not /search) for accurate dataset results
        const url = `${this.HUB_API_BASE}/datasets?q=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          logger.warn('Hub API query failed', {
            city: city.name,
            state: city.state,
            query,
            status: response.status
          });
          continue;
        }

        const data = await response.json() as { data: HubDataset[] };

        for (const dataset of data.data) {
          // Skip duplicates across queries
          if (seenDatasetIds.has(dataset.id)) {
            continue;
          }

          if (!this.isRelevantDataset(dataset, city)) {
            continue;
          }

          // Get service URL and polygon layer from Hub API
          const serviceInfo = await this.getServiceUrl(dataset.id);
          if (!serviceInfo) {
            continue;
          }

          seenDatasetIds.add(dataset.id);
          allCandidates.push({
            id: dataset.id,
            title: dataset.attributes.name,
            description: dataset.attributes.description || '',
            url: serviceInfo.url,
            downloadUrl: `${serviceInfo.url}/${serviceInfo.layerId}/query?where=1%3D1&outFields=*&f=geojson`,
            score: 0, // Will be scored in rankCandidates
            portalType: 'arcgis-hub',
            featureCount: dataset.attributes.recordCount,
          });
        }

        // If we found results, stop searching (first successful query wins)
        if (allCandidates.length > 0) {
          logger.info('Found Hub API candidates', {
            city: city.name,
            state: city.state,
            query,
            candidateCount: allCandidates.length
          });
          break;
        }
      } catch (error) {
        logger.warn('Hub API query error', {
          city: city.name,
          state: city.state,
          query,
          error: (error as Error).message
        });
      }
    }

    if (allCandidates.length === 0) {
      logger.info('No Hub API results found', {
        city: city.name,
        state: city.state,
        queriesAttempted: searchQueries.length
      });
    }

    return allCandidates;
  }

  /**
   * Get Feature Service URL from Hub dataset and validate geometry type
   */
  private async getServiceUrl(datasetId: string): Promise<{ url: string; layerId: number } | null> {
    try {
      const url = `${this.HUB_API_BASE}/datasets/${datasetId}`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        data: {
          attributes: {
            url?: string;
            serviceUrl?: string;
          };
        };
      };

      // Try multiple possible URL fields
      const serviceUrl = data.data.attributes.serviceUrl || data.data.attributes.url;
      if (!serviceUrl) {
        return null;
      }

      // Query FeatureServer metadata to find polygon layers
      const layerId = await this.findPolygonLayer(serviceUrl);
      if (layerId === null) {
        return null;
      }

      return { url: serviceUrl, layerId };
    } catch (error) {
      return null;
    }
  }

  /**
   * Find first layer with polygon geometry in FeatureServer
   */
  private async findPolygonLayer(serviceUrl: string): Promise<number | null> {
    try {
      const metadataUrl = `${serviceUrl}?f=json`;
      const response = await fetch(metadataUrl);

      if (!response.ok) {
        return null;
      }

      const metadata = await response.json() as {
        layers?: Array<{
          id: number;
          name: string;
          geometryType?: string;
        }>;
      };

      // Find first layer with polygon geometry
      const polygonLayer = metadata.layers?.find(layer =>
        layer.geometryType === 'esriGeometryPolygon' ||
        layer.geometryType === 'esriGeometryMultiPolygon'
      );

      return polygonLayer?.id ?? null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Search ArcGIS Portal API (fallback)
   */
  private async searchPortal(city: CityTarget): Promise<PortalCandidate[]> {
    // Keep query broad (don't filter by state in search - we'll filter in scoring)
    // This maximizes recall, we'll handle precision with scoring/validation
    const query = `${city.name} council district OR ward`;
    const url = `${this.PORTAL_API_BASE}/search?q=${encodeURIComponent(query)}&f=json&num=20`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Portal API returned ${response.status}`);
    }

    const data = await response.json() as {
      results: Array<{
        id: string;
        title: string;
        description: string;
        url: string;
        type: string;
        numViews?: number;
      }>;
    };

    // Filter to Feature Services only
    const featureServices = data.results.filter(
      item => item.type === 'Feature Service' || item.type === 'Feature Layer'
    );

    // Check each service for polygon layers
    const candidates: PortalCandidate[] = [];

    for (const item of featureServices) {
      // Find polygon layer in service
      const layerId = await this.findPolygonLayer(item.url);
      if (layerId === null) {
        continue;
      }

      candidates.push({
        id: item.id,
        title: item.title,
        description: item.description || '',
        url: item.url,
        downloadUrl: `${item.url}/${layerId}/query?where=1%3D1&outFields=*&f=geojson`,
        score: this.scoreTitle(item.title, city),
        portalType: 'arcgis-online' as const,
      });
    }

    return candidates;
  }

  /**
   * Filter relevant datasets (avoid noise)
   *
   * Uses semantic validator to check for negative keywords and basic relevance.
   * This pre-filters before geographic validation (performance optimization).
   */
  private isRelevantDataset(dataset: HubDataset, _city: CityTarget): boolean {
    const title = dataset.attributes.name;

    // Use semantic validator for comprehensive filtering
    const result = this.semanticValidator.scoreTitle(title);

    // Accept if score is above minimal threshold (≥20)
    // Note: Geographic validation and final scoring happens later
    return result.score >= 20;
  }

  /**
   * Extract Feature Service URL from various ArcGIS URL formats
   */
  private extractServiceUrl(url: string): string | null {
    // Clean up URL
    url = url.trim();

    // Already a FeatureServer/MapServer URL
    if (url.includes('FeatureServer') || url.includes('MapServer')) {
      // Remove layer number if present (e.g., /FeatureServer/0 -> /FeatureServer/0)
      // Keep it for the query
      return url;
    }

    // Extract from ArcGIS REST URL patterns
    const patterns = [
      /arcgis\/rest\/services\/([^/]+\/[^/]+)\/(FeatureServer|MapServer)\/\d+/,
      /arcgis\/rest\/services\/([^/]+)\/(FeatureServer|MapServer)\/\d+/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return url;
      }
    }

    return null;
  }

  /**
   * Score title for relevance using comprehensive semantic validation
   *
   * Delegates to SemanticLayerValidator which includes:
   * - Negative keyword filtering (precincts, canopy, voting, etc.)
   * - Positive pattern matching (council district, ward, etc.)
   * - False positive penalties (school, fire, congressional, etc.)
   *
   * This prevents false positives like:
   * - Wichita, KS: 234 voting precincts (wrong granularity)
   * - Anaheim, CA: Tree canopy cover (wrong domain)
   */
  private scoreTitle(title: string, _city: CityTarget): number {
    const result = this.semanticValidator.scoreTitle(title);

    // Log rejections for debugging
    if (result.score === 0 && result.reasons.length > 0) {
      logger.debug('Layer rejected by semantic validator', {
        title,
        reasons: result.reasons
      });
    }

    return result.score;
  }

  /**
   * Rank candidates by score and filter by threshold
   *
   * Uses SemanticLayerValidator scoring (name-only, 0-40 scale):
   * - 0: Rejected (negative keywords like "precinct", "canopy", or false positive penalties)
   * - 20: Low confidence (generic "district" or "council" mention)
   * - 30: Medium confidence (e.g., "ward boundaries")
   * - 40: High confidence (e.g., "city council districts", "municipal district")
   *
   * Note: Threshold is 30+ (medium confidence or higher).
   * Full semantic scoring (with geometry/fields/count) would reach 100, but
   * ArcGIS scanner only has title metadata at discovery time.
   */
  private rankCandidates(candidates: PortalCandidate[], city: CityTarget): PortalCandidate[] {
    // Score all candidates
    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.scoreTitle(candidate.title, city),
    }));

    // Filter out rejected and low-confidence candidates (score < 30)
    // Accept: medium (30) and high (40) confidence patterns
    const filtered = scored.filter(c => c.score >= 30);

    // Sort by score descending
    return filtered.sort((a, b) => b.score - a.score);
  }
}
