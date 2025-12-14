/**
 * Source Registry - Canonical Source Management
 *
 * Manages authority and freshness metadata for each boundary type.
 * Implements DATA-PROVENANCE-SPEC Section 2 (Canonical Source Registry).
 *
 * CRITICAL INSIGHT: Authority and freshness are orthogonal.
 * - Authority = who has legal jurisdiction to define the boundary
 * - Freshness = when was the data last updated
 *
 * Census is an AGGREGATOR, not an authority. The entity with legal
 * jurisdiction (state legislature for congressional districts, city
 * council for council districts) is the authority.
 *
 * Resolution rule: freshest primary source > freshest aggregator
 */

import { BoundaryType } from '../core/types.js';

/**
 * Authority source - the legal entity that DEFINES the boundary
 *
 * This is the PRIMARY source: the organization with legal authority
 * to establish and modify the boundaries.
 */
interface AuthoritySource {
  /** Legal entity with jurisdiction (e.g., "CA Citizens Redistricting Commission") */
  readonly entity: string;

  /** Legal basis for authority (e.g., "CA Constitution Article XXI") */
  readonly legalBasis: string;

  /** Direct download URL if available (null if no public API) */
  readonly publishUrl: string | null;

  /** When authority publishes updates (e.g., "Post-redistricting cycle") */
  readonly publishSchedule: string;

  /** Whether authority varies by state/jurisdiction */
  readonly variesByState?: boolean;

  /** Typical lag from legal adoption to publication (in days) */
  readonly publicationLag?: number;
}

/**
 * Aggregator source - republishes authoritative data with standardization
 *
 * This is a SECONDARY source: aggregates and standardizes data from
 * multiple primary authorities. More convenient but less fresh.
 */
interface AggregatorSource {
  /** Aggregator name (e.g., "Census TIGER") */
  readonly name: string;

  /** URL template with {YEAR} placeholder (e.g., "https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/") */
  readonly urlTemplate: string;

  /** Typical delay after authoritative publication (e.g., "6-18 months") */
  readonly lag: string;

  /** File format provided */
  readonly format: 'shapefile' | 'geojson' | 'geopackage';

  /** When to use this source (e.g., "Primary source unavailable") */
  readonly useWhen: string;

  /** Release schedule (e.g., "Annual in July") */
  readonly releaseSchedule: string;
}

/**
 * Source configuration for a boundary type
 */
interface SourceConfig {
  /** Boundary type this config applies to */
  readonly boundaryType: BoundaryType;

  /** Primary authority source (legally authoritative) */
  readonly primaryAuthority: AuthoritySource;

  /** Aggregator sources (convenience, standardization) */
  readonly aggregators: readonly AggregatorSource[];

  /** Notes about this boundary type's data landscape */
  readonly notes?: string;
}

/**
 * Freshness check result from HEAD request
 */
interface FreshnessCheck {
  /** Whether source is currently available */
  readonly available: boolean;

  /** Last modified timestamp (Unix milliseconds) */
  readonly lastModified: number;

  /** ETag for change detection (null if not provided) */
  readonly etag: string | null;

  /** Whether data passes validity window check */
  readonly isValid: boolean;

  /** Reason for invalidity (if isValid=false) */
  readonly invalidReason?: string;
}

/**
 * Selected source after resolution
 */
interface SelectedSource {
  /** The selected source (authority or aggregator) */
  readonly source: AuthoritySource | AggregatorSource;

  /** Why this source was selected */
  readonly reason: string;

  /** Freshness check result */
  readonly freshness: FreshnessCheck;

  /** Whether this is the primary (authoritative) source */
  readonly isPrimary: boolean;

  /** Confidence score (0-100) based on freshness and authority */
  readonly confidence: number;
}

/**
 * Source Registry
 *
 * Manages canonical source configurations for each boundary type.
 * Implements authority vs aggregator distinction and freshness-based selection.
 */
export class SourceRegistry {
  private readonly configs: Map<BoundaryType, SourceConfig>;

  constructor() {
    this.configs = this.initializeConfigs();
  }

  /**
   * Initialize canonical source configurations for US boundary types
   *
   * AUTHORITY HIERARCHY:
   * 1. Congressional: State Redistricting Authority (varies by state)
   * 2. State Legislature: State Legislature
   * 3. County: State (aggregator: Census TIGER)
   * 4. City Council: City Council (varies by municipality)
   */
  private initializeConfigs(): Map<BoundaryType, SourceConfig> {
    const configs = new Map<BoundaryType, SourceConfig>();

    // Congressional Districts
    configs.set(BoundaryType.CONGRESSIONAL_DISTRICT, {
      boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
      primaryAuthority: {
        entity: 'State Redistricting Authority',
        legalBasis: 'Varies by state (state constitution or statute)',
        publishUrl: null, // Varies by state
        publishSchedule: 'Post-redistricting cycle (2021-2022, 2031-2032)',
        variesByState: true,
        publicationLag: 90, // ~3 months from adoption to GIS publication
      },
      aggregators: [
        {
          name: 'Census TIGER',
          urlTemplate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/CD/',
          lag: '6-18 months after state adoption',
          format: 'shapefile',
          useWhen: 'State source unavailable or during non-redistricting years',
          releaseSchedule: 'Annual in July',
        },
      ],
      notes: 'During redistricting (2021-2022, 2031-2032), primary sources are significantly fresher. Census lags 6-18 months.',
    });

    // State Legislative Upper (State Senate)
    configs.set(BoundaryType.STATE_LEGISLATIVE_UPPER, {
      boundaryType: BoundaryType.STATE_LEGISLATIVE_UPPER,
      primaryAuthority: {
        entity: 'State Legislature or Redistricting Commission',
        legalBasis: 'State constitution',
        publishUrl: null, // Varies by state
        publishSchedule: 'Post-redistricting cycle',
        variesByState: true,
        publicationLag: 90,
      },
      aggregators: [
        {
          name: 'Census TIGER',
          urlTemplate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDU/',
          lag: '6-18 months',
          format: 'shapefile',
          useWhen: 'State source unavailable',
          releaseSchedule: 'Annual in July',
        },
      ],
    });

    // State Legislative Lower (State House)
    configs.set(BoundaryType.STATE_LEGISLATIVE_LOWER, {
      boundaryType: BoundaryType.STATE_LEGISLATIVE_LOWER,
      primaryAuthority: {
        entity: 'State Legislature or Redistricting Commission',
        legalBasis: 'State constitution',
        publishUrl: null,
        publishSchedule: 'Post-redistricting cycle',
        variesByState: true,
        publicationLag: 90,
      },
      aggregators: [
        {
          name: 'Census TIGER',
          urlTemplate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/SLDL/',
          lag: '6-18 months',
          format: 'shapefile',
          useWhen: 'State source unavailable',
          releaseSchedule: 'Annual in July',
        },
      ],
    });

    // County Boundaries
    configs.set(BoundaryType.COUNTY, {
      boundaryType: BoundaryType.COUNTY,
      primaryAuthority: {
        entity: 'State Government',
        legalBasis: 'State statute (counties are state subdivisions)',
        publishUrl: null, // Varies by state
        publishSchedule: 'Infrequent (boundary changes rare)',
        variesByState: true,
        publicationLag: 180, // ~6 months
      },
      aggregators: [
        {
          name: 'Census TIGER',
          urlTemplate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/COUNTY/',
          lag: '6-12 months',
          format: 'shapefile',
          useWhen: 'Preferred for consistency across states',
          releaseSchedule: 'Annual in July',
        },
      ],
      notes: 'Census TIGER is de facto standard. County boundaries rarely change.',
    });

    // City Limits (Incorporated Places)
    configs.set(BoundaryType.CITY_LIMITS, {
      boundaryType: BoundaryType.CITY_LIMITS,
      primaryAuthority: {
        entity: 'Municipal Government',
        legalBasis: 'Municipal charter or state statute',
        publishUrl: null, // Varies by municipality
        publishSchedule: 'Irregular (annexation-driven)',
        variesByState: true,
        publicationLag: 180,
      },
      aggregators: [
        {
          name: 'Census TIGER PLACE',
          urlTemplate: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/',
          lag: '6-18 months',
          format: 'shapefile',
          useWhen: 'Municipal source unavailable',
          releaseSchedule: 'Annual in July',
        },
      ],
      notes: 'Annexation boundary changes lag significantly in Census data.',
    });

    // City Council Districts
    configs.set(BoundaryType.CITY_COUNCIL_DISTRICT, {
      boundaryType: BoundaryType.CITY_COUNCIL_DISTRICT,
      primaryAuthority: {
        entity: 'City Council or Municipal Redistricting Body',
        legalBasis: 'Municipal charter',
        publishUrl: null, // Varies by city
        publishSchedule: 'Post-redistricting (typically 10-year cycle)',
        variesByState: true,
        publicationLag: 60, // ~2 months
      },
      aggregators: [],
      notes: 'No national aggregator exists. Must discover per-municipality via portal discovery.',
    });

    // City Council Wards (alternative terminology)
    configs.set(BoundaryType.CITY_COUNCIL_WARD, {
      boundaryType: BoundaryType.CITY_COUNCIL_WARD,
      primaryAuthority: {
        entity: 'City Council or Municipal Redistricting Body',
        legalBasis: 'Municipal charter',
        publishUrl: null,
        publishSchedule: 'Post-redistricting',
        variesByState: true,
        publicationLag: 60,
      },
      aggregators: [],
      notes: 'Ward is alternate terminology for council district (common in Northeast US).',
    });

    // Census Designated Places (CDPs)
    configs.set(BoundaryType.CDP, {
      boundaryType: BoundaryType.CDP,
      primaryAuthority: {
        entity: 'US Census Bureau',
        legalBasis: 'Statistical geography (not legal boundaries)',
        publishUrl: 'https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/',
        publishSchedule: 'Annual in July',
        variesByState: false,
        publicationLag: 0, // Census is the authority
      },
      aggregators: [],
      notes: 'CDPs are Census-defined statistical areas, not legal jurisdictions.',
    });

    return configs;
  }

  /**
   * Get source configuration for a boundary type
   *
   * @param boundaryType - The boundary type to look up
   * @returns Source configuration or undefined if not registered
   */
  getSourceConfig(boundaryType: BoundaryType): SourceConfig | undefined {
    return this.configs.get(boundaryType);
  }

  /**
   * Select best source for a boundary type based on freshness
   *
   * RESOLUTION ALGORITHM:
   * 1. Check if primary authority source is available and fresh
   * 2. If not, find freshest aggregator
   * 3. Calculate confidence based on authority level and freshness
   *
   * @param boundaryType - Boundary type to select source for
   * @returns Selected source with reasoning
   */
  async selectSource(boundaryType: BoundaryType): Promise<SelectedSource> {
    const config = this.configs.get(boundaryType);

    if (!config) {
      throw new Error(`No source configuration for boundary type: ${boundaryType}`);
    }

    // 1. Try primary authority source first
    if (config.primaryAuthority.publishUrl) {
      const freshness = await this.checkFreshness(config.primaryAuthority.publishUrl);

      if (freshness.available && freshness.isValid) {
        return {
          source: config.primaryAuthority,
          reason: 'Primary authority source available and fresh',
          freshness,
          isPrimary: true,
          confidence: this.calculateConfidence(true, freshness),
        };
      }
    }

    // 2. Fall back to freshest aggregator
    if (config.aggregators.length === 0) {
      // No aggregators available - return primary authority anyway
      return {
        source: config.primaryAuthority,
        reason: 'No aggregator available - portal discovery required',
        freshness: {
          available: false,
          lastModified: 0,
          etag: null,
          isValid: false,
          invalidReason: 'No public URL available',
        },
        isPrimary: true,
        confidence: 50, // Medium confidence - need manual discovery
      };
    }

    // Check all aggregators and select freshest
    let bestAggregator: AggregatorSource | null = null;
    let bestFreshness: FreshnessCheck | null = null;

    for (const aggregator of config.aggregators) {
      // Replace {YEAR} with current year
      const currentYear = new Date().getFullYear();
      const url = aggregator.urlTemplate.replace('{YEAR}', String(currentYear));

      const freshness = await this.checkFreshness(url);

      if (freshness.available && (!bestFreshness || freshness.lastModified > bestFreshness.lastModified)) {
        bestAggregator = aggregator;
        bestFreshness = freshness;
      }
    }

    if (bestAggregator && bestFreshness) {
      return {
        source: bestAggregator,
        reason: `Primary unavailable, using freshest aggregator: ${bestAggregator.name}`,
        freshness: bestFreshness,
        isPrimary: false,
        confidence: this.calculateConfidence(false, bestFreshness),
      };
    }

    // No sources available
    throw new Error(`No available sources for boundary type: ${boundaryType}`);
  }

  /**
   * Check freshness of a source URL via HEAD request
   *
   * @param url - URL to check
   * @returns Freshness check result
   */
  async checkFreshness(url: string): Promise<FreshnessCheck> {
    try {
      const response = await fetch(url, { method: 'HEAD' });

      if (!response.ok) {
        return {
          available: false,
          lastModified: 0,
          etag: null,
          isValid: false,
          invalidReason: `HTTP ${response.status}`,
        };
      }

      // Extract Last-Modified header
      const lastModifiedHeader = response.headers.get('Last-Modified');
      const lastModified = lastModifiedHeader
        ? new Date(lastModifiedHeader).getTime()
        : Date.now();

      // Extract ETag
      const etag = response.headers.get('ETag');

      // Check validity window (data should be less than 2 years old)
      const twoYearsAgo = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000);
      const isValid = lastModified > twoYearsAgo;

      return {
        available: true,
        lastModified,
        etag,
        isValid,
        invalidReason: isValid ? undefined : 'Data older than 2 years',
      };
    } catch (error) {
      return {
        available: false,
        lastModified: 0,
        etag: null,
        isValid: false,
        invalidReason: `Network error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Calculate confidence score based on authority level and freshness
   *
   * SCORING:
   * - Primary authority source: 80-100 (based on freshness)
   * - Aggregator source: 60-80 (based on freshness)
   * - Unavailable source: 0-50 (portal discovery required)
   *
   * @param isPrimary - Whether this is the primary authority source
   * @param freshness - Freshness check result
   * @returns Confidence score (0-100)
   */
  private calculateConfidence(isPrimary: boolean, freshness: FreshnessCheck): number {
    if (!freshness.available || !freshness.isValid) {
      return 0;
    }

    // Base confidence: primary=90, aggregator=70
    const baseConfidence = isPrimary ? 90 : 70;

    // Freshness bonus: +0 to +10 based on how recent
    const ageInDays = (Date.now() - freshness.lastModified) / (24 * 60 * 60 * 1000);
    const freshnessPenalty = Math.min(10, Math.floor(ageInDays / 90)); // -1 per quarter year

    return Math.max(0, Math.min(100, baseConfidence - freshnessPenalty));
  }

  /**
   * Get all registered boundary types
   *
   * @returns Array of registered boundary types
   */
  getRegisteredBoundaryTypes(): BoundaryType[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get authority information for a boundary type
   *
   * @param boundaryType - Boundary type to look up
   * @returns Authority information or undefined
   */
  getAuthorityInfo(boundaryType: BoundaryType): AuthoritySource | undefined {
    return this.configs.get(boundaryType)?.primaryAuthority;
  }

  /**
   * Get aggregator information for a boundary type
   *
   * @param boundaryType - Boundary type to look up
   * @returns Array of aggregators
   */
  getAggregators(boundaryType: BoundaryType): readonly AggregatorSource[] {
    return this.configs.get(boundaryType)?.aggregators || [];
  }
}

// Export types for external use
export type {
  AuthoritySource,
  AggregatorSource,
  SourceConfig,
  FreshnessCheck,
  SelectedSource,
};
