/**
 * Database and Storage Types
 *
 * Type definitions for database operations, storage adapters,
 * and event-sourced municipal boundary data.
 */

/**
 * Municipality (19k US incorporated places)
 */
export interface Municipality {
  readonly id: string;              // "ca-los_angeles"
  readonly name: string;            // "Los Angeles, CA"
  readonly state: string;           // "CA"
  readonly fips_place: string | null;
  readonly population: number | null;
  readonly county_fips: string | null;
  readonly created_at: string;      // ISO 8601
}

/**
 * Source portal types
 */
export type SourceKind = 'arcgis' | 'socrata' | 'ckan' | 'geojson';

/**
 * Discovered source (portal endpoint)
 */
export interface Source {
  readonly id: number;
  readonly muni_id: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly layer_hint: string | null;  // Layer index or name
  readonly title: string | null;
  readonly description: string | null;
  readonly discovered_at: string;      // ISO 8601
  readonly score: number | null;       // Heuristic ranking
}

/**
 * Selection decision type
 */
export type DecisionType = 'heuristic' | 'llm' | 'manual';

/**
 * Selected source for a municipality
 */
export interface Selection {
  readonly muni_id: string;
  readonly source_id: number;
  readonly district_field: string | null;  // e.g., "DISTRICT", "WARD"
  readonly member_field: string | null;    // e.g., "COUNCILMEM", "MEMBER"
  readonly at_large: boolean;              // True if at-large/no districts
  readonly confidence: number | null;      // 0.0-1.0
  readonly decided_by: DecisionType;
  readonly decided_at: string;             // ISO 8601
  readonly model: string | null;           // e.g., "gemini-2.5-flash"
}

/**
 * Content-addressed GeoJSON artifact
 */
export interface Artifact {
  readonly id: number;
  readonly muni_id: string;
  readonly content_sha256: string;     // Key into R2/S3
  readonly record_count: number;       // Feature count
  readonly bbox: [number, number, number, number] | null;  // [minLon, minLat, maxLon, maxLat]
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_edit_date: number | null;  // Epoch ms
  readonly created_at: string;             // ISO 8601
}

/**
 * Head pointer to current artifact
 */
export interface Head {
  readonly muni_id: string;
  readonly artifact_id: number;
  readonly updated_at: string;  // ISO 8601
}

/**
 * Event types for provenance log
 */
export type EventKind = 'DISCOVER' | 'SELECT' | 'FETCH' | 'UPDATE' | 'ERROR' | 'SKIP';

/**
 * Event (append-only log)
 */
export interface Event {
  readonly id: number;
  readonly ts: string;               // ISO 8601
  readonly run_id: string;           // Batch/cron run identifier
  readonly muni_id: string | null;
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;  // JSON blob
  readonly model: string | null;     // LLM model if used
  readonly duration_ms: number | null;
  readonly error: string | null;
}

/**
 * Status view (derived)
 */
export type StatusType = 'FOUND_LAYER' | 'SELECTED_NOT_FETCHED' | 'SOURCES_FOUND' | 'NOT_ATTEMPTED';

export interface StatusView {
  readonly muni_id: string;
  readonly name: string;
  readonly state: string;
  readonly population: number | null;
  readonly status: StatusType;
  readonly confidence: number | null;
  readonly decided_by: DecisionType | null;
  readonly decided_at: string | null;
  readonly district_count: number | null;
  readonly content_sha256: string | null;
  readonly data_updated_at: string | null;
}

/**
 * Coverage metrics view (derived)
 */
export interface CoverageView {
  readonly state: string;
  readonly total_munis: number;
  readonly found: number;
  readonly selected: number;
  readonly sources: number;
  readonly pending: number;
  readonly pct_complete: number;
}

/**
 * Normalized GeoJSON structure
 */
export interface NormalizedGeoJSON {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJSONFeature[];
  readonly bbox?: readonly [number, number, number, number];
}

export interface GeoJSONFeature {
  readonly type: 'Feature';
  readonly id?: string | number;
  readonly properties: Record<string, unknown>;
  readonly geometry: GeoJSONGeometry;
}

export type GeoJSONGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: readonly [readonly [number, number][]][]; }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly [readonly [readonly [number, number][]][]][]; };

/**
 * LLM batch input/output types
 */

export interface LLMBatchCity {
  readonly id: string;
  readonly name: string;
  readonly state: string;
}

export interface LLMBatchCandidate {
  readonly ty: SourceKind;      // Type (abbreviated for token efficiency)
  readonly ti: string;          // Title
  readonly u: string;           // URL
  readonly ly?: readonly LLMLayerInfo[];  // Layers (ArcGIS only)
  readonly f?: readonly string[];         // Fields (Socrata/CKAN)
}

export interface LLMLayerInfo {
  readonly i: number;           // Index
  readonly n: string;           // Name
  readonly f: readonly string[]; // Fields (top 6 only)
}

export interface LLMBatchInput {
  readonly task: string;
  readonly rules: readonly string[];
  readonly glossary: Record<string, string>;
  readonly batch: readonly LLMBatchCityInput[];
}

export interface LLMBatchCityInput {
  readonly city: LLMBatchCity;
  readonly cand: readonly LLMBatchCandidate[];
}

export interface LLMDecision {
  readonly muni_id: string;
  readonly source_type?: SourceKind;
  readonly source_url?: string;
  readonly layer_hint?: string | number;
  readonly district_field?: string;
  readonly member_field?: string;
  readonly at_large: boolean;
  readonly decision: 'ok' | 'skip';
  readonly confidence: number;
}

/**
 * Source fetcher metadata (from fetcher operations)
 * Distinct from SourceMetadata (provider attribution)
 */
export interface FetcherSourceMetadata {
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_edit_date: number | null;  // Epoch ms (ArcGIS only)
}

/**
 * Fetcher response
 */
export interface FetchResult {
  readonly data: NormalizedGeoJSON;
  readonly meta: FetcherSourceMetadata;
}

/**
 * Database adapter interface
 */
export interface DatabaseAdapter {
  // Municipalities
  insertMunicipality(muni: Omit<Municipality, 'created_at'>): Promise<void>;
  batchInsertMunicipalities(munis: Omit<Municipality, 'created_at'>[]): Promise<void>;
  getMunicipality(id: string): Promise<Municipality | null>;
  listMunicipalities(limit?: number, offset?: number): Promise<Municipality[]>;

  // Sources
  insertSource(source: Omit<Source, 'id'>): Promise<number>;
  batchInsertSources(sources: Omit<Source, 'id'>[]): Promise<void>;
  getSourcesByMuni(muni_id: string): Promise<Source[]>;

  // Selections
  insertSelection(sel: Selection): Promise<void>;
  getSelection(muni_id: string): Promise<Selection | null>;

  // Artifacts
  insertArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<number>;
  getArtifact(id: number): Promise<Artifact | null>;
  getArtifactBySha(sha: string): Promise<Artifact | null>;

  // Heads
  upsertHead(head: Omit<Head, 'updated_at'>): Promise<void>;
  getHead(muni_id: string): Promise<Head | null>;

  // Events
  insertEvent(event: Omit<Event, 'id' | 'ts'>): Promise<void>;
  batchInsertEvents(events: Omit<Event, 'id' | 'ts'>[]): Promise<void>;
  getEventsByMuni(muni_id: string, limit?: number): Promise<Event[]>;
  getEventsByRun(run_id: string): Promise<Event[]>;

  // Views
  getStatus(muni_id: string): Promise<StatusView | null>;
  listStatus(limit?: number, offset?: number): Promise<StatusView[]>;
  getCoverage(): Promise<CoverageView[]>;
  getErrors(limit?: number): Promise<Event[]>;

  // Utility
  close(): Promise<void>;
}

/**
 * Storage adapter interface (content-addressed blobs)
 */
export interface StorageAdapter {
  put(sha256: string, data: Buffer, metadata: Record<string, string>): Promise<void>;
  get(sha256: string): Promise<Buffer | null>;
  exists(sha256: string): Promise<boolean>;
  delete(sha256: string): Promise<void>;
}

/**
 * SQLite database schema types
 */
export interface DistrictRecord {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly district_type: string;
  readonly geometry: string;       // JSON-serialized GeoJSON
  readonly provenance: string;     // JSON-serialized ProvenanceMetadata
  readonly min_lon: number;
  readonly min_lat: number;
  readonly max_lon: number;
  readonly max_lat: number;
}
