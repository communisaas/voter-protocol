/**
 * Discovery Utilities
 *
 * Shared functions for portal discovery across ArcGIS Hub, Socrata,
 * and regional aggregators.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { PortalType } from '../../core/types/discovery.js';
import {
  getAllAggregatorsSorted,
  getAggregatorsForState,
  type RegionalAggregator,
} from '../../core/registry/regional-aggregators.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Search source type
 */
export type SearchSource = 'arcgis-hub' | 'socrata' | 'regional' | 'all';

/**
 * Portal candidate discovered from search
 */
export interface PortalCandidate {
  /** Unique identifier from source */
  readonly id: string;

  /** Human-readable name/title */
  readonly name: string;

  /** Data download URL */
  readonly url: string;

  /** Source portal type */
  readonly portalType: PortalType;

  /** Owner/organization name */
  readonly owner: string;

  /** Organization ID (if available) */
  readonly orgId?: string;

  /** Number of features/records */
  readonly recordCount: number | null;

  /** Geographic extent (if available) */
  readonly extent?: {
    readonly minLon: number;
    readonly minLat: number;
    readonly maxLon: number;
    readonly maxLat: number;
  };

  /** Search term that matched */
  readonly matchedTerm: string;

  /** Confidence score (0-100) */
  readonly confidence: number;

  /** Discovery timestamp */
  readonly discoveredAt: string;

  /** State code (if known) */
  readonly state?: string;

  /** City name (if known) */
  readonly city?: string;

  /** Tags from source */
  readonly tags?: readonly string[];
}

/**
 * Search filters for discovery
 */
export interface SearchFilters {
  /** State code filter (e.g., 'CA', 'TX') */
  readonly state?: string;

  /** City name filter */
  readonly city?: string;

  /** Minimum population */
  readonly populationMin?: number;

  /** Custom keywords to search */
  readonly keywords?: readonly string[];

  /** Maximum results to return */
  readonly limit?: number;
}

/**
 * Search result from any source
 */
export interface SearchResult {
  /** Source that was searched */
  readonly source: SearchSource;

  /** Candidates found */
  readonly candidates: readonly PortalCandidate[];

  /** Total results (may be more than returned) */
  readonly total: number;

  /** Search duration in milliseconds */
  readonly durationMs: number;

  /** Any errors that occurred */
  readonly errors?: readonly string[];
}

// ============================================================================
// ArcGIS Hub API Types
// ============================================================================

interface HubDataset {
  readonly id: string;
  readonly attributes: {
    readonly name: string;
    readonly url: string | null;
    readonly slug: string;
    readonly owner: string;
    readonly orgId: string | null;
    readonly type: string;
    readonly source: string | null;
    readonly extent: { readonly coordinates: readonly number[][] } | null;
    readonly recordCount: number | null;
    readonly created: number | null;
    readonly modified: number | null;
    readonly tags: readonly string[] | null;
  };
}

interface HubApiResponse {
  readonly data: readonly HubDataset[];
  readonly meta?: {
    readonly total?: number;
    readonly next?: string;
  };
}

function isHubApiResponse(data: unknown): data is HubApiResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    Array.isArray((data as HubApiResponse).data)
  );
}

// ============================================================================
// Socrata API Types
// ============================================================================

interface SocrataResource {
  readonly name: string;
  readonly id: string;
  readonly description: string;
  readonly link: string;
  readonly type: string;
  readonly download_count: number;
  readonly columns_field_name?: readonly string[];
}

interface SocrataResult {
  readonly resource: SocrataResource;
  readonly classification?: {
    readonly categories: readonly string[];
    readonly tags: readonly string[];
    readonly domain_category?: string;
  };
  readonly metadata?: {
    readonly domain: string;
  };
  readonly link: string;
}

interface SocrataApiResponse {
  readonly results: readonly SocrataResult[];
  readonly resultSetSize: number;
}

function isSocrataApiResponse(data: unknown): data is SocrataApiResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'results' in data &&
    Array.isArray((data as SocrataApiResponse).results)
  );
}

// ============================================================================
// Default Search Terms
// ============================================================================

const DEFAULT_SEARCH_TERMS = [
  'council districts',
  'city council districts',
  'ward boundaries',
  'aldermanic districts',
  'councilmanic districts',
  'commission districts',
  'municipal wards',
  'council ward',
  'city ward',
];

// ============================================================================
// ArcGIS Hub Search
// ============================================================================

/**
 * Search ArcGIS Hub API for council district data
 *
 * @param keywords - Search keywords (uses defaults if not provided)
 * @param filters - Search filters
 * @returns Array of portal candidates
 */
export async function searchArcGISHub(
  keywords: readonly string[] = DEFAULT_SEARCH_TERMS,
  filters: SearchFilters = {}
): Promise<readonly PortalCandidate[]> {
  const hubApiUrl = 'https://hub.arcgis.com/api/v3/datasets';
  const allCandidates = new Map<string, PortalCandidate>();
  const limit = filters.limit ?? 500;

  // Build search terms with location qualifiers
  const searchTerms = keywords.flatMap((keyword) => {
    const terms = [keyword];
    if (filters.state) {
      terms.push(`${keyword} ${filters.state}`);
    }
    if (filters.city) {
      terms.push(`${keyword} ${filters.city}`);
      if (filters.state) {
        terms.push(`${keyword} ${filters.city} ${filters.state}`);
      }
    }
    return terms;
  });

  for (const term of searchTerms) {
    try {
      const params = new URLSearchParams({
        q: term,
        'filter[type]': 'Feature Service',
        'page[size]': '100',
        sort: '-modified',
      });

      const response = await fetch(`${hubApiUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Discovery)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        continue;
      }

      const data: unknown = await response.json();

      if (!isHubApiResponse(data)) {
        continue;
      }

      for (const dataset of data.data) {
        if (allCandidates.has(dataset.id)) {
          continue;
        }

        if (!dataset.attributes.url) {
          continue;
        }

        // US bounds check
        const extent = dataset.attributes.extent;
        if (extent?.coordinates?.[0]) {
          const coords = extent.coordinates[0];
          if (coords.length >= 2) {
            const [lon, lat] = coords;
            if (
              lon !== undefined &&
              lat !== undefined &&
              (lon < -130 || lon > -60 || lat < 20 || lat > 55)
            ) {
              continue;
            }
          }
        }

        const confidence = scoreHubCandidate(dataset.attributes.name, term);
        if (confidence < 40) {
          continue;
        }

        // Extract extent if available
        let candidateExtent: PortalCandidate['extent'];
        if (extent?.coordinates && extent.coordinates.length >= 2) {
          const [min, max] = extent.coordinates;
          if (min && max && min.length >= 2 && max.length >= 2) {
            candidateExtent = {
              minLon: min[0]!,
              minLat: min[1]!,
              maxLon: max[0]!,
              maxLat: max[1]!,
            };
          }
        }

        allCandidates.set(dataset.id, {
          id: dataset.id,
          name: dataset.attributes.name,
          url: dataset.attributes.url,
          portalType: 'arcgis-hub',
          owner: dataset.attributes.owner,
          orgId: dataset.attributes.orgId ?? undefined,
          recordCount: dataset.attributes.recordCount,
          extent: candidateExtent,
          matchedTerm: term,
          confidence: Math.min(100, confidence),
          discoveredAt: new Date().toISOString(),
          tags: dataset.attributes.tags ?? undefined,
        });
      }

      if (allCandidates.size >= limit) {
        break;
      }
    } catch {
      // Continue to next search term
    }

    // Rate limit between searches
    await delay(200);
  }

  return Array.from(allCandidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Score a Hub candidate based on name matching
 */
function scoreHubCandidate(name: string, searchTerm: string): number {
  const nameLower = name.toLowerCase();
  let score = 50;

  // Positive signals
  if (nameLower.includes('council district')) score += 30;
  if (nameLower.includes('city council')) score += 25;
  if (nameLower.includes('ward')) score += 20;
  if (nameLower.includes('commission district')) score += 20;
  if (nameLower.includes('aldermanic')) score += 20;
  if (nameLower.includes('boundary') || nameLower.includes('boundaries'))
    score += 10;

  // Negative signals
  if (nameLower.includes('school')) score -= 35;
  if (nameLower.includes('police')) score -= 30;
  if (nameLower.includes('fire')) score -= 30;
  if (nameLower.includes('utility')) score -= 25;
  if (nameLower.includes('water district')) score -= 20;
  if (nameLower.includes('sewer')) score -= 20;
  if (nameLower.includes('congressional')) score -= 15;
  if (nameLower.includes('state senate')) score -= 15;
  if (nameLower.includes('state house')) score -= 15;
  if (nameLower.includes('precinct')) score -= 10;

  return score;
}

// ============================================================================
// Socrata Search
// ============================================================================

/**
 * Search Socrata API for council district data
 *
 * @param keywords - Search keywords
 * @param filters - Search filters
 * @returns Array of portal candidates
 */
export async function searchSocrata(
  keywords: readonly string[] = DEFAULT_SEARCH_TERMS,
  filters: SearchFilters = {}
): Promise<readonly PortalCandidate[]> {
  const socrataApiUrl = 'https://api.us.socrata.com/api/catalog/v1';
  const allCandidates = new Map<string, PortalCandidate>();
  const limit = filters.limit ?? 100;

  const searchTerms = keywords.slice(0, 5); // Socrata is slower, limit terms

  for (const term of searchTerms) {
    try {
      let query = term;
      if (filters.state) {
        query += ` ${filters.state}`;
      }
      if (filters.city) {
        query += ` ${filters.city}`;
      }

      const params = new URLSearchParams({
        q: query,
        only: 'datasets',
        limit: '25',
      });

      const response = await fetch(`${socrataApiUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Discovery)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        continue;
      }

      const data: unknown = await response.json();

      if (!isSocrataApiResponse(data)) {
        continue;
      }

      for (const result of data.results) {
        const resource = result.resource;

        if (allCandidates.has(resource.id)) {
          continue;
        }

        // Check for geometry columns
        const hasGeometry = resource.columns_field_name?.some(
          (col) =>
            col.toLowerCase().includes('geometry') ||
            col.toLowerCase().includes('geom') ||
            col.toLowerCase().includes('the_geom') ||
            col.toLowerCase().includes('shape')
        );

        if (!hasGeometry) {
          continue;
        }

        const confidence = scoreSocrataCandidate(resource.name, term);
        if (confidence < 50) {
          continue;
        }

        allCandidates.set(resource.id, {
          id: resource.id,
          name: resource.name,
          url: result.link,
          portalType: 'socrata',
          owner: result.metadata?.domain ?? 'unknown',
          recordCount: null,
          matchedTerm: term,
          confidence: Math.min(100, confidence),
          discoveredAt: new Date().toISOString(),
          tags:
            result.classification?.tags ??
            result.classification?.categories ??
            undefined,
        });
      }

      if (allCandidates.size >= limit) {
        break;
      }
    } catch {
      // Continue to next term
    }

    await delay(300);
  }

  return Array.from(allCandidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Score a Socrata candidate
 */
function scoreSocrataCandidate(name: string, _searchTerm: string): number {
  const nameLower = name.toLowerCase();
  let score = 50;

  // Positive signals
  if (nameLower.includes('council district')) score += 30;
  if (nameLower.includes('city council')) score += 25;
  if (nameLower.includes('ward')) score += 20;
  if (nameLower.includes('commission district')) score += 20;

  // Negative signals
  if (nameLower.includes('school')) score -= 30;
  if (nameLower.includes('police')) score -= 25;
  if (nameLower.includes('fire')) score -= 25;

  return score;
}

// ============================================================================
// Regional Aggregator Query
// ============================================================================

/**
 * Query regional aggregators for available data
 *
 * @param state - Optional state filter
 * @returns Array of portal candidates from aggregators
 */
export async function queryRegionalAggregators(
  state?: string
): Promise<readonly PortalCandidate[]> {
  const aggregators = state
    ? getAggregatorsForState(state)
    : getAllAggregatorsSorted();

  const candidates: PortalCandidate[] = [];

  for (const aggregator of aggregators) {
    if (aggregator.status === 'deprecated') {
      continue;
    }

    // Each aggregator represents potential candidates
    candidates.push({
      id: `aggregator-${aggregator.id}`,
      name: aggregator.name,
      url: aggregator.endpointUrl,
      portalType: 'arcgis',
      owner: aggregator.id,
      recordCount: aggregator.expectedFeatureCount ?? null,
      matchedTerm: 'regional-aggregator',
      confidence: aggregator.confidence,
      discoveredAt: new Date().toISOString(),
      state: aggregator.states[0],
    });
  }

  return candidates;
}

// ============================================================================
// Combined Search
// ============================================================================

/**
 * Search all sources for portal candidates
 *
 * @param source - Which source to search
 * @param filters - Search filters
 * @returns Combined search result
 */
export async function searchAll(
  source: SearchSource,
  filters: SearchFilters = {}
): Promise<SearchResult> {
  const startTime = Date.now();
  const allCandidates: PortalCandidate[] = [];
  const errors: string[] = [];

  const keywords = filters.keywords ?? DEFAULT_SEARCH_TERMS;

  if (source === 'arcgis-hub' || source === 'all') {
    try {
      const hubCandidates = await searchArcGISHub(keywords, filters);
      allCandidates.push(...hubCandidates);
    } catch (error) {
      errors.push(
        `ArcGIS Hub: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (source === 'socrata' || source === 'all') {
    try {
      const socrataCandidates = await searchSocrata(keywords, filters);
      allCandidates.push(...socrataCandidates);
    } catch (error) {
      errors.push(
        `Socrata: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (source === 'regional' || source === 'all') {
    try {
      const aggregatorCandidates = await queryRegionalAggregators(
        filters.state
      );
      allCandidates.push(...aggregatorCandidates);
    } catch (error) {
      errors.push(
        `Regional: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Deduplicate by URL
  const uniqueCandidates = deduplicateCandidates(allCandidates);

  return {
    source,
    candidates: uniqueCandidates.sort((a, b) => b.confidence - a.confidence),
    total: uniqueCandidates.length,
    durationMs: Date.now() - startTime,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================================================
// Scoring and Ranking
// ============================================================================

/**
 * Score a candidate for relevance and quality
 *
 * @param candidate - Portal candidate to score
 * @returns Updated confidence score (0-100)
 */
export function scoreCandidate(candidate: PortalCandidate): number {
  let score = candidate.confidence;

  // Boost for record count in expected range
  if (candidate.recordCount !== null) {
    if (candidate.recordCount >= 3 && candidate.recordCount <= 20) {
      score += 10; // Typical council district range
    } else if (candidate.recordCount > 20 && candidate.recordCount <= 50) {
      score += 5; // Could be wards
    } else if (candidate.recordCount < 3 || candidate.recordCount > 100) {
      score -= 10; // Suspicious count
    }
  }

  // Boost for known good portals
  if (candidate.url.includes('.gov')) {
    score += 5;
  }

  // Penalty for likely wrong data
  const nameLower = candidate.name.toLowerCase();
  if (nameLower.includes('proposed') || nameLower.includes('draft')) {
    score -= 15;
  }
  if (nameLower.includes('historic') || nameLower.includes('historical')) {
    score -= 10;
  }

  return Math.min(100, Math.max(0, score));
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Deduplicate candidates by URL
 */
function deduplicateCandidates(
  candidates: readonly PortalCandidate[]
): PortalCandidate[] {
  const seen = new Map<string, PortalCandidate>();

  for (const candidate of candidates) {
    // Normalize URL for comparison
    const normalizedUrl = candidate.url.toLowerCase().replace(/\/$/, '');

    const existing = seen.get(normalizedUrl);
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(normalizedUrl, candidate);
    }
  }

  return Array.from(seen.values());
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Export regional aggregator types for CLI usage
 */
export type { RegionalAggregator };
export { getAllAggregatorsSorted, getAggregatorsForState };
