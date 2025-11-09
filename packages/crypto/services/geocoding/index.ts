/**
 * Geocoding Service Router
 *
 * DESIGN PRINCIPLE: Provider selection based on country, cost, accuracy needs
 *
 * ROUTING LOGIC:
 * - US/CA addresses → Geocodio (high accuracy, cheap, Phase 1)
 * - UK/EU/AU/etc → Nominatim (global coverage, FREE, Phase 3+)
 * - Future: Google Maps, Mapbox (premium accuracy, expensive)
 *
 * This abstraction allows business logic to call geocode() without knowing
 * which provider is used. Provider selection is configuration, not code.
 */

import type {
  GeocodingProvider,
  Address,
  Coordinates,
  GeocodeResult,
  ReverseGeocodeResult
} from './types';
import { GeocodeError, GeocodeErrorCode } from './types';
import { GeocodioProvider } from './providers/geocodio';
import { NominatimProvider } from './providers/nominatim';

export type { GeocodingProvider, Address, Coordinates, GeocodeResult };
export { GeocodeError, GeocodeErrorCode };

interface GeocodingConfig {
  // Provider credentials
  geocodioApiKey?: string;
  nominatimBaseUrl?: string;

  // Provider selection strategy
  strategy: 'cost-optimized' | 'accuracy-first' | 'provider-specific';

  // Optional: Force specific provider for all requests
  forceProvider?: 'geocodio' | 'nominatim' | 'google' | 'mapbox';
}

export class GeocodingService {
  private readonly providers: Map<string, GeocodingProvider> = new Map();
  private readonly config: GeocodingConfig;

  constructor(config: GeocodingConfig) {
    this.config = config;

    // Initialize available providers
    if (config.geocodioApiKey) {
      this.providers.set('geocodio', new GeocodioProvider(config.geocodioApiKey));
    }

    // Nominatim always available (FREE, no API key required)
    this.providers.set(
      'nominatim',
      new NominatimProvider({
        baseUrl: config.nominatimBaseUrl
      })
    );
  }

  /**
   * Geocode address to coordinates
   *
   * Automatically selects best provider based on country + strategy
   */
  async geocode(address: Address): Promise<GeocodeResult> {
    const provider = this.selectProvider(address.country);

    if (!provider) {
      throw new GeocodeError(
        `No geocoding provider available for country: ${address.country}`,
        GeocodeErrorCode.UNSUPPORTED_COUNTRY,
        'none'
      );
    }

    return provider.geocode(address);
  }

  /**
   * Reverse geocode coordinates to address
   */
  async reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult> {
    // For reverse geocoding, we don't know country upfront
    // Use Nominatim (global) or Geocodio (if result is US/CA)
    const nominatim = this.providers.get('nominatim')!;
    const result = await nominatim.reverseGeocode(coords);

    // If result is US/CA and we have Geocodio, re-query for better accuracy
    if (
      ['US', 'CA'].includes(result.address.country) &&
      this.providers.has('geocodio') &&
      this.config.strategy === 'accuracy-first'
    ) {
      const geocodio = this.providers.get('geocodio')!;
      return geocodio.reverseGeocode(coords);
    }

    return result;
  }

  /**
   * Batch geocode (if provider supports)
   */
  async geocodeBatch(addresses: Address[]): Promise<GeocodeResult[]> {
    // Group by country
    const byCountry = new Map<string, Address[]>();
    for (const address of addresses) {
      const list = byCountry.get(address.country) || [];
      list.push(address);
      byCountry.set(address.country, list);
    }

    // Geocode each country group with appropriate provider
    const results: GeocodeResult[] = [];
    for (const [country, addrs] of byCountry) {
      const provider = this.selectProvider(country);

      if (!provider) {
        throw new GeocodeError(
          `No provider for country: ${country}`,
          GeocodeErrorCode.UNSUPPORTED_COUNTRY,
          'none'
        );
      }

      if (provider.geocodeBatch) {
        // Use batch API (efficient)
        const batchResults = await provider.geocodeBatch(addrs);
        results.push(...batchResults);
      } else {
        // Sequential fallback (rate-limited)
        for (const addr of addrs) {
          const result = await provider.geocode(addr);
          results.push(result);

          // Rate limiting for providers without batch support
          await this.sleep(1000 / (provider.capabilities.rateLimit || 1));
        }
      }
    }

    return results;
  }

  /**
   * Get provider capabilities (for UI/cost estimation)
   */
  getCapabilities(country: string): GeocodingProvider['capabilities'] | null {
    const provider = this.selectProvider(country);
    return provider?.capabilities || null;
  }

  /**
   * Estimate geocoding cost for address
   */
  estimateCost(address: Address): number {
    const provider = this.selectProvider(address.country);
    return provider?.pricing.costPerLookup || 0;
  }

  /**
   * Provider selection logic
   *
   * ROUTING RULES:
   * 1. If forceProvider set, use that (testing/debugging)
   * 2. If cost-optimized: Geocodio (US/CA), Nominatim (everywhere else)
   * 3. If accuracy-first: Geocodio (US/CA), Google Maps (international, future)
   */
  private selectProvider(country: string): GeocodingProvider | null {
    // Force specific provider (testing/debugging)
    if (this.config.forceProvider) {
      return this.providers.get(this.config.forceProvider) || null;
    }

    // Strategy-based selection
    switch (this.config.strategy) {
      case 'cost-optimized':
        // Geocodio for US/CA (cheap + accurate)
        if (['US', 'CA'].includes(country) && this.providers.has('geocodio')) {
          return this.providers.get('geocodio')!;
        }
        // Nominatim for everything else (FREE)
        return this.providers.get('nominatim')!;

      case 'accuracy-first':
        // Geocodio for US/CA (best accuracy for North America)
        if (['US', 'CA'].includes(country) && this.providers.has('geocodio')) {
          return this.providers.get('geocodio')!;
        }
        // TODO: Google Maps for international (premium accuracy)
        // Fallback to Nominatim for now
        return this.providers.get('nominatim')!;

      case 'provider-specific':
        // Let caller decide via forceProvider
        throw new Error('Must set forceProvider when using provider-specific strategy');

      default:
        return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory: Create geocoding service with environment-based config
 */
export function createGeocodingService(env?: {
  GEOCODIO_API_KEY?: string;
  NOMINATIM_BASE_URL?: string;
}): GeocodingService {
  return new GeocodingService({
    geocodioApiKey: env?.GEOCODIO_API_KEY || process.env.GEOCODIO_API_KEY,
    nominatimBaseUrl: env?.NOMINATIM_BASE_URL || process.env.NOMINATIM_BASE_URL,
    strategy: 'cost-optimized' // Default: minimize costs
  });
}
