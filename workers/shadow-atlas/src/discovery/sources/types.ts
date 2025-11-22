/**
 * Data Source Interface - Clean abstraction for pluggable boundary data sources
 *
 * Each source (Hub API, TIGER/Line, state portals) implements this interface.
 * The orchestrator doesn't care which source succeeds - just that one does.
 */

import { BoundaryType } from '../hub-api-discovery';
import type { SourceId } from './source-descriptors';

export interface BoundaryDataSource {
  readonly name: string;
  readonly id?: SourceId;

  /**
   * Attempt to fetch boundary data from this source
   * @returns SourceResult if found and valid, null otherwise
   */
  fetch(request: BoundaryRequest): Promise<SourceResult | null>;
}

export interface BoundaryRequest {
  location: LocationQuery;
  boundaryType: BoundaryType;
  classification: Classification;
}

export interface LocationQuery {
  // For point-based lookup
  lat?: number;
  lng?: number;

  // For name-based lookup
  name?: string;
  state: string;
  county?: string;
}

export interface Classification {
  type: string; // 'independent_city' | 'consolidated' | 'federal_district' | 'standard' | etc.
  metadata?: any;
  routingPreference: 'county' | 'place' | 'state_portal' | 'standard';
}

export interface SourceResult {
  geometry: GeoJSON.Feature;
  score: number;
  metadata: SourceMetadata;
}

export interface SourceMetadata {
  source: string;
  publisher: string;
  publishedDate?: Date;
  lastModified?: Date;
  fipsCode?: string;
  districtCode?: string;
  districtName?: string;
  notes?: string;
  dataQuality?: 'high' | 'medium' | 'low';
  overlappingDistricts?: string[];
}

export interface BoundaryResult {
  success: boolean;
  data?: GeoJSON.Feature;
  source?: string;
  classification: Classification;
  metadata?: SourceMetadata;
  score?: number;
  error?: string;
}
