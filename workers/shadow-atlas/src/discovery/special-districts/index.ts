import type { BoundaryDataSource } from '../sources/types';
import type { BoundaryDataSource } from '../sources/types';
import { CaliforniaLAFCoSource } from './california-lafco';
import { TexasTCEQMUDSource } from './texas-tceq';
import { FloridaDEOCDDSource } from './florida-deo';
import { RegistryGeoJSONStatewideSource } from './statewide-registry-source';

class CompositeSpecialDistrictSource implements BoundaryDataSource {
  readonly id = 'special_district_authority' as const;
  readonly name: string;

  constructor(
    private readonly primary: BoundaryDataSource,
    private readonly fallback?: BoundaryDataSource
  ) {
    this.name = fallback ? `${primary.name} + registry` : primary.name;
  }

  async fetch(request: Parameters<BoundaryDataSource['fetch']>[0]) {
    const primaryResult = await this.primary.fetch(request);
    if (primaryResult) {
      return primaryResult;
    }
    return this.fallback ? this.fallback.fetch(request) : null;
  }
}

export function createSpecialDistrictStateSource(state: string): BoundaryDataSource | undefined {
  switch (state) {
    case 'CA':
      return new CompositeSpecialDistrictSource(
        new CaliforniaLAFCoSource(),
        new RegistryGeoJSONStatewideSource(state)
      );
    case 'TX':
      return new CompositeSpecialDistrictSource(
        new TexasTCEQMUDSource(),
        new RegistryGeoJSONStatewideSource(state)
      );
    case 'FL':
      return new CompositeSpecialDistrictSource(
        new FloridaDEOCDDSource(),
        new RegistryGeoJSONStatewideSource(state)
      );
    default:
      return new RegistryGeoJSONStatewideSource(state);
  }
}
