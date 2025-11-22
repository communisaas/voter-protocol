/**
 * Boundary Discovery Orchestrator - Single entry point for all boundary queries
 *
 * Design Pattern: Facade + Strategy Pattern + Dependency Injection
 *
 * Philosophy:
 * - One function, one purpose: discoverBoundary()
 * - All complexity hidden behind clean interface
 * - Routing logic is data-driven (see routing-strategy.ts)
 * - Future agents modify by: (1) adjust strategy composition, (2) add source
 *
 * Usage:
 * ```typescript
 * const result = await discoverBoundary({
 *   location: { lat: 40.7128, lng: -74.0060, state: 'NY' },
 *   boundaryType: 'STATE_HOUSE'
 * });
 * ```
 */

import type {
  BoundaryDataSource,
  BoundaryRequest,
  BoundaryResult,
  LocationQuery,
  SourceResult
} from './sources/types';
import type { BoundaryType } from './hub-api-discovery';
import {
  composeRouting,
  createHubAPIFirstStrategy,
  createFreshnessAwareStrategy,
  createTIGERFallbackStrategy,
  createClassificationAwareStrategy,
  createSpecialDistrictAuthorityStrategy,
  hubAPIOnly,
  conditional,
  isHubAPIOnlyBoundaryType,
  type RoutingContext,
  type RoutingStrategy,
  type SourceFactory,
  type BoundaryNeeds
} from './sources/routing-strategy';
import {
  buildPortalLookup,
  buildRedistrictingMetadata,
  createPortalKey
} from './sources/state-portal-registry';
import { getMunicipalEdgeCase } from './classifiers/municipal';
import { createHubAPISource } from './sources/hub-api';
import { createTIGERSource, boundaryTypeToTIGERDataset } from './sources/tiger-line';
import { createStatePortalSource } from './sources/state-portal';
import { createSpecialDistrictStateSource } from './special-districts';
import { getSourceDescriptor, type SourceDescriptor } from './sources/source-descriptors';

/**
 * Orchestrator configuration - dependency injection for testability
 */
export interface OrchestratorConfig {
  readonly sourceFactories: SourceFactories;
  readonly qualityThreshold: number; // Default minimum score to accept result (0-100)
  readonly specialThresholds?: Partial<Record<BoundaryType, number>>; // Boundary-type-specific thresholds
  readonly logRouting?: boolean; // Log routing decisions for debugging
}

/**
 * Source factories - lazy construction of data sources
 */
export interface SourceFactories {
  readonly hubAPI: SourceFactory;
  readonly tiger: (boundaryType: BoundaryType) => SourceFactory;
  readonly statePortal: (state: string, boundaryType: BoundaryType) => SourceFactory | undefined;
  readonly specialDistrict?: (state: string) => SourceFactory | undefined;
}

/**
 * Default orchestrator configuration
 */
export const DEFAULT_CONFIG: OrchestratorConfig = {
  sourceFactories: {
    // Hub API - wraps existing discovery logic
    hubAPI: () => createHubAPISource(),

    // TIGER/Line - provides 100% coverage guarantee
    tiger: (boundaryType: BoundaryType) => () => {
      const dataset = boundaryTypeToTIGERDataset(boundaryType);
      return createTIGERSource(dataset);
    },

    // State portals - freshness optimization
    statePortal: (state: string, boundaryType: BoundaryType) => {
      const source = createStatePortalSource(state, boundaryType);
      return source ? () => source : undefined;
    },

    // Special districts - state-authority registries (e.g., LAFCo, TCEQ)
    specialDistrict: (state: string) => {
      const source = createSpecialDistrictStateSource(state);
      return source ? () => source : undefined;
    }
  },
  qualityThreshold: 60, // Default threshold for most boundary types
  // Boundary-type-specific thresholds (override default)
  specialThresholds: {
    'special_district': 40,  // Lower threshold - 35K districts, no federal standard, fragmented data
    'judicial': 50,          // Moderate threshold - 500+ courts, decent Hub API coverage
    'school_board': 55       // Near-standard threshold - many well-documented, but some at-large
  },
  logRouting: false
};

const DEFAULT_BOUNDARY_NEEDS: BoundaryNeeds = {
  preferFreshness: false,
  requireCoverageGuarantee: false
};

const BOUNDARY_NEEDS: Record<BoundaryType, BoundaryNeeds> = {
  municipal: { preferFreshness: false, requireCoverageGuarantee: false },
  county: { preferFreshness: false, requireCoverageGuarantee: true },
  state_house: { preferFreshness: true, requireCoverageGuarantee: false, preferAuthorityTier: 'state' },
  state_senate: { preferFreshness: true, requireCoverageGuarantee: false, preferAuthorityTier: 'state' },
  congressional: { preferFreshness: false, requireCoverageGuarantee: true, preferAuthorityTier: 'federal' },
  school_board: { preferFreshness: false, requireCoverageGuarantee: false, preferAuthorityTier: 'state' },
  special_district: { preferFreshness: false, requireCoverageGuarantee: false, preferAuthorityTier: 'state' },
  judicial: { preferFreshness: false, requireCoverageGuarantee: false, preferAuthorityTier: 'state' },
  voting_precinct: { preferFreshness: false, requireCoverageGuarantee: true, preferAuthorityTier: 'federal' }
};

function determineBoundaryNeeds(boundaryType: BoundaryType): BoundaryNeeds {
  return BOUNDARY_NEEDS[boundaryType] ?? DEFAULT_BOUNDARY_NEEDS;
}

function determineQualityThreshold(
  boundaryType: BoundaryType,
  config: OrchestratorConfig,
  descriptor?: SourceDescriptor
): number {
  let threshold = config.specialThresholds?.[boundaryType] ?? config.qualityThreshold;

  if (boundaryType === 'special_district') {
    if (descriptor?.supports.authorityTier === 'state') {
      threshold = Math.max(threshold, 60);
    } else {
      threshold = Math.min(threshold, 45);
    }
  }

  if (descriptor?.supports.coverageGuarantee) {
    threshold = Math.max(threshold, 65);
  }

  return threshold;
}

/**
 * Discover boundary data for a location and boundary type
 *
 * This is the ONLY public entry point for boundary discovery.
 * All other discovery functions are deprecated.
 *
 * @param request - Location and boundary type to discover
 * @param config - Optional configuration (uses defaults if not provided)
 * @returns BoundaryResult with geometry, metadata, and provenance
 */
export async function discoverBoundary(
  request: Omit<BoundaryRequest, 'classification'>,
  config: OrchestratorConfig = DEFAULT_CONFIG
): Promise<BoundaryResult> {
  // Step 1: Classify the location (determines routing strategy)
  const classification = classifyLocation(request.location, request.boundaryType);
  const needs = determineBoundaryNeeds(request.boundaryType);

  // Step 2: Build routing context
  const context: RoutingContext = {
    boundaryType: request.boundaryType,
    state: request.location.state,
    classification: classification,
    requestedAt: new Date(),
    needs
  };

  // Step 3: Build routing strategy (composable, data-driven)
  const router = buildRouter(config);

  // Step 4: Get source chain for this request
  const { sources, strategy: strategyName, reasoning } = router(context);

  if (config.logRouting) {
    console.log(`[Routing] ${strategyName} → ${sources.length} sources`);
    console.log(`[Routing] ${reasoning}`);
  }

  // Step 5: Try sources in order until success
  const fullRequest: BoundaryRequest = {
    ...request,
    classification
  };

  for (const source of sources) {
    try {
      if (config.logRouting) {
        console.log(`[Orchestrator] Trying source: ${source.name}`);
      }

      const result = await source.fetch(fullRequest);

      if (!result) {
        if (config.logRouting) {
          console.log(`[Orchestrator] ${source.name} returned null`);
        }
        continue; // Source found nothing, try next
      }

      const descriptor = source.id ? getSourceDescriptor(source.id) : undefined;
      const threshold = determineQualityThreshold(request.boundaryType, config, descriptor);

      if (result.score < threshold) {
        if (config.logRouting) {
          console.log(`[Orchestrator] ${source.name} score ${result.score} below threshold ${threshold} (type: ${request.boundaryType})`);
        }
        continue; // Quality too low, try next
      }

      // Success! Return result with full metadata
      if (config.logRouting) {
        console.log(`[Orchestrator] ✅ ${source.name} succeeded (score: ${result.score})`);
      }

      return {
        success: true,
        data: result.geometry,
        source: source.name,
        classification: classification,
        metadata: result.metadata,
        score: result.score
      };

    } catch (error) {
      if (config.logRouting) {
        console.error(`[Orchestrator] ${source.name} threw error:`, error);
      }
      // Source errored, try next
      continue;
    }
  }

  // All sources failed
  return {
    success: false,
    classification: classification,
    error: `No source found valid data for ${request.boundaryType} in ${request.location.state}. Tried ${sources.length} sources: ${sources.map(s => s.name).join(', ')}`
  };
}

/**
 * Build routing strategy from configuration
 *
 * This is where routing logic is composed. Future agents modify HERE.
 *
 * Current strategy:
 * 1. Always try Hub API first (fast, good metadata)
 * 2. If state has fresh portal (< 36 months since redistricting), try it
 * 3. Always try TIGER/Line (100% coverage guarantee)
 *
 * To modify:
 * - Add new strategy: create in routing-strategy.ts
 * - Compose it here in desired order
 * - Zero changes needed elsewhere
 */
function buildRouter(config: OrchestratorConfig): (context: RoutingContext) => ReturnType<typeof composeRouting> {
  // Build lookups for freshness-aware routing
  const portalLookup = buildPortalLookup();
  const redistrictingData = buildRedistrictingMetadata();

  // Convert state portal registry to source factories
  const statePortalFactories = new Map<string, SourceFactory>();
  for (const [key, portalConfig] of portalLookup.entries()) {
    const factory = config.sourceFactories.statePortal(portalConfig.state, portalConfig.boundaryType);
    if (factory) {
      statePortalFactories.set(key, factory);
    }
  }

  const specialDistrictResolver = config.sourceFactories.specialDistrict;

  // Compose routing strategies in order of preference
  const strategies: RoutingStrategy[] = [
    // Strategy 0: State-authority special district sources (e.g., LAFCo)
    conditional(
      (ctx) => ctx.boundaryType === 'special_district',
      createSpecialDistrictAuthorityStrategy((state: string) => specialDistrictResolver?.(state))
    ),

    // Strategy 1: Hub API-only for special districts and judicial (no TIGER equivalent)
    conditional(
      (ctx) => isHubAPIOnlyBoundaryType(ctx.boundaryType),
      createHubAPIFirstStrategy(config.sourceFactories.hubAPI)
    ),

    // Strategy 2: Always try Hub API first for TIGER-supported types (fast)
    conditional(
      (ctx) => !isHubAPIOnlyBoundaryType(ctx.boundaryType),
      createHubAPIFirstStrategy(config.sourceFactories.hubAPI)
    ),

    // Strategy 3: Classification-aware routing (e.g., DC → county TIGER)
    conditional(
      (ctx) => !isHubAPIOnlyBoundaryType(ctx.boundaryType),
      createClassificationAwareStrategy(
        config.sourceFactories.tiger('county'),
        config.sourceFactories.tiger('municipal')
      )
    ),

    // Strategy 4: Freshness-aware state portals (recent redistricting)
    conditional(
      (ctx) => !isHubAPIOnlyBoundaryType(ctx.boundaryType),
      createFreshnessAwareStrategy(statePortalFactories, redistrictingData)
    ),

    // Strategy 5: TIGER/Line fallback (100% coverage guarantee, TIGER-supported types only)
    conditional(
      (ctx) => !isHubAPIOnlyBoundaryType(ctx.boundaryType),
      createTIGERFallbackStrategy(config.sourceFactories.tiger)
    )
  ];

  return composeRouting(strategies);
}

/**
 * Classify location to determine routing strategy
 *
 * This function determines the administrative structure of the location,
 * which influences which data sources are most appropriate.
 */
function classifyLocation(
  location: LocationQuery,
  boundaryType: BoundaryType
): BoundaryRequest['classification'] {
  // For municipal queries, check if it's an edge case
  if (boundaryType === 'municipal' && location.name) {
    const edgeCase = getMunicipalEdgeCase(location.name, location.state);

    if (edgeCase) {
      return {
        type: edgeCase.classification,
        metadata: {
          fipsCode: edgeCase.fipsCode,
          notes: edgeCase.notes
        },
        routingPreference: edgeCase.discoveryStrategy === 'county_equivalent' ? 'county' : 'place'
      };
    }
  }

  // For county queries, check for county-equivalent cities
  if (boundaryType === 'county' && location.name) {
    const edgeCase = getMunicipalEdgeCase(location.name, location.state);

    if (edgeCase && edgeCase.classification === 'independent_city') {
      return {
        type: 'independent_city',
        metadata: {
          fipsCode: edgeCase.fipsCode,
          notes: 'Independent city (county-equivalent)'
        },
        routingPreference: 'county'
      };
    }
  }

  // State legislative districts are straightforward
  if (boundaryType === 'state_house' || boundaryType === 'state_senate') {
    return {
      type: 'state_legislative',
      routingPreference: 'state_portal'
    };
  }

  // Congressional districts are standardized
  if (boundaryType === 'congressional') {
    return {
      type: 'congressional',
      routingPreference: 'standard'
    };
  }

  // Voting precincts - TIGER VTD (100% coverage)
  if (boundaryType === 'voting_precinct') {
    return {
      type: 'voting_precinct',
      routingPreference: 'standard',
      metadata: {
        notes: 'Voting Tabulation Districts (VTD) from Census TIGER - most granular election boundaries'
      }
    };
  }

  // School board districts - TIGER UNSD (unified school districts)
  if (boundaryType === 'school_board') {
    return {
      type: 'school_board',
      routingPreference: 'standard',
      metadata: {
        notes: 'Unified School Districts from Census TIGER - note: many school boards elected at-large (no geographic districts)'
      }
    };
  }

  // Special districts and judicial - Hub API only (no TIGER equivalent)
  if (boundaryType === 'special_district' || boundaryType === 'judicial') {
    return {
      type: 'hub_api_only',
      routingPreference: 'standard', // Changed from 'hub_api_only' to 'standard'
      metadata: {
        notes: boundaryType === 'special_district'
          ? 'Special districts have variable data quality (35,000+ districts, no federal standard). Lower quality threshold applied.'
          : 'Judicial districts available via Hub API only'
      }
    };
  }

  // Default: standard routing
  return {
    type: 'standard',
    routingPreference: 'standard'
  };
}

/**
 * Create orchestrator with custom configuration
 *
 * Use this for testing or custom routing logic
 *
 * @param config - Custom orchestrator configuration
 * @returns Configured discovery function
 */
export function createOrchestrator(
  config: OrchestratorConfig
): (request: Omit<BoundaryRequest, 'classification'>) => Promise<BoundaryResult> {
  return (request) => discoverBoundary(request, config);
}

/**
 * Batch discover boundaries for multiple locations
 *
 * Useful for testing or bulk operations
 *
 * @param requests - Array of boundary requests
 * @param config - Optional orchestrator configuration
 * @returns Array of results in same order as requests
 */
export async function discoverBoundaryBatch(
  requests: Array<Omit<BoundaryRequest, 'classification'>>,
  config: OrchestratorConfig = DEFAULT_CONFIG
): Promise<BoundaryResult[]> {
  // Run in parallel for performance
  return Promise.all(
    requests.map(request => discoverBoundary(request, config))
  );
}

/**
 * Example: How to modify routing logic (for future agents)
 *
 * To add a new routing strategy:
 *
 * 1. Create strategy in routing-strategy.ts:
 * ```typescript
 * export function createMyNewStrategy(...): RoutingStrategy {
 *   const strategy: RoutingStrategy = (context) => {
 *     // Your logic here
 *     return sources;
 *   };
 *   Object.defineProperty(strategy, 'name', { value: 'myNewStrategy' });
 *   return strategy;
 * }
 * ```
 *
 * 2. Add to buildRouter() strategies array:
 * ```typescript
 * const strategies: RoutingStrategy[] = [
 *   createHubAPIFirstStrategy(...),
 *   createMyNewStrategy(...),  // <-- Add here
 *   createFreshnessAwareStrategy(...),
 *   createTIGERFallbackStrategy(...)
 * ];
 * ```
 *
 * That's it. No changes needed anywhere else.
 */
