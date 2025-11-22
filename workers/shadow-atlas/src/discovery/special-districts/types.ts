import type { GeoJsonProperties, Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export type SpecialDistrictCategory =
  | 'water'
  | 'fire'
  | 'transit'
  | 'sewer'
  | 'parks'
  | 'utility'
  | 'sanitation'
  | 'library'
  | 'cdd'
  | 'mud'
  | 'health'
  | 'unknown';

export interface SpecialDistrictFeatureProperties extends GeoJsonProperties {
  district_id?: string;
  district_name?: string;
  district_type?: SpecialDistrictCategory | string;
  authority?: string;
  last_updated?: string;
  website?: string;
  registrySource?: string;
  registryPublisher?: string;
  registryScore?: number;
  registryNotes?: string;
  registryCategories?: SpecialDistrictCategory[];
}

export type SpecialDistrictFeature = Feature<Polygon | MultiPolygon, SpecialDistrictFeatureProperties>;
export type SpecialDistrictFeatureCollection = FeatureCollection<Polygon | MultiPolygon, SpecialDistrictFeatureProperties>;

export interface CountyDatasetConfig {
  readonly county: string;
  readonly authority: string;
  readonly dataPath: string;
  readonly categories: SpecialDistrictCategory[];
  readonly score: number;
  readonly lastUpdated: string;
  readonly notes?: string;
}

export interface SpecialDistrictAuthoritySourceConfig {
  readonly state: string;
  readonly name: string;
  readonly publisher: string;
  readonly coverage: 'statewide' | 'multi-county' | 'county';
  readonly counties: readonly CountyDatasetConfig[];
}
