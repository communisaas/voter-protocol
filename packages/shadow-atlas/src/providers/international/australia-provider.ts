/**
 * Australia Electoral Boundaries Provider
 *
 * Fetches boundary data from Australian Electoral Commission (AEC).
 *
 * DATA SOURCE:
 * - Organization: Australian Electoral Commission (AEC)
 * - API Type: ArcGIS REST (FeatureServer)
 * - Format: GeoJSON via f=geojson parameter
 * - License: Creative Commons Attribution 4.0 (CC-BY-4.0)
 *
 * COVERAGE:
 * - Federal Electoral Divisions: 151 (as of 2021 redistribution)
 * - Covers: All states and territories
 *
 * USAGE:
 * ```typescript
 * const provider = new AustraliaBoundaryProvider();
 *
 * // Extract all federal electoral divisions
 * const result = await provider.extractFederalDivisions();
 * console.log(`Extracted ${result.actualCount}/${result.expectedCount} divisions`);
 *
 * // Extract by state
 * const nsw = await provider.extractByState('NSW');
 *
 * // Health check
 * const health = await provider.healthCheck();
 * ```
 *
 * API ENDPOINT:
 * https://services.arcgis.com/dHnJfFOAL8X99WD7/arcgis/rest/services/Federal_Electoral_Divisions_2021/FeatureServer/0
 *
 * NOTES:
 * - 2021 redistribution implemented after 2021 census
 * - Federal boundaries updated every ~7-10 years following census
 * - Next scheduled redistribution: Post-2026 census
 * - State/territory boundaries available but not yet implemented
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  BaseInternationalProvider,
  type InternationalExtractionResult,
  type LayerConfig,
  type LayerExtractionResult,
  type InternationalBoundary,
  type BoundarySource,
  type ProviderHealth,
} from './base-provider.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Australia-Specific Types
// ============================================================================

/**
 * Australia layer types
 */
export type AustraliaLayerType = 'federal';

/**
 * Australia state/territory codes (ISO 3166-2:AU)
 */
export type AustraliaState =
  | 'NSW' // New South Wales
  | 'VIC' // Victoria
  | 'QLD' // Queensland
  | 'SA'  // South Australia
  | 'WA'  // Western Australia
  | 'TAS' // Tasmania
  | 'NT'  // Northern Territory
  | 'ACT'; // Australian Capital Territory

/**
 * Australia federal electoral division
 */
export interface AustraliaDivision extends InternationalBoundary {
  /** Electoral division code (e.g., 'NSW01' for first NSW division) */
  readonly id: string;

  /** Division name (e.g., 'Banks', 'Barton', 'Bradfield') */
  readonly name: string;

  /** Boundary type (always 'federal') */
  readonly type: 'federal';

  /** State/territory code */
  readonly state: AustraliaState;

  /** Population (from latest census) */
  readonly population?: number;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: BoundarySource & {
    readonly country: 'AU';
  };

  /** Original properties from AEC */
  readonly properties: Record<string, unknown>;
}

/**
 * Australia extraction result
 */
export interface AustraliaExtractionResult extends LayerExtractionResult<AustraliaLayerType, AustraliaDivision> {
  readonly layer: 'federal';
}

// ============================================================================
// Australia Boundary Provider
// ============================================================================

/**
 * Australia Electoral Boundaries Provider
 */
export class AustraliaBoundaryProvider extends BaseInternationalProvider<
  AustraliaLayerType,
  AustraliaDivision
> {
  readonly country = 'AU';
  readonly countryName = 'Australia';
  readonly dataSource = 'AEC (Australian Electoral Commission)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'CC-BY-4.0';

  private readonly baseUrl =
    'https://geo.abs.gov.au/arcgis/rest/services';

  /**
   * Available boundary layers
   *
   * Uses ABS (Australian Bureau of Statistics) CED layer which includes state codes.
   * The aus_digitalatlas 2025 endpoint lacks state fields.
   * ABS 2024 has 169 records but includes "No usual address" and "Outside Australia"
   * entries — these are filtered out during normalization (codes >= 900).
   */
  readonly layers = new Map<AustraliaLayerType, LayerConfig<AustraliaLayerType>>([
    [
      'federal',
      {
        type: 'federal',
        name: 'CED (2024) ASGS Ed. 3',
        endpoint: `${this.baseUrl}/ASGS2024/CED/FeatureServer/0`,
        expectedCount: 150,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2024,
        lastVerified: '2026-03-10',
        notes: 'ABS ASGS Ed. 3 — includes state codes; filter codes >= 900',
      },
    ],
  ]);

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<AustraliaLayerType, AustraliaDivision>> {
    const startTime = Date.now();
    const federal = await this.extractFederalDivisions();

    return {
      country: this.country,
      layers: [federal],
      totalBoundaries: federal.actualCount,
      successfulLayers: federal.success ? 1 : 0,
      failedLayers: federal.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '1.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract a specific layer
   */
  async extractLayer(layerType: AustraliaLayerType): Promise<AustraliaExtractionResult> {
    if (layerType === 'federal') {
      return this.extractFederalDivisions();
    }

    throw new Error(`Unknown layer type: ${layerType}`);
  }

  /**
   * Extract federal electoral divisions
   */
  async extractFederalDivisions(): Promise<AustraliaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal');
    if (!layer) {
      throw new Error('Federal layer not configured');
    }

    try {
      logger.info('Extracting federal electoral divisions', { country: 'Australia' });
      // ABS endpoint supports up to 2000 records per query (169 total CED entries).
      // Use paginated fetch with geometry simplification for reliability.
      const geojson = await this.fetchGeoJSONPaginated(
        `${layer.endpoint}/query?where=1%3D1&outFields=*&f=geojson`,
        200, 169, 0.0001
      );
      const divisions = this.normalizeDivisions(geojson, layer);
      const durationMs = Date.now() - startTime;

      const confidence = this.calculateConfidence(
        divisions.length,
        layer.expectedCount,
        layer.vintage,
        layer.authority
      );

      logger.info('Federal extraction complete', {
        country: 'Australia',
        divisionCount: divisions.length,
        expectedCount: layer.expectedCount,
        durationMs,
        confidence
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: divisions,
        expectedCount: layer.expectedCount,
        actualCount: divisions.length,
        matched: divisions.length === layer.expectedCount,
        confidence,
        extractedAt: new Date(),
        source: layer.endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Federal extraction failed', { country: 'Australia', error: message });

      return this.createFailedResult('federal', message, layer.expectedCount, layer.endpoint, startTime);
    }
  }

  /**
   * Extract divisions for a specific state/territory
   *
   * @param stateCode - State/territory code (ISO 3166-2:AU)
   * @returns Divisions for the specified state
   */
  async extractByState(stateCode: AustraliaState): Promise<AustraliaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal');
    if (!layer) {
      throw new Error('Federal layer not configured');
    }

    try {
      logger.info('Extracting federal divisions by state', { country: 'Australia', state: stateCode });
      const allDivisions = await this.extractFederalDivisions();
      const stateDivisions = allDivisions.boundaries.filter((d) => d.state === stateCode);
      const durationMs = Date.now() - startTime;

      logger.info('State extraction complete', {
        country: 'Australia',
        state: stateCode,
        divisionCount: stateDivisions.length,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: stateDivisions,
        expectedCount: stateDivisions.length, // No fixed expectation per state
        actualCount: stateDivisions.length,
        matched: true,
        confidence: 100,
        extractedAt: new Date(),
        source: layer.endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('State extraction failed', { country: 'Australia', state: stateCode, error: message });

      return this.createFailedResult('federal', message, 0, layer.endpoint, startTime);
    }
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const layer = this.layers.get('federal');
      if (!layer) {
        issues.push('Federal layer not configured');
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      // Check ArcGIS service metadata
      const metadataUrl = `${layer.endpoint}?f=json`;
      const response = await fetch(metadataUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        issues.push(`HTTP ${response.status}: ${response.statusText}`);
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      const metadata = (await response.json()) as {
        count?: number;
        name?: string;
      };
      const latencyMs = Date.now() - startTime;

      // Check feature count
      if (metadata.count === 0) {
        issues.push('Service reports zero features');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to connect: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Normalize GeoJSON features to AustraliaDivision format
   */
  private normalizeDivisions(geojson: FeatureCollection, layer: LayerConfig): AustraliaDivision[] {
    return geojson.features
      .filter((f) => {
        // Must have valid polygon geometry
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
          return false;
        }
        // Filter out non-electoral entries from ABS dataset
        // Codes >= 900 are "No usual address", "Migratory", "Outside Australia"
        const props = f.properties ?? {};
        const code = Number(props.CED_CODE_2024 ?? props.ced_code_2021 ?? props.e_div_numb ?? 0);
        const name = String(props.CED_NAME_2024 ?? props.ced_name_2021 ?? props.elect_div ?? '');
        if (code >= 900 || name.includes('No usual address') || name.includes('Outside Australia') || name.includes('Migratory')) {
          return false;
        }
        return true;
      })
      .map((f) => {
        const props = f.properties ?? {};

        // Extract division code and name
        // ABS 2024: CED_CODE_2024, CED_NAME_2024, STATE_CODE_2021, STATE_NAME_2021
        // ABS 2021: ced_code_2021, ced_name_2021
        // aus_digitalatlas 2025: elect_div (name), e_div_numb (number)
        // Legacy: DIV_CODE, DIV_NAME, ELECT_DIV
        const divisionCode = String(
          props.CED_CODE_2024 ?? props.ced_code_2021 ?? props.e_div_numb ?? props.DIV_CODE ?? props.DIV_ID ?? props.ELECT_DIV ?? props.code ?? ''
        );
        const name = String(
          props.CED_NAME_2024 ?? props.ced_name_2021 ?? props.elect_div ?? props.sortname ?? props.DIV_NAME ?? props.ELECT_DIV_NAME ?? props.name ?? 'Unknown Division'
        );

        // Extract state code from division code or properties
        const stateCode = this.extractStateCode(divisionCode, props);

        // Extract population if available
        const population = typeof props.POPULATION === 'number' ? props.POPULATION : undefined;

        return {
          id: divisionCode,
          name,
          type: 'federal',
          state: stateCode,
          population,
          geometry: f.geometry as Polygon | MultiPolygon,
          source: {
            country: 'AU',
            dataSource: 'AEC',
            endpoint: layer.endpoint,
            authority: layer.authority,
            vintage: layer.vintage,
            retrievedAt: new Date().toISOString(),
          },
          properties: props,
        };
      });
  }

  /**
   * Extract state code from division code or properties
   *
   * AEC division codes sometimes include state prefix (e.g., 'NSW01')
   * Otherwise, extract from STATE or STATE_NAME property
   */
  private extractStateCode(divisionCode: string, props: Record<string, unknown>): AustraliaState {
    const validStates: AustraliaState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

    // ABS uses numeric state codes: 1=NSW, 2=VIC, 3=QLD, 4=SA, 5=WA, 6=TAS, 7=NT, 8=ACT
    const absStateCode = Number(props.STATE_CODE_2021 ?? props.state_code_2021 ?? 0);
    const absStateMap: Record<number, AustraliaState> = {
      1: 'NSW', 2: 'VIC', 3: 'QLD', 4: 'SA', 5: 'WA', 6: 'TAS', 7: 'NT', 8: 'ACT',
    };
    if (absStateMap[absStateCode]) {
      return absStateMap[absStateCode];
    }

    // ABS CED codes: first digit = state (1xx=NSW, 2xx=VIC, etc.)
    const codeNum = parseInt(divisionCode, 10);
    if (!isNaN(codeNum) && codeNum >= 100 && codeNum < 900) {
      const stateDigit = Math.floor(codeNum / 100);
      if (absStateMap[stateDigit]) {
        return absStateMap[stateDigit];
      }
    }

    // Check for state prefix in division code (3-letter)
    const statePrefix = divisionCode.substring(0, 3).toUpperCase();
    if (validStates.includes(statePrefix as AustraliaState)) {
      return statePrefix as AustraliaState;
    }

    // Extract from properties
    const stateProp = String(props.STATE ?? props.STATE_CODE ?? props.STATE_AB ?? '').toUpperCase();
    if (validStates.includes(stateProp as AustraliaState)) {
      return stateProp as AustraliaState;
    }

    // Map state names to codes
    const stateName = String(props.STATE_NAME_2021 ?? props.state_name_2021 ?? props.STATE_NAME ?? '').toUpperCase();
    const stateNameMap: Record<string, AustraliaState> = {
      'NEW SOUTH WALES': 'NSW',
      VICTORIA: 'VIC',
      QUEENSLAND: 'QLD',
      'SOUTH AUSTRALIA': 'SA',
      'WESTERN AUSTRALIA': 'WA',
      TASMANIA: 'TAS',
      'NORTHERN TERRITORY': 'NT',
      'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
    };

    const mapped = stateNameMap[stateName];
    if (!mapped) {
      logger.warn('Could not determine state for AU division, defaulting to NSW', {
        cedCode: String(props.CED_CODE_2024 ?? props.CED_CODE ?? ''),
        stateName: stateName || '(empty)',
      });
    }
    return mapped ?? 'NSW';
  }
}
