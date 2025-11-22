import path from 'path';
import { fileURLToPath } from 'url';

import registryJson from '../../../data/special-districts/registry.json' with { type: 'json' };
import type { SpecialDistrictCategory } from './types';

export type DatasetStatus = 'live' | 'in_progress' | 'planned' | 'unverified';
export type DatasetType = 'geojson_local' | 'remote_shapefile' | 'remote_feature_server';

export interface SpecialDistrictSourceEntry {
  readonly name: string;
  readonly publisher?: string;
  readonly coverage: 'county' | 'statewide' | 'multi-county';
  readonly county?: string;
  readonly datasetType: DatasetType;
  readonly path?: string;
  readonly url?: string;
  readonly status: DatasetStatus;
  readonly score: number;
  readonly lastUpdated: string | null;
  readonly categories?: SpecialDistrictCategory[];
  readonly notes?: string;
}

export interface SpecialDistrictStateEntry {
  readonly state: string;
  readonly authority: string;
  readonly coverage: 'county' | 'statewide';
  readonly status: DatasetStatus | 'in_progress';
  readonly populationShare: number;
  readonly priorityRank: number;
  readonly notes?: string;
  readonly sources: readonly SpecialDistrictSourceEntry[];
}

export interface SpecialDistrictRegistry {
  readonly version: number;
  readonly generated: string;
  readonly states: readonly SpecialDistrictStateEntry[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export const SPECIAL_DISTRICT_REGISTRY = registryJson as SpecialDistrictRegistry;

export function getStateEntry(state: string): SpecialDistrictStateEntry | undefined {
  return SPECIAL_DISTRICT_REGISTRY.states.find(entry => entry.state === state);
}
