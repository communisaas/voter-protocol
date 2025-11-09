/**
 * Geocoding Service Abstraction
 *
 * DESIGN PRINCIPLE: Provider-agnostic geocoding interface
 *
 * WHY: Geocodio only supports US/Canada. We need international expansion.
 * FUTURE: Nominatim (OSM, global), Google Maps, Mapbox, Pelias, etc.
 *
 * This abstraction allows swapping geocoding providers without touching
 * business logic in Shadow Atlas, district resolution, or ZK circuits.
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeocodeResult {
  readonly coordinates: Coordinates;
  readonly accuracy: number; // 0.0-1.0 confidence
  readonly source: string; // 'geocodio' | 'nominatim' | 'google' | 'mapbox'
}

export interface ReverseGeocodeResult {
  readonly address: Address;
  readonly accuracy: number;
  readonly source: string;
}

export interface Address {
  readonly street?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country: string; // ISO 3166-1 alpha-2 (US, CA, GB, AU, etc.)
}

export interface GeocodingProvider {
  /**
   * Convert address to coordinates
   */
  geocode(address: Address): Promise<GeocodeResult>;

  /**
   * Convert coordinates to address
   */
  reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult>;

  /**
   * Batch geocoding (if supported)
   */
  geocodeBatch?(addresses: Address[]): Promise<GeocodeResult[]>;

  /**
   * Provider-specific capabilities
   */
  readonly capabilities: {
    supportedCountries: string[]; // ISO country codes
    batchSize?: number; // Max addresses per batch
    rateLimit?: number; // Requests per minute
    accuracy: 'rooftop' | 'street' | 'city' | 'approximate';
  };

  /**
   * Cost tracking (for budget monitoring)
   */
  readonly pricing: {
    costPerLookup: number; // USD
    freeTierLimit?: number; // Lookups per day/month
  };
}

/**
 * Geocoding Error Types
 */
export class GeocodeError extends Error {
  constructor(
    message: string,
    public readonly code: GeocodeErrorCode,
    public readonly provider: string
  ) {
    super(message);
    this.name = 'GeocodeError';
  }
}

export enum GeocodeErrorCode {
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  NOT_FOUND = 'NOT_FOUND',
  UNSUPPORTED_COUNTRY = 'UNSUPPORTED_COUNTRY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR'
}
