/**
 * GeocodeService — Self-hosted address geocoding via Nominatim.
 *
 * Wraps a local Nominatim instance (backed by TIGER/Line + OSM data)
 * to geocode structured US/CA addresses with zero external API calls.
 *
 * Uses the /search endpoint with structured parameters for best match quality.
 */

import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address: string;
  confidence: number;       // 0-1 based on Nominatim importance/rank
  country: 'US' | 'CA';
  state_province: string;   // 2-letter code
  postal_code: string;
}

export interface GeocodeRequest {
  street: string;
  city: string;
  state: string;            // US state or CA province abbreviation
  zip: string;              // US ZIP or CA postal code
  country?: 'US' | 'CA';   // auto-detected from postal format if omitted
}

/** Raw Nominatim /search JSON response item */
interface NominatimPlace {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  importance: number;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  class?: string;
  type?: string;
  place_rank?: number;
}

// ============================================================================
// GeocodeService
// ============================================================================

export class GeocodeService {
  private readonly nominatimUrl: string;
  private readonly timeoutMs: number;

  // Metrics
  private queryCount = 0;
  private successCount = 0;
  private failCount = 0;
  private latencies: number[] = [];

  constructor(nominatimUrl: string, timeoutMs = 5000) {
    // Strip trailing slash
    this.nominatimUrl = nominatimUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Auto-detect country from postal code format.
   *
   * US ZIP: 12345 or 12345-6789
   * Canadian postal code: A1A 1A1 or A1A1A1
   */
  static detectCountry(postalCode: string): 'US' | 'CA' | null {
    const trimmed = postalCode.trim();
    if (/^\d{5}(-\d{4})?$/.test(trimmed)) return 'US';
    if (/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(trimmed)) return 'CA';
    return null;
  }

  /**
   * Geocode a structured address.
   *
   * Uses Nominatim /search with structured query parameters for highest
   * match quality. Returns null if no match found (not an error).
   */
  async geocode(request: GeocodeRequest): Promise<GeocodeResult | null> {
    const startTime = performance.now();
    this.queryCount++;

    const country = request.country ?? GeocodeService.detectCountry(request.zip);
    const countryCode = country === 'CA' ? 'ca' : 'us';

    const params = new URLSearchParams({
      street: request.street,
      city: request.city,
      state: request.state,
      postalcode: request.zip,
      countrycodes: countryCode,
      format: 'json',
      addressdetails: '1',
      limit: '1',
    });

    const url = `${this.nominatimUrl}/search?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'shadow-atlas/0.2.0' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        this.failCount++;
        logger.warn('Nominatim returned non-OK status', {
          status: response.status,
          url: url.replace(/street=[^&]+/, 'street=***'),  // privacy: redact address
        });
        return null;
      }

      const places = (await response.json()) as NominatimPlace[];

      const latencyMs = performance.now() - startTime;
      this.latencies.push(latencyMs);

      if (places.length === 0) {
        this.failCount++;
        return null;
      }

      const place = places[0];
      const lat = parseFloat(place.lat);
      const lng = parseFloat(place.lon);

      if (isNaN(lat) || isNaN(lng)) {
        this.failCount++;
        logger.warn('Nominatim returned unparseable coordinates', {
          lat: place.lat,
          lon: place.lon,
        });
        return null;
      }

      this.successCount++;

      const stateProvince = place.address?.state
        ? this.abbreviateState(place.address.state, country ?? 'US')
        : request.state;

      return {
        lat,
        lng,
        matched_address: place.display_name,
        confidence: this.computeConfidence(place),
        country: country ?? 'US',
        state_province: stateProvince,
        postal_code: place.address?.postcode ?? request.zip,
      };
    } catch (err) {
      this.failCount++;
      const latencyMs = performance.now() - startTime;
      this.latencies.push(latencyMs);

      if (err instanceof DOMException && err.name === 'AbortError') {
        logger.warn('Nominatim geocode timed out', { timeoutMs: this.timeoutMs });
      } else {
        logger.warn('Nominatim geocode failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }
  }

  /**
   * Health check: Nominatim is reachable and responsive.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.nominatimUrl}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Service metrics for monitoring.
   */
  getMetrics(): {
    queryCount: number;
    successCount: number;
    failCount: number;
    successRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  } {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      queryCount: this.queryCount,
      successCount: this.successCount,
      failCount: this.failCount,
      successRate: this.queryCount > 0 ? this.successCount / this.queryCount : 0,
      p50LatencyMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0,
      p95LatencyMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Compute confidence score from Nominatim response.
   * Based on importance (0-1) and place_rank (lower = more important).
   */
  private computeConfidence(place: NominatimPlace): number {
    // Nominatim importance is 0-1, higher = more important place
    let confidence = place.importance ?? 0.5;

    // Boost for address-level matches (place_rank >= 26 means house/building level)
    if (place.place_rank && place.place_rank >= 26) {
      confidence = Math.min(1, confidence + 0.2);
    }

    // Reduce for very coarse matches (city-level or above)
    if (place.place_rank && place.place_rank < 16) {
      confidence = Math.max(0, confidence - 0.3);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Abbreviate a full state/province name to its 2-letter code.
   * Falls back to first 2 characters if not found.
   */
  private abbreviateState(fullName: string, country: 'US' | 'CA'): string {
    const map = country === 'US' ? US_STATE_ABBREV : CA_PROVINCE_ABBREV;
    return map[fullName.toLowerCase()] ?? fullName.slice(0, 2).toUpperCase();
  }
}

// ============================================================================
// State/Province Abbreviations
// ============================================================================

const US_STATE_ABBREV: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', 'guam': 'GU',
  'american samoa': 'AS', 'u.s. virgin islands': 'VI',
  'northern mariana islands': 'MP',
};

const CA_PROVINCE_ABBREV: Record<string, string> = {
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
  'northwest territories': 'NT', 'nova scotia': 'NS', 'nunavut': 'NU',
  'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
  'saskatchewan': 'SK', 'yukon': 'YT',
};
