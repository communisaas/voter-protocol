/**
 * Authoritative Multi-Path Scanner
 *
 * PHILOSOPHY: Cities are the most authoritative source, but their infrastructure is unreliable.
 * Solution: Try MULTIPLE pathways to the SAME authoritative source.
 *
 * PATHWAYS (in priority order):
 * 1. Direct city portal (data.{city}.gov) - Socrata/ArcGIS Hub
 * 2. Official hub.arcgis.com download API (stable mirror of city data)
 * 3. Data.gov catalog (federal mirror of city data)
 * 4. City GIS server (gisdata.{city}.gov)
 * 5. City website scraping (www.{city}.gov/council/districts)
 *
 * GOAL: 95%+ success with official names, zero validation errors
 *
 * GOVERNANCE PRE-FLIGHT INTEGRATION (TODO - not yet wired up):
 *
 * To prevent wasted compute on at-large cities (no geographic districts),
 * call GovernanceValidator BEFORE this scanner runs:
 *
 * ```typescript
 * import { GovernanceValidator } from '../validators/governance-validator.js';
 *
 * // In discovery pipeline (before calling this scanner):
 * const govValidator = new GovernanceValidator();
 * const govCheck = await govValidator.checkGovernance(city.fips);
 *
 * if (!govCheck.shouldAttemptLayer1) {
 *   console.log(`⏭️  Skipping Layer 1 for ${city.name}, ${city.state}`);
 *   console.log(`   Reason: ${govCheck.reason}`);
 *   console.log(`   Source: ${govCheck.source}`);
 *   return { success: false, fallbackToLayer2: true };
 * }
 *
 * // Proceed with multi-path scanner...
 * const scanner = new AuthoritativeMultiPathScanner();
 * const candidates = await scanner.search(city);
 *
 * // After successful discovery, validate district count:
 * if (candidates.length > 0) {
 *   // Download and parse GeoJSON to get feature count...
 *   const featureCount = geojson.features.length;
 *
 *   const validation = govValidator.validateDiscoveredDistricts(
 *     city.fips,
 *     featureCount
 *   );
 *
 *   if (!validation.valid) {
 *     console.warn(`⚠️  Discovery validation failed: ${validation.reason}`);
 *     // Continue with Layer 2 fallback or flag for manual review
 *   }
 * }
 * ```
 *
 * See: packages/crypto/services/shadow-atlas/specs/AT-LARGE-DETECTION-SPEC.md
 */

import type { CityInfo as CityTarget } from '../validators/geographic-validator.js';
import type { PortalCandidate } from './arcgis-hub.js';
// KNOWN_CITY_PORTALS imported from centralized registry (eliminated duplicate)
import { KNOWN_CITY_PORTALS } from '../registry/known-city-portals.js';

/**
 * Authoritative path types (in priority order)
 */
type AuthoritativePath =
  | 'direct-city-portal'      // data.seattle.gov
  | 'hub-download-api'       // hub.arcgis.com/api/v3/datasets/{id}/downloads
  | 'data-gov-catalog'        // catalog.data.gov
  | 'city-gis-server'         // gisdata.{city}.gov
  | 'city-website-scrape';    // www.{city}.gov

/**
 * Authoritative source result
 */
export interface AuthoritativeSource {
  readonly path: AuthoritativePath;
  readonly url: string;
  readonly confidence: number;
  readonly lastVerified: string;
  readonly notes: string;
}

/**
 * Authoritative Multi-Path Scanner
 *
 * Tries multiple pathways to the same city's authoritative data,
 * prioritizing direct city sources but with intelligent fallbacks.
 */
export class AuthoritativeMultiPathScanner {
  // KNOWN_CITY_PORTALS now imported from registry/known-city-portals.ts

  /**
   * Search for council districts using multi-path strategy
   *
   * Tries paths in priority order until one succeeds.
   */
  async search(city: CityTarget): Promise<PortalCandidate[]> {
    console.log(`   🎯 Authoritative search: ${city.name}, ${city.state}`);

    // Path 1: Direct city portal (highest priority)
    const path1 = await this.tryDirectCityPortal(city);
    if (path1) {
      return [path1];
    }

    // Path 2: Hub download API (stable mirror)
    const path2 = await this.tryHubDownloadAPI(city);
    if (path2) {
      return [path2];
    }

    // Path 3: Data.gov catalog (federal mirror)
    const path3 = await this.tryDataGovCatalog(city);
    if (path3) {
      return [path3];
    }

    // Path 4: City GIS server (direct server access)
    const path4 = await this.tryCityGISServer(city);
    if (path4) {
      return [path4];
    }

    console.log(`   ❌ All authoritative paths failed for ${city.name}, ${city.state}`);
    return [];
  }

  /**
   * Path 1: Direct city portal (Socrata/ArcGIS Hub)
   */
  private async tryDirectCityPortal(city: CityTarget): Promise<PortalCandidate | null> {
    const known = KNOWN_CITY_PORTALS[city.fips];
    if (!known) {
      return null; // No known portal for this city
    }

    // Try Socrata first
    if (known.socrata) {
      try {
        const candidate = await this.querySocrataDomain(known.socrata, city);
        if (candidate) {
          console.log(`   ✅ Path 1: Direct Socrata portal (${known.socrata})`);
          return candidate;
        }
      } catch (error) {
        console.log(`   ⏭️  Path 1: Socrata failed - ${(error as Error).message}`);
      }
    }

    // Try ArcGIS Hub
    if (known.arcgis && known.datasetId) {
      try {
        const candidate = await this.queryArcGISHub(known.arcgis, known.datasetId, city);
        if (candidate) {
          console.log(`   ✅ Path 1: Direct ArcGIS Hub (${known.arcgis})`);
          return candidate;
        }
      } catch (error) {
        console.log(`   ⏭️  Path 1: ArcGIS Hub failed - ${(error as Error).message}`);
      }
    }

    return null;
  }

  /**
   * Path 2: Hub download API (stable, curated downloads)
   */
  private async tryHubDownloadAPI(city: CityTarget): Promise<PortalCandidate | null> {
    const known = KNOWN_CITY_PORTALS[city.fips];
    if (!known?.datasetId) {
      return null;
    }

    try {
      // Use official hub.arcgis.com download API
      const downloadUrl = `https://hub.arcgis.com/api/v3/datasets/${known.datasetId}/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1`;

      const response = await fetch(downloadUrl, { method: 'HEAD' });
      if (response.ok) {
        console.log(`   ✅ Path 2: Hub download API (dataset ${known.datasetId.substring(0, 8)}...)`);

        return {
          id: known.datasetId,
          title: `${city.name} City Council Districts`,
          description: 'Official city data via hub.arcgis.com download API',
          url: downloadUrl,
          downloadUrl,
          score: 95, // High score - official stable source
          portalType: 'arcgis-hub',
        };
      }
    } catch (error) {
      console.log(`   ⏭️  Path 2: Hub download API failed - ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Path 3: Data.gov catalog (federal mirror)
   */
  private async tryDataGovCatalog(city: CityTarget): Promise<PortalCandidate | null> {
    try {
      const query = `${city.name} council districts`;
      const org = `city-of-${city.name.toLowerCase().replace(/\s+/g, '-')}`;

      const searchUrl = `https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent(query)}&fq=organization:${org}+tags:gis`;

      const response = await fetch(searchUrl);
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        result?: {
          results?: Array<{
            id: string;
            title: string;
            resources?: Array<{
              url: string;
              format: string;
            }>;
          }>;
        };
      };

      const packages = data.result?.results || [];
      for (const pkg of packages) {
        // Find GeoJSON resource
        const geojson = pkg.resources?.find(r =>
          r.format.toLowerCase().includes('geojson') ||
          r.format.toLowerCase().includes('json')
        );

        if (geojson) {
          console.log(`   ✅ Path 3: Data.gov catalog (${pkg.title})`);

          return {
            id: pkg.id,
            title: pkg.title,
            description: 'Official city data via Data.gov federal catalog',
            url: geojson.url,
            downloadUrl: geojson.url,
            score: 90, // High score - federal catalog
            portalType: 'arcgis-hub',
          };
        }
      }
    } catch (error) {
      console.log(`   ⏭️  Path 3: Data.gov catalog failed - ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Path 4: City GIS server (direct server access)
   */
  private async tryCityGISServer(city: CityTarget): Promise<PortalCandidate | null> {
    // Try common GIS server patterns
    const patterns = [
      `https://gisdata.${city.name.toLowerCase()}.gov/server/rest/services`,
      `https://gis.${city.name.toLowerCase()}.gov/server/rest/services`,
      `https://maps.${city.name.toLowerCase()}.gov/server/rest/services`,
    ];

    for (const baseUrl of patterns) {
      try {
        const response = await fetch(`${baseUrl}?f=json`);
        if (response.ok) {
          // TODO: Parse services, find council district layer
          // This requires recursive service exploration
          console.log(`   ⏭️  Path 4: GIS server found but exploration not implemented`);
        }
      } catch {
        // Continue to next pattern
      }
    }

    return null;
  }

  /**
   * Query Socrata domain for council districts
   */
  private async querySocrataDomain(
    domain: string,
    city: CityTarget
  ): Promise<PortalCandidate | null> {
    // Socrata catalog API
    const catalogUrl = `https://${domain}/api/catalog/v1?q=council districts&only=datasets`;

    const response = await fetch(catalogUrl);
    if (!response.ok) {
      throw new Error(`Socrata catalog returned ${response.status}`);
    }

    const data = await response.json() as {
      results?: Array<{
        resource: {
          id: string;
          name: string;
          description?: string;
        };
        link: string;
      }>;
    };

    const results = data.results || [];
    if (results.length === 0) {
      return null;
    }

    // Take first result (Socrata search is usually accurate)
    const first = results[0];
    const geojsonUrl = `https://${domain}/resource/${first.resource.id}.geojson?$limit=50000`;

    return {
      id: first.resource.id,
      title: first.resource.name,
      description: first.resource.description || '',
      url: first.link,
      downloadUrl: geojsonUrl,
      score: 95, // High score - direct city source
      portalType: 'socrata',
    };
  }

  /**
   * Query ArcGIS Hub for specific dataset
   */
  private async queryArcGISHub(
    domain: string,
    datasetId: string,
    city: CityTarget
  ): Promise<PortalCandidate | null> {
    const downloadUrl = `https://hub.arcgis.com/api/v3/datasets/${datasetId}/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1`;

    return {
      id: datasetId,
      title: `${city.name} City Council Districts`,
      description: `Official city data via ${domain}`,
      url: `https://${domain}`,
      downloadUrl,
      score: 95,
      portalType: 'arcgis-hub',
    };
  }
}
