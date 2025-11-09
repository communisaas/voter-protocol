/**
 * Nominatim Provider (OpenStreetMap, Global)
 *
 * SCOPE: Phase 3+ (International expansion: UK, EU, Australia, etc.)
 * COVERAGE: 190+ countries (worldwide OSM data)
 * COST: FREE (self-hosted) or $0.0001/lookup (third-party hosted)
 *
 * ACCURACY: Lower than Geocodio for US addresses, but ONLY global option
 * USE CASE: Fallback for countries Geocodio doesn't support
 */

import type {
  GeocodingProvider,
  Address,
  Coordinates,
  GeocodeResult,
  ReverseGeocodeResult
} from '../types';
import { GeocodeError, GeocodeErrorCode } from '../types';

export class NominatimProvider implements GeocodingProvider {
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(options?: { baseUrl?: string; userAgent?: string }) {
    // Default to public OSM Nominatim (requires user agent)
    this.baseUrl = options?.baseUrl || 'https://nominatim.openstreetmap.org';
    this.userAgent = options?.userAgent || 'VOTER-Protocol/1.0';
  }

  readonly capabilities = {
    supportedCountries: ['*'], // GLOBAL: All countries with OSM data
    rateLimit: 1, // Public instance: 1 request per second (self-hosted: unlimited)
    accuracy: 'street' as const // Lower precision than Geocodio
  };

  readonly pricing = {
    costPerLookup: 0, // FREE (public) or 0.0001 (hosted, e.g., LocationIQ)
    freeTierLimit: undefined // No limit on public instance (rate-limited only)
  };

  async geocode(address: Address): Promise<GeocodeResult> {
    const params = new URLSearchParams({
      format: 'json',
      street: address.street || '',
      city: address.city || '',
      state: address.state || '',
      postalcode: address.postalCode || '',
      country: address.country,
      limit: '1'
    });

    const url = `${this.baseUrl}/search?${params}`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        throw new GeocodeError(
          `HTTP ${response.status}`,
          GeocodeErrorCode.PROVIDER_ERROR,
          'nominatim'
        );
      }

      const data = await response.json();

      if (!data || data.length === 0) {
        throw new GeocodeError(
          'Address not found',
          GeocodeErrorCode.NOT_FOUND,
          'nominatim'
        );
      }

      const result = data[0];

      return {
        coordinates: {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon)
        },
        // Nominatim doesn't return accuracy score, estimate from importance
        accuracy: Math.min(result.importance || 0.5, 1.0),
        source: 'nominatim'
      };
    } catch (error) {
      if (error instanceof GeocodeError) throw error;

      throw new GeocodeError(
        error instanceof Error ? error.message : 'Unknown error',
        GeocodeErrorCode.NETWORK_ERROR,
        'nominatim'
      );
    }
  }

  async reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult> {
    const params = new URLSearchParams({
      format: 'json',
      lat: coords.latitude.toString(),
      lon: coords.longitude.toString()
    });

    const url = `${this.baseUrl}/reverse?${params}`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        throw new GeocodeError(
          `HTTP ${response.status}`,
          GeocodeErrorCode.PROVIDER_ERROR,
          'nominatim'
        );
      }

      const data = await response.json();

      if (!data || !data.address) {
        throw new GeocodeError(
          'Coordinates not found',
          GeocodeErrorCode.NOT_FOUND,
          'nominatim'
        );
      }

      const addr = data.address;

      return {
        address: {
          street: addr.road
            ? `${addr.house_number || ''} ${addr.road}`.trim()
            : undefined,
          city: addr.city || addr.town || addr.village,
          state: addr.state,
          postalCode: addr.postcode,
          country: addr.country_code?.toUpperCase() || 'US'
        },
        accuracy: 0.7, // Estimate (Nominatim doesn't provide accuracy)
        source: 'nominatim'
      };
    } catch (error) {
      if (error instanceof GeocodeError) throw error;

      throw new GeocodeError(
        error instanceof Error ? error.message : 'Unknown error',
        GeocodeErrorCode.NETWORK_ERROR,
        'nominatim'
      );
    }
  }

  // Nominatim doesn't support batch geocoding
  // (would need to implement rate-limited sequential calls)
}
