/**
 * Geocodio Provider (US + Canada only)
 *
 * SCOPE: Phase 1 (US launch), Phase 2 (Canada expansion)
 * LIMITATION: No international support beyond North America
 * COST: $0.0005 per lookup (2,500 free/day)
 */

import type {
  GeocodingProvider,
  Address,
  Coordinates,
  GeocodeResult,
  ReverseGeocodeResult
} from '../types';
import { GeocodeError, GeocodeErrorCode } from '../types';

export class GeocodioProvider implements GeocodingProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.geocod.io/v1.7';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Geocodio API key required');
    }
    this.apiKey = apiKey;
  }

  readonly capabilities = {
    supportedCountries: ['US', 'CA'], // LIMITATION: North America only
    batchSize: 10000, // Max addresses per batch
    rateLimit: 1000, // Requests per minute (paid tier)
    accuracy: 'rooftop' as const // High precision
  };

  readonly pricing = {
    costPerLookup: 0.0005, // $0.50 per 1,000 lookups
    freeTierLimit: 2500 // Per day
  };

  async geocode(address: Address): Promise<GeocodeResult> {
    // Validate country support
    if (!this.capabilities.supportedCountries.includes(address.country)) {
      throw new GeocodeError(
        `Geocodio does not support country: ${address.country}`,
        GeocodeErrorCode.UNSUPPORTED_COUNTRY,
        'geocodio'
      );
    }

    const addressString = this.formatAddress(address);
    const url = `${this.baseUrl}/geocode?q=${encodeURIComponent(addressString)}&api_key=${this.apiKey}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          throw new GeocodeError(
            'Geocodio rate limit exceeded',
            GeocodeErrorCode.RATE_LIMIT_EXCEEDED,
            'geocodio'
          );
        }
        throw new GeocodeError(
          `HTTP ${response.status}`,
          GeocodeErrorCode.PROVIDER_ERROR,
          'geocodio'
        );
      }

      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        throw new GeocodeError(
          'Address not found',
          GeocodeErrorCode.NOT_FOUND,
          'geocodio'
        );
      }

      const result = data.results[0]; // Best match

      return {
        coordinates: {
          latitude: result.location.lat,
          longitude: result.location.lng
        },
        accuracy: result.accuracy, // 0.0-1.0
        source: 'geocodio'
      };
    } catch (error) {
      if (error instanceof GeocodeError) throw error;

      throw new GeocodeError(
        error instanceof Error ? error.message : 'Unknown error',
        GeocodeErrorCode.NETWORK_ERROR,
        'geocodio'
      );
    }
  }

  async reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult> {
    const url = `${this.baseUrl}/reverse?q=${coords.latitude},${coords.longitude}&api_key=${this.apiKey}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new GeocodeError(
          `HTTP ${response.status}`,
          GeocodeErrorCode.PROVIDER_ERROR,
          'geocodio'
        );
      }

      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        throw new GeocodeError(
          'Coordinates not found',
          GeocodeErrorCode.NOT_FOUND,
          'geocodio'
        );
      }

      const result = data.results[0];
      const components = result.address_components;

      return {
        address: {
          street: `${components.number || ''} ${components.street || ''}`.trim(),
          city: components.city,
          state: components.state,
          postalCode: components.zip,
          country: components.country // 'US' or 'CA'
        },
        accuracy: result.accuracy,
        source: 'geocodio'
      };
    } catch (error) {
      if (error instanceof GeocodeError) throw error;

      throw new GeocodeError(
        error instanceof Error ? error.message : 'Unknown error',
        GeocodeErrorCode.NETWORK_ERROR,
        'geocodio'
      );
    }
  }

  async geocodeBatch(addresses: Address[]): Promise<GeocodeResult[]> {
    if (addresses.length > this.capabilities.batchSize!) {
      throw new Error(`Batch size exceeds limit: ${this.capabilities.batchSize}`);
    }

    const url = `${this.baseUrl}/geocode?api_key=${this.apiKey}`;
    const payload = addresses.map(a => this.formatAddress(a));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new GeocodeError(
        `HTTP ${response.status}`,
        GeocodeErrorCode.PROVIDER_ERROR,
        'geocodio'
      );
    }

    const data = await response.json();

    return data.results.map((result: any) => ({
      coordinates: {
        latitude: result.response.results[0].location.lat,
        longitude: result.response.results[0].location.lng
      },
      accuracy: result.response.results[0].accuracy,
      source: 'geocodio'
    }));
  }

  private formatAddress(address: Address): string {
    const parts = [
      address.street,
      address.city,
      address.state,
      address.postalCode,
      address.country
    ].filter(Boolean);

    return parts.join(', ');
  }
}
