/**
 * Discovery Workflow State
 *
 * Defines the state schema for the boundary discovery workflow.
 * All state is checkpointed to enable resume from any point.
 */

/**
 * Place record from Census or equivalent source
 */
export interface Place {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly countryCode: string;
  readonly population: number;
  readonly placeType: string;
}

/**
 * Governance classification result
 */
export interface GovernanceClassification {
  readonly placeId: string;
  readonly placeName: string;
  readonly governanceType: 'ward' | 'district' | 'commission' | 'at-large' | 'unknown';
  readonly expectedDistricts: number;
  readonly confidence: 'verified' | 'inferred' | 'needs-research';
  readonly source: string;
  readonly reasoning: string;
}

/**
 * Candidate URL discovered from GIS sources
 */
export interface CandidateUrl {
  readonly placeId: string;
  readonly url: string;
  readonly source: 'arcgis' | 'socrata' | 'ckan' | 'state-gis' | 'county-gis' | 'city-gis';
  readonly layerName: string;
  readonly confidence: number;
  readonly discoveredAt: number;
}

/**
 * Validated boundary result
 */
export interface ValidatedBoundary {
  readonly placeId: string;
  readonly placeName: string;
  readonly url: string;
  readonly format: 'geojson' | 'shapefile' | 'feature-service';
  readonly featureCount: number;
  readonly geometryType: 'polygon' | 'multipolygon' | 'unknown';
  readonly validatedAt: number;
  readonly responseTimeMs: number;
}

/**
 * Discovery error record
 */
export interface DiscoveryError {
  readonly placeId: string;
  readonly phase: DiscoveryPhase;
  readonly error: string;
  readonly timestamp: number;
  readonly retryCount: number;
}

/**
 * Workflow phases
 */
export type DiscoveryPhase =
  | 'initializing'
  | 'loading_places'
  | 'classifying_governance'
  | 'searching_sources'
  | 'validating_urls'
  | 'writing_registry'
  | 'complete'
  | 'failed';

/**
 * Complete discovery state
 */
export interface DiscoveryState {
  // Input
  readonly region: string;  // e.g., "US-MT", "CA-ON", "GB-ENG"

  // Progress tracking
  phase: DiscoveryPhase;
  currentPlaceIndex: number;

  // Data
  places: Place[];
  classifications: GovernanceClassification[];
  candidateUrls: CandidateUrl[];
  validatedBoundaries: ValidatedBoundary[];

  // Error handling
  errors: DiscoveryError[];
  retryQueue: string[];  // placeIds to retry

  // Metrics
  startedAt: number;
  lastCheckpoint: number;
  apiCallCount: number;
  estimatedCost: number;

  // Summary (populated at end)
  summary?: DiscoverySummary;
}

/**
 * Discovery summary
 */
export interface DiscoverySummary {
  readonly region: string;
  readonly totalPlaces: number;
  readonly wardBasedPlaces: number;
  readonly atLargePlaces: number;
  readonly boundariesFound: number;
  readonly boundariesMissing: number;
  readonly coveragePercent: number;
  readonly totalApiCalls: number;
  readonly totalCost: number;
  readonly durationMs: number;
}

/**
 * Create initial state for a discovery run
 */
export function createInitialState(region: string): DiscoveryState {
  return {
    region,
    phase: 'initializing',
    currentPlaceIndex: 0,
    places: [],
    classifications: [],
    candidateUrls: [],
    validatedBoundaries: [],
    errors: [],
    retryQueue: [],
    startedAt: Date.now(),
    lastCheckpoint: Date.now(),
    apiCallCount: 0,
    estimatedCost: 0,
  };
}

/**
 * Serialize state for checkpointing
 */
export function serializeState(state: DiscoveryState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Deserialize state from checkpoint
 */
export function deserializeState(json: string): DiscoveryState {
  return JSON.parse(json) as DiscoveryState;
}

/**
 * Calculate summary from completed state
 */
export function calculateSummary(state: DiscoveryState): DiscoverySummary {
  const wardBased = state.classifications.filter(
    c => c.governanceType !== 'at-large' && c.governanceType !== 'unknown'
  );
  const atLarge = state.classifications.filter(c => c.governanceType === 'at-large');

  const boundariesFound = state.validatedBoundaries.length;
  const boundariesNeeded = wardBased.length;
  const coveragePercent = boundariesNeeded > 0
    ? (boundariesFound / boundariesNeeded) * 100
    : 100;

  return {
    region: state.region,
    totalPlaces: state.places.length,
    wardBasedPlaces: wardBased.length,
    atLargePlaces: atLarge.length,
    boundariesFound,
    boundariesMissing: boundariesNeeded - boundariesFound,
    coveragePercent: Math.round(coveragePercent * 10) / 10,
    totalApiCalls: state.apiCallCount,
    totalCost: Math.round(state.estimatedCost * 1000) / 1000,
    durationMs: Date.now() - state.startedAt,
  };
}
