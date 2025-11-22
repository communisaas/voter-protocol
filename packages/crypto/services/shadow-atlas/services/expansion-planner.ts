/**
 * Expansion Planner - Intelligent City Prioritization
 *
 * PURPOSE: Maximize coverage impact per discovery attempt
 * STRATEGY: Multi-factor prioritization algorithm
 * SCALE: Handles 19,495 US cities
 *
 * PRIORITIZATION FACTORS:
 * 1. Population score (0-40 pts) - Log scale balances mega-cities vs medium
 * 2. Tier upgrade score (0-30 pts) - Rewards quality improvements
 * 3. Success probability (0-20 pts) - Learn from state-level patterns
 * 4. State clustering (0-10 pts) - Batch similar portals
 */

import type { ProvenanceEntry } from './provenance-writer.js';
import { queryProvenance } from './provenance-writer.js';

/**
 * City to be prioritized
 */
export interface CityTarget {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number; // National population rank
  readonly currentTier: number | null; // Existing tier or null
  readonly currentConfidence: number | null;
  readonly priority: number; // Composite score (0-100)
  readonly priorityFactors: {
    readonly populationScore: number;
    readonly tierUpgradeScore: number;
    readonly successProbability: number;
    readonly stateClusterBonus: number;
  };
  readonly reasoning: readonly string[];
}

/**
 * Expansion plan
 */
export interface ExpansionPlan {
  readonly totalCandidates: number;
  readonly recommended: readonly CityTarget[];
  readonly byState: Record<string, readonly CityTarget[]>;
  readonly byTier: Record<string, readonly CityTarget[]>;
  readonly estimatedImpact: {
    readonly peopleReached: number;
    readonly tierUpgrades: number;
    readonly newCoverage: number;
  };
}

/**
 * Calculate priority score for a city
 *
 * ALGORITHM:
 * - Population: Log scale (40 pts max) - prevents mega-city dominance
 * - Tier upgrade: 30 pts for new, 25 for T2→T1, 10 for T1→T0, 0 for T0
 * - Success rate: State-level success pattern (20 pts max)
 * - Clustering: Bonus for active states (10 pts max)
 *
 * @param city - City to prioritize
 * @param provenance - Existing provenance entries
 * @param stateSuccessRates - Success rate by state
 * @returns Priority score (0-100)
 */
function calculatePriority(
  city: { fips: string; population: number; state: string },
  provenance: Map<string, ProvenanceEntry>,
  stateSuccessRates: Record<string, number>
): {
  priority: number;
  factors: {
    populationScore: number;
    tierUpgradeScore: number;
    successProbability: number;
    stateClusterBonus: number;
  };
  reasoning: string[];
} {
  const reasoning: string[] = [];

  // Factor 1: Population score (0-40 points)
  // Use log scale to balance mega-cities vs medium cities
  // 10M people = 40 pts, 1M people = 24 pts, 100K people = 8 pts
  const popScore = Math.min(40, (Math.log10(city.population) / Math.log10(10000000)) * 40);
  reasoning.push(`Population: ${city.population.toLocaleString()} (${popScore.toFixed(1)} pts)`);

  // Factor 2: Tier upgrade score (0-30 points)
  const existing = provenance.get(city.fips);
  let tierScore = 30; // New discovery = max points

  if (existing) {
    const currentTier = existing.g;
    if (currentTier === 0) {
      tierScore = 0; // Already have precincts
      reasoning.push(`Has TIER 0 (precincts) - no upgrade needed (0 pts)`);
    } else if (currentTier === 1) {
      tierScore = 10; // Already have districts, only precinct upgrade possible
      reasoning.push(`Has TIER 1 (districts) - precinct upgrade possible (10 pts)`);
    } else if (currentTier === 2) {
      tierScore = 25; // Municipal → districts upgrade valuable
      reasoning.push(`Has TIER 2 (municipal) - district upgrade valuable (25 pts)`);
    } else {
      tierScore = 30; // County/subdivision → any improvement valuable
      reasoning.push(`Has TIER ${currentTier} - significant upgrade possible (30 pts)`);
    }
  } else {
    reasoning.push(`No existing data - new discovery (30 pts)`);
  }

  // Factor 3: Success probability (0-20 points)
  const stateSuccessRate = stateSuccessRates[city.state] || 0.5; // Default 50%
  const successScore = stateSuccessRate * 20;
  reasoning.push(
    `State success rate (${city.state}): ${(stateSuccessRate * 100).toFixed(0)}% (${successScore.toFixed(1)} pts)`
  );

  // Factor 4: State clustering bonus (0-10 points)
  // Bonus for states with active discovery (more likely to have standardized portals)
  const clusterBonus = stateSuccessRates[city.state]
    ? Math.min(10, stateSuccessRates[city.state] * 10)
    : 0;
  if (clusterBonus > 0) {
    reasoning.push(`State clustering bonus: ${clusterBonus.toFixed(1)} pts`);
  }

  const priority = popScore + tierScore + successScore + clusterBonus;

  return {
    priority,
    factors: {
      populationScore: popScore,
      tierUpgradeScore: tierScore,
      successProbability: successScore,
      stateClusterBonus: clusterBonus,
    },
    reasoning,
  };
}

/**
 * Calculate success rates by state from provenance
 *
 * SUCCESS DEFINITION: Tier 0 or 1 with no blocker
 * FAILURE: Tier 2+ or has blocker code
 */
function calculateStateSuccessRates(entries: ProvenanceEntry[]): Record<string, number> {
  const byState: Record<string, { total: number; successful: number }> = {};

  for (const entry of entries) {
    if (!entry.s) continue;

    if (!byState[entry.s]) {
      byState[entry.s] = { total: 0, successful: 0 };
    }

    byState[entry.s].total++;
    if (entry.blocked === null && entry.g <= 1) {
      byState[entry.s].successful++;
    }
  }

  const rates: Record<string, number> = {};
  for (const [state, stats] of Object.entries(byState)) {
    rates[state] = stats.successful / stats.total;
  }

  return rates;
}

/**
 * Create expansion plan for next N cities
 *
 * STRATEGY:
 * 1. Load existing provenance (success/failure patterns)
 * 2. Calculate state-level success rates
 * 3. Score all cities using multi-factor algorithm
 * 4. Sort by priority and recommend top N
 * 5. Group by state for batch discovery
 *
 * @param allCities - All cities to consider
 * @param limit - Number of cities to recommend
 * @param baseDir - Provenance log directory
 * @returns Expansion plan
 */
export async function createExpansionPlan(
  allCities: Array<{
    fips: string;
    name: string;
    state: string;
    population: number;
    rank: number;
  }>,
  limit: number = 100,
  baseDir: string = './discovery-attempts'
): Promise<ExpansionPlan> {
  // Load provenance
  const allEntries = await queryProvenance({}, baseDir);

  // Build FIPS map (keep only latest entry per FIPS)
  const provenanceMap = new Map<string, ProvenanceEntry>();
  for (const entry of allEntries) {
    const existing = provenanceMap.get(entry.f);
    if (!existing || entry.ts > existing.ts) {
      provenanceMap.set(entry.f, entry);
    }
  }

  // Calculate state success rates
  const stateSuccessRates = calculateStateSuccessRates(allEntries);

  // Prioritize all cities
  const targets: CityTarget[] = [];

  for (const city of allCities) {
    const existing = provenanceMap.get(city.fips);
    const { priority, factors, reasoning } = calculatePriority(city, provenanceMap, stateSuccessRates);

    targets.push({
      fips: city.fips,
      cityName: city.name,
      state: city.state,
      population: city.population,
      rank: city.rank,
      currentTier: existing?.g ?? null,
      currentConfidence: existing?.conf ?? null,
      priority,
      priorityFactors: factors,
      reasoning,
    });
  }

  // Sort by priority (highest first)
  targets.sort((a, b) => b.priority - a.priority);

  // Recommended targets
  const recommended = targets.slice(0, limit);

  // Group by state
  const byState: Record<string, CityTarget[]> = {};
  for (const target of recommended) {
    if (!byState[target.state]) {
      byState[target.state] = [];
    }
    byState[target.state].push(target);
  }

  // Group by current tier
  const byTier: Record<string, CityTarget[]> = { null: [] };
  for (const target of recommended) {
    const tier = target.currentTier === null ? 'null' : String(target.currentTier);
    if (!byTier[tier]) {
      byTier[tier] = [];
    }
    byTier[tier].push(target);
  }

  // Calculate estimated impact
  const peopleReached = recommended.reduce((sum, t) => sum + t.population, 0);
  const tierUpgrades = recommended.filter((t) => t.currentTier !== null && t.currentTier > 1).length;
  const newCoverage = recommended.filter((t) => t.currentTier === null).length;

  return {
    totalCandidates: targets.length,
    recommended,
    byState,
    byTier,
    estimatedImpact: {
      peopleReached,
      tierUpgrades,
      newCoverage,
    },
  };
}
