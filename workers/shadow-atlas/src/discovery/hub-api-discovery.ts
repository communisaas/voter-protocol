/**
 * ArcGIS Hub API Discovery - Deterministic, FREE, Reliable
 *
 * Unlike LLM-based approaches, Hub API provides:
 * - Deterministic results (same query = same results)
 * - Structured responses (no hallucination)
 * - Direct access to authoritative GIS data sources
 * - Zero cost (public API)
 *
 * Hub API is Esri's centralized catalog of published GIS datasets.
 * Cities that publish council district data to ArcGIS Online appear here.
 *
 * SPECIFICATION v2.0.0:
 * - FR-001: Boundary type routing
 * - FR-002: Terminology fallback (150+ variants)
 * - FR-008: Boundary-type-aware scoring
 */

import {
  BoundaryType,
  getTerminologyForBoundaryType,
  getScoringKeywords
} from './terminology';

export interface HubSearchResult {
  id: string;
  type: string;
  attributes: {
    name: string;
    description?: string;
    snippet?: string;
    url?: string;
    modified: number;
    owner: string;
    orgId: string;
  };
}

export interface HubDatasetDetails {
  data: {
    id: string;
    type: string;
    attributes: {
      name: string;
      type: string;
      url: string;
      geometryType?: string;
      fields?: Array<{ name: string; type: string }>;
      recordCount?: number;
    };
  };
}

export interface DiscoveryResult {
  url: string;
  score: number;
  metadata: {
    name: string;
    source: 'hub-api' | 'census-tiger' | 'state-gis';
    geometryType?: string;
    fields?: Array<{ name: string; type: string }>;
    recordCount?: number;
    modified?: number;
    terminologyUsed?: string;  // Which terminology variant succeeded (FR-002)
  };
}

/**
 * FR-002: Terminology Fallback Search (PERFORMANCE OPTIMIZED)
 *
 * Try ALL terminology variants in PARALLEL until successful (score ≥60) OR exhausted.
 * This fixes edge cases like San Francisco ("supervisorial districts").
 *
 * PERFORMANCE: Parallel execution provides 10× speedup over sequential approach.
 * 21 variants × 2s = 42s → ~4s total
 *
 * @param entityName - City name, county name, or district name
 * @param state - Two-letter state code
 * @param boundaryType - Type of boundary to discover
 * @param options - Configuration options
 * @returns DiscoveryResult with terminologyUsed tracking, or null if all variants fail
 */
export async function searchHubWithTerminologyFallback(
  entityName: string,
  state: string,
  boundaryType: BoundaryType = BoundaryType.MUNICIPAL,
  options: { quiet?: boolean } = {}
): Promise<DiscoveryResult | null> {
  const terminologyList = getTerminologyForBoundaryType(boundaryType);

  if (!options.quiet) {
    console.log(`\n🔄 Starting terminology fallback for ${entityName}, ${state}`);
    console.log(`📋 Boundary type: ${boundaryType}`);
    console.log(`🔍 Will try ${terminologyList.length} terminology variants`);
  }

  // PERFORMANCE FIX: Parallel execution instead of sequential
  const promises = terminologyList.map(async (terminology, i) => {
    if (!options.quiet) {
      console.log(`\n   [${i + 1}/${terminologyList.length}] Trying: "${terminology}"`);
    }

    try {
      const result = await searchHubForBoundaryType(
        entityName,
        state,
        terminology,
        boundaryType
      );

      if (result && result.score >= 60) {
        if (!options.quiet) {
          console.log(`   ✅ SUCCESS with "${terminology}" (score: ${result.score}/100)`);
        }
        result.metadata.terminologyUsed = terminology;
        return { result, terminology, success: true };
      } else if (result) {
        if (!options.quiet) {
          console.log(`   ⚠️  Found but low score: ${result.score}/100 (< 60 threshold)`);
        }
        return { result, terminology, success: false };
      } else {
        if (!options.quiet) {
          console.log(`   ❌ No results for "${terminology}"`);
        }
        return { result: null, terminology, success: false };
      }
    } catch (error) {
      if (!options.quiet) {
        console.log(`   ❌ Error with "${terminology}": ${error}`);
      }
      return { result: null, terminology, success: false, error: String(error) };
    }
  });

  // Wait for all requests to complete
  const results = await Promise.allSettled(promises);

  // Find first successful result (score >= 60)
  for (const promiseResult of results) {
    if (promiseResult.status === 'fulfilled' && promiseResult.value.success) {
      return promiseResult.value.result;
    }
  }

  // No successful results, find best scoring result as fallback
  let bestResult: DiscoveryResult | null = null;
  let bestScore = 0;

  for (const promiseResult of results) {
    if (promiseResult.status === 'fulfilled' && promiseResult.value.result) {
      const score = promiseResult.value.result.score;
      if (score > bestScore) {
        bestScore = score;
        bestResult = promiseResult.value.result;
        bestResult.metadata.terminologyUsed = promiseResult.value.terminology;
      }
    }
  }

  if (!options.quiet) {
    if (bestResult) {
      console.log(`\n⚠️  Best result: score ${bestScore}/100 with "${bestResult.metadata.terminologyUsed}" (below 60 threshold)`);
    } else {
      console.log(`\n❌ All ${terminologyList.length} terminology variants exhausted. No valid data found.`);
    }
  }

  return bestResult; // Return best result even if below threshold (let caller decide)
}

/**
 * Search ArcGIS Hub with specific terminology
 * (Internal helper for terminology fallback)
 */
export async function searchHubForBoundaryType(
  entityName: string,
  state: string,
  terminology: string,
  boundaryType: BoundaryType
): Promise<DiscoveryResult | null> {
  try {
    // Step 1: Search Hub for datasets matching entity + terminology
    const searchQuery = `${entityName} ${state} ${terminology}`;
    const searchUrl = `https://hub.arcgis.com/api/v3/search?q=${encodeURIComponent(searchQuery)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VOTER-Protocol/1.0 (shadow-atlas discovery)'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!searchResponse.ok) {
      // NEW: Log HTTP errors for monitoring (don't throw - let fallback work)
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[Shadow Atlas - Hub API] HTTP ${searchResponse.status} for query: "${searchQuery}" ` +
          `(${entityName}, ${state}, terminology: "${terminology}")`
        );
      }
      return null; // Continue fallback loop
    }

    const searchData = await searchResponse.json() as { data: HubSearchResult[] };

    if (!searchData.data || searchData.data.length === 0) {
      return null; // No results for this terminology variant
    }

    // Step 2: Filter for relevant names using boundary-type-aware keywords
    const keywords = getScoringKeywords(boundaryType);
    const candidates = searchData.data.filter(result => {
      const name = result.attributes.name?.toLowerCase() || '';

      // Must contain at least one relevant keyword for this boundary type
      const hasRelevantName = keywords.nameKeywords.some(keyword =>
        name.includes(keyword.toLowerCase())
      );

      return hasRelevantName;
    });

    if (candidates.length === 0) {
      return null; // No matching candidates
    }

    // Step 3: Get details for top candidate
    for (const candidate of candidates) {
      try {
        const detailsUrl = `https://hub.arcgis.com/api/v3/datasets/${candidate.id}`;

        const detailsResponse = await fetch(detailsUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VOTER-Protocol/1.0 (shadow-atlas discovery)'
          }
        });

        if (!detailsResponse.ok) {
          // NEW: Log HTTP errors for dataset details requests
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              `[Shadow Atlas - Hub API] HTTP ${detailsResponse.status} fetching dataset details: ${candidate.id} ` +
              `(${entityName}, ${state})`
            );
          }
          continue; // Try next candidate
        }

        const details = await detailsResponse.json() as HubDatasetDetails;
        const attrs = details.data.attributes;

        // Must have a valid FeatureServer/MapServer URL
        if (!attrs.url) {
          continue;
        }

        // Validate it's actually a FeatureServer or MapServer
        if (!attrs.url.includes('/FeatureServer/') && !attrs.url.includes('/MapServer/')) {
          continue;
        }

        // Step 4: Validate the URL actually works
        const validateUrl = `${attrs.url}?f=json`;
        const validateResponse = await fetch(validateUrl, {
          headers: { 'Accept': 'application/json' }
        });

        if (!validateResponse.ok) {
          // NEW: Log HTTP errors for FeatureServer validation
          if (process.env.NODE_ENV !== 'test') {
            console.warn(
              `[Shadow Atlas - Hub API] HTTP ${validateResponse.status} validating FeatureServer URL: ${attrs.url} ` +
              `(${entityName}, ${state})`
            );
          }
          continue;
        }

        const metadata = await validateResponse.json();

        // Step 5: Score the result (FR-008: boundary-type-aware + enhanced quality signals)
        const score = calculateScore(
          metadata,
          candidate,
          boundaryType,
          terminology
        );

        return {
          url: attrs.url,
          score,
          metadata: {
            name: attrs.name,
            source: 'hub-api' as const,
            geometryType: metadata.geometryType,
            fields: metadata.fields,
            recordCount: metadata.extent?.features || metadata.count,
            modified: candidate.attributes.modified
          }
        };

      } catch (error) {
        // Silently continue to next candidate
        continue;
      }
    }

    // No valid candidates found
    return null;

  } catch (error) {
    // Silently fail for fallback loop
    return null;
  }
}

/**
 * BACKWARD COMPATIBILITY: Keep old function name for existing code
 * @deprecated Use searchHubWithTerminologyFallback instead
 */
export async function searchHubForCouncilDistricts(
  cityName: string,
  state: string
): Promise<DiscoveryResult | null> {
  return searchHubWithTerminologyFallback(cityName, state, BoundaryType.MUNICIPAL);
}

/**
 * Phase 2: County Commissioner/Supervisor District Discovery
 *
 * Search for county governing body districts using comprehensive terminology fallback.
 * Counties use varied terminology: commissioner districts, supervisorial districts, etc.
 *
 * @param countyName - County name (e.g., "Los Angeles", "Cook")
 * @param state - Two-letter state code (e.g., "CA", "IL")
 * @returns DiscoveryResult with county district boundaries, or null if not found
 */
export async function searchHubForCountyDistricts(
  countyName: string,
  state: string
): Promise<DiscoveryResult | null> {
  return searchHubWithTerminologyFallback(countyName, state, BoundaryType.COUNTY);
}

/**
 * Phase 3: Congressional District Discovery
 *
 * Search for U.S. House of Representatives district boundaries.
 * These are federally mandated and should have near-perfect availability.
 *
 * CRITICAL FOR VOTER PROTOCOL: This enables verification of congressional district
 * membership before sending messages to representatives.
 *
 * @param state - Two-letter state code or full state name (e.g., "CA", "California")
 * @returns DiscoveryResult with ALL congressional districts for the state, or null if not found
 */
export async function searchHubForCongressionalDistricts(
  state: string
): Promise<DiscoveryResult | null> {
  // For congressional districts, we search by state (not individual district)
  // The result contains ALL congressional districts for that state
  return searchHubWithTerminologyFallback(state, state, BoundaryType.CONGRESSIONAL);
}

/**
 * Phase 4: School Board District Discovery
 *
 * Search for school board trustee areas/districts.
 * School boards use varied terminology and many are at-large (no districts).
 *
 * Expected coverage: 80-85% (many boards are at-large without geographic districts)
 *
 * @param districtName - School district name (e.g., "Los Angeles Unified", "Chicago Public Schools")
 * @param state - Two-letter state code
 * @returns DiscoveryResult with school board districts, or null if at-large or not found
 */
export async function searchHubForSchoolBoardDistricts(
  districtName: string,
  state: string
): Promise<DiscoveryResult | null> {
  return searchHubWithTerminologyFallback(districtName, state, BoundaryType.SCHOOL_BOARD);
}

/**
 * Phase 5: State Legislative District Discovery (House)
 *
 * Search for state house/assembly/delegate district boundaries.
 * These should have very high availability as they're legally required.
 *
 * Expected coverage: 95-98%
 *
 * @param state - Two-letter state code or full state name
 * @returns DiscoveryResult with ALL state house districts for the state, or null if not found
 */
export async function searchHubForStateHouseDistricts(
  state: string
): Promise<DiscoveryResult | null> {
  return searchHubWithTerminologyFallback(state, state, BoundaryType.STATE_HOUSE);
}

/**
 * Phase 5: State Legislative District Discovery (Senate)
 *
 * Search for state senate district boundaries.
 * These should have very high availability as they're legally required.
 *
 * Expected coverage: 95-98%
 *
 * @param state - Two-letter state code or full state name
 * @returns DiscoveryResult with ALL state senate districts for the state, or null if not found
 */
export async function searchHubForStateSenateDistricts(
  state: string
): Promise<DiscoveryResult | null> {
  return searchHubWithTerminologyFallback(state, state, BoundaryType.STATE_SENATE);
}

/**
 * FR-008: Enhanced Boundary-Type-Aware Scoring (0-130 scale, normalized to 100)
 *
 * IMPROVEMENTS:
 * - Publisher authority verification (+15 pts)
 * - Record count validation (+15 pts)
 * - Spatial bounds verification (+10 pts)
 * - Metadata quality assessment (+10 pts)
 * - Revised recency scoring (reduced penalty for stable datasets)
 *
 * Different boundary types use different terminology.
 * Scoring must adapt based on boundaryType to avoid false positives.
 */
function calculateScore(
  metadata: any,
  candidate: HubSearchResult,
  boundaryType: BoundaryType,
  terminology: string
): number {
  let score = 0;
  const nameLC = (metadata.name || candidate.attributes.name).toLowerCase();
  const keywords = getScoringKeywords(boundaryType);

  // 1. Name matching (40 points) - boundary-type-specific
  switch (boundaryType) {
    case BoundaryType.MUNICIPAL:
      if ((nameLC.includes('council') && nameLC.includes('district')) ||
          (nameLC.includes('supervisorial') && nameLC.includes('district')) ||
          nameLC.includes('ward')) {
        score += 40;
      } else if (nameLC.includes('council') || nameLC.includes('district') ||
                 nameLC.includes('commissioner')) {
        score += 30;
      }
      break;

    case BoundaryType.COUNTY:
      if ((nameLC.includes('commissioner') && nameLC.includes('district')) ||
          (nameLC.includes('supervisorial') && nameLC.includes('district'))) {
        score += 40;
      } else if (nameLC.includes('commissioner') || nameLC.includes('supervisor') ||
                 nameLC.includes('council')) {
        score += 30;
      }
      break;

    case BoundaryType.SCHOOL_BOARD:
      if ((nameLC.includes('school') && nameLC.includes('board') && nameLC.includes('district')) ||
          nameLC.includes('trustee areas')) {
        score += 40;
      } else if (nameLC.includes('school') || nameLC.includes('trustee') ||
                 nameLC.includes('education')) {
        score += 30;
      }
      break;

    case BoundaryType.CONGRESSIONAL:
      if ((nameLC.includes('congressional') && nameLC.includes('district')) ||
          (nameLC.includes('congress') && nameLC.includes('district')) ||
          nameLC.includes('u.s. congressional')) {
        score += 40;
      } else if (nameLC.includes('congressional') || nameLC.includes('congress') ||
                 nameLC.includes('house')) {
        score += 30;
      }
      break;

    case BoundaryType.STATE_HOUSE:
    case BoundaryType.STATE_SENATE:
      if (nameLC.includes('district') && (nameLC.includes('house') || nameLC.includes('senate') ||
          nameLC.includes('assembly') || nameLC.includes('legislative'))) {
        score += 40;
      } else if (nameLC.includes('district')) {
        score += 30;
      }
      break;

    default:
      // Generic scoring for other boundary types
      if (nameLC.includes('district')) score += 30;
      break;
  }

  // 2. Geometry type (20 points)
  if (metadata.geometryType === 'esriGeometryPolygon') score += 20;
  else if (metadata.geometryType === 'esriGeometryPolyline') score += 10;

  // 3. Field validation (20 points) - boundary-type-specific keywords
  if (metadata.fields && Array.isArray(metadata.fields)) {
    const matchingFields = metadata.fields.filter((f: any) => {
      const fname = f.name.toLowerCase();
      return keywords.fieldKeywords.some(kw => fname.includes(kw.toLowerCase()));
    });

    if (matchingFields.length >= 2) score += 20;
    else if (matchingFields.length === 1) score += 10;
  }

  // 4. Publisher Authority (15 points) - NEW
  // Official government datasets score higher
  const ownerName = candidate.attributes.owner?.toLowerCase() || '';
  const orgId = candidate.attributes.orgId?.toLowerCase() || '';

  if (ownerName.includes('county') || ownerName.includes('city') ||
      ownerName.includes('government') || ownerName.includes('gis') ||
      ownerName.includes('state') || ownerName.includes('municipal') ||
      orgId.includes('gov')) {
    score += 15;
  } else if (ownerName.length > 0) {
    // Non-government but verified publisher
    score += 5;
  }

  // 5. Record Count Validation (15 points) - NEW
  // Boundary datasets should have reasonable number of features
  const recordCount = metadata.extent?.features || metadata.count || 0;

  let expectedRange: { min: number; max: number };
  switch (boundaryType) {
    case BoundaryType.COUNTY:
      expectedRange = { min: 3, max: 25 };  // Counties typically have 3-25 commissioner/supervisor districts
      break;
    case BoundaryType.MUNICIPAL:
      expectedRange = { min: 3, max: 20 };  // Cities typically have 3-20 council districts
      break;
    case BoundaryType.SCHOOL_BOARD:
      expectedRange = { min: 3, max: 15 };  // School boards typically have 3-15 trustee areas
      break;
    case BoundaryType.CONGRESSIONAL:
      expectedRange = { min: 1, max: 53 };  // States have 1-53 congressional districts (CA has 53)
      break;
    case BoundaryType.STATE_HOUSE:
      expectedRange = { min: 10, max: 400 };  // State houses vary widely (NH has 400!)
      break;
    case BoundaryType.STATE_SENATE:
      expectedRange = { min: 10, max: 67 };  // State senates more uniform (MN has 67)
      break;
    default:
      expectedRange = { min: 3, max: 50 };
  }

  if (recordCount >= expectedRange.min && recordCount <= expectedRange.max) {
    score += 15;
  } else if (recordCount > 0 && recordCount < expectedRange.max * 2) {
    // Plausible but outside expected range
    score += 8;
  }

  // 6. Metadata Quality (10 points) - NEW
  // Well-documented datasets indicate professional maintenance
  const description = metadata.description || candidate.attributes.snippet || candidate.attributes.description || '';
  if (description.length > 100) score += 5;  // Has substantive description
  if (metadata.editingInfo?.lastEditDate !== undefined) score += 5;  // Has edit tracking

  // 7. Revised Recency Scoring (10 points) - MODIFIED
  // Reduced penalty for stable official datasets
  if (metadata.editingInfo?.lastEditDate) {
    const lastEdit = new Date(metadata.editingInfo.lastEditDate);
    const now = new Date();
    const daysSinceEdit = (now.getTime() - lastEdit.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceEdit < 180) score += 10;       // Very recent (6 months)
    else if (daysSinceEdit < 730) score += 8;   // Recent enough (2 years) - stable is OK
    else if (daysSinceEdit < 1825) score += 5;  // Within 5 years - could be stable boundaries
    // No penalty for older datasets - boundaries don't change frequently
  }

  // Total possible: 130 points
  // Normalize to 0-100 scale
  const normalizedScore = Math.round((score / 130) * 100);
  return Math.min(normalizedScore, 100);
}

/**
 * Batch discovery for multiple municipalities
 */
export async function batchHubDiscovery(
  municipalities: Array<{ name: string; state: string }>
): Promise<Map<string, DiscoveryResult | null>> {
  const results = new Map<string, DiscoveryResult | null>();

  for (const muni of municipalities) {
    const key = `${muni.state}-${muni.name}`;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing: ${muni.name}, ${muni.state}`);
    console.log('='.repeat(80));

    const result = await searchHubForCouncilDistricts(muni.name, muni.state);
    results.set(key, result);

    // Be respectful to Hub API - small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}
