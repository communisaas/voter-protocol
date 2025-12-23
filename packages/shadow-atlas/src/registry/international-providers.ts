/**
 * International Boundary Provider Registry
 *
 * Central registry mapping ISO 3166-1 alpha-2 country codes to their
 * boundary data providers. This is the single source of truth for
 * international provider configuration.
 *
 * ARCHITECTURE:
 * - Each country has ONE canonical provider (no duplicates)
 * - Providers are instantiated once and reused (singleton pattern)
 * - Registry enables batch operations across multiple countries
 * - Type-safe lookups with compile-time country code validation
 *
 * USAGE:
 * ```typescript
 * // Get provider for specific country
 * const ukProvider = getProviderForCountry('GB');
 * const result = await ukProvider?.extractAll();
 *
 * // Batch extraction for multiple countries
 * const results = await extractMultipleCountries(['GB', 'CA', 'AU']);
 *
 * // Health check all providers
 * const health = await checkAllProvidersHealth();
 * ```
 *
 * ADDING NEW PROVIDERS:
 * 1. Implement provider class extending BaseInternationalProvider
 * 2. Add to INTERNATIONAL_PROVIDERS map with ISO country code
 * 3. Run integration tests: npm run test:integration -- international
 * 4. Update GLOBAL_SCALING_SPEC.md with data source details
 *
 * @see GLOBAL_SCALING_SPEC.md for expansion roadmap
 */

import { UKBoundaryProvider } from '../providers/international/uk-provider.js';
import { CanadaBoundaryProvider } from '../providers/international/canada-provider.js';
import { AustraliaBoundaryProvider } from '../providers/international/australia-provider.js';
import { NewZealandBoundaryProvider } from '../providers/international/nz-provider.js';
import type {
  InternationalBoundaryProvider,
  InternationalBoundary,
  ProviderHealth,
  InternationalExtractionResult,
} from '../providers/international/base-provider.js';

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * International boundary provider registry
 *
 * Maps ISO 3166-1 alpha-2 country codes to provider instances.
 * Providers are singletons (instantiated once, reused across requests).
 *
 * CURRENT COVERAGE (Phase 1 - COMPLETE):
 * - GB: United Kingdom (650 parliamentary constituencies)
 * - CA: Canada (338 federal electoral districts)
 * - AU: Australia (151 federal electoral divisions)
 * - NZ: New Zealand (72 electorates: 65 general + 7 Māori)
 *
 * PLANNED EXPANSION:
 * - Phase 2 (Q2-Q3 2025): + 27 EU countries
 * - Phase 3 (Q4 2025 - Q2 2026): + G20 major democracies
 * - Phase 4 (Q3-Q4 2026): Global coverage (190+ countries)
 */
export const INTERNATIONAL_PROVIDERS = new Map<
  string,
  InternationalBoundaryProvider<any, any>
>([
  // Phase 1: Anglosphere (Complete)
  ['GB', new UKBoundaryProvider()],
  ['CA', new CanadaBoundaryProvider()],
  ['AU', new AustraliaBoundaryProvider()],
  ['NZ', new NewZealandBoundaryProvider()],

  // Phase 2: EU (Pending - 27 countries)
  // ['DE', new GermanyBoundaryProvider()],    // Germany (Priority 1)
  // ['FR', new FranceBoundaryProvider()],     // France (Priority 1)
  // ['IT', new ItalyBoundaryProvider()],      // Italy (Priority 1)
  // ['ES', new SpainBoundaryProvider()],      // Spain (Priority 1)
  // ['PL', new PolandBoundaryProvider()],     // Poland (Priority 1)
  // ... (22 more EU countries)

  // Phase 3: G20 + Major Democracies (Pending)
  // ['JP', new JapanBoundaryProvider()],      // Japan
  // ['KR', new SouthKoreaBoundaryProvider()], // South Korea
  // ['IN', new IndiaBoundaryProvider()],      // India
  // ['BR', new BrazilBoundaryProvider()],     // Brazil
  // ['MX', new MexicoBoundaryProvider()],     // Mexico
  // ... (20+ more countries)
]);

// ============================================================================
// Provider Lookup Functions
// ============================================================================

/**
 * Get boundary provider for a specific country
 *
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., 'GB', 'CA', 'AU')
 * @returns Provider instance or undefined if not configured
 *
 * @example
 * const ukProvider = getProviderForCountry('GB');
 * if (ukProvider) {
 *   const result = await ukProvider.extractAll();
 * }
 */
export function getProviderForCountry(
  countryCode: string
): InternationalBoundaryProvider<any, any> | undefined {
  return INTERNATIONAL_PROVIDERS.get(countryCode.toUpperCase());
}

/**
 * Check if a provider is configured for a country
 *
 * @param countryCode - ISO 3166-1 alpha-2 country code
 * @returns true if provider exists
 */
export function hasProviderForCountry(countryCode: string): boolean {
  return INTERNATIONAL_PROVIDERS.has(countryCode.toUpperCase());
}

/**
 * Get all configured country codes
 *
 * @returns Array of ISO 3166-1 alpha-2 country codes
 */
export function getConfiguredCountries(): string[] {
  return Array.from(INTERNATIONAL_PROVIDERS.keys()).sort();
}

/**
 * Get provider configuration summary
 *
 * Useful for debugging and documentation generation.
 *
 * @returns Array of provider metadata
 */
export function getProviderSummary(): Array<{
  country: string;
  countryName: string;
  dataSource: string;
  apiType: string;
  license: string;
  supportedLayers: string[];
}> {
  const summaries: Array<{
    country: string;
    countryName: string;
    dataSource: string;
    apiType: string;
    license: string;
    supportedLayers: string[];
  }> = [];

  for (const [country, provider] of INTERNATIONAL_PROVIDERS) {
    summaries.push({
      country,
      countryName: provider.countryName,
      dataSource: provider.dataSource,
      apiType: provider.apiType,
      license: provider.license,
      supportedLayers: Array.from(provider.layers.keys()),
    });
  }

  return summaries.sort((a, b) => a.country.localeCompare(b.country));
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Extract boundaries for multiple countries
 *
 * Runs extractions in parallel with configurable concurrency.
 * Useful for batch updates or initial data population.
 *
 * @param countries - Array of ISO 3166-1 alpha-2 country codes
 * @param options - Batch extraction options
 * @returns Array of extraction results
 *
 * @example
 * const results = await extractMultipleCountries(['GB', 'CA', 'AU'], {
 *   concurrency: 3,
 *   continueOnError: true,
 *   onProgress: (p) => console.log(`${p.completed}/${p.total} complete`)
 * });
 */
export async function extractMultipleCountries(
  countries: readonly string[],
  options: {
    concurrency?: number;
    continueOnError?: boolean;
    onProgress?: (progress: ExtractionProgress) => void;
  } = {}
): Promise<BatchExtractionResult> {
  const { concurrency = 5, continueOnError = true, onProgress } = options;

  const results: CountryExtractionResult[] = [];
  let completed = 0;
  let failed = 0;
  let totalBoundaries = 0;

  // Process countries in batches (respect concurrency limit)
  for (let i = 0; i < countries.length; i += concurrency) {
    const batch = countries.slice(i, i + concurrency);

    const batchPromises = batch.map(async (country) => {
      const provider = getProviderForCountry(country);

      if (!provider) {
        const error = `No provider configured for ${country}`;
        console.warn(`[Registry] ${error}`);
        failed++;
        return {
          country,
          success: false,
          error,
        } as CountryExtractionResult;
      }

      try {
        console.log(`[Registry] Extracting ${provider.countryName} (${country})...`);
        const result = await provider.extractAll();

        completed++;
        totalBoundaries += result.totalBoundaries;

        onProgress?.({
          currentCountry: country,
          completed,
          total: countries.length,
          failed,
          totalBoundaries,
        });

        return {
          country,
          success: true,
          data: result,
        } as CountryExtractionResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Registry] Failed to extract ${country}: ${message}`);

        failed++;
        onProgress?.({
          currentCountry: country,
          completed,
          total: countries.length,
          failed,
          totalBoundaries,
        });

        if (!continueOnError) {
          throw error;
        }

        return {
          country,
          success: false,
          error: message,
        } as CountryExtractionResult;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return {
    results,
    summary: {
      total: countries.length,
      succeeded: completed,
      failed,
      totalBoundaries,
    },
  };
}

/**
 * Health check all configured providers
 *
 * Runs health checks in parallel to detect availability issues.
 * Useful for monitoring and alerting.
 *
 * @param options - Health check options
 * @returns Map of country code to health status
 *
 * @example
 * const health = await checkAllProvidersHealth();
 * for (const [country, status] of health) {
 *   if (!status.available) {
 *     console.error(`${country} provider unavailable: ${status.issues}`);
 *   }
 * }
 */
export async function checkAllProvidersHealth(options: {
  concurrency?: number;
} = {}): Promise<Map<string, ProviderHealth>> {
  const { concurrency = 10 } = options;
  const healthMap = new Map<string, ProviderHealth>();

  const countries = Array.from(INTERNATIONAL_PROVIDERS.keys());

  // Process in batches
  for (let i = 0; i < countries.length; i += concurrency) {
    const batch = countries.slice(i, i + concurrency);

    const batchPromises = batch.map(async (country) => {
      const provider = INTERNATIONAL_PROVIDERS.get(country);
      if (!provider) return;

      try {
        const health = await provider.healthCheck();
        healthMap.set(country, health);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        healthMap.set(country, {
          available: false,
          latencyMs: 0,
          lastChecked: new Date(),
          issues: [`Health check failed: ${message}`],
        });
      }
    });

    await Promise.all(batchPromises);
  }

  return healthMap;
}

/**
 * Get expected counts for all providers
 *
 * Useful for validation and reporting.
 *
 * @returns Map of country code to expected boundary counts by layer
 */
export async function getAllExpectedCounts(): Promise<
  Map<string, Map<string, number>>
> {
  const countsMap = new Map<string, Map<string, number>>();

  for (const [country, provider] of INTERNATIONAL_PROVIDERS) {
    const expectedCounts = await provider.getExpectedCounts();
    countsMap.set(country, expectedCounts as Map<string, number>);
  }

  return countsMap;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result from extracting a single country
 */
export interface CountryExtractionResult {
  readonly country: string;
  readonly success: boolean;
  readonly data?: InternationalExtractionResult<string, InternationalBoundary>;
  readonly error?: string;
}

/**
 * Result from batch extraction
 */
export interface BatchExtractionResult {
  readonly results: readonly CountryExtractionResult[];
  readonly summary: {
    readonly total: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly totalBoundaries: number;
  };
}

/**
 * Extraction progress event
 */
export interface ExtractionProgress {
  readonly currentCountry: string;
  readonly completed: number;
  readonly total: number;
  readonly failed: number;
  readonly totalBoundaries: number;
}

// ============================================================================
// Registry Statistics
// ============================================================================

/**
 * Get registry statistics
 *
 * Useful for monitoring and reporting.
 *
 * @returns Registry statistics
 */
export function getRegistryStats() {
  const providers = Array.from(INTERNATIONAL_PROVIDERS.values());

  const apiTypeCounts: Record<string, number> = {};
  for (const provider of providers) {
    apiTypeCounts[provider.apiType] = (apiTypeCounts[provider.apiType] || 0) + 1;
  }

  const totalLayers = providers.reduce(
    (sum, provider) => sum + provider.layers.size,
    0
  );

  return {
    totalProviders: INTERNATIONAL_PROVIDERS.size,
    totalLayers,
    apiTypeDistribution: apiTypeCounts,
    countries: getConfiguredCountries(),
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { ProviderHealth, InternationalExtractionResult, InternationalBoundary };
