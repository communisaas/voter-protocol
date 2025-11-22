/**
 * State Portal Registry - Metadata for official state GIS portals
 *
 * Design Pattern: Registry Pattern + Data-Driven Configuration
 *
 * Philosophy:
 * - All state-specific knowledge lives in data structures, not code
 * - Adding new portal = add entry to registry, zero code changes
 * - Future agents can modify by editing this file alone
 * - TypeScript enforces schema correctness
 */

import type { BoundaryType } from '../hub-api-discovery';
import type { RedistrictingMetadata } from './routing-strategy';

/**
 * State portal configuration - complete metadata for a state GIS source
 */
export interface StatePortalConfig {
  readonly state: string;
  readonly boundaryType: BoundaryType;
  readonly authority: string; // Official name of governing body
  readonly name: string; // Display name
  readonly url: string; // Direct download or portal URL
  readonly format: 'shapefile' | 'geojson' | 'arcgis_service';
  readonly lastRedistricting: Date; // When districts were last redrawn
  readonly notes?: string;
}

/**
 * Portal registry key - ensures unique lookups
 */
export type PortalRegistryKey = `${string}:${BoundaryType}`;

/**
 * Create registry key from state code and boundary type
 */
export function createPortalKey(state: string, boundaryType: BoundaryType): PortalRegistryKey {
  return `${state}:${boundaryType}`;
}

/**
 * State portal registry - all known official government GIS sources
 *
 * CRITICAL: These are FREE government portals from redistricting authorities
 * Source: STATE_PORTAL_RESEARCH.md (2025-11-10)
 *
 * Coverage: 21 states with official state portals
 * - Fresh redistricting (< 36 months): WI (2024-02), WA (2024-03), ND (2024-01), OH (2023-09), AK (2023-05)
 * - Official state sources: UT, IA, NH, ME, RI, DE, VT, NE
 * - Previously catalogued: CO, IL, MN, MS, MT, TX, GA, KS, NC
 *
 * States not in registry: Fall back to TIGER/Line (100% coverage via Hub API)
 */
export const STATE_PORTAL_REGISTRY: readonly StatePortalConfig[] = [
  // Colorado - Independent Redistricting Commission
  {
    state: 'CO',
    boundaryType: 'state_house',
    authority: 'Colorado Independent Redistricting Commission',
    name: 'Colorado Redistricting Commission',
    url: 'https://data.openwaterfoundation.org/state/co/circ/legislative-districts/',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-15'),
    notes: 'Maps approved by Colorado Supreme Court November 2021'
  },
  {
    state: 'CO',
    boundaryType: 'state_senate',
    authority: 'Colorado Independent Redistricting Commission',
    name: 'Colorado Redistricting Commission',
    url: 'https://data.openwaterfoundation.org/state/co/circ/legislative-districts/',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-15')
  },

  // Illinois - Senate Redistricting Committee
  {
    state: 'IL',
    boundaryType: 'state_house',
    authority: 'Illinois Senate Redistricting Committee',
    name: 'Illinois General Assembly',
    url: 'https://www.ilsenateredistricting.com/resources/shape-files',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01'),
    notes: 'Enacted maps from Senate Redistricting Committee'
  },
  {
    state: 'IL',
    boundaryType: 'state_senate',
    authority: 'Illinois Senate Redistricting Committee',
    name: 'Illinois General Assembly',
    url: 'https://www.ilsenateredistricting.com/resources/shape-files',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01')
  },

  // Minnesota - Legislature GIS Office (LCC-GIS)
  {
    state: 'MN',
    boundaryType: 'state_house',
    authority: 'Minnesota Legislature GIS Office',
    name: 'Minnesota Geospatial Commons',
    url: 'https://gisdata.mn.gov/organization/us-mn-state-lcc',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01'),
    notes: 'Official state clearinghouse, derived from Census 2020 TIGER/Line'
  },
  {
    state: 'MN',
    boundaryType: 'state_senate',
    authority: 'Minnesota Legislature GIS Office',
    name: 'Minnesota Geospatial Commons',
    url: 'https://gisdata.mn.gov/dataset/bdry-senatedistricts2022',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01')
  },

  // Mississippi - MARIS (State GIS Authority)
  {
    state: 'MS',
    boundaryType: 'state_house',
    authority: 'Mississippi Automated Resource Information System',
    name: 'MARIS',
    url: 'https://maris.mississippi.edu/HTML/Redistricting/Redistricting.html',
    format: 'shapefile',
    lastRedistricting: new Date('2022-03-01'),
    notes: 'Assists Mississippi Joint Committee on Reapportionment & Redistricting'
  },
  {
    state: 'MS',
    boundaryType: 'state_senate',
    authority: 'Mississippi Automated Resource Information System',
    name: 'MARIS',
    url: 'https://maris.mississippi.edu/HTML/Redistricting/Redistricting.html',
    format: 'shapefile',
    lastRedistricting: new Date('2025-05-07'),
    notes: 'Senate districts court-adopted May 2025'
  },

  // Montana - State Library (MSDI Framework)
  {
    state: 'MT',
    boundaryType: 'state_house',
    authority: 'Montana State Library',
    name: 'Montana MSDI Framework',
    url: 'https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaLegislativeDistricts_2024_2032_shp.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-01-01'),
    notes: 'Montana Spatial Data Infrastructure - authoritative state source (direct shapefile download)'
  },
  {
    state: 'MT',
    boundaryType: 'state_senate',
    authority: 'Montana State Library',
    name: 'Montana MSDI Framework',
    url: 'https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaLegislativeDistricts_2024_2032_shp.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-01-01'),
    notes: 'Contains both House and Senate districts (direct shapefile download)'
  },

  // Texas - Legislative Council + TxDOT
  {
    state: 'TX',
    boundaryType: 'state_house',
    authority: 'Texas Legislative Council',
    name: 'Texas Department of Transportation Open Data',
    url: 'https://gis-txdot.opendata.arcgis.com/datasets/texas-state-house-districts',
    format: 'shapefile',
    lastRedistricting: new Date('2023-01-01'),
    notes: 'TxDOT hosts official TLC shapefiles'
  },
  {
    state: 'TX',
    boundaryType: 'state_senate',
    authority: 'Texas Legislative Council',
    name: 'Texas Department of Transportation Open Data',
    url: 'https://gis-txdot.opendata.arcgis.com/datasets/texas-state-senate-districts',
    format: 'shapefile',
    lastRedistricting: new Date('2023-01-01')
  },

  // Georgia - General Assembly Reapportionment
  {
    state: 'GA',
    boundaryType: 'state_senate',
    authority: 'Georgia General Assembly',
    name: 'Georgia Reapportionment Office',
    url: 'https://www.legis.ga.gov/joint-office/reapportionment',
    format: 'shapefile',
    lastRedistricting: new Date('2023-10-01'),
    notes: 'Approved October 2023 for 2024 elections'
  },
  {
    state: 'GA',
    boundaryType: 'state_house',
    authority: 'Georgia General Assembly',
    name: 'Georgia Reapportionment Office',
    url: 'https://www.legis.ga.gov/joint-office/reapportionment',
    format: 'shapefile',
    lastRedistricting: new Date('2023-10-01')
  },

  // Kansas - DASC Geoportal (since 1991)
  {
    state: 'KS',
    boundaryType: 'state_senate',
    authority: 'Kansas Data Access and Support Center',
    name: 'Kansas Geoportal Hub',
    url: 'https://hub.kansasgis.org/datasets/kansas-senate-districts',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01'),
    notes: 'DASC is official Kansas GIS clearinghouse since 1991'
  },
  {
    state: 'KS',
    boundaryType: 'state_house',
    authority: 'Kansas Data Access and Support Center',
    name: 'Kansas Geoportal Hub',
    url: 'https://hub.kansasgis.org/datasets/kansas-house-districts',
    format: 'shapefile',
    lastRedistricting: new Date('2022-01-01')
  },

  // North Carolina - General Assembly Redistricting
  {
    state: 'NC',
    boundaryType: 'state_senate',
    authority: 'North Carolina General Assembly',
    name: 'NC General Assembly Redistricting Office',
    url: 'https://www.ncleg.gov/Redistricting',
    format: 'shapefile',
    lastRedistricting: new Date('2023-10-01'),
    notes: 'New maps approved October 2023 for 2024 elections'
  },
  {
    state: 'NC',
    boundaryType: 'state_house',
    authority: 'North Carolina General Assembly',
    name: 'NC General Assembly Redistricting Office',
    url: 'https://www.ncleg.gov/Redistricting',
    format: 'shapefile',
    lastRedistricting: new Date('2023-10-01')
  },

  // Washington - State Redistricting Commission (court-corrected)
  {
    state: 'WA',
    boundaryType: 'state_senate',
    authority: 'Washington State Redistricting Commission',
    name: 'WA Redistricting Commission',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_53_sldu.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-03-15'),
    notes: 'District 15 revised March 15, 2024 (Soto Palmer v. Hobbs VRA compliance). TIGER2024 incorporates corrections.'
  },
  {
    state: 'WA',
    boundaryType: 'state_house',
    authority: 'Washington State Redistricting Commission',
    name: 'WA Redistricting Commission',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_53_sldl.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-03-15'),
    notes: 'District 15 revised March 15, 2024. Original redistricting Feb 8, 2022.'
  },

  // Wisconsin - Legislative Technology Services Bureau (FRESH - court-ordered 2024)
  {
    state: 'WI',
    boundaryType: 'state_house',
    authority: 'Wisconsin Legislative Technology Services Bureau',
    name: 'WI LTSB GIS Portal',
    url: 'https://legis.wisconsin.gov/ltsb/gis/',
    format: 'shapefile',
    lastRedistricting: new Date('2024-02-19'),
    notes: 'Court-ordered redistricting February 19, 2024 - FRESHEST state data'
  },
  {
    state: 'WI',
    boundaryType: 'state_senate',
    authority: 'Wisconsin Legislative Technology Services Bureau',
    name: 'WI LTSB GIS Portal',
    url: 'https://legis.wisconsin.gov/ltsb/gis/',
    format: 'shapefile',
    lastRedistricting: new Date('2024-02-19')
  },

  // Ohio - ODOT TIMS (FRESH - court-ordered 2023)
  {
    state: 'OH',
    boundaryType: 'state_house',
    authority: 'Ohio Department of Transportation',
    name: 'ODOT TIMS Portal',
    url: 'https://gis.dot.state.oh.us/tims/Data/Download',
    format: 'shapefile',
    lastRedistricting: new Date('2023-09-29'),
    notes: 'Court-ordered redistricting September 29, 2023'
  },
  {
    state: 'OH',
    boundaryType: 'state_senate',
    authority: 'Ohio Department of Transportation',
    name: 'ODOT TIMS Portal',
    url: 'https://gis.dot.state.oh.us/tims/Data/Download',
    format: 'shapefile',
    lastRedistricting: new Date('2023-09-29')
  },

  // Alaska - Redistricting Board (FRESH - 2023)
  {
    state: 'AK',
    boundaryType: 'state_house',
    authority: 'Alaska Redistricting Board',
    name: 'AK Redistricting Board',
    url: 'https://www.akredistrict.org/files/8316/8421/0002/2023-May-Final-Proclamation.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2023-05-15'),
    notes: 'Final Proclamation May 15, 2023. Combined file contains both House (40) and Senate (20) districts.'
  },
  {
    state: 'AK',
    boundaryType: 'state_senate',
    authority: 'Alaska Redistricting Board',
    name: 'AK Redistricting Board',
    url: 'https://www.akredistrict.org/files/8316/8421/0002/2023-May-Final-Proclamation.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2023-05-15'),
    notes: 'Same file as House - both chambers in single shapefile'
  },

  // Utah - UGRC (official state source)
  {
    state: 'UT',
    boundaryType: 'state_house',
    authority: 'Utah Geospatial Resource Center',
    name: 'UGRC Open Data',
    url: 'https://opendata.gis.utah.gov/datasets/utah-house-districts-2022-to-2032',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-16'),
    notes: 'HB2005 signed November 16, 2021, effective January 1, 2023. Valid through 2032.'
  },
  {
    state: 'UT',
    boundaryType: 'state_senate',
    authority: 'Utah Geospatial Resource Center',
    name: 'UGRC Open Data',
    url: 'https://opendata.gis.utah.gov/datasets/utah-senate-districts-2022-to-2032',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-16'),
    notes: 'SB2006 signed November 16, 2021. Valid through 2032.'
  },

  // Iowa - Legislative Services Agency (official state source)
  {
    state: 'IA',
    boundaryType: 'state_house',
    authority: 'Iowa Legislative Services Agency',
    name: 'Iowa Open Data Portal',
    url: 'https://data.iowa.gov/dataset/Iowa-House-Districts/e6rr-h43b',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-04'),
    notes: 'Enacted November 4, 2021, effective for 2022 elections through 2032'
  },
  {
    state: 'IA',
    boundaryType: 'state_senate',
    authority: 'Iowa Legislative Services Agency',
    name: 'Iowa Open Data Portal',
    url: 'https://data.iowa.gov/dataset/Iowa-Senate-Districts/uw2q-yh4n',
    format: 'shapefile',
    lastRedistricting: new Date('2021-11-04')
  },

  // New Hampshire - GRANIT (official state source with floterial districts)
  {
    state: 'NH',
    boundaryType: 'state_house',
    authority: 'NH Office of Strategic Initiatives / NH GRANIT',
    name: 'NH GRANIT FTP',
    url: 'https://ftp.granit.unh.edu/GRANIT_Data/Vector_Data/Administrative_and_Political_Boundaries/d-nhhousedists/',
    format: 'shapefile',
    lastRedistricting: new Date('2022-03-23'),
    notes: 'HB 50 signed March 23, 2022. Requires TWO files: base districts + floterial overlay'
  },
  {
    state: 'NH',
    boundaryType: 'state_senate',
    authority: 'NH Office of Strategic Initiatives / NH GRANIT',
    name: 'NH GRANIT FTP',
    url: 'https://ftp.granit.unh.edu/GRANIT_Data/Vector_Data/Administrative_and_Political_Boundaries/d-nhsenatedists/',
    format: 'shapefile',
    lastRedistricting: new Date('2022-05-06'),
    notes: 'SB 240 signed May 6, 2022'
  },

  // Maine - GeoLibrary (official state source)
  {
    state: 'ME',
    boundaryType: 'state_house',
    authority: 'Maine Office of GIS',
    name: 'Maine GeoLibrary',
    url: 'https://opendata.arcgis.com/api/v3/datasets/eb07c79aca3f474f816f2d7aef016b52_0/downloads/data?format=shp&spatialRefId=4326',
    format: 'shapefile',
    lastRedistricting: new Date('2021-09-29'),
    notes: 'LD 1738 signed September 29, 2021'
  },
  {
    state: 'ME',
    boundaryType: 'state_senate',
    authority: 'Maine Office of GIS',
    name: 'Maine GeoLibrary',
    url: 'https://opendata.arcgis.com/api/v3/datasets/7f622be56e9a46eb9a09f323ca45c700/downloads/data?format=shp&spatialRefId=4326',
    format: 'shapefile',
    lastRedistricting: new Date('2021-09-29'),
    notes: 'LD 1741 signed September 29, 2021'
  },

  // Rhode Island - RIGIS (official state source)
  {
    state: 'RI',
    boundaryType: 'state_house',
    authority: 'Rhode Island Geographic Information System',
    name: 'RIGIS Open Data',
    url: 'https://www.rigis.org/datasets/house-districts-2022/explore',
    format: 'shapefile',
    lastRedistricting: new Date('2022-02-16'),
    notes: 'H 7323 signed February 16, 2022'
  },
  {
    state: 'RI',
    boundaryType: 'state_senate',
    authority: 'Rhode Island Geographic Information System',
    name: 'RIGIS Open Data',
    url: 'https://www.rigis.org/datasets/c977b771d35b4deeb08b4ed10a379225/explore',
    format: 'shapefile',
    lastRedistricting: new Date('2022-02-16'),
    notes: 'S 2162 signed February 16, 2022'
  },

  // Delaware - FirstMap (official state source)
  {
    state: 'DE',
    boundaryType: 'state_house',
    authority: 'Delaware Office of State Planning Coordination',
    name: 'Delaware FirstMap',
    url: 'https://opendata.firstmap.delaware.gov/api/download/v1/items/634f9ede21d1479c8779ab82628ebd4c/shapefile',
    format: 'shapefile',
    lastRedistricting: new Date('2022-04-01'),
    notes: 'HB 335 signed April 1, 2022 (revised from SB 199)'
  },
  {
    state: 'DE',
    boundaryType: 'state_senate',
    authority: 'Delaware Office of State Planning Coordination',
    name: 'Delaware FirstMap',
    url: 'https://opendata.firstmap.delaware.gov/api/download/v1/items/7f5a42e0a3284c0a857a4ed549ca8b6e/shapefile',
    format: 'shapefile',
    lastRedistricting: new Date('2022-04-01')
  },

  // North Dakota - Legislature (official state source with 2024 VRA corrections)
  {
    state: 'ND',
    boundaryType: 'state_house',
    authority: 'North Dakota Legislative Assembly',
    name: 'ND Legislature Downloads',
    url: 'https://ndlegis.gov/downloads/redistricting-2021/final_maps_shape_file.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-01-08'),
    notes: 'HB 1504 (Nov 12, 2021) with court-ordered Districts 9 & 15 corrections (Jan 8, 2024). 47 districts, same boundaries for both chambers.'
  },
  {
    state: 'ND',
    boundaryType: 'state_senate',
    authority: 'North Dakota Legislative Assembly',
    name: 'ND Legislature Downloads',
    url: 'https://ndlegis.gov/downloads/redistricting-2021/final_maps_shape_file.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2024-01-08'),
    notes: 'Same file as House - multimember districts'
  },

  // Vermont - VCGI (official state source)
  {
    state: 'VT',
    boundaryType: 'state_house',
    authority: 'Vermont Center for Geographic Information',
    name: 'Vermont Open Geodata Portal',
    url: 'https://geodata.vermont.gov/datasets/VCGI::vt-data-vermont-house-districts-2022/about',
    format: 'shapefile',
    lastRedistricting: new Date('2022-04-06'),
    notes: 'H.722 signed April 6, 2022 (Act 89). 150 representatives in 109 districts.'
  },
  {
    state: 'VT',
    boundaryType: 'state_senate',
    authority: 'Vermont Center for Geographic Information',
    name: 'Vermont Open Geodata Portal',
    url: 'https://sov-vcgi.opendata.arcgis.com/maps/9b83b1d42d3745a4b91b4be21ee32561',
    format: 'shapefile',
    lastRedistricting: new Date('2022-04-06'),
    notes: 'Act 89, April 6, 2022'
  },

  // Nebraska - Legislature (unicameral)
  {
    state: 'NE',
    boundaryType: 'state_house',
    authority: 'Nebraska Legislature',
    name: 'Nebraska Legislature (Unicameral)',
    url: 'https://www2.census.gov/geo/tiger/TIGER2023/SLDU/tl_2023_31_sldu.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2021-09-30'),
    notes: 'LB3 signed September 30, 2021. Nebraska has unicameral legislature (49 districts) - same file for both chambers.'
  },
  {
    state: 'NE',
    boundaryType: 'state_senate',
    authority: 'Nebraska Legislature',
    name: 'Nebraska Legislature (Unicameral)',
    url: 'https://www2.census.gov/geo/tiger/TIGER2023/SLDU/tl_2023_31_sldu.zip',
    format: 'shapefile',
    lastRedistricting: new Date('2021-09-30'),
    notes: 'Same as House - Nebraska unicameral'
  }
];

/**
 * Build fast lookup map from registry
 */
export function buildPortalLookup(): Map<PortalRegistryKey, StatePortalConfig> {
  const lookup = new Map<PortalRegistryKey, StatePortalConfig>();

  for (const config of STATE_PORTAL_REGISTRY) {
    const key = createPortalKey(config.state, config.boundaryType);
    lookup.set(key, config);
  }

  return lookup;
}

/**
 * Redistricting metadata for freshness calculations
 *
 * Threshold logic:
 * - TIGER/Line updates ~every 10 years (post-census)
 * - Most states redistrict 2021-2023 (post-2020 census)
 * - Consider state portal "fresh" if < 36 months since redistricting
 * - After 36 months, TIGER likely caught up
 */
export function buildRedistrictingMetadata(): Map<PortalRegistryKey, RedistrictingMetadata> {
  const metadata = new Map<PortalRegistryKey, RedistrictingMetadata>();

  for (const config of STATE_PORTAL_REGISTRY) {
    const key = createPortalKey(config.state, config.boundaryType);

    metadata.set(key, {
      state: config.state,
      boundaryType: config.boundaryType,
      lastRedistricting: config.lastRedistricting,
      freshnessThresholdMonths: 36 // State portal fresher than TIGER for 3 years post-redistricting
    });
  }

  return metadata;
}

/**
 * Get all states with known portals for a boundary type
 */
export function getStatesWithPortals(boundaryType: BoundaryType): readonly string[] {
  const states = new Set<string>();

  for (const config of STATE_PORTAL_REGISTRY) {
    if (config.boundaryType === boundaryType) {
      states.add(config.state);
    }
  }

  return Array.from(states).sort();
}

/**
 * Get portal config for a specific state and boundary type
 */
export function getPortalConfig(
  state: string,
  boundaryType: BoundaryType
): StatePortalConfig | undefined {
  const lookup = buildPortalLookup();
  const key = createPortalKey(state, boundaryType);
  return lookup.get(key);
}

/**
 * Check if state has fresh portal (within freshness threshold)
 */
export function hasFreshPortal(
  state: string,
  boundaryType: BoundaryType,
  asOf: Date = new Date()
): boolean {
  const config = getPortalConfig(state, boundaryType);

  if (!config) {
    return false;
  }

  const monthsSince = Math.floor(
    (asOf.getTime() - config.lastRedistricting.getTime()) /
    (1000 * 60 * 60 * 24 * 30)
  );

  return monthsSince <= 36; // Fresh if < 3 years since redistricting
}
