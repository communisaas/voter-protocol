/**
 * Census Bureau Geocoding API Integration
 *
 * OFFICIAL API: https://geocoding.geo.census.gov/geocoder/
 * COST: FREE, unlimited
 * COVERAGE: 100% US addresses
 * RETURNS: Congressional + State Legislature districts
 *
 * Compliance: [CENSUS-API] specification in SHADOW-ATLAS-SPEC.md Section 4.3
 */

export interface CensusAddress {
  readonly street: string;
  readonly city: string;
  readonly state: string;  // 2-letter state code
  readonly zip?: string;
}

export interface CensusDistrict {
  readonly GEOID: string;
  readonly NAME: string;
  readonly BASENAME?: string;
  readonly CENTLAT?: string;
  readonly CENTLON?: string;
}

export interface CensusGeocodeResponse {
  result: {
    addressMatches: Array<{
      matchedAddress: string;
      coordinates: {
        x: number;  // Longitude
        y: number;  // Latitude
      };
      addressComponents: {
        streetName: string;
        city: string;
        state: string;
        zip: string;
      };
      geographies: {
        "119th Congressional Districts"?: CensusDistrict[];
        "2024 State Legislative Districts - Upper"?: CensusDistrict[];
        "2024 State Legislative Districts - Lower"?: CensusDistrict[];
        "Counties"?: CensusDistrict[];
        "Census Tracts"?: CensusDistrict[];
      };
    }>;
  };
}

export interface CensusDistrictResult {
  congressional?: {
    geoid: string;
    name: string;
    state: string;
  };
  stateSenate?: {
    geoid: string;
    name: string;
  };
  stateHouse?: {
    geoid: string;
    name: string;
  };
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

export class CensusGeocoder {
  private readonly baseUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/address';
  private readonly benchmark = 'Public_AR_Current';
  private readonly vintage = 'Current_Current';

  /**
   * Geocode address and resolve legislative districts
   *
   * @param address - US address
   * @returns Legislative districts + coordinates
   * @throws Error if address not found or API error
   */
  async geocodeAddress(address: CensusAddress): Promise<CensusDistrictResult> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('street', address.street);
    url.searchParams.set('city', address.city);
    url.searchParams.set('state', address.state);
    if (address.zip) {
      url.searchParams.set('zip', address.zip);
    }
    url.searchParams.set('benchmark', this.benchmark);
    url.searchParams.set('vintage', this.vintage);
    url.searchParams.set('format', 'json');

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Census API error: HTTP ${response.status}`);
      }

      const data: CensusGeocodeResponse = await response.json();

      if (!data.result?.addressMatches || data.result.addressMatches.length === 0) {
        throw new Error('Address not found in Census database');
      }

      const match = data.result.addressMatches[0];
      const geo = match.geographies;

      if (!geo) {
        throw new Error('No geographic data returned');
      }

      const result: CensusDistrictResult = {
        coordinates: {
          latitude: match.coordinates.y,
          longitude: match.coordinates.x
        }
      };

      // Congressional district
      const cd = geo["119th Congressional Districts"]?.[0];
      if (cd) {
        result.congressional = {
          geoid: cd.GEOID,
          name: cd.NAME,
          state: address.state
        };
      }

      // State Senate (upper chamber)
      const stateSenate = geo["2024 State Legislative Districts - Upper"]?.[0];
      if (stateSenate) {
        result.stateSenate = {
          geoid: stateSenate.GEOID,
          name: stateSenate.NAME
        };
      }

      // State House (lower chamber)
      const stateHouse = geo["2024 State Legislative Districts - Lower"]?.[0];
      if (stateHouse) {
        result.stateHouse = {
          geoid: stateHouse.GEOID,
          name: stateHouse.NAME
        };
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Census geocoding failed: ${String(error)}`);
    }
  }

  /**
   * Batch geocode addresses (sequential, respects rate limits)
   *
   * @param addresses - Array of US addresses
   * @param onProgress - Optional progress callback
   * @returns Array of results (same order as input)
   */
  async geocodeBatch(
    addresses: CensusAddress[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<CensusDistrictResult | Error>> {
    const results: Array<CensusDistrictResult | Error> = [];

    for (let i = 0; i < addresses.length; i++) {
      try {
        const result = await this.geocodeAddress(addresses[i]);
        results.push(result);
      } catch (error) {
        results.push(error instanceof Error ? error : new Error(String(error)));
      }

      onProgress?.(i + 1, addresses.length);

      // Rate limiting: 1 request per second to be respectful
      if (i < addresses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

/**
 * Factory: Create Census geocoder instance
 */
export function createCensusGeocoder(): CensusGeocoder {
  return new CensusGeocoder();
}
