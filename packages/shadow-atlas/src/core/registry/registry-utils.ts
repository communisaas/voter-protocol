/**
 * Registry Utility Functions
 *
 * Helper functions for working with registry data. These operate on
 * the generated registry constants and provide common query patterns.
 *
 * USAGE:
 *   import { isStale, isAtLargeCity } from './registry-utils.js';
 *   import { KNOWN_PORTALS } from './known-portals.generated.js';
 */

import { KNOWN_PORTALS, type KnownPortal } from './known-portals.generated.js';
import { QUARANTINED_PORTALS, type QuarantinedPortal } from './quarantined-portals.generated.js';
import { AT_LARGE_CITIES, type AtLargeCity } from './at-large-cities.generated.js';

// ============================================================================
// Known Portals Utilities
// ============================================================================

/**
 * Check if a portal entry is stale (not verified in over 90 days)
 *
 * Portal URLs can change more frequently than district counts,
 * so we use a shorter staleness threshold (90 days vs 365 for district counts).
 */
export function isStale(portal: KnownPortal): boolean {
  const lastVerified = new Date(portal.lastVerified);
  const now = new Date();
  const daysSinceVerified = (now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceVerified > 90;
}

/**
 * Get portal by FIPS code
 */
export function getPortal(cityFips: string): KnownPortal | undefined {
  return KNOWN_PORTALS[cityFips];
}

/**
 * Check if a city has a known portal
 */
export function hasPortal(cityFips: string): boolean {
  return cityFips in KNOWN_PORTALS;
}

// ============================================================================
// Quarantined Portals Utilities
// ============================================================================

/**
 * Get quarantine summary by pattern
 *
 * Computes statistics from actual quarantine data to ensure accuracy.
 */
export function getQuarantineSummary(): Record<string, number> {
  return Object.values(QUARANTINED_PORTALS).reduce(
    (summary, portal) => {
      const pattern = portal.matchedPattern;
      summary[pattern] = (summary[pattern] || 0) + 1;
      return summary;
    },
    {} as Record<string, number>,
  );
}

/**
 * Check if a city is quarantined
 */
export function isQuarantined(cityFips: string): boolean {
  return cityFips in QUARANTINED_PORTALS;
}

/**
 * Get quarantined portal by FIPS code
 */
export function getQuarantinedPortal(cityFips: string): QuarantinedPortal | undefined {
  return QUARANTINED_PORTALS[cityFips];
}

// ============================================================================
// At-Large Cities Utilities
// ============================================================================

/**
 * Check if a city uses at-large voting (no geographic districts)
 *
 * @param cityFips - 7-digit Census PLACE FIPS code
 * @returns true if city has at-large/proportional voting
 */
export function isAtLargeCity(cityFips: string): boolean {
  return cityFips in AT_LARGE_CITIES;
}

/**
 * Get at-large city metadata
 *
 * @param cityFips - 7-digit Census PLACE FIPS code
 * @returns City metadata or undefined if not at-large
 */
export function getAtLargeCityInfo(cityFips: string): AtLargeCity | undefined {
  return AT_LARGE_CITIES[cityFips];
}

/**
 * Get all at-large cities in a state
 *
 * @param stateAbbr - State abbreviation (e.g., "MA", "TX")
 * @returns Array of [FIPS, city metadata] tuples
 */
export function getAtLargeCitiesByState(stateAbbr: string): Array<[string, AtLargeCity]> {
  return Object.entries(AT_LARGE_CITIES).filter(([_, city]) => city.state === stateAbbr) as Array<
    [string, AtLargeCity]
  >;
}

/**
 * Count at-large cities by election method and state
 */
export function getAtLargeCityStats(): {
  total: number;
  byMethod: Record<string, number>;
  byState: Record<string, number>;
} {
  const byMethod: Record<string, number> = {};
  const byState: Record<string, number> = {};

  for (const city of Object.values(AT_LARGE_CITIES)) {
    byMethod[city.electionMethod] = (byMethod[city.electionMethod] || 0) + 1;
    byState[city.state] = (byState[city.state] || 0) + 1;
  }

  return {
    total: Object.keys(AT_LARGE_CITIES).length,
    byMethod,
    byState,
  };
}
