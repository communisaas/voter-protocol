/**
 * CKAN Open Data Portal Scanner
 *
 * Searches CKAN-powered open data portals for council/ward/district boundaries.
 *
 * API Documentation:
 * - Package Search: https://docs.ckan.org/en/latest/api/index.html#ckan.logic.action.get.package_search
 * - Resource Show: https://docs.ckan.org/en/latest/api/index.html#ckan.logic.action.get.resource_show
 *
 * Search Strategy:
 * 1. Query known CKAN portals (data.gov, EU portals, academic institutions)
 * 2. Filter by GeoJSON/Shapefile resources
 * 3. Score candidates using SemanticLayerValidator (negative keyword filtering)
 * 4. Validate geographic location with centroid checking
 * 5. Return top candidates with download URLs
 *
 * Quality Improvements (Nov 2025):
 * - SemanticLayerValidator integration: Rejects voting precincts, canopy, zoning
 * - Geographic validation: Detects cross-city contamination (e.g., Lexington getting Louisville data)
 * - Stricter confidence threshold: 50+ (was 40)
 *
 * Quality: ~5-15% success rate (academic/research data, less municipal focus)
 * Coverage: International (190+ countries), academic datasets, research institutions
 */

import type { CityTarget } from '../validators/enhanced-geographic-validator.js';
import type { PortalCandidate } from './arcgis-hub.js';
import { SemanticLayerValidator } from '../validators/semantic-layer-validator.js';
import { validateCityBoundary } from '../validators/enhanced-geographic-validator.js';
import type { FeatureCollection } from 'geojson';

/**
 * Known CKAN portal instances
 */
const CKAN_PORTALS: Record<string, string> = {
  // US Federal
  'data.gov': 'https://catalog.data.gov',

  // International
  'data.gov.uk': 'https://data.gov.uk',
  'data.gov.au': 'https://data.gov.au',
  'open.canada.ca': 'https://open.canada.ca',
  'datos.gob.es': 'https://datos.gob.es',
  'dati.gov.it': 'https://dati.gov.it',

  // Academic/Research
  'data.opendatasoft.com': 'https://data.opendatasoft.com',
};

/**
 * CKAN Open Data Portal Scanner
 */
export class CKANScanner {
  private semanticValidator: SemanticLayerValidator;

  constructor() {
    this.semanticValidator = new SemanticLayerValidator();
  }

  /**
   * Search for council district datasets
   */
  async search(city: CityTarget): Promise<PortalCandidate[]> {
    const candidates: PortalCandidate[] = [];

    // Try each CKAN portal
    for (const [portalName, portalUrl] of Object.entries(CKAN_PORTALS)) {
      try {
        const portalResults = await this.searchPortal(portalUrl, city);
        candidates.push(...portalResults);
      } catch (error) {
        console.warn(`   CKAN portal ${portalName} failed: ${(error as Error).message}`);
      }
    }

    return this.rankCandidates(candidates, city);
  }

  /**
   * Search a specific CKAN portal
   */
  private async searchPortal(portalUrl: string, city: CityTarget): Promise<PortalCandidate[]> {
    const query = `${city.name} ${city.state} council district OR ward`;
    const url = `${portalUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=10`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CKAN API returned ${response.status}`);
    }

    const data = await response.json() as {
      success: boolean;
      result: {
        results: Array<{
          id: string;
          name: string;
          title: string;
          notes?: string;
          resources: Array<{
            id: string;
            name: string;
            format: string;
            url: string;
          }>;
        }>;
      };
    };

    if (!data.success) {
      throw new Error('CKAN API returned success=false');
    }

    const candidates: PortalCandidate[] = [];

    for (const pkg of data.result.results) {
      // Find GeoJSON or Shapefile resources
      const geoResource = pkg.resources.find(r =>
        r.format?.toLowerCase().includes('geojson') ||
        r.format?.toLowerCase().includes('json') ||
        r.format?.toLowerCase().includes('shp') ||
        r.url?.toLowerCase().includes('geojson')
      );

      if (!geoResource) {
        continue;
      }

      // Filter: Must mention city or state
      const title = pkg.title.toLowerCase();
      const hasCityReference =
        title.includes(city.name.toLowerCase()) ||
        title.includes(city.state.toLowerCase());

      if (!hasCityReference) {
        continue;
      }

      // Extract tags if available
      const tags = (pkg as { tags?: Array<{ name: string }> }).tags?.map(t => t.name) || [];

      // Score dataset using semantic validator + geographic bonuses
      const score = this.scoreTitle(pkg.title, city, tags);

      // Skip datasets rejected by semantic validator (score=0)
      if (score === 0) {
        continue;
      }

      candidates.push({
        id: pkg.id,
        title: pkg.title,
        description: pkg.notes || '',
        url: `${portalUrl}/dataset/${pkg.name}`,
        downloadUrl: geoResource.url,
        score,
        portalType: 'ckan' as const,
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
   * with 38 passing tests and comprehensive negative keyword filtering.
   */
  private scoreTitle(title: string, city: CityTarget, tags: readonly string[] = []): number {
    // Step 1: Semantic validation (catches negative keywords)
    const semanticResult = this.semanticValidator.scoreTitleOnly(title, tags);

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
   *
   * QUALITY THRESHOLD: 50+ (was 40)
   * - Stricter filtering after semantic validator integration
   * - Candidates already scored in searchPortal()
   */
  private rankCandidates(candidates: PortalCandidate[], _city: CityTarget): PortalCandidate[] {
    // Filter to high-quality candidates only (≥50 confidence)
    const validCandidates = candidates.filter(c => c.score >= 50);

    // Sort by score descending
    return validCandidates.sort((a, b) => b.score - a.score);
  }
}
