#!/usr/bin/env npx tsx
/**
 * State Governance District Crawler - Focused Approach
 *
 * PURPOSE: Fill state-level governance gaps (state legislative, congressional, county districts)
 * NOT city council districts (already have 3,413).
 *
 * STRATEGY:
 * - Target state legislative redistricting portals (authoritative sources)
 * - Use known Census TIGER patterns for congressional districts
 * - Query state GIS portals for county commission districts
 * - Leverage existing scanners (ArcGIS Hub, Socrata) with state-level keywords
 *
 * Usage:
 *   npx tsx agents/crawl-state-governance-districts.ts --states CA,TX,FL
 *   npx tsx agents/crawl-state-governance-districts.ts --all
 *   npx tsx agents/crawl-state-governance-districts.ts --test CA
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface LayerInfo {
  readonly service_url: string;
  readonly layer_number: number;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null;
  readonly fields: readonly string[];
  readonly source_state: string;
  readonly source_portal: string;
  readonly discovery_method: string;
  readonly district_type: 'state_legislative' | 'congressional' | 'county_commission' | 'school_board';
}

interface StateGovernancePortal {
  readonly state: string;
  readonly state_code: string;
  readonly portals: readonly {
    readonly type: 'redistricting' | 'gis_clearinghouse' | 'legislature';
    readonly url: string;
    readonly platform: string;
    readonly notes: string;
  }[];
}

/**
 * Authoritative state redistricting portals and GIS clearinghouses
 *
 * Priority 1: Official redistricting commission websites (legislative + congressional districts)
 * Priority 2: State GIS clearinghouses (county boundaries)
 */
const STATE_GOVERNANCE_PORTALS: Record<string, StateGovernancePortal> = {
  'CA': {
    state: 'California',
    state_code: 'CA',
    portals: [
      {
        type: 'redistricting',
        url: 'https://redistricting.lao.ca.gov',
        platform: 'custom',
        notes: 'California Citizens Redistricting Commission - State Senate, Assembly, Congressional'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.data.ca.gov',
        platform: 'arcgis',
        notes: 'California Open Data Portal - County boundaries'
      }
    ]
  },
  'TX': {
    state: 'Texas',
    state_code: 'TX',
    portals: [
      {
        type: 'redistricting',
        url: 'https://data.tlc.texas.gov',
        platform: 'socrata',
        notes: 'Texas Legislative Council - State House, Senate, Congressional'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://data.tnris.org',
        platform: 'arcgis',
        notes: 'Texas Natural Resources Information System - County boundaries'
      }
    ]
  },
  'FL': {
    state: 'Florida',
    state_code: 'FL',
    portals: [
      {
        type: 'legislature',
        url: 'https://www.flsenate.gov/Redistricting',
        platform: 'custom',
        notes: 'Florida Senate Redistricting - State Senate, House, Congressional'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://geodata.floridagio.gov',
        platform: 'arcgis',
        notes: 'Florida Geographic Data Library - County boundaries'
      }
    ]
  },
  'NY': {
    state: 'New York',
    state_code: 'NY',
    portals: [
      {
        type: 'redistricting',
        url: 'https://redistricting.nyirc.gov',
        platform: 'custom',
        notes: 'NY Independent Redistricting Commission - State Senate, Assembly, Congressional'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.ny.gov',
        platform: 'arcgis',
        notes: 'NYS GIS Clearinghouse - County boundaries'
      }
    ]
  },
  'PA': {
    state: 'Pennsylvania',
    state_code: 'PA',
    portals: [
      {
        type: 'legislature',
        url: 'https://www.redistricting.state.pa.us',
        platform: 'custom',
        notes: 'PA Legislative Reapportionment Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://www.pasda.psu.edu',
        platform: 'ckan',
        notes: 'PASDA - County boundaries'
      }
    ]
  },
  'AL': {
    state: 'Alabama',
    state_code: 'AL',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis-alabama.opendata.arcgis.com',
        platform: 'arcgis',
        notes: 'Alabama GIS Portal - State legislative districts'
      }
    ]
  },
  'AK': {
    state: 'Alaska',
    state_code: 'AK',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.data.alaska.gov',
        platform: 'arcgis',
        notes: 'Alaska Open Data Portal - Legislative districts'
      }
    ]
  },
  'AZ': {
    state: 'Arizona',
    state_code: 'AZ',
    portals: [
      {
        type: 'redistricting',
        url: 'https://irc.az.gov',
        platform: 'custom',
        notes: 'Arizona Independent Redistricting Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://azgeo-open-data-agic.hub.arcgis.com',
        platform: 'arcgis',
        notes: 'Arizona Geographic Information Council'
      }
    ]
  },
  'AR': {
    state: 'Arkansas',
    state_code: 'AR',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.arkansas.gov',
        platform: 'arcgis',
        notes: 'Arkansas GIS Office'
      }
    ]
  },
  'CO': {
    state: 'Colorado',
    state_code: 'CO',
    portals: [
      {
        type: 'redistricting',
        url: 'https://redistricting.colorado.gov',
        platform: 'custom',
        notes: 'Colorado Independent Redistricting Commissions'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://data-cdphe.opendata.arcgis.com',
        platform: 'arcgis',
        notes: 'Colorado Information Marketplace'
      }
    ]
  },
  'CT': {
    state: 'Connecticut',
    state_code: 'CT',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://ct-deep-gis-open-data-website-ct-deep.hub.arcgis.com',
        platform: 'arcgis',
        notes: 'Connecticut Open Data Portal'
      }
    ]
  },
  'DE': {
    state: 'Delaware',
    state_code: 'DE',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://firstmap.delaware.gov',
        platform: 'arcgis',
        notes: 'Delaware FirstMap - State GIS'
      }
    ]
  },
  'DC': {
    state: 'District of Columbia',
    state_code: 'DC',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://opendata.dc.gov',
        platform: 'socrata',
        notes: 'DC Open Data Portal - Ward boundaries, ANCs'
      }
    ]
  },
  'GA': {
    state: 'Georgia',
    state_code: 'GA',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://data.georgiagio.org',
        platform: 'arcgis',
        notes: 'Georgia GIO Open Data'
      }
    ]
  },
  'HI': {
    state: 'Hawaii',
    state_code: 'HI',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://geoportal.hawaii.gov',
        platform: 'arcgis',
        notes: 'Hawaii Statewide GIS Portal'
      }
    ]
  },
  'ID': {
    state: 'Idaho',
    state_code: 'ID',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://data-idaho.hub.arcgis.com',
        platform: 'arcgis',
        notes: 'Idaho GIS Portal'
      }
    ]
  },
  'IL': {
    state: 'Illinois',
    state_code: 'IL',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://data.illinois.gov',
        platform: 'socrata',
        notes: 'Illinois Data Portal'
      }
    ]
  },
  'IN': {
    state: 'Indiana',
    state_code: 'IN',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis-iot.hub.arcgis.com',
        platform: 'arcgis',
        notes: 'Indiana GIS Portal'
      }
    ]
  },
  'IA': {
    state: 'Iowa',
    state_code: 'IA',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://geodata.iowa.gov',
        platform: 'arcgis',
        notes: 'Iowa Geographic Data Portal'
      }
    ]
  },
  'KS': {
    state: 'Kansas',
    state_code: 'KS',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.kansasgis.org',
        platform: 'arcgis',
        notes: 'Kansas Data Access and Support Center'
      }
    ]
  },
  'KY': {
    state: 'Kentucky',
    state_code: 'KY',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://kygeoportal.ky.gov',
        platform: 'arcgis',
        notes: 'Kentucky Geoportal'
      }
    ]
  },
  'LA': {
    state: 'Louisiana',
    state_code: 'LA',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://atlas.ga.lsu.edu',
        platform: 'custom',
        notes: 'Louisiana GIS Data Portal'
      }
    ]
  },
  'ME': {
    state: 'Maine',
    state_code: 'ME',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.maine.gov/megis',
        platform: 'custom',
        notes: 'Maine Office of GIS'
      }
    ]
  },
  'MD': {
    state: 'Maryland',
    state_code: 'MD',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://data.imap.maryland.gov',
        platform: 'arcgis',
        notes: 'Maryland iMap'
      }
    ]
  },
  'MA': {
    state: 'Massachusetts',
    state_code: 'MA',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.mass.gov/orgs/massgis-bureau-of-geographic-information',
        platform: 'custom',
        notes: 'MassGIS Data Portal'
      }
    ]
  },
  'MI': {
    state: 'Michigan',
    state_code: 'MI',
    portals: [
      {
        type: 'redistricting',
        url: 'https://www.michigan.gov/micrc',
        platform: 'custom',
        notes: 'Michigan Independent Citizens Redistricting Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://gis-michigan.opendata.arcgis.com',
        platform: 'arcgis',
        notes: 'Michigan Open Data Portal'
      }
    ]
  },
  'MN': {
    state: 'Minnesota',
    state_code: 'MN',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gisdata.mn.gov',
        platform: 'arcgis',
        notes: 'Minnesota Geospatial Commons'
      }
    ]
  },
  'MS': {
    state: 'Mississippi',
    state_code: 'MS',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.maris.state.ms.us',
        platform: 'custom',
        notes: 'Mississippi Automated Resource Information System'
      }
    ]
  },
  'MO': {
    state: 'Missouri',
    state_code: 'MO',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://msdis.missouri.edu',
        platform: 'custom',
        notes: 'Missouri Spatial Data Information Service'
      }
    ]
  },
  'MT': {
    state: 'Montana',
    state_code: 'MT',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.mt.gov',
        platform: 'arcgis',
        notes: 'Montana State Library GIS Portal'
      }
    ]
  },
  'NE': {
    state: 'Nebraska',
    state_code: 'NE',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.nebraskamap.gov',
        platform: 'arcgis',
        notes: 'NebraskaMAP'
      }
    ]
  },
  'NV': {
    state: 'Nevada',
    state_code: 'NV',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://opendata.gis.nv.gov',
        platform: 'arcgis',
        notes: 'Nevada GIS Open Data Portal'
      }
    ]
  },
  'NH': {
    state: 'New Hampshire',
    state_code: 'NH',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.granit.unh.edu',
        platform: 'custom',
        notes: 'NH GRANIT GIS Data Portal'
      }
    ]
  },
  'NJ': {
    state: 'New Jersey',
    state_code: 'NJ',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://njogis-newjersey.opendata.arcgis.com',
        platform: 'arcgis',
        notes: 'NJ Office of GIS'
      }
    ]
  },
  'NM': {
    state: 'New Mexico',
    state_code: 'NM',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://rgis.unm.edu',
        platform: 'custom',
        notes: 'Resource Geographic Information System'
      }
    ]
  },
  'NC': {
    state: 'North Carolina',
    state_code: 'NC',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.nconemap.gov',
        platform: 'arcgis',
        notes: 'NC OneMap'
      }
    ]
  },
  'ND': {
    state: 'North Dakota',
    state_code: 'ND',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gishubdata.nd.gov',
        platform: 'arcgis',
        notes: 'North Dakota GIS Hub'
      }
    ]
  },
  'OH': {
    state: 'Ohio',
    state_code: 'OH',
    portals: [
      {
        type: 'redistricting',
        url: 'https://redistricting.ohio.gov',
        platform: 'custom',
        notes: 'Ohio Redistricting Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.ohio.gov',
        platform: 'arcgis',
        notes: 'Ohio Geographically Referenced Information Program'
      }
    ]
  },
  'OK': {
    state: 'Oklahoma',
    state_code: 'OK',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://data.ok.gov',
        platform: 'socrata',
        notes: 'Oklahoma Data Portal'
      }
    ]
  },
  'OR': {
    state: 'Oregon',
    state_code: 'OR',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://spatialdata.oregonexplorer.info',
        platform: 'arcgis',
        notes: 'Oregon Spatial Data Library'
      }
    ]
  },
  'RI': {
    state: 'Rhode Island',
    state_code: 'RI',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.rigis.org',
        platform: 'custom',
        notes: 'Rhode Island Geographic Information System'
      }
    ]
  },
  'SC': {
    state: 'South Carolina',
    state_code: 'SC',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.scdhec.gov/gis',
        platform: 'arcgis',
        notes: 'South Carolina GIS Portal'
      }
    ]
  },
  'SD': {
    state: 'South Dakota',
    state_code: 'SD',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://sdbit.sd.gov',
        platform: 'custom',
        notes: 'South Dakota GIS Portal'
      }
    ]
  },
  'TN': {
    state: 'Tennessee',
    state_code: 'TN',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://www.tn.gov/finance/sts-gis.html',
        platform: 'custom',
        notes: 'Tennessee GIS Services'
      }
    ]
  },
  'UT': {
    state: 'Utah',
    state_code: 'UT',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://gis.utah.gov',
        platform: 'arcgis',
        notes: 'Utah AGRC'
      }
    ]
  },
  'VT': {
    state: 'Vermont',
    state_code: 'VT',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://vcgi.vermont.gov',
        platform: 'custom',
        notes: 'Vermont Center for Geographic Information'
      }
    ]
  },
  'VA': {
    state: 'Virginia',
    state_code: 'VA',
    portals: [
      {
        type: 'redistricting',
        url: 'https://www.virginiaredistricting.org',
        platform: 'custom',
        notes: 'Virginia Redistricting Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://vgin.vdem.virginia.gov',
        platform: 'arcgis',
        notes: 'Virginia Geographic Information Network'
      }
    ]
  },
  'WA': {
    state: 'Washington',
    state_code: 'WA',
    portals: [
      {
        type: 'redistricting',
        url: 'https://www.redistricting.wa.gov',
        platform: 'custom',
        notes: 'Washington State Redistricting Commission'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://geo.wa.gov',
        platform: 'arcgis',
        notes: 'Washington Geospatial Open Data Portal'
      }
    ]
  },
  'WV': {
    state: 'West Virginia',
    state_code: 'WV',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://wvgis.wvu.edu',
        platform: 'custom',
        notes: 'West Virginia GIS Technical Center'
      }
    ]
  },
  'WI': {
    state: 'Wisconsin',
    state_code: 'WI',
    portals: [
      {
        type: 'legislature',
        url: 'https://gis-ltsb.hub.arcgis.com',
        platform: 'arcgis',
        notes: 'Wisconsin State Legislature GIS Hub - 2024 redistricting'
      },
      {
        type: 'gis_clearinghouse',
        url: 'https://data-wi-dnr.opendata.arcgis.com',
        platform: 'arcgis',
        notes: 'Wisconsin DNR Open Data'
      }
    ]
  },
  'WY': {
    state: 'Wyoming',
    state_code: 'WY',
    portals: [
      {
        type: 'gis_clearinghouse',
        url: 'https://geohub.wyo.gov',
        platform: 'arcgis',
        notes: 'Wyoming GeoHub'
      }
    ]
  }
};

/**
 * Census TIGER fallback for Congressional Districts
 * All 50 states + DC have congressional district shapefiles at:
 * https://www2.census.gov/geo/tiger/TIGER2023/CD/tl_2023_us_cd118.zip
 */
const CENSUS_TIGER_CONGRESSIONAL_URL = 'https://www2.census.gov/geo/tiger/TIGER2023/CD/tl_2023_us_cd118.zip';

/**
 * State Legislative District Scanner
 * Searches state redistricting portals for authoritative district boundaries
 */
class StateLegislativeScanner {
  private readonly userAgent = 'ShadowAtlas/1.0 (State Governance District Crawler)';

  async scanState(stateCode: string): Promise<LayerInfo[]> {
    const portal = STATE_GOVERNANCE_PORTALS[stateCode];
    if (!portal) {
      logger.info(`⚠️  No redistricting portal configured for ${stateCode}`);
      return [];
    }

    const layers: LayerInfo[] = [];

    for (const portalInfo of portal.portals) {
      if (portalInfo.type !== 'redistricting' && portalInfo.type !== 'legislature') {
        continue;
      }

      logger.info(`\n🏛️  Scanning ${portal.state} redistricting portal...`);
      logger.info(`   ${portalInfo.url}`);

      try {
        if (portalInfo.platform === 'arcgis') {
          layers.push(...await this.scanArcGISPortal(portalInfo.url, portal, portalInfo.notes));
        } else if (portalInfo.platform === 'socrata') {
          layers.push(...await this.scanSocrataPortal(portalInfo.url, portal, portalInfo.notes));
        } else {
          logger.info(`   ⚠️  Custom portal ${portalInfo.url} requires manual research`);
          logger.info(`   Notes: ${portalInfo.notes}`);
        }
      } catch (error) {
        logger.error(`   ✗ Error: ${(error as Error).message}`);
      }
    }

    return layers;
  }

  private async scanArcGISPortal(
    portalUrl: string,
    portal: StateGovernancePortal,
    notes: string
  ): Promise<LayerInfo[]> {
    // COMPREHENSIVE state-level governance keywords
    // Aligned with comprehensive-district-classifier.py (20+ district types)
    const keywords = [
      // State legislative (primary target)
      'state senate', 'state house', 'state assembly',
      'state representative', 'legislative district',

      // Congressional (federal)
      'congressional district', 'congress',

      // County governance
      'county commission', 'county supervisor', 'county district',

      // Special districts (elected boards)
      'school district', 'school board', 'fire district',
      'library district', 'hospital district', 'health district'
    ];

    const layers: LayerInfo[] = [];

    for (const keyword of keywords) {
      try {
        // Query ArcGIS Hub API
        const searchUrl = `https://hub.arcgis.com/api/v3/datasets?filter[q]=${encodeURIComponent(keyword + ' ' + portal.state)}&filter[type]=Feature Service`;

        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json() as {
          data?: Array<{
            id: string;
            attributes?: {
              name?: string;
              url?: string;
              itemType?: string;
            };
          }>;
        };

        if (!data.data) continue;

        for (const dataset of data.data) {
          const attrs = dataset.attributes;
          if (!attrs?.url) continue;

          // Validate this is actually from the target state
          const name = attrs.name?.toLowerCase() || '';
          if (!name.includes(portal.state.toLowerCase()) && !name.includes(portal.state_code.toLowerCase())) {
            continue;
          }

          // Enumerate service layers
          const serviceLayers = await this.enumerateService(attrs.url, portal);
          layers.push(...serviceLayers);
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`   ⚠️  Error searching "${keyword}": ${(error as Error).message}`);
      }
    }

    return layers;
  }

  private async scanSocrataPortal(
    portalUrl: string,
    portal: StateGovernancePortal,
    notes: string
  ): Promise<LayerInfo[]> {
    // Socrata catalog search for redistricting datasets
    const searchUrl = `${portalUrl}/api/catalog/v1?q=legislative congressional senate house district&only=datasets&limit=100`;

    try {
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as {
        results?: Array<{
          resource?: {
            id?: string;
            name?: string;
            metadata?: Record<string, unknown>;
          };
        }>;
      };

      const layers: LayerInfo[] = [];

      for (const result of data.results || []) {
        const resource = result.resource;
        if (!resource) continue;

        // Look for ArcGIS Feature Service URL in metadata
        const metadata = resource.metadata as Record<string, unknown> | undefined;
        const customFields = metadata?.custom_fields as Record<string, unknown> | undefined;

        let arcgisUrl: string | null = null;
        if (typeof customFields?.arcgis_url === 'string') {
          arcgisUrl = customFields.arcgis_url;
        } else if (typeof metadata?.arcgis_url === 'string') {
          arcgisUrl = metadata.arcgis_url;
        }

        if (arcgisUrl) {
          const serviceLayers = await this.enumerateService(arcgisUrl, portal);
          layers.push(...serviceLayers);
        }
      }

      return layers;

    } catch (error) {
      logger.error(`   ✗ Socrata portal error: ${(error as Error).message}`);
      return [];
    }
  }

  private async enumerateService(
    serviceUrl: string,
    portal: StateGovernancePortal
  ): Promise<LayerInfo[]> {
    try {
      const response = await fetch(`${serviceUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) return [];

      const data = await response.json() as {
        layers?: Array<{
          id?: number;
          name?: string;
          geometryType?: string;
        }>;
      };

      const layers: LayerInfo[] = [];

      for (const layer of data.layers || []) {
        if (typeof layer.id !== 'number') continue;

        const layerUrl = `${serviceUrl}/${layer.id}`;
        const layerInfo = await this.fetchLayerDetails(layerUrl, portal);

        if (layerInfo) {
          layers.push(layerInfo);
        }
      }

      return layers;

    } catch (error) {
      return [];
    }
  }

  private async fetchLayerDetails(
    layerUrl: string,
    portal: StateGovernancePortal
  ): Promise<LayerInfo | null> {
    try {
      const response = await fetch(`${layerUrl}?f=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        name?: string;
        geometryType?: string;
        fields?: Array<{ name?: string }>;
      };

      const layerName = data.name?.toLowerCase() || '';

      // Classify district type based on layer name
      let districtType: LayerInfo['district_type'] | null = null;

      if (layerName.includes('congressional')) {
        districtType = 'congressional';
      } else if (
        layerName.includes('senate') ||
        layerName.includes('house') ||
        layerName.includes('assembly') ||
        layerName.includes('legislative')
      ) {
        districtType = 'state_legislative';
      } else if (
        layerName.includes('county commission') ||
        layerName.includes('county boundary') ||
        layerName.includes('county district')
      ) {
        districtType = 'county_commission';
      } else if (layerName.includes('school')) {
        districtType = 'school_board';
      }

      // Skip if not a recognized district type
      if (!districtType) {
        return null;
      }

      // Skip if not polygon geometry
      if (data.geometryType !== 'esriGeometryPolygon') {
        return null;
      }

      // Fetch actual feature count
      const featureCount = await this.fetchFeatureCount(layerUrl);

      const match = layerUrl.match(/\/(\d+)$/);
      const layerNumber = match ? parseInt(match[1], 10) : 0;

      return {
        service_url: layerUrl.replace(/\/\d+$/, ''),
        layer_number: layerNumber,
        layer_url: layerUrl,
        layer_name: data.name || 'Unknown',
        geometry_type: data.geometryType || null,
        feature_count: featureCount,
        fields: (data.fields || []).map(f => f.name || ''),
        source_state: portal.state_code,
        source_portal: portal.portals[0].url,
        discovery_method: 'state_governance_portal',
        district_type: districtType
      };

    } catch (error) {
      return null;
    }
  }

  private async fetchFeatureCount(layerUrl: string): Promise<number | null> {
    try {
      const queryUrl = `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json`;

      const response = await fetch(queryUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) return null;

      const data = await response.json() as { count?: number };

      return typeof data.count === 'number' ? data.count : null;

    } catch (error) {
      return null;
    }
  }
}

/**
 * Main crawler orchestrator
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let selectedStates: string[] = [];

  if (args.includes('--all')) {
    selectedStates = Object.keys(STATE_GOVERNANCE_PORTALS);
  } else if (args.includes('--test')) {
    const testIndex = args.indexOf('--test');
    selectedStates = [args[testIndex + 1] || 'CA'];
  } else if (args.includes('--states')) {
    const statesIndex = args.indexOf('--states');
    const statesArg = args[statesIndex + 1];
    selectedStates = statesArg ? statesArg.split(',') : [];
  } else {
    selectedStates = ['CA', 'TX', 'FL', 'NY', 'PA']; // Default: Top 5 states
  }

  logger.info('═'.repeat(70));
  logger.info('STATE GOVERNANCE DISTRICT CRAWLER');
  logger.info('═'.repeat(70));
  logger.info(`Target: State legislative, congressional, county commission districts`);
  logger.info(`States: ${selectedStates.join(', ')}`);
  logger.info('');

  const scanner = new StateLegislativeScanner();
  const allLayers: LayerInfo[] = [];

  for (const stateCode of selectedStates) {
    const layers = await scanner.scanState(stateCode);
    allLayers.push(...layers);

    // Rate limit between states
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Save results
  const outputPath = join(__dirname, 'data', 'state_governance_discoveries.jsonl');
  writeFileSync(
    outputPath,
    allLayers.map(l => JSON.stringify(l)).join('\n')
  );

  // Print summary
  logger.info('\n' + '═'.repeat(70));
  logger.info('CRAWL COMPLETE');
  logger.info('═'.repeat(70));
  logger.info(`Total governance layers discovered: ${allLayers.length}`);
  logger.info('');
  logger.info('By district type:');

  const byType: Record<string, number> = {};
  for (const layer of allLayers) {
    byType[layer.district_type] = (byType[layer.district_type] || 0) + 1;
  }

  for (const [type, count] of Object.entries(byType)) {
    logger.info(`  ${type}: ${count}`);
  }

  logger.info('');
  logger.info('By state:');

  const byState: Record<string, number> = {};
  for (const layer of allLayers) {
    byState[layer.source_state] = (byState[layer.source_state] || 0) + 1;
  }

  for (const [state, count] of Object.entries(byState)) {
    logger.info(`  ${state}: ${count}`);
  }

  logger.info('');
  logger.info(`Output: ${outputPath}`);
  logger.info('═'.repeat(70));
  logger.info('');
  logger.info('⚠️  NEXT STEPS:');
  logger.info('1. Run classification: npx tsx comprehensive-district-classifier.py data/state_governance_discoveries.jsonl');
  logger.info('2. Deduplicate: npx tsx agents/deduplicate-discoveries.ts');
  logger.info('3. Merge: cat data/state_governance_discoveries.jsonl >> data/comprehensive_classified_layers.jsonl');
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
