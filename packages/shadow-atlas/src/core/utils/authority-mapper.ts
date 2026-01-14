/**
 * Authority Level Mapper
 *
 * Maps portal types and discovery sources to authority levels for provenance tracking.
 *
 * AUTHORITY HIERARCHY:
 * 5 (federal-mandate)   - US Census TIGER, Statistics Canada
 * 4 (state-agency)      - State GIS clearinghouses (geodata.hawaii.gov, gis.ny.gov)
 * 3 (municipal-agency)  - City open data portals (data.seattle.gov)
 * 2 (county-agency)     - County GIS departments
 * 1 (commercial-aggregator) - Commercial APIs (Cicero, Google Civic)
 * 0 (community-maintained) - OpenStreetMap, volunteer efforts
 */

import type { PortalType } from '../types/discovery.js';
import type { AuthorityLevel } from '../types/provider.js';

/**
 * Map portal type to authority level
 *
 * @param portalType - Portal type from discovery
 * @returns Authority level (0-5 for provenance, or string for provider)
 */
export function mapPortalToAuthority(portalType: PortalType): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
} {
  switch (portalType) {
    case 'census-tiger':
      return {
        numeric: 5,
        semantic: 'federal-mandate',
      };

    case 'state-gis':
      return {
        numeric: 4,
        semantic: 'state-agency',
      };

    case 'arcgis':
    case 'socrata':
    case 'ckan':
    case 'arcgis-hub':
    case 'arcgis-online':
    case 'municipal-gis':
      // City/county portals - assume municipal unless we know otherwise
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'custom-api':
    case 'static-file':
      // Could be municipal or commercial - default to commercial
      return {
        numeric: 1,
        semantic: 'commercial-aggregator',
      };

    default:
      // Unknown portal type - lowest authority
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };
  }
}

/**
 * Map collection method to authority level
 *
 * @param collectionMethod - How the data was collected
 * @returns Authority level
 */
export function mapCollectionMethodToAuthority(collectionMethod: string): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
} {
  switch (collectionMethod) {
    case 'census-tiger':
    case 'national-statistics':
      return {
        numeric: 5,
        semantic: 'federal-mandate',
      };

    case 'portal-discovery':
      // Default to municipal for portal discovery
      // (can be refined based on actual portal)
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'manual-verification':
      // Manual verification implies human review - municipal quality
      return {
        numeric: 3,
        semantic: 'municipal-agency',
      };

    case 'commercial-api':
      return {
        numeric: 1,
        semantic: 'commercial-aggregator',
      };

    case 'community-aggregation':
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };

    default:
      return {
        numeric: 0,
        semantic: 'community-maintained',
      };
  }
}

/**
 * Determine authority level from portal URL
 *
 * Some portals can be identified as state vs municipal based on URL patterns
 *
 * @param url - Portal URL
 * @param defaultPortalType - Default portal type if URL doesn't match known patterns
 * @returns Authority level
 */
export function mapUrlToAuthority(
  url: string,
  defaultPortalType: PortalType = 'arcgis'
): {
  numeric: 0 | 1 | 2 | 3 | 4 | 5;
  semantic: AuthorityLevel;
  detectedType: PortalType;
} {
  const urlLower = url.toLowerCase();

  // State GIS patterns
  const stateGisPatterns = [
    'geodata.hawaii.gov',
    'gis.ny.gov',
    'data.colorado.gov',
    'gisdata.mn.gov',
    'geo.wa.gov',
    'spatialdata.oregonexplorer.info',
    'gis.data.ca.gov',
    'data.tnris.org',
    'geodata.floridagio.gov',
    'www.pasda.psu.edu',
    'clearinghouse.isgs.illinois.edu',
    'ogrip.oit.ohio.gov',
    'gis-michigan.opendata.arcgis.com',
    'www.nconemap.gov',
    'vgin.vdem.virginia.gov',
    'data.georgiaspatial.org',
    'www.mass.gov/info-details/massgis',
    'data-wi-dnr.opendata.arcgis.com',
  ];

  for (const pattern of stateGisPatterns) {
    if (urlLower.includes(pattern)) {
      return {
        numeric: 4,
        semantic: 'state-agency',
        detectedType: 'state-gis',
      };
    }
  }

  // Census TIGER patterns
  if (urlLower.includes('census.gov') || urlLower.includes('tiger')) {
    return {
      numeric: 5,
      semantic: 'federal-mandate',
      detectedType: 'census-tiger',
    };
  }

  // Default to provided portal type
  const defaultAuthority = mapPortalToAuthority(defaultPortalType);
  return {
    ...defaultAuthority,
    detectedType: defaultPortalType,
  };
}

/**
 * Get human-readable authority label
 *
 * @param level - Authority level (numeric 0-5)
 * @returns Human-readable label
 */
export function getAuthorityLabel(level: 0 | 1 | 2 | 3 | 4 | 5): string {
  const labels: Record<number, string> = {
    5: 'Federal Mandate (Highest)',
    4: 'State Agency (High)',
    3: 'Municipal Agency (Medium-High)',
    2: 'County Agency (Medium)',
    1: 'Commercial Aggregator (Low)',
    0: 'Community Maintained (Lowest)',
  };

  return labels[level] || 'Unknown';
}

/**
 * Compare authority levels
 *
 * @param a - First authority level
 * @param b - Second authority level
 * @returns Positive if a > b, negative if a < b, 0 if equal
 */
export function compareAuthority(
  a: 0 | 1 | 2 | 3 | 4 | 5,
  b: 0 | 1 | 2 | 3 | 4 | 5
): number {
  return a - b;
}

/**
 * Select highest authority source from multiple candidates
 *
 * @param candidates - Array of candidates with authority levels
 * @returns Candidate with highest authority level
 */
export function selectHighestAuthority<T extends { auth: number }>(
  candidates: T[]
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((highest, current) =>
    current.auth > highest.auth ? current : highest
  );
}
