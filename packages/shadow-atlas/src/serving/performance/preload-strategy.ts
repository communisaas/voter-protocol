/**
 * Predictive Preload Strategy
 *
 * Intelligently preloads districts based on:
 * - Traffic patterns: Hot regions get preloaded
 * - Time zones: Preload regions in active hours
 * - Event-driven: Election day, voter registration deadlines
 * - Population density: Major metro areas prioritized
 *
 * Performance targets:
 * - Preload latency: <500ms for top 100 metro areas
 * - Cache hit rate: >90% during peak hours
 * - Memory efficiency: <200MB for preloaded data
 *
 * DATABASE INTEGRATION:
 * - Queries R-tree indexed SQLite database built by RTreeBuilder
 * - Schema: districts(id, name, jurisdiction, district_type, geometry, provenance, bbox)
 * - Accepts database via dependency injection OR path in config
 * - Gracefully falls back to placeholder generation if database unavailable
 *
 * CRITICAL: Reduces cold-start latency during traffic spikes.
 */

import type { DistrictBoundary } from '../types';
import type { RegionalCache } from './regional-cache';
import { logger } from '../../core/utils/logger.js';
import type Database from 'better-sqlite3';

/**
 * Preload priority levels
 */
export enum PreloadPriority {
  CRITICAL = 3,    // Election day, voter registration deadline
  HIGH = 2,        // Major metro areas, peak hours
  MEDIUM = 1,      // Secondary cities, business hours
  LOW = 0,         // Background preload during idle time
}

/**
 * Preload target (geographic region)
 */
export interface PreloadTarget {
  readonly country: string;            // ISO 3166-1 alpha-2
  readonly region?: string;            // State/province code
  readonly city?: string;              // City name
  readonly population?: number;        // Population (for prioritization)
  readonly timezone?: string;          // IANA timezone
  readonly priority: PreloadPriority;
}

/**
 * Traffic pattern (historical data)
 */
export interface TrafficPattern {
  readonly region: string;             // Region identifier
  readonly hourlyTraffic: readonly number[];  // 24-hour traffic pattern
  readonly peakHours: readonly number[];      // Peak hour indices (0-23)
  readonly avgLatencyMs: number;       // Average lookup latency
}

/**
 * Event trigger (time-based preload)
 */
export interface PreloadEvent {
  readonly name: string;               // Event name
  readonly startTime: Date;            // Event start time
  readonly endTime: Date;              // Event end time
  readonly targets: readonly PreloadTarget[];  // Regions to preload
  readonly priority: PreloadPriority;
}

/**
 * Preload strategy configuration
 */
export interface PreloadStrategyConfig {
  readonly enableTimezoneAware: boolean;       // Preload based on timezone
  readonly enableTrafficPrediction: boolean;   // Use historical traffic patterns
  readonly enableEventDriven: boolean;         // Event-based preloading
  readonly maxPreloadSizeMB: number;           // Max memory for preloaded data
  readonly preloadIntervalMinutes: number;     // Background preload interval
  readonly dbPath?: string;                    // Optional database path for district queries
}

/**
 * Preload function interface (injected dependency)
 */
export type PreloadFunction = (districtIds: readonly string[]) => Promise<void>;

/**
 * Predictive preload strategy
 */
export class PreloadStrategy {
  private readonly config: PreloadStrategyConfig;
  private readonly cache: RegionalCache;
  private readonly db: Database.Database | null;

  // Preload targets (sorted by priority)
  private readonly targets: PreloadTarget[];

  // Traffic patterns (learned from historical data)
  private readonly trafficPatterns: Map<string, TrafficPattern>;

  // Scheduled events (election day, registration deadlines)
  private readonly events: PreloadEvent[];

  // Metrics
  private preloadCount = 0;
  private preloadedDistricts = 0;
  private avgPreloadTimeMs = 0;

  constructor(cache: RegionalCache, config: PreloadStrategyConfig, db: Database.Database | null = null) {
    this.cache = cache;
    this.config = config;
    this.targets = [];
    this.trafficPatterns = new Map();
    this.events = [];

    // Use injected database or initialize from path
    if (db) {
      this.db = db;
    } else if (config.dbPath) {
      try {
        // Dynamic import to avoid bundling better-sqlite3 if not needed
        const Database = require('better-sqlite3');
        this.db = new Database(config.dbPath, { readonly: true });
      } catch (error) {
        logger.warn('PreloadStrategy failed to open database', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.db = null;
      }
    } else {
      this.db = null;
    }
  }

  /**
   * Register preload targets
   *
   * @param targets - Geographic regions to preload
   */
  registerTargets(targets: readonly PreloadTarget[]): void {
    this.targets.push(...targets);

    // Sort by priority (CRITICAL first)
    this.targets.sort((a, b) => b.priority - a.priority);

    logger.info('PreloadStrategy registered preload targets', {
      targetCount: targets.length,
    });
  }

  /**
   * Register traffic patterns (learned from historical data)
   *
   * @param patterns - Historical traffic patterns per region
   */
  registerTrafficPatterns(patterns: readonly TrafficPattern[]): void {
    for (const pattern of patterns) {
      this.trafficPatterns.set(pattern.region, pattern);
    }

    logger.info('PreloadStrategy registered traffic patterns', {
      patternCount: patterns.length,
    });
  }

  /**
   * Schedule preload event (election day, registration deadline)
   *
   * @param event - Event with preload targets
   */
  scheduleEvent(event: PreloadEvent): void {
    this.events.push(event);

    // Sort events by start time
    this.events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    logger.info('PreloadStrategy scheduled event', {
      eventName: event.name,
      startTime: event.startTime.toISOString(),
      priority: event.priority,
    });
  }

  /**
   * Execute preload strategy
   *
   * Determines which districts to preload based on:
   * 1. Active events (highest priority)
   * 2. Current timezone hour (timezone-aware)
   * 3. Traffic predictions (historical patterns)
   * 4. Static priority (major metro areas)
   */
  async executePreload(lookupFn: (districtId: string) => Promise<DistrictBoundary | null>): Promise<void> {
    const startTime = performance.now();

    // Step 1: Get active events
    const activeEvents = this.getActiveEvents();

    // Step 2: Get timezone-aware targets
    const timezoneTargets = this.config.enableTimezoneAware
      ? this.getTimezoneTargets()
      : [];

    // Step 3: Get traffic-predicted targets
    const trafficTargets = this.config.enableTrafficPrediction
      ? this.getTrafficPredictedTargets()
      : [];

    // Step 4: Merge and prioritize all targets
    const allTargets = [
      ...activeEvents.flatMap(e => e.targets),
      ...timezoneTargets,
      ...trafficTargets,
    ];

    // Remove duplicates and sort by priority
    const uniqueTargets = this.deduplicateTargets(allTargets);
    const sortedTargets = [...uniqueTargets].sort((a, b) => b.priority - a.priority);

    // Step 5: Convert targets to district IDs
    const districtIds = await this.resolveDistrictIds(sortedTargets, lookupFn);

    // Step 6: Preload districts into cache
    await this.preloadDistricts(districtIds, lookupFn);

    // Update metrics
    this.preloadCount++;
    this.preloadedDistricts += districtIds.length;
    const duration = performance.now() - startTime;
    this.avgPreloadTimeMs = (this.avgPreloadTimeMs * (this.preloadCount - 1) + duration) / this.preloadCount;

    logger.info('PreloadStrategy preloaded districts', {
      districtCount: districtIds.length,
      durationMs: duration,
    });
  }

  /**
   * Get active events (currently running)
   */
  private getActiveEvents(): readonly PreloadEvent[] {
    const now = new Date();

    return this.events.filter(event =>
      now >= event.startTime && now <= event.endTime
    );
  }

  /**
   * Get targets for currently active timezones
   *
   * Preloads regions in business hours (9am-5pm local time).
   */
  private getTimezoneTargets(): readonly PreloadTarget[] {
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Major timezones with UTC offsets
    const timezones = [
      { name: 'America/New_York', offset: -5, regions: ['us-ny', 'us-ma', 'us-pa', 'us-fl'] },
      { name: 'America/Chicago', offset: -6, regions: ['us-il', 'us-tx', 'us-mo'] },
      { name: 'America/Denver', offset: -7, regions: ['us-co', 'us-az'] },
      { name: 'America/Los_Angeles', offset: -8, regions: ['us-ca', 'us-wa', 'us-or'] },
      { name: 'Europe/London', offset: 0, regions: ['gb-england', 'gb-scotland'] },
      { name: 'Europe/Paris', offset: 1, regions: ['fr', 'de', 'es'] },
      { name: 'Asia/Tokyo', offset: 9, regions: ['jp'] },
    ];

    const activeTargets: PreloadTarget[] = [];

    for (const tz of timezones) {
      const localHour = (currentHour + tz.offset + 24) % 24;

      // Business hours: 9am-5pm
      if (localHour >= 9 && localHour <= 17) {
        for (const region of tz.regions) {
          const [country, state] = region.split('-');
          activeTargets.push({
            country: country.toUpperCase(),
            region: state?.toUpperCase(),
            timezone: tz.name,
            priority: PreloadPriority.HIGH,
          });
        }
      }
    }

    return activeTargets;
  }

  /**
   * Get targets based on traffic predictions
   *
   * Uses historical traffic patterns to predict high-traffic regions.
   */
  private getTrafficPredictedTargets(): readonly PreloadTarget[] {
    const now = new Date();
    const currentHour = now.getUTCHours();

    const predictedTargets: PreloadTarget[] = [];

    for (const [region, pattern] of this.trafficPatterns) {
      const hourlyTraffic = pattern.hourlyTraffic[currentHour] || 0;
      const peakTraffic = Math.max(...pattern.hourlyTraffic);

      // If current hour is >50% of peak traffic, preload
      if (hourlyTraffic > peakTraffic * 0.5) {
        const [country, state] = region.split('-');
        predictedTargets.push({
          country: country.toUpperCase(),
          region: state?.toUpperCase(),
          priority: pattern.peakHours.includes(currentHour)
            ? PreloadPriority.HIGH
            : PreloadPriority.MEDIUM,
        });
      }
    }

    return predictedTargets;
  }

  /**
   * Deduplicate preload targets
   */
  private deduplicateTargets(targets: readonly PreloadTarget[]): readonly PreloadTarget[] {
    const seen = new Set<string>();
    const unique: PreloadTarget[] = [];

    for (const target of targets) {
      const key = `${target.country}-${target.region || ''}-${target.city || ''}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(target);
      }
    }

    return unique;
  }

  /**
   * Resolve targets to district IDs
   *
   * Queries database for district IDs matching targets.
   * Limited by memory budget.
   */
  private async resolveDistrictIds(
    targets: readonly PreloadTarget[],
    lookupFn: (districtId: string) => Promise<DistrictBoundary | null>
  ): Promise<readonly string[]> {
    const districtIds: string[] = [];

    // Estimate memory budget per district (~5KB)
    const maxDistricts = (this.config.maxPreloadSizeMB * 1024 * 1024) / 5120;

    for (const target of targets) {
      if (districtIds.length >= maxDistricts) {
        logger.warn('PreloadStrategy reached memory budget', {
          maxDistricts,
          currentCount: districtIds.length,
        });
        break;
      }

      // Query database for matching districts
      const matchingIds = await this.queryDistrictsByRegion(target);
      districtIds.push(...matchingIds);
    }

    return districtIds;
  }

  /**
   * Query database for districts matching a geographic region
   *
   * Queries the R-tree indexed database built by RTreeBuilder.
   * Schema: districts(id, name, jurisdiction, district_type, geometry, provenance, bbox)
   *
   * @param target - Geographic region target
   * @returns Array of district IDs for the region
   */
  private async queryDistrictsByRegion(target: PreloadTarget): Promise<readonly string[]> {
    // Build district ID pattern for matching
    let pattern = target.country.toLowerCase();
    if (target.region) {
      pattern += `-${target.region.toLowerCase()}`;
    }
    if (target.city) {
      pattern += `-${target.city.toLowerCase()}`;
    }

    // Pattern matching for district IDs:
    // - Congressional: "{country}-{region}-cd-{number}"
    // - State Senate: "{country}-{region}-senate-{number}"
    // - State House: "{country}-{region}-house-{number}"
    // - City Council: "{country}-{region}-{city}-council-{number}"

    // Generate expected district ID patterns (SQL LIKE patterns)
    const patterns: string[] = [];

    if (target.city) {
      // City-level districts (council wards)
      patterns.push(`${pattern}-council-%`);
      patterns.push(`${pattern}-ward-%`);
    } else if (target.region) {
      // State-level districts
      patterns.push(`${pattern}-cd-%`);      // Congressional
      patterns.push(`${pattern}-senate-%`);  // State Senate
      patterns.push(`${pattern}-house-%`);   // State House
    } else {
      // Country-level (all congressional districts)
      patterns.push(`${pattern}-%-cd-%`);
    }

    // Query database if available
    if (this.db) {
      const results: string[] = [];

      try {
        const stmt = this.db.prepare(`
          SELECT DISTINCT id FROM districts
          WHERE id LIKE ?
          ORDER BY id
          LIMIT 100
        `);

        for (const pattern of patterns) {
          const rows = stmt.all(pattern) as Array<{ id: string }>;
          results.push(...rows.map(r => r.id));
        }

        return results;
      } catch (error) {
        logger.error('PreloadStrategy database query failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Fall through to placeholder implementation
      }
    }

    // Fallback: Generate placeholder IDs if database unavailable
    const placeholderIds: string[] = [];
    if (target.city) {
      // Generate 5-10 city council districts
      const numDistricts = Math.min(10, target.population ? Math.ceil(target.population / 100000) : 5);
      for (let i = 1; i <= numDistricts; i++) {
        placeholderIds.push(`${pattern}-council-${i}`);
      }
    } else if (target.region) {
      // Generate 1 congressional district per region (placeholder)
      placeholderIds.push(`${pattern}-cd-1`);
    }

    return placeholderIds;
  }

  /**
   * Preload districts into cache
   */
  private async preloadDistricts(
    districtIds: readonly string[],
    lookupFn: (districtId: string) => Promise<DistrictBoundary | null>
  ): Promise<void> {
    const preloadData: { id: string; district: DistrictBoundary }[] = [];

    for (const id of districtIds) {
      const district = await lookupFn(id);

      if (district) {
        preloadData.push({ id, district });
      }
    }

    // Preload into cache with CRITICAL priority
    this.cache.preload(preloadData);
  }

  /**
   * Start background preload loop
   *
   * Runs preload strategy at regular intervals.
   */
  startBackgroundPreload(lookupFn: (districtId: string) => Promise<DistrictBoundary | null>): void {
    const intervalMs = this.config.preloadIntervalMinutes * 60 * 1000;

    setInterval(async () => {
      try {
        await this.executePreload(lookupFn);
      } catch (error) {
        logger.error('PreloadStrategy background preload failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }, intervalMs);

    logger.info('PreloadStrategy started background preload', {
      intervalMinutes: this.config.preloadIntervalMinutes,
    });
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PreloadStrategyMetrics {
    return {
      preloadCount: this.preloadCount,
      preloadedDistricts: this.preloadedDistricts,
      avgPreloadTimeMs: this.avgPreloadTimeMs,
      registeredTargets: this.targets.length,
      trafficPatterns: this.trafficPatterns.size,
      scheduledEvents: this.events.length,
      activeEvents: this.getActiveEvents().length,
    };
  }

  /**
   * Close database connection and cleanup resources
   *
   * Call this when shutting down the preload strategy.
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (error) {
        logger.error('PreloadStrategy failed to close database', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Preload strategy metrics
 */
export interface PreloadStrategyMetrics {
  readonly preloadCount: number;
  readonly preloadedDistricts: number;
  readonly avgPreloadTimeMs: number;
  readonly registeredTargets: number;
  readonly trafficPatterns: number;
  readonly scheduledEvents: number;
  readonly activeEvents: number;
}

/**
 * Default US metro area preload targets
 */
export const US_METRO_PRELOAD_TARGETS: readonly PreloadTarget[] = [
  // Top 10 metro areas by population
  { country: 'US', region: 'NY', city: 'new_york', population: 8_336_817, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'CA', city: 'los_angeles', population: 3_979_576, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'IL', city: 'chicago', population: 2_693_976, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'TX', city: 'houston', population: 2_320_268, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'AZ', city: 'phoenix', population: 1_680_992, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'PA', city: 'philadelphia', population: 1_584_064, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'TX', city: 'san_antonio', population: 1_547_253, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'CA', city: 'san_diego', population: 1_423_851, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'TX', city: 'dallas', population: 1_343_573, priority: PreloadPriority.HIGH },
  { country: 'US', region: 'CA', city: 'san_jose', population: 1_021_795, priority: PreloadPriority.HIGH },

  // Next 20 major cities
  { country: 'US', region: 'TX', city: 'austin', population: 978_908, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'FL', city: 'jacksonville', population: 949_611, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'TX', city: 'fort_worth', population: 918_915, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'OH', city: 'columbus', population: 905_748, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'NC', city: 'charlotte', population: 885_708, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'CA', city: 'san_francisco', population: 873_965, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'IN', city: 'indianapolis', population: 876_384, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'WA', city: 'seattle', population: 753_675, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'CO', city: 'denver', population: 715_522, priority: PreloadPriority.MEDIUM },
  { country: 'US', region: 'DC', city: 'washington', population: 689_545, priority: PreloadPriority.MEDIUM },
];
