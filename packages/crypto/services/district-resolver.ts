/**
 * District Resolution Service
 *
 * DESIGN PRINCIPLE: Geocoding-agnostic, internationally scalable
 *
 * ARCHITECTURE:
 * 1. Geocode address (provider-agnostic via GeocodingService)
 * 2. Resolve district (country-specific logic)
 * 3. Return finest available granularity
 *
 * COUNTRY EXPANSION:
 * - US: City council → Congressional → State legislature (Phases 1-2)
 * - CA: City council → Federal ridings → Provincial (Phase 2)
 * - UK: City council → Parliamentary constituencies (Phase 3)
 * - AU: City council → Federal electorates → State (Phase 3)
 * - etc.
 *
 * Each country has different district hierarchies. This service abstracts
 * that complexity so business logic just calls resolveDistrict(address).
 */

import type { Address, Coordinates } from './geocoding';
import { GeocodingService } from './geocoding';
import * as turf from '@turf/turf';
import type { FeatureCollection, Polygon } from 'geojson';

/**
 * District types (internationally extensible)
 */
export enum DistrictType {
  // Municipal (finest granularity)
  CITY_COUNCIL = 'city_council',
  COUNTY_COUNCIL = 'county_council',
  WARD = 'ward',

  // National legislature
  CONGRESSIONAL = 'congressional', // US House
  SENATE = 'senate', // US Senate (state-level)
  PARLIAMENTARY = 'parliamentary', // UK, AU, CA
  RIDING = 'riding', // Canada federal

  // State/Provincial legislature
  STATE_SENATE = 'state_senate',
  STATE_HOUSE = 'state_house',
  PROVINCIAL_ASSEMBLY = 'provincial_assembly',

  // International
  EUROPEAN_PARLIAMENT = 'european_parliament',
  // ... extensible as we add countries
}

export interface District {
  readonly type: DistrictType;
  readonly id: string; // Unique identifier (e.g., "NYC-Council-1", "US-Congress-CA-12")
  readonly name: string; // Human-readable (e.g., "New York City Council District 1")
  readonly country: string; // ISO 3166-1 alpha-2
  readonly granularity: 'finest' | 'intermediate' | 'fallback';
  readonly source: 'gis' | 'census' | 'cicero' | 'parliament-api'; // Where data came from
}

export interface DistrictResolution {
  readonly address: Address;
  readonly coordinates: Coordinates;
  readonly districts: District[]; // Sorted by granularity (finest first)
  readonly cost: number; // USD spent on lookups
}

/**
 * Country-specific district resolution strategies
 */
interface CountryStrategy {
  /**
   * Resolve districts for this country
   */
  resolve(
    address: Address,
    coords: Coordinates,
    context: DistrictResolverContext
  ): Promise<District[]>;

  /**
   * Supported district types (in order of preference)
   */
  readonly districtHierarchy: DistrictType[];
}

interface DistrictResolverContext {
  geocodingService: GeocodingService;
  censusApiKey?: string;
  ciceroApiKey?: string;
  parliamentApiKey?: string; // UK Parliament API
}

/**
 * US District Resolution Strategy
 */
class USDistrictStrategy implements CountryStrategy {
  readonly districtHierarchy = [
    DistrictType.CITY_COUNCIL, // Finest
    DistrictType.CONGRESSIONAL,
    DistrictType.STATE_SENATE,
    DistrictType.STATE_HOUSE // Fallback
  ];

  async resolve(
    address: Address,
    coords: Coordinates,
    context: DistrictResolverContext
  ): Promise<District[]> {
    const districts: District[] = [];

    // Tier 1: Check for FREE city council GIS data
    const cityCouncilDistrict = await this.resolveCityCouncilGIS(address, coords);
    if (cityCouncilDistrict) {
      districts.push(cityCouncilDistrict);
    }

    // Tier 2: FREE Census Bureau API (congressional + state legislature)
    const censusDistricts = await this.resolveCensusDistricts(address);
    districts.push(...censusDistricts);

    // Tier 3: Cicero (on-demand, if user consents and city council not in Tier 1)
    if (!cityCouncilDistrict && context.ciceroApiKey) {
      const ciceroDistrict = await this.resolveCicero(address, context.ciceroApiKey);
      if (ciceroDistrict) {
        districts.unshift(ciceroDistrict); // Add to front (finest granularity)
      }
    }

    return districts;
  }

  private async resolveCityCouncilGIS(
    address: Address,
    coords: Coordinates
  ): Promise<District | null> {
    // Load city council GeoJSON (cached in IndexedDB)
    const citySlug = address.city?.toLowerCase().replace(/\s+/g, '-');
    const gisData = await this.loadCityCouncilBoundaries(citySlug);

    if (!gisData) return null; // No FREE GIS for this city

    // Point-in-polygon check (client-side, < 10ms)
    const point = turf.point([coords.longitude, coords.latitude]);

    for (const feature of gisData.features) {
      if (turf.booleanPointInPolygon(point, feature as any)) {
        return {
          type: DistrictType.CITY_COUNCIL,
          id: `US-CityCouncil-${citySlug}-${feature.properties?.district ?? 'unknown'}`,
          name: `${address.city} City Council District ${feature.properties?.district ?? 'unknown'}`,
          country: 'US',
          granularity: 'finest',
          source: 'gis'
        };
      }
    }

    return null;
  }

  private async resolveCensusDistricts(address: Address): Promise<District[]> {
    // Census Bureau API (FREE, unlimited)
    const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/address');
    url.searchParams.set('street', address.street || '');
    url.searchParams.set('city', address.city || '');
    url.searchParams.set('state', address.state || '');
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('vintage', 'Current_Current');
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!data.result?.geographies) {
      return [];
    }

    const geo = data.result.geographies;
    const districts: District[] = [];

    // Congressional district
    const cd = geo['119th Congressional Districts']?.[0];
    if (cd) {
      districts.push({
        type: DistrictType.CONGRESSIONAL,
        id: `US-Congress-${address.state}-${cd.GEOID}`,
        name: `${address.state} Congressional District ${cd.GEOID}`,
        country: 'US',
        granularity: 'intermediate',
        source: 'census'
      });
    }

    // State legislature (upper chamber)
    const stateSenate = geo['State Legislative Districts - Upper']?.[0];
    if (stateSenate) {
      districts.push({
        type: DistrictType.STATE_SENATE,
        id: `US-StateSenate-${address.state}-${stateSenate.GEOID}`,
        name: `${address.state} State Senate District ${stateSenate.GEOID}`,
        country: 'US',
        granularity: 'fallback',
        source: 'census'
      });
    }

    // State legislature (lower chamber)
    const stateHouse = geo['State Legislative Districts - Lower']?.[0];
    if (stateHouse) {
      districts.push({
        type: DistrictType.STATE_HOUSE,
        id: `US-StateHouse-${address.state}-${stateHouse.GEOID}`,
        name: `${address.state} State House District ${stateHouse.GEOID}`,
        country: 'US',
        granularity: 'fallback',
        source: 'census'
      });
    }

    return districts;
  }

  private async resolveCicero(
    address: Address,
    apiKey: string
  ): Promise<District | null> {
    // Check coverage first (FREE)
    const coverage = await this.checkCiceroCoverage(address, apiKey);
    if (!coverage.hasLocalCouncil) return null;

    // User consent required (costs $0.03)
    // This would be implemented in the UI layer
    // For now, we just return the capability

    return null; // Deferred to Phase 2
  }

  private async checkCiceroCoverage(
    address: Address,
    apiKey: string
  ): Promise<{ hasLocalCouncil: boolean }> {
    // Load cached coverage map (FREE endpoint, refreshed monthly)
    // Implementation in update-cicero-coverage.ts
    return { hasLocalCouncil: false }; // Placeholder
  }

  private async loadCityCouncilBoundaries(
    citySlug?: string
  ): Promise<FeatureCollection | null> {
    if (!citySlug) return null;

    // Load from IndexedDB or fetch from IPFS
    // Implementation depends on storage strategy
    return null; // Placeholder
  }
}

/**
 * Canada District Resolution Strategy (Phase 2)
 */
class CanadaDistrictStrategy implements CountryStrategy {
  readonly districtHierarchy = [
    DistrictType.CITY_COUNCIL,
    DistrictType.RIDING, // Federal electoral districts
    DistrictType.PROVINCIAL_ASSEMBLY
  ];

  async resolve(
    address: Address,
    coords: Coordinates,
    context: DistrictResolverContext
  ): Promise<District[]> {
    // TODO: Implement Canada-specific resolution
    // - City council GIS from municipal portals
    // - Federal ridings from Elections Canada API
    // - Provincial districts from provincial APIs
    return [];
  }
}

/**
 * UK District Resolution Strategy (Phase 3)
 */
class UKDistrictStrategy implements CountryStrategy {
  readonly districtHierarchy = [
    DistrictType.CITY_COUNCIL,
    DistrictType.PARLIAMENTARY // UK Parliamentary constituencies
  ];

  async resolve(
    address: Address,
    coords: Coordinates,
    context: DistrictResolverContext
  ): Promise<District[]> {
    // TODO: Implement UK-specific resolution
    // - City council wards from local authorities
    // - Parliamentary constituencies from UK Parliament API
    return [];
  }
}

/**
 * Main District Resolver Service
 */
export class DistrictResolver {
  private readonly geocodingService: GeocodingService;
  private readonly strategies: Map<string, CountryStrategy> = new Map();
  private readonly context: DistrictResolverContext;

  constructor(config: {
    geocodingService: GeocodingService;
    censusApiKey?: string;
    ciceroApiKey?: string;
    parliamentApiKey?: string;
  }) {
    this.geocodingService = config.geocodingService;
    this.context = {
      geocodingService: config.geocodingService,
      censusApiKey: config.censusApiKey,
      ciceroApiKey: config.ciceroApiKey,
      parliamentApiKey: config.parliamentApiKey
    };

    // Register country strategies
    this.strategies.set('US', new USDistrictStrategy());
    this.strategies.set('CA', new CanadaDistrictStrategy());
    this.strategies.set('GB', new UKDistrictStrategy());
    // ... extensible as we add countries
  }

  /**
   * Resolve districts for address (geocoding-agnostic, country-agnostic)
   */
  async resolveDistricts(address: Address): Promise<DistrictResolution> {
    // Step 1: Geocode address (provider selected automatically)
    const geocodeResult = await this.geocodingService.geocode(address);
    const geocodeCost = this.geocodingService.estimateCost(address);

    // Step 2: Get country-specific strategy
    const strategy = this.strategies.get(address.country);
    if (!strategy) {
      throw new Error(`No district resolution strategy for country: ${address.country}`);
    }

    // Step 3: Resolve districts using country strategy
    const districts = await strategy.resolve(address, geocodeResult.coordinates, this.context);

    // Sort by granularity (finest first)
    const sorted = this.sortByGranularity(districts);

    return {
      address,
      coordinates: geocodeResult.coordinates,
      districts: sorted,
      cost: geocodeCost
    };
  }

  /**
   * Get finest available district for address
   */
  async resolveFinestDistrict(address: Address): Promise<District> {
    const resolution = await this.resolveDistricts(address);

    if (resolution.districts.length === 0) {
      throw new Error('No districts found for address');
    }

    return resolution.districts[0]; // Finest granularity
  }

  private sortByGranularity(districts: District[]): District[] {
    const order: { [key in District['granularity']]: number } = {
      finest: 0,
      intermediate: 1,
      fallback: 2
    };

    return districts.sort((a, b) => order[a.granularity] - order[b.granularity]);
  }
}
