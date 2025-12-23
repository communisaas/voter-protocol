/**
 * Census Geocoder Integration
 *
 * FREE batch geocoding for US addresses via Census Bureau API.
 * Zero cost, no API key required, 10,000 addresses per batch.
 *
 * API Documentation: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
 * Batch Endpoint: https://geocoding.geo.census.gov/geocoder/geographies/addressbatch
 *
 * PHILOSOPHY:
 * - Free forever (federal government service)
 * - No authentication required
 * - Returns lat/lng + FIPS codes (state, county, tract, block)
 * - Authoritative US boundary assignments
 */

export interface Address {
  readonly id: string;
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
}

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface GeocodeResult {
  readonly address: Address;
  readonly coordinates: LatLng | null;
  readonly match: boolean;
  readonly matchType?: 'Exact' | 'Non_Exact';
  readonly fips?: {
    readonly state: string;
    readonly county: string;
    readonly tract: string;
    readonly block: string;
  };
  readonly error?: string;
}

export interface BatchGeocodeStats {
  readonly total: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly exactMatches: number;
  readonly nonExactMatches: number;
  readonly matchRate: number;
}

/**
 * Census Bureau Geocoder Client
 *
 * Handles batch geocoding of US addresses using the free Census API.
 */
export class CensusGeocoder {
  private readonly BATCH_ENDPOINT =
    'https://geocoding.geo.census.gov/geocoder/geographies/addressbatch';
  private readonly MAX_BATCH_SIZE = 10000;
  private readonly TIMEOUT_MS = 120000; // 2 minutes for large batches

  /**
   * Geocode a single address
   *
   * @param address - Address to geocode
   * @returns Geocode result with coordinates and FIPS codes
   */
  async geocodeSingle(address: Address): Promise<GeocodeResult> {
    const results = await this.geocodeBatch([address]);
    const result = results.get(address.id);

    if (!result) {
      return {
        address,
        coordinates: null,
        match: false,
        error: 'No result returned from Census API',
      };
    }

    return result;
  }

  /**
   * Geocode multiple addresses in a single batch request
   *
   * CSV format (required by Census API):
   * Unique ID, Street address, City, State, ZIP
   *
   * @param addresses - Array of addresses to geocode (max 10,000)
   * @returns Map of address ID → geocode result
   */
  async geocodeBatch(addresses: Address[]): Promise<Map<string, GeocodeResult>> {
    if (addresses.length === 0) {
      return new Map();
    }

    if (addresses.length > this.MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size ${addresses.length} exceeds Census API limit of ${this.MAX_BATCH_SIZE}`
      );
    }

    // Generate CSV (Census API format)
    const csv = this.generateCSV(addresses);

    // Upload CSV to Census API
    const formData = new FormData();
    formData.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv');
    formData.append('benchmark', 'Public_AR_Current'); // Current benchmark
    formData.append('vintage', 'Current_Current'); // Current vintage

    try {
      const response = await fetch(this.BATCH_ENDPOINT, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(this.TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Census API returned ${response.status} ${response.statusText}`
        );
      }

      const resultText = await response.text();
      return this.parseBatchResults(resultText, addresses);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Census API request timed out after ${this.TIMEOUT_MS}ms`
        );
      }
      throw error;
    }
  }

  /**
   * Geocode addresses in multiple batches (for >10k addresses)
   *
   * @param addresses - Array of addresses (unlimited size)
   * @returns Map of address ID → geocode result
   */
  async geocodeMultiBatch(
    addresses: Address[],
    options?: {
      onProgress?: (completed: number, total: number) => void;
      delayBetweenBatches?: number; // ms
    }
  ): Promise<Map<string, GeocodeResult>> {
    const results = new Map<string, GeocodeResult>();
    const batches = this.chunkAddresses(addresses, this.MAX_BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResults = await this.geocodeBatch(batch);

      // Merge results
      for (const [id, result] of batchResults) {
        results.set(id, result);
      }

      // Progress callback
      if (options?.onProgress) {
        const completed = (i + 1) * this.MAX_BATCH_SIZE;
        options.onProgress(
          Math.min(completed, addresses.length),
          addresses.length
        );
      }

      // Rate limiting (optional delay)
      if (
        i < batches.length - 1 &&
        options?.delayBetweenBatches &&
        options.delayBetweenBatches > 0
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayBetweenBatches)
        );
      }
    }

    return results;
  }

  /**
   * Compute statistics for batch geocoding results
   *
   * @param results - Geocoding results
   * @returns Statistics summary
   */
  computeStats(results: Map<string, GeocodeResult>): BatchGeocodeStats {
    let matched = 0;
    let exactMatches = 0;
    let nonExactMatches = 0;

    for (const result of results.values()) {
      if (result.match) {
        matched++;
        if (result.matchType === 'Exact') {
          exactMatches++;
        } else if (result.matchType === 'Non_Exact') {
          nonExactMatches++;
        }
      }
    }

    const total = results.size;
    const unmatched = total - matched;
    const matchRate = total > 0 ? matched / total : 0;

    return {
      total,
      matched,
      unmatched,
      exactMatches,
      nonExactMatches,
      matchRate,
    };
  }

  /**
   * Generate CSV for Census API batch upload
   *
   * Format: "Unique ID","Street address","City","State","ZIP"
   */
  private generateCSV(addresses: Address[]): string {
    const header = 'Unique ID,Street address,City,State,ZIP\n';

    // Escape CSV field: double any embedded quotes per RFC 4180
    const escapeCSVField = (value: string): string => {
      return value.replace(/"/g, '""');
    };

    const rows = addresses.map((addr) =>
      `"${escapeCSVField(addr.id)}","${escapeCSVField(addr.street)}","${escapeCSVField(addr.city)}","${escapeCSVField(addr.state)}","${escapeCSVField(addr.zip)}"`
    );

    return header + rows.join('\n');
  }

  /**
   * Parse Census API batch results
   *
   * Response format (CSV):
   * "Unique ID","Input Address","Match","Match Type","Matched Address","Coordinates","TIGER/Line ID","Side"
   *
   * Match = "Match" | "No_Match" | "Tie"
   * Match Type = "Exact" | "Non_Exact"
   * Coordinates = "lng, lat" (note: lon first!)
   */
  private parseBatchResults(
    resultText: string,
    originalAddresses: Address[]
  ): Map<string, GeocodeResult> {
    const results = new Map<string, GeocodeResult>();
    const addressMap = new Map(originalAddresses.map((a) => [a.id, a]));

    const lines = resultText.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse CSV row (handle quoted fields)
      const fields = this.parseCSVRow(line);

      if (fields.length < 3) {
        continue; // Skip invalid rows
      }

      const id = fields[0];
      const matchStatus = fields[2]; // "Match", "No_Match", "Tie"
      const matchType = fields.length > 3 ? fields[3] : undefined; // "Exact", "Non_Exact"
      const coordinates = fields.length > 5 ? fields[5] : undefined;

      const address = addressMap.get(id);
      if (!address) {
        continue; // Unknown address ID
      }

      // Parse coordinates (format: "lng, lat")
      let latLng: LatLng | null = null;
      if (coordinates && coordinates.includes(',')) {
        const [lngStr, latStr] = coordinates.split(',').map((s) => s.trim());
        const lng = parseFloat(lngStr);
        const lat = parseFloat(latStr);

        if (!isNaN(lng) && !isNaN(lat)) {
          latLng = { lat, lng };
        }
      }

      // Parse FIPS codes (if available)
      // Census API returns: State FIPS, County FIPS, Tract, Block
      // This data is in columns after coordinates
      let fips: GeocodeResult['fips'] | undefined;
      if (fields.length > 9) {
        fips = {
          state: fields[9] || '',
          county: fields[10] || '',
          tract: fields[11] || '',
          block: fields[12] || '',
        };
      }

      results.set(id, {
        address,
        coordinates: latLng,
        match: matchStatus === 'Match',
        matchType:
          matchType === 'Exact' || matchType === 'Non_Exact'
            ? matchType
            : undefined,
        fips,
        error:
          matchStatus === 'No_Match'
            ? 'Address not found in Census database'
            : matchStatus === 'Tie'
              ? 'Multiple matches found (ambiguous address)'
              : undefined,
      });
    }

    // Add unmatched addresses (not in result)
    for (const address of originalAddresses) {
      if (!results.has(address.id)) {
        results.set(address.id, {
          address,
          coordinates: null,
          match: false,
          error: 'No result returned from Census API',
        });
      }
    }

    return results;
  }

  /**
   * Parse CSV row handling quoted fields
   */
  private parseCSVRow(row: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }

    fields.push(currentField.trim());
    return fields;
  }

  /**
   * Split addresses into chunks for batch processing
   */
  private chunkAddresses(
    addresses: Address[],
    chunkSize: number
  ): Address[][] {
    const chunks: Address[][] = [];

    for (let i = 0; i < addresses.length; i += chunkSize) {
      chunks.push(addresses.slice(i, i + chunkSize));
    }

    return chunks;
  }
}
