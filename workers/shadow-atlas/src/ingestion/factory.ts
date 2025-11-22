import { MassachusettsFireIngestor } from './authorities/massachusetts-fire';
import { UtahFireIngestor } from './authorities/utah-fire';
import { MinnesotaFireIngestor } from './authorities/minnesota-fire';
import { WashingtonFireIngestor } from './authorities/washington-fire';
import { OregonFireIngestor } from './authorities/oregon-fire';
import { MontanaFireIngestor } from './authorities/montana-fire';
import { DelawareFireIngestor } from './authorities/delaware-fire';
import { IdahoFireIngestor } from './authorities/idaho-fire';
import { ColoradoFireIngestor } from './authorities/colorado-fire';
import { DistrictOfColumbiaFireIngestor } from './authorities/district-of-columbia-fire';
import { KansasFireIngestor } from './authorities/kansas-fire';
import { OklahomaFireIngestor } from './authorities/oklahoma-fire';
import { NorthDakotaFireIngestor } from './authorities/north-dakota-fire';
import { NebraskaFireIngestor } from './authorities/nebraska-fire';
import { AlaskaFireIngestor } from './authorities/alaska-fire';
import { HawaiiFireIngestor } from './authorities/hawaii-fire';
import { ArkansasFireIngestor } from './authorities/arkansas-fire';
import { NewMexicoFireIngestor } from './authorities/new-mexico-fire';
import { ArizonaFireIngestor } from './authorities/arizona-fire';
import { DelawareWaterIngestor } from './authorities/delaware-water';
import { DelawareTransitIngestor } from './authorities/delaware-transit';
import { KansasTransitIngestor } from './authorities/kansas-transit';
import { UtahWaterIngestor } from './authorities/utah-water';
import { TexasWaterIngestor } from './authorities/texas-water';
import { RhodeIslandWaterIngestor } from './authorities/rhode-island-water';
import { RhodeIslandTransitIngestor } from './authorities/rhode-island-transit';
import { ConnecticutWaterIngestor } from './authorities/connecticut-water';
import { ConnecticutTransitIngestor } from './authorities/connecticut-transit';
import { NorthCarolinaWaterIngestor } from './authorities/north-carolina-water';
import { NorthCarolinaTransitIngestor } from './authorities/north-carolina-transit';
import { TennesseeWaterIngestor } from './authorities/tennessee-water';
import { MissouriWaterIngestor } from './authorities/missouri-water';
import { AlabamaTransitIngestor } from './authorities/alabama-transit';
import { KansasWaterIngestor } from './authorities/kansas-water';
import type { AuthorityIngestor } from './types';

export function createAuthorityIngestor(ingestorId: string): AuthorityIngestor | undefined {
  switch (ingestorId) {
    case 'massachusetts-fire-districts':
      return new MassachusettsFireIngestor();
    case 'utah-fire-response-areas':
      return new UtahFireIngestor();
    case 'minnesota-fire-districts':
      return new MinnesotaFireIngestor();
    case 'washington-e911-fire-districts':
      return new WashingtonFireIngestor();
    case 'oregon-oda-fire-districts':
      return new OregonFireIngestor();
    case 'montana-msfca-fire-districts':
      return new MontanaFireIngestor();
    case 'delaware-firstmap-fire-districts':
      return new DelawareFireIngestor();
    case 'idaho-dof-fire-protective-districts':
      return new IdahoFireIngestor();
    case 'colorado-dola-fire-protection-districts':
      return new ColoradoFireIngestor();
    case 'district-of-columbia-fems-fire-districts':
      return new DistrictOfColumbiaFireIngestor();
    case 'kansas-forest-service-fire-districts':
      return new KansasFireIngestor();
    case 'oklahoma-tax-commission-fire-districts':
      return new OklahomaFireIngestor();
    case 'north-dakota-ndgishub-fire-districts':
      return new NorthDakotaFireIngestor();
    case 'nebraska-psc-fire-districts':
      return new NebraskaFireIngestor();
    case 'alaska-dof-fire-service-areas':
      return new AlaskaFireIngestor();
    case 'hawaii-statewide-fire-response-zones':
      return new HawaiiFireIngestor();
    case 'arkansas-fire-districts':
      return new ArkansasFireIngestor();
    case 'new-mexico-fire-districts':
      return new NewMexicoFireIngestor();
    case 'arizona-ng911-fire-districts':
      return new ArizonaFireIngestor();
    case 'delaware-psc-water-cpcn':
      return new DelawareWaterIngestor();
    case 'delaware-dart-transit-routes':
      return new DelawareTransitIngestor();
    case 'kansas-coordinated-transit-districts':
      return new KansasTransitIngestor();
    case 'utah-culinary-water-service-areas':
      return new UtahWaterIngestor();
    case 'texas-twdb-public-water-systems':
      return new TexasWaterIngestor();
    case 'rhode-island-water-districts':
      return new RhodeIslandWaterIngestor();
    case 'rhode-island-ripta-transit-routes':
      return new RhodeIslandTransitIngestor();
    case 'connecticut-exclusive-service-areas':
      return new ConnecticutWaterIngestor();
    case 'connecticut-transit-districts':
      return new ConnecticutTransitIngestor();
    case 'north-carolina-type-a-water-systems':
      return new NorthCarolinaWaterIngestor();
    case 'north-carolina-lcp-transit-districts':
      return new NorthCarolinaTransitIngestor();
    case 'tennessee-public-water-systems':
      return new TennesseeWaterIngestor();
    case 'missouri-public-water-districts':
      return new MissouriWaterIngestor();
    case 'alabama-rural-transit-districts':
      return new AlabamaTransitIngestor();
    case 'kansas-public-water-districts':
      return new KansasWaterIngestor();
    default:
      return undefined;
  }
}
