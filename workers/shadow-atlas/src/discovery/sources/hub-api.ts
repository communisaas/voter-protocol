/**
 * Hub API Source - Adapter for existing Hub API discovery logic
 *
 * Design Pattern: Adapter Pattern
 *
 * What this does: Wraps existing searchHubWithTerminologyFallback logic
 * in clean BoundaryDataSource interface for orchestrator use.
 *
 * Why an adapter: We have working Hub API code with 96.2% coverage.
 * Don't rewrite working code. Wrap it in clean interface instead.
 */

import type { BoundaryDataSource, BoundaryRequest, SourceResult } from './types';
import type GeoJSON from 'geojson';
import {
  searchHubWithTerminologyFallback,
  searchHubForBoundaryType,
  type DiscoveryResult
} from '../hub-api-discovery';
import type { BoundaryType } from '../hub-api-discovery';
import { queryFeatureLayer } from './formats';

/**
 * Hub API Source - ArcGIS Hub API discovery
 *
 * Advantages:
 * - Fast (API is responsive)
 * - Good metadata (publisher, modification dates)
 * - 150+ terminology variants (handles edge cases)
 * - Boundary-type-aware scoring
 * - Zero cost (free public API)
 *
 * Limitations:
 * - Not authoritative (third-party datasets)
 * - Variable quality (user-uploaded data)
 * - Coverage gaps (96.2%, missing 13 chambers)
 *
 * Use case: Try Hub first for speed. Fall back to TIGER if it fails.
 */
export class HubAPISource implements BoundaryDataSource {
  readonly id = 'arcgis_hub' as const;
  readonly name = 'ArcGIS Hub API';
  private readonly overlapCache = new Map<string, Promise<string[]>>();

  /**
   * Fetch boundary data from ArcGIS Hub
   *
   * Maps orchestrator request → Hub API call → standardized result
   */
  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    // Hub API requires entity name for municipal/county queries
    const entityName = request.location.name || '';

    // For state-level queries (congressional, state legislative),
    // use state code as entity name
    const searchEntity = this.requiresStateLevelSearch(request.boundaryType)
      ? request.location.state
      : entityName;

    // Call existing Hub API logic with terminology fallback
    // Use quiet mode for better test performance
    const hubResult = await searchHubWithTerminologyFallback(
      searchEntity,
      request.location.state,
      request.boundaryType as BoundaryType,
      { quiet: process.env.NODE_ENV === 'test' }
    );

    if (!hubResult) {
      return null; // Hub API found nothing
    }

    // Convert Hub API result to standardized SourceResult
    return this.convertToSourceResult(hubResult, request.boundaryType, searchEntity, request.location.state);
  }

  /**
   * Check if boundary type requires state-level search
   */
  private requiresStateLevelSearch(boundaryType: BoundaryRequest['boundaryType']): boolean {
    return [
      'CONGRESSIONAL',
      'STATE_HOUSE',
      'STATE_SENATE'
    ].includes(boundaryType);
  }

  /**
   * Convert Hub API DiscoveryResult to standardized SourceResult
   *
   * Pattern: Adapter mapping between legacy format and new interface
   */
  private async convertToSourceResult(
    hubResult: DiscoveryResult,
    boundaryType: BoundaryRequest['boundaryType'],
    entityName: string,
    state: string
  ): Promise<SourceResult> {
    // Hub API returns FeatureServer URL, need to fetch actual geometry
    const geometry = await this.fetchGeometryFromURL(hubResult.url);

    // Build base notes
    const baseNotes = hubResult.metadata.terminologyUsed
      ? `Found using terminology: "${hubResult.metadata.terminologyUsed}"`
      : '';

    // Add quality warnings for special districts
    const warnings = this.generateQualityWarnings(hubResult, boundaryType);
    const overlaps = boundaryType === 'special_district'
      ? await this.detectOverlappingDistricts(entityName, state)
      : [];
    const notes = warnings.length > 0
      ? `${baseNotes}${baseNotes ? '. ' : ''}${warnings.join('. ')}`
      : baseNotes || undefined;

    return {
      geometry: geometry,
      score: hubResult.score,
      metadata: {
        source: 'ArcGIS Hub API',
        publisher: hubResult.metadata.name, // Dataset name as publisher
        publishedDate: hubResult.metadata.modified
          ? new Date(hubResult.metadata.modified)
          : undefined,
        lastModified: hubResult.metadata.modified
          ? new Date(hubResult.metadata.modified)
          : undefined,
        notes
      },
      overlappingDistricts: overlaps.length > 0 ? overlaps : undefined,
      dataQuality: boundaryType === 'special_district'
        ? (hubResult.score >= 60 ? 'medium' : hubResult.score >= 40 ? 'low' : 'low')
        : undefined
    };
  }

  /**
   * Generate quality warnings for boundary results
   *
   * Special districts have variable data quality due to:
   * - 35,000+ districts nationwide with no federal standard
   * - 1,000+ managing agencies with different update frequencies
   * - High turnover and fragmented data sources
   *
   * This provides transparency about data quality expectations.
   */
  private generateQualityWarnings(
    hubResult: DiscoveryResult,
    boundaryType: BoundaryRequest['boundaryType']
  ): string[] {
    const warnings: string[] = [];

    // Only generate warnings for boundary types with known data quality issues
    const boundaryTypesWithWarnings = ['special_district', 'judicial'];
    if (!boundaryTypesWithWarnings.includes(boundaryType)) {
      return warnings;
    }

    // Warning 1: Score below standard threshold
    if (hubResult.score < 50) {
      warnings.push('Data quality below standard threshold (35K+ districts, no federal standard)');
    } else if (hubResult.score < 60) {
      warnings.push('Data quality acceptable but below typical threshold');
    }

    // Warning 2: Data freshness (if modified date available)
    if (hubResult.metadata.modified) {
      const lastModified = new Date(hubResult.metadata.modified);
      const now = new Date();
      const daysSinceUpdate = Math.floor(
        (now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceUpdate > 730) {
        // More than 2 years old
        const yearsSinceUpdate = Math.floor(daysSinceUpdate / 365);
        warnings.push(`Data not updated in ${yearsSinceUpdate} year${yearsSinceUpdate > 1 ? 's' : ''}`);
      } else if (daysSinceUpdate > 365) {
        // More than 1 year old
        warnings.push('Data over 1 year old');
      }
    }

    // Warning 3: Special district-specific note
    if (boundaryType === 'special_district') {
      warnings.push('Verify with local authorities before using for critical decisions');
    }

    return warnings;
  }

  private detectOverlappingDistricts(
    entityName: string,
    state: string
  ): Promise<string[]> {
    const cacheKey = `${entityName}:${state}`;
    const cached = this.overlapCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request = (async () => {
      const overlapDefinitions: Array<{ terminology: string; label: string }> = [
        { terminology: 'water district', label: 'water' },
        { terminology: 'fire protection district', label: 'fire' },
        { terminology: 'transit district', label: 'transit' },
        { terminology: 'utility district', label: 'utility' }
      ];

      const overlaps = new Set<string>();
      for (const { terminology, label } of overlapDefinitions) {
        try {
          const result = await searchHubForBoundaryType(entityName, state, terminology, 'special_district');
          if (result) {
            overlaps.add(label);
          }
        } catch {
          continue;
        }
      }
      return Array.from(overlaps);
    })();

    this.overlapCache.set(cacheKey, request);
    return request;
  }

  /**
   * Fetch GeoJSON geometry from FeatureServer URL
   *
   * Hub API returns FeatureServer URL. We need to:
   * 1. Query the FeatureServer for features
   * 2. Convert to GeoJSON Feature
   *
   * CRITICAL: This must handle multi-feature responses (state-level queries
   * return all districts, not just one)
   */
  private async fetchGeometryFromURL(url: string): Promise<GeoJSON.Feature> {
    try {
      const features = await queryFeatureLayer({ url, cache: true });
      if (features.length === 0) {
        throw new Error('FeatureServer returned no features');
      }

      if (features.length === 1) {
        return features[0];
      }

      const geometries = features
        .map(feature => feature.geometry)
        .filter((geometry): geometry is GeoJSON.Geometry => Boolean(geometry));

      if (geometries.length === 0) {
        return features[0];
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'GeometryCollection',
          geometries
        },
        properties: {
          source: 'ArcGIS FeatureServer',
          url,
          note: `Returned ${features.length} features; verify selection.`
        }
      };
    } catch (error) {
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[]]
        },
        properties: {
          error: `Failed to fetch geometry from FeatureServer: ${error instanceof Error ? error.message : String(error)}`,
          url: url
        }
      };
    }
  }
}

/**
 * Create Hub API source factory
 *
 * Used by orchestrator for lazy source construction
 */
export function createHubAPISource(): BoundaryDataSource {
  return new HubAPISource();
}
