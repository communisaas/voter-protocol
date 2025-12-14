/**
 * Socrata Open Data Portal Scanner
 *
 * Searches Socrata-powered open data portals for city council district boundaries.
 *
 * API Documentation:
 * - Discovery API: https://api.us.socrata.com/api/catalog/v1
 * - SODA API: https://dev.socrata.com/foundry/
 *
 * Search Strategy:
 * 1. Prioritize city-specific domains (data.{city}.gov, {city}.data.gov)
 * 2. Query Socrata Discovery API for council/ward/district datasets
 * 3. Filter by GeoJSON availability and polygon geometry
 * 4. Score candidates using SemanticLayerValidator (negative keyword filtering)
 *
 * Quality Improvements (Nov 2025):
 * - SemanticLayerValidator integration: Rejects voting precincts, canopy, zoning
 * - Stricter confidence threshold: 50+ (was 40)
 * - Consistent validation across all scanners (ArcGIS, CKAN, Socrata)
 *
 * Quality: ~20-40% success rate (better metadata than ArcGIS, fewer false positives)
 * Coverage: Major US cities + international (Socrata used globally)
 */

import type { CityTarget } from '../providers/us-council-district-discovery.js';
import type { PortalCandidate } from './arcgis-hub.js';
import { SemanticValidator } from '../validation/semantic-validator.js';

/**
 * City-specific Socrata portal patterns
 */
const CITY_PORTAL_PATTERNS: Record<string, string[]> = {
  // Major US cities with known Socrata portals
  'Seattle': ['data.seattle.gov'],
  'Kansas City': ['data.kcmo.org'],
  'San Francisco': ['data.sfgov.org'],
  'Chicago': ['data.cityofchicago.org'],
  'New York': ['data.cityofnewyork.us'],
  'Los Angeles': ['data.lacity.org'],
  'Baltimore': ['data.baltimorecity.gov'],
  'Austin': ['data.austintexas.gov'],
  'Portland': ['gis-pdx.opendata.arcgis.com'], // Portland uses ArcGIS Open Data (Socrata-compatible)
  'Denver': ['opendata.denvergov.org'],
  'Boston': ['data.boston.gov'],
  'Philadelphia': ['opendataphilly.org'],
  'San Diego': ['data.sandiego.gov'],
};

/**
 * Socrata Open Data Portal Scanner
 */
export class SocrataScanner {
  private readonly DISCOVERY_API_BASE = 'https://api.us.socrata.com/api/catalog/v1';
  private readonly semanticValidator: SemanticValidator;

  constructor() {
    this.semanticValidator = new SemanticValidator();
  }

  /**
   * Search for council district datasets
   */
  async search(city: CityTarget): Promise<PortalCandidate[]> {
    const candidates: PortalCandidate[] = [];

    // Try city-specific portals first (highest quality)
    const cityPortals = CITY_PORTAL_PATTERNS[city.name] || [];
    for (const domain of cityPortals) {
      try {
        const portalResults = await this.searchDomain(domain, city);
        candidates.push(...portalResults);
      } catch (error) {
        console.warn(`   Socrata domain ${domain} failed: ${(error as Error).message}`);
      }
    }

    // If no city-specific results, try general discovery API
    if (candidates.length === 0) {
      try {
        const discoveryResults = await this.searchDiscoveryAPI(city);
        candidates.push(...discoveryResults);
      } catch (error) {
        console.warn(`   Socrata discovery failed: ${(error as Error).message}`);
      }
    }

    return this.rankCandidates(candidates, city);
  }

  /**
   * Search a specific Socrata domain
   */
  private async searchDomain(domain: string, city: CityTarget): Promise<PortalCandidate[]> {
    const query = `council district OR ward`;
    const url = `https://${domain}/api/catalog/v1?q=${encodeURIComponent(query)}&only=dataset&limit=10`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Socrata domain API returned ${response.status}`);
    }

    const data = await response.json() as {
      results: Array<{
        resource: {
          id: string;
          name: string;
          description?: string;
          distribution?: Array<{
            downloadURL?: string;
            mediaType?: string;
          }>;
        };
      }>;
    };

    const candidates: PortalCandidate[] = [];

    for (const result of data.results) {
      const resource = result.resource;

      // Find GeoJSON distribution
      const geojsonDist = resource.distribution?.find(d =>
        d.mediaType?.includes('geo+json') || d.downloadURL?.includes('geojson')
      );

      if (!geojsonDist?.downloadURL) {
        continue;
      }

      candidates.push({
        id: resource.id,
        title: resource.name,
        description: resource.description || '',
        url: `https://${domain}/resource/${resource.id}`,
        downloadUrl: geojsonDist.downloadURL,
        score: this.scoreTitle(resource.name, city),
        portalType: 'socrata' as const,
      });
    }

    return candidates;
  }

  /**
   * Search Socrata Discovery API (general search across all portals)
   */
  private async searchDiscoveryAPI(city: CityTarget): Promise<PortalCandidate[]> {
    const query = `${city.name} ${city.state} council district OR ward`;
    const url = `${this.DISCOVERY_API_BASE}?q=${encodeURIComponent(query)}&only=dataset&limit=20`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Socrata Discovery API returned ${response.status}`);
    }

    const data = await response.json() as {
      results: Array<{
        resource: {
          id: string;
          name: string;
          description?: string;
          distribution?: Array<{
            downloadURL?: string;
            mediaType?: string;
          }>;
        };
        permalink?: string;
      }>;
    };

    const candidates: PortalCandidate[] = [];

    for (const result of data.results) {
      const resource = result.resource;

      // Find GeoJSON distribution
      const geojsonDist = resource.distribution?.find(d =>
        d.mediaType?.includes('geo+json') || d.downloadURL?.includes('geojson')
      );

      if (!geojsonDist?.downloadURL) {
        continue;
      }

      // Filter: Must mention city or state
      const title = resource.name.toLowerCase();
      const hasCityReference =
        title.includes(city.name.toLowerCase()) ||
        title.includes(city.state.toLowerCase());

      if (!hasCityReference) {
        continue;
      }

      candidates.push({
        id: resource.id,
        title: resource.name,
        description: resource.description || '',
        url: result.permalink || geojsonDist.downloadURL,
        downloadUrl: geojsonDist.downloadURL,
        score: this.scoreTitle(resource.name, city),
        portalType: 'socrata' as const,
      });
    }

    return candidates;
  }

  /**
   * Score title for relevance using SemanticLayerValidator + geographic bonuses
   *
   * VALIDATION STRATEGY:
   * 1. Semantic validation FIRST (catches precincts, canopy, zoning via negative keywords)
   * 2. If rejected (score=0), return 0 immediately
   * 3. Otherwise, add city/state bonuses for geographic relevance
   *
   * IMPROVEMENT: Was simple keyword matching. Now uses production-ready validator
   * with comprehensive negative keyword filtering.
   */
  private scoreTitle(title: string, city: CityTarget, tags: readonly string[] = [], description = ''): number {
    // Step 1: Semantic validation (catches negative keywords)
    const semanticResult = this.semanticValidator.scoreTitle(title);

    // If semantic validator rejected it (negative keyword, wrong granularity), skip
    if (semanticResult.score === 0) {
      console.log(`   ⚠️  Dataset rejected: ${title}`);
      console.log(`   Reasons: ${semanticResult.reasons.join(', ')}`);
      return 0;
    }

    // Step 2: Start with semantic score (0-100)
    let score = semanticResult.score;

    // Step 3: Add geographic bonuses (city/state match)
    const titleLower = title.toLowerCase();
    const cityLower = city.name.toLowerCase();
    const stateLower = city.state.toLowerCase();

    // City name match: +15
    if (titleLower.includes(cityLower)) {
      score += 15;
    }

    // State match: +10
    if (titleLower.includes(stateLower)) {
      score += 10;
    }

    return Math.min(100, score); // Clamp to 100 max
  }

  /**
   * Rank candidates by score
   */
  private rankCandidates(candidates: PortalCandidate[], city: CityTarget): PortalCandidate[] {
    // Score all candidates
    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.scoreTitle(candidate.title, city),
    }));

    // Filter to candidates with score >= 50 (semantic validation threshold)
    const validCandidates = scored.filter(c => c.score >= 50);

    // Sort by score descending
    return validCandidates.sort((a, b) => b.score - a.score);
  }
}
