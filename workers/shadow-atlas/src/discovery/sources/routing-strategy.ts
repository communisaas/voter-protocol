/**
 * Source Routing Strategy - Composable decision logic for selecting data sources
 *
 * Design Pattern: Strategy Pattern + Chain of Responsibility
 *
 * Philosophy:
 * - Each routing strategy is a pure function (state, context) => Source[]
 * - Strategies compose via function composition
 * - Adding new routing logic = add pure function, no mutation
 * - Future agents can modify by: (1) add strategy, (2) register in composer
 */

import type { BoundaryDataSource, BoundaryRequest, Classification } from './types';

/**
 * Routing context - all information needed to make source selection decisions
 */
export interface RoutingContext {
  readonly boundaryType: BoundaryRequest['boundaryType'];
  readonly state: string;
  readonly classification: Classification;
  readonly requestedAt: Date;
  readonly needs: BoundaryNeeds;
}

export interface BoundaryNeeds {
  readonly preferFreshness: boolean;
  readonly requireCoverageGuarantee: boolean;
  readonly preferAuthorityTier?: 'federal' | 'state' | 'community';
}

/**
 * Routing strategy - pure function that selects appropriate sources
 */
export type RoutingStrategy = (context: RoutingContext) => readonly BoundaryDataSource[];

/**
 * Source metadata for routing decisions
 */
export interface SourceMetadata {
  readonly freshnessScore: number; // 0-100, higher = more recent
  readonly authorityScore: number; // 0-100, higher = more authoritative
  readonly coverageGuarantee: boolean; // true if 100% coverage guaranteed
  readonly lastKnownUpdate?: Date;
}

/**
 * Redistricting metadata - when states last redrew districts
 */
export interface RedistrictingMetadata {
  readonly state: string;
  readonly boundaryType: BoundaryRequest['boundaryType'];
  readonly lastRedistricting: Date;
  readonly freshnessThresholdMonths: number; // TIGER considered stale after N months
}

/**
 * Source factory - lazily constructs sources to avoid unnecessary initialization
 */
export type SourceFactory = () => BoundaryDataSource;

/**
 * Routing decision - explains WHY sources were selected
 */
export interface RoutingDecision {
  readonly sources: readonly BoundaryDataSource[];
  readonly strategy: string;
  readonly reasoning: string;
}

/**
 * Smart routing composer - composes multiple strategies with explicit priority
 *
 * Pattern: Higher-order function that builds routing logic from composable strategies
 *
 * Usage:
 * ```typescript
 * const router = composeRouting([
 *   hubAPIFirst,           // Always try Hub first (fast)
 *   freshnessAware,        // Use state portals for recent redistricting
 *   tigerLineFallback      // TIGER guarantees success
 * ]);
 * ```
 */
export function composeRouting(
  strategies: readonly RoutingStrategy[]
): (context: RoutingContext) => RoutingDecision {
  return (context: RoutingContext): RoutingDecision => {
    // Merge all strategy outputs (preserving order)
    const allSources = strategies.flatMap(strategy => strategy(context));

    // Deduplicate while preserving order (first occurrence wins)
    const seenSources = new Set<string>();
    const uniqueSources = allSources.filter(source => {
      if (seenSources.has(source.name)) {
        return false;
      }
      seenSources.add(source.name);
      return true;
    });

    return {
      sources: uniqueSources,
      strategy: strategies.map(s => s.name).join(' → '),
      reasoning: `Applied ${strategies.length} routing strategies, yielded ${uniqueSources.length} unique sources`
    };
  };
}

/**
 * Freshness-aware routing - prefer state portals for recently redistricted states
 *
 * Logic:
 * - If state redistricted within threshold AND portal exists → inject state portal
 * - Otherwise → skip (let other strategies handle)
 */
export function createFreshnessAwareStrategy(
  statePortalRegistry: Map<string, SourceFactory>,
  redistrictingData: Map<string, RedistrictingMetadata>
): RoutingStrategy {
  const strategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    if (!context.needs.preferFreshness) {
      return [];
    }

    const key = `${context.state}:${context.boundaryType}`;
    const redistricting = redistrictingData.get(key);
    const portalFactory = statePortalRegistry.get(key);

    if (!redistricting || !portalFactory) {
      return []; // No metadata or portal → skip
    }

    // Calculate months since redistricting
    const monthsSince = Math.floor(
      (context.requestedAt.getTime() - redistricting.lastRedistricting.getTime()) /
      (1000 * 60 * 60 * 24 * 30)
    );

    // If recent redistricting, state portal is fresher than TIGER
    if (monthsSince <= redistricting.freshnessThresholdMonths) {
      return [portalFactory()];
    }

    return []; // Outside freshness window → skip
  };

  // Name the function for debugging
  Object.defineProperty(strategy, 'name', { value: 'freshnessAware' });
  return strategy;
}

/**
 * Classification-aware routing - route based on administrative structure
 *
 * Logic:
 * - Independent cities → County TIGER (they ARE counties)
 * - Federal district (DC) → County TIGER (county-equivalent)
 * - Multi-county cities → Place TIGER (captures full extent)
 * - Standard → Default routing
 */
export function createClassificationAwareStrategy(
  tigerCountyFactory: SourceFactory,
  tigerPlaceFactory: SourceFactory
): RoutingStrategy {
  const strategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    switch (context.classification.type) {
      case 'independent_city':
      case 'consolidated_city_county':
      case 'federal_district':
        // These ARE counties → use county TIGER
        return [tigerCountyFactory()];

      case 'multi_county_city':
        // Spans counties → use place TIGER
        return [tigerPlaceFactory()];

      default:
        return []; // No special routing needed
    }
  };

  Object.defineProperty(strategy, 'name', { value: 'classificationAware' });
  return strategy;
}

/**
 * Hub API first strategy - always try Hub first (fast, good metadata)
 */
export function createHubAPIFirstStrategy(
  hubAPIFactory: SourceFactory
): RoutingStrategy {
  const strategy: RoutingStrategy = (): readonly BoundaryDataSource[] => {
    return [hubAPIFactory()];
  };

  Object.defineProperty(strategy, 'name', { value: 'hubAPIFirst' });
  return strategy;
}

/**
 * TIGER/Line fallback strategy - guaranteed 100% coverage
 */
export function createTIGERFallbackStrategy(
  tigerFactory: (boundaryType: BoundaryRequest['boundaryType']) => SourceFactory
): RoutingStrategy {
  const strategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    return [tigerFactory(context.boundaryType)()];
  };

  Object.defineProperty(strategy, 'name', { value: 'tigerFallback' });
  return strategy;
}

/**
 * Conditional strategy - apply strategy only if predicate is true
 *
 * Pattern: Higher-order function for conditional routing
 *
 * Usage:
 * ```typescript
 * const statePortalIfAvailable = conditional(
 *   (ctx) => statePortalRegistry.has(ctx.state),
 *   statePortalStrategy
 * );
 * ```
 */
export function conditional(
  predicate: (context: RoutingContext) => boolean,
  strategy: RoutingStrategy
): RoutingStrategy {
  const conditionalStrategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    return predicate(context) ? strategy(context) : [];
  };

  Object.defineProperty(conditionalStrategy, 'name', {
    value: `conditional(${strategy.name})`
  });

  return conditionalStrategy;
}

/**
 * Logging strategy wrapper - logs routing decisions for debugging
 *
 * Pattern: Decorator for observability
 */
export function withLogging(
  strategy: RoutingStrategy,
  logger: (context: RoutingContext, sources: readonly BoundaryDataSource[]) => void
): RoutingStrategy {
  const loggingStrategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    const sources = strategy(context);
    logger(context, sources);
    return sources;
  };

  Object.defineProperty(loggingStrategy, 'name', {
    value: `logged(${strategy.name})`
  });

  return loggingStrategy;
}

/**
 * Parallel strategy - try multiple strategies, merge results
 *
 * Pattern: Combinator for strategy composition
 */
export function parallel(...strategies: RoutingStrategy[]): RoutingStrategy {
  const parallelStrategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    return strategies.flatMap(strategy => strategy(context));
  };

  Object.defineProperty(parallelStrategy, 'name', {
    value: `parallel(${strategies.map(s => s.name).join(', ')})`
  });

  return parallelStrategy;
}

/**
 * Fallback strategy - try first strategy, if empty try second
 *
 * Pattern: Combinator for graceful degradation
 */
export function fallback(
  primary: RoutingStrategy,
  secondary: RoutingStrategy
): RoutingStrategy {
  const fallbackStrategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    const primarySources = primary(context);
    return primarySources.length > 0 ? primarySources : secondary(context);
  };

  Object.defineProperty(fallbackStrategy, 'name', {
    value: `fallback(${primary.name}, ${secondary.name})`
  });

  return fallbackStrategy;
}

/**
 * Special district authority strategy - try state-mandated registries first
 *
 * Design goal: agentic SWE can plug new state sources without touching orchestrator
 */
export function createSpecialDistrictAuthorityStrategy(
  resolver?: (state: string) => SourceFactory | undefined
): RoutingStrategy {
  const strategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    if (
      context.boundaryType !== 'special_district' ||
      context.needs.preferAuthorityTier !== 'state' ||
      !resolver
    ) {
      return [];
    }

    const factory = resolver(context.state);
    if (!factory) {
      return [];
    }

    return [factory()];
  };

  Object.defineProperty(strategy, 'name', { value: 'specialDistrictAuthority' });
  return strategy;
}

/**
 * Hub API-only strategy - for boundary types without TIGER/Line equivalents
 *
 * Pattern: Specialized routing for boundary types that only exist in local GIS systems
 *
 * Boundary types that require Hub API-only routing:
 * - special_district: Water, fire, transit, library districts (35,000+ nationwide)
 * - judicial: Federal and state court districts (500+ nationwide)
 *
 * These boundary types don't have Census TIGER/Line equivalents because:
 * - Special districts are created by local governments, not standardized federally
 * - Judicial districts vary by state court systems, not tracked by Census
 */
export function hubAPIOnly(): RoutingStrategy {
  const strategy: RoutingStrategy = (context: RoutingContext): readonly BoundaryDataSource[] => {
    // Only return Hub API source, no TIGER fallback
    return []; // Will be populated by orchestrator with Hub API source
  };

  Object.defineProperty(strategy, 'name', { value: 'hubAPIOnly' });
  return strategy;
}

/**
 * Predicate: Check if boundary type requires Hub API-only routing
 */
export function isHubAPIOnlyBoundaryType(boundaryType: BoundaryRequest['boundaryType']): boolean {
  return boundaryType === 'special_district' || boundaryType === 'judicial';
}
