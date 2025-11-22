import type { BoundaryType } from '../hub-api-discovery';
import { resolveIngestorId } from '../../ingestion/registry';

export type SourceId =
  | 'arcgis_hub'
  | 'census_tiger'
  | 'state_portal'
  | 'special_district_authority';

export type SourceQueryMode = 'point' | 'name';

export interface SourceDescriptor {
  readonly id: SourceId;
  readonly label: string;
  readonly boundaryTypes: ReadonlyArray<BoundaryType | 'special_district'> | 'any';
  readonly supports: {
    readonly queryModes: ReadonlyArray<SourceQueryMode>;
    readonly freshness?: boolean;
    readonly coverageGuarantee?: boolean;
    readonly authorityTier: 'federal' | 'state' | 'community';
  };
  readonly ingestion?: {
    readonly datasets: ReadonlyArray<string>;
    readonly resolve: (state: string, dataset?: string) => string | undefined;
  };
}

export const SOURCE_DESCRIPTORS: Record<SourceId, SourceDescriptor> = {
  arcgis_hub: {
    id: 'arcgis_hub',
    label: 'ArcGIS Hub API',
    boundaryTypes: 'any',
    supports: {
      queryModes: ['point', 'name'],
      authorityTier: 'community'
    }
  },
  census_tiger: {
    id: 'census_tiger',
    label: 'Census TIGER/Line',
    boundaryTypes: ['county', 'municipal', 'congressional', 'state_house', 'state_senate', 'school_board', 'voting_precinct'],
    supports: {
      queryModes: ['point', 'name'],
      coverageGuarantee: true,
      authorityTier: 'federal'
    }
  },
  state_portal: {
    id: 'state_portal',
    label: 'State GIS Portal',
    boundaryTypes: ['state_house', 'state_senate'],
    supports: {
      queryModes: ['point', 'name'],
      freshness: true,
      authorityTier: 'state'
    }
  },
  special_district_authority: {
    id: 'special_district_authority',
    label: 'Special District Authority',
    boundaryTypes: ['special_district'],
    supports: {
      queryModes: ['point', 'name'],
      authorityTier: 'state'
    },
    ingestion: {
      datasets: ['fire', 'water', 'transit'],
      resolve: (state: string, dataset = 'fire') => resolveIngestorId(state, dataset)
    }
  }
};

export function getSourceDescriptor(id: SourceId): SourceDescriptor {
  const descriptor = SOURCE_DESCRIPTORS[id];
  if (!descriptor) {
    throw new Error(`Unknown source descriptor: ${id}`);
  }
  return descriptor;
}
