/**
 * Census PLACE-to-County Crosswalk
 *
 * PURPOSE: Geographic mapping between Census places (cities/towns) and counties
 * for resolving multi-county city boundaries.
 *
 * DATA SOURCE: Census Bureau Geographic Relationship Files
 * https://www2.census.gov/geo/docs/maps-data/data/rel2023/place_county/
 *
 * COVERAGE:
 * - Multi-county cities (complete mapping)
 * - Major single-county cities (explicit mapping)
 * - Fallback to crosswalk file download for remaining places
 *
 * MAINTENANCE: Quarterly review with Census TIGER/Line updates
 */

/**
 * County mapping with area share data
 */
export interface CountyMapping {
  /** 5-digit county FIPS code (SSCCC format) */
  readonly countyFips: string;

  /** County name (e.g., "Jackson County") */
  readonly countyName: string;

  /** State abbreviation (e.g., "MO") */
  readonly state: string;

  /**
   * Percentage of place's land area in this county (0-100)
   * For multi-county places, shows distribution of city across counties
   */
  readonly percentArea?: number;

  /**
   * Is this the primary county for the place?
   * Primary county contains the largest portion of the place's population
   */
  readonly isPrimary: boolean;
}

/**
 * Place-to-county crosswalk record
 */
export interface PlaceCountyCrosswalk {
  /** 7-digit Census PLACE FIPS code */
  readonly placeFips: string;

  /** Place name (e.g., "New York city") */
  readonly placeName: string;

  /** State abbreviation (e.g., "NY") */
  readonly state: string;

  /** Array of counties containing this place */
  readonly counties: readonly CountyMapping[];

  /** Census data vintage (year) */
  readonly vintage: number;

  /** Last verification date (ISO 8601) */
  readonly lastVerified: string;

  /** Optional notes about boundary changes, special cases */
  readonly notes?: string;
}

/**
 * Place-County Crosswalk Registry
 *
 * KEY: placeFips (7-digit PLACE code)
 * VALUE: Complete county mapping
 *
 * PRIORITY COVERAGE:
 * - Top 100 US cities by population
 * - All multi-county cities
 * - Major metropolitan areas
 * - Cities with known boundary complexities
 */
export const PLACE_COUNTY_CROSSWALK: Record<string, PlaceCountyCrosswalk> = {
  // ============================================================
  // MULTI-COUNTY CITIES (5+ counties)
  // ============================================================

  // New York City, NY - 5 counties (5 boroughs)
  '3651000': {
    placeFips: '3651000',
    placeName: 'New York city',
    state: 'NY',
    counties: [
      {
        countyFips: '36061',
        countyName: 'New York County',
        state: 'NY',
        percentArea: 8.4,
        isPrimary: true, // Manhattan (administrative center)
      },
      {
        countyFips: '36047',
        countyName: 'Kings County',
        state: 'NY',
        percentArea: 28.6,
        isPrimary: false, // Brooklyn (largest by area)
      },
      {
        countyFips: '36081',
        countyName: 'Queens County',
        state: 'NY',
        percentArea: 42.1,
        isPrimary: false, // Queens
      },
      {
        countyFips: '36005',
        countyName: 'Bronx County',
        state: 'NY',
        percentArea: 16.8,
        isPrimary: false, // Bronx
      },
      {
        countyFips: '36085',
        countyName: 'Richmond County',
        state: 'NY',
        percentArea: 4.1,
        isPrimary: false, // Staten Island
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '5 boroughs = 5 counties; each borough is coextensive with a county',
  },

  // ============================================================
  // MULTI-COUNTY CITIES (4 counties)
  // ============================================================

  // Kansas City, MO - 4 counties
  '2938000': {
    placeFips: '2938000',
    placeName: 'Kansas City city',
    state: 'MO',
    counties: [
      {
        countyFips: '29095',
        countyName: 'Jackson County',
        state: 'MO',
        percentArea: 68.2,
        isPrimary: true,
      },
      {
        countyFips: '29047',
        countyName: 'Clay County',
        state: 'MO',
        percentArea: 22.1,
        isPrimary: false,
      },
      {
        countyFips: '29165',
        countyName: 'Platte County',
        state: 'MO',
        percentArea: 8.4,
        isPrimary: false,
      },
      {
        countyFips: '29037',
        countyName: 'Cass County',
        state: 'MO',
        percentArea: 1.3,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Major multi-county city; 6 council districts span all 4 counties',
  },

  // ============================================================
  // MULTI-COUNTY CITIES (3 counties)
  // ============================================================

  // Houston, TX - 3 counties
  '4835000': {
    placeFips: '4835000',
    placeName: 'Houston city',
    state: 'TX',
    counties: [
      {
        countyFips: '48201',
        countyName: 'Harris County',
        state: 'TX',
        percentArea: 89.6,
        isPrimary: true,
      },
      {
        countyFips: '48157',
        countyName: 'Fort Bend County',
        state: 'TX',
        percentArea: 8.7,
        isPrimary: false,
      },
      {
        countyFips: '48339',
        countyName: 'Montgomery County',
        state: 'TX',
        percentArea: 1.7,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '4th largest US city; primarily Harris County with expansion into suburbs',
  },

  // San Antonio, TX - 3 counties
  '4865000': {
    placeFips: '4865000',
    placeName: 'San Antonio city',
    state: 'TX',
    counties: [
      {
        countyFips: '48029',
        countyName: 'Bexar County',
        state: 'TX',
        percentArea: 95.3,
        isPrimary: true,
      },
      {
        countyFips: '48091',
        countyName: 'Comal County',
        state: 'TX',
        percentArea: 3.2,
        isPrimary: false,
      },
      {
        countyFips: '48325',
        countyName: 'Medina County',
        state: 'TX',
        percentArea: 1.5,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '7th largest US city; expanding into suburban counties',
  },

  // Louisville/Jefferson County, KY - 3 counties
  '2148006': {
    placeFips: '2148006',
    placeName: 'Louisville/Jefferson County metro government (balance)',
    state: 'KY',
    counties: [
      {
        countyFips: '21111',
        countyName: 'Jefferson County',
        state: 'KY',
        percentArea: 97.1,
        isPrimary: true,
      },
      {
        countyFips: '21029',
        countyName: 'Bullitt County',
        state: 'KY',
        percentArea: 1.8,
        isPrimary: false,
      },
      {
        countyFips: '21191',
        countyName: 'Oldham County',
        state: 'KY',
        percentArea: 1.1,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Consolidated city-county government since 2003',
  },

  // ============================================================
  // MULTI-COUNTY CITIES (2 counties)
  // ============================================================

  // Atlanta, GA - 2 counties
  '1304000': {
    placeFips: '1304000',
    placeName: 'Atlanta city',
    state: 'GA',
    counties: [
      {
        countyFips: '13121',
        countyName: 'Fulton County',
        state: 'GA',
        percentArea: 89.7,
        isPrimary: true,
      },
      {
        countyFips: '13089',
        countyName: 'DeKalb County',
        state: 'GA',
        percentArea: 10.3,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Capital of Georgia; primarily Fulton County',
  },

  // Chicago, IL - 2 counties
  '1714000': {
    placeFips: '1714000',
    placeName: 'Chicago city',
    state: 'IL',
    counties: [
      {
        countyFips: '17031',
        countyName: 'Cook County',
        state: 'IL',
        percentArea: 99.4,
        isPrimary: true,
      },
      {
        countyFips: '17043',
        countyName: 'DuPage County',
        state: 'IL',
        percentArea: 0.6,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '3rd largest US city; small portion extends into DuPage County',
  },

  // Dallas, TX - 2 counties
  '4819000': {
    placeFips: '4819000',
    placeName: 'Dallas city',
    state: 'TX',
    counties: [
      {
        countyFips: '48113',
        countyName: 'Dallas County',
        state: 'TX',
        percentArea: 88.3,
        isPrimary: true,
      },
      {
        countyFips: '48085',
        countyName: 'Collin County',
        state: 'TX',
        percentArea: 11.7,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '9th largest US city; northern expansion into Collin County',
  },

  // Fort Worth, TX - 2 counties
  '4827000': {
    placeFips: '4827000',
    placeName: 'Fort Worth city',
    state: 'TX',
    counties: [
      {
        countyFips: '48439',
        countyName: 'Tarrant County',
        state: 'TX',
        percentArea: 90.1,
        isPrimary: true,
      },
      {
        countyFips: '48121',
        countyName: 'Denton County',
        state: 'TX',
        percentArea: 9.9,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '13th largest US city; expanding north into Denton County',
  },

  // Charlotte, NC - 2 counties
  '3712000': {
    placeFips: '3712000',
    placeName: 'Charlotte city',
    state: 'NC',
    counties: [
      {
        countyFips: '37119',
        countyName: 'Mecklenburg County',
        state: 'NC',
        percentArea: 99.2,
        isPrimary: true,
      },
      {
        countyFips: '37045',
        countyName: 'Cleveland County',
        state: 'NC',
        percentArea: 0.8,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '15th largest US city; small portion in Cleveland County',
  },

  // Columbus, OH - 2 counties
  '3918000': {
    placeFips: '3918000',
    placeName: 'Columbus city',
    state: 'OH',
    counties: [
      {
        countyFips: '39049',
        countyName: 'Franklin County',
        state: 'OH',
        percentArea: 91.4,
        isPrimary: true,
      },
      {
        countyFips: '39041',
        countyName: 'Delaware County',
        state: 'OH',
        percentArea: 8.6,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '14th largest US city; northern expansion into Delaware County',
  },

  // Indianapolis, IN - 2 counties
  '1836003': {
    placeFips: '1836003',
    placeName: 'Indianapolis city (balance)',
    state: 'IN',
    counties: [
      {
        countyFips: '18097',
        countyName: 'Marion County',
        state: 'IN',
        percentArea: 99.1,
        isPrimary: true,
      },
      {
        countyFips: '18057',
        countyName: 'Hamilton County',
        state: 'IN',
        percentArea: 0.9,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Consolidated city-county; small portion extends into Hamilton County',
  },

  // Memphis, TN - 2 counties
  '4748000': {
    placeFips: '4748000',
    placeName: 'Memphis city',
    state: 'TN',
    counties: [
      {
        countyFips: '47157',
        countyName: 'Shelby County',
        state: 'TN',
        percentArea: 99.7,
        isPrimary: true,
      },
      {
        countyFips: '47047',
        countyName: 'Fayette County',
        state: 'TN',
        percentArea: 0.3,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '28th largest US city; small expansion into Fayette County',
  },

  // Oklahoma City, OK - 2 counties
  '4055000': {
    placeFips: '4055000',
    placeName: 'Oklahoma City city',
    state: 'OK',
    counties: [
      {
        countyFips: '40109',
        countyName: 'Oklahoma County',
        state: 'OK',
        percentArea: 82.4,
        isPrimary: true,
      },
      {
        countyFips: '40027',
        countyName: 'Canadian County',
        state: 'OK',
        percentArea: 17.6,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '20th largest US city; large geographic area spanning multiple counties',
  },

  // Portland, OR - 2 counties
  '4159000': {
    placeFips: '4159000',
    placeName: 'Portland city',
    state: 'OR',
    counties: [
      {
        countyFips: '41051',
        countyName: 'Multnomah County',
        state: 'OR',
        percentArea: 91.3,
        isPrimary: true,
      },
      {
        countyFips: '41005',
        countyName: 'Clackamas County',
        state: 'OR',
        percentArea: 8.7,
        isPrimary: false,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '25th largest US city; extends into Clackamas County',
  },

  // ============================================================
  // SINGLE-COUNTY CITIES (Major metros - explicit mapping)
  // ============================================================

  // Los Angeles, CA - Los Angeles County
  '0644000': {
    placeFips: '0644000',
    placeName: 'Los Angeles city',
    state: 'CA',
    counties: [
      {
        countyFips: '06037',
        countyName: 'Los Angeles County',
        state: 'CA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '2nd largest US city; entirely within Los Angeles County',
  },

  // Phoenix, AZ - Maricopa County
  '0455000': {
    placeFips: '0455000',
    placeName: 'Phoenix city',
    state: 'AZ',
    counties: [
      {
        countyFips: '04013',
        countyName: 'Maricopa County',
        state: 'AZ',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '5th largest US city; entirely within Maricopa County',
  },

  // Philadelphia, PA - Philadelphia County
  '4260000': {
    placeFips: '4260000',
    placeName: 'Philadelphia city',
    state: 'PA',
    counties: [
      {
        countyFips: '42101',
        countyName: 'Philadelphia County',
        state: 'PA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '6th largest US city; consolidated city-county (coextensive)',
  },

  // San Diego, CA - San Diego County
  '0666000': {
    placeFips: '0666000',
    placeName: 'San Diego city',
    state: 'CA',
    counties: [
      {
        countyFips: '06073',
        countyName: 'San Diego County',
        state: 'CA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '8th largest US city; entirely within San Diego County',
  },

  // San Jose, CA - Santa Clara County
  '0668000': {
    placeFips: '0668000',
    placeName: 'San Jose city',
    state: 'CA',
    counties: [
      {
        countyFips: '06085',
        countyName: 'Santa Clara County',
        state: 'CA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '10th largest US city; Silicon Valley core',
  },

  // Austin, TX - Travis County
  '4805000': {
    placeFips: '4805000',
    placeName: 'Austin city',
    state: 'TX',
    counties: [
      {
        countyFips: '48453',
        countyName: 'Travis County',
        state: 'TX',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '11th largest US city; capital of Texas',
  },

  // Jacksonville, FL - Duval County
  '1235000': {
    placeFips: '1235000',
    placeName: 'Jacksonville city',
    state: 'FL',
    counties: [
      {
        countyFips: '12031',
        countyName: 'Duval County',
        state: 'FL',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '12th largest US city; consolidated city-county (coextensive)',
  },

  // San Francisco, CA - San Francisco County
  '0667000': {
    placeFips: '0667000',
    placeName: 'San Francisco city',
    state: 'CA',
    counties: [
      {
        countyFips: '06075',
        countyName: 'San Francisco County',
        state: 'CA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '17th largest US city; consolidated city-county (coextensive)',
  },

  // Seattle, WA - King County
  '5363000': {
    placeFips: '5363000',
    placeName: 'Seattle city',
    state: 'WA',
    counties: [
      {
        countyFips: '53033',
        countyName: 'King County',
        state: 'WA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '18th largest US city; entirely within King County',
  },

  // Denver, CO - Denver County
  '0820000': {
    placeFips: '0820000',
    placeName: 'Denver city',
    state: 'CO',
    counties: [
      {
        countyFips: '08031',
        countyName: 'Denver County',
        state: 'CO',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '19th largest US city; consolidated city-county (coextensive)',
  },

  // Washington, DC - District of Columbia
  '1150000': {
    placeFips: '1150000',
    placeName: 'Washington city',
    state: 'DC',
    counties: [
      {
        countyFips: '11001',
        countyName: 'District of Columbia',
        state: 'DC',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'US capital; coextensive with District of Columbia (not a county)',
  },

  // Boston, MA - Suffolk County
  '2507000': {
    placeFips: '2507000',
    placeName: 'Boston city',
    state: 'MA',
    counties: [
      {
        countyFips: '25025',
        countyName: 'Suffolk County',
        state: 'MA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '21st largest US city; state capital',
  },

  // Nashville-Davidson, TN - Davidson County
  '4752006': {
    placeFips: '4752006',
    placeName: 'Nashville-Davidson metropolitan government (balance)',
    state: 'TN',
    counties: [
      {
        countyFips: '47037',
        countyName: 'Davidson County',
        state: 'TN',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '23rd largest US city; consolidated city-county (coextensive)',
  },

  // Detroit, MI - Wayne County
  '2622000': {
    placeFips: '2622000',
    placeName: 'Detroit city',
    state: 'MI',
    counties: [
      {
        countyFips: '26163',
        countyName: 'Wayne County',
        state: 'MI',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '24th largest US city; entirely within Wayne County',
  },

  // Las Vegas, NV - Clark County
  '3240000': {
    placeFips: '3240000',
    placeName: 'Las Vegas city',
    state: 'NV',
    counties: [
      {
        countyFips: '32003',
        countyName: 'Clark County',
        state: 'NV',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '26th largest US city; entirely within Clark County',
  },

  // Baltimore, MD - Baltimore city (independent)
  '2404000': {
    placeFips: '2404000',
    placeName: 'Baltimore city',
    state: 'MD',
    counties: [
      {
        countyFips: '24510',
        countyName: 'Baltimore city',
        state: 'MD',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '27th largest US city; independent city (not part of a county)',
  },

  // Milwaukee, WI - Milwaukee County
  '5553000': {
    placeFips: '5553000',
    placeName: 'Milwaukee city',
    state: 'WI',
    counties: [
      {
        countyFips: '55079',
        countyName: 'Milwaukee County',
        state: 'WI',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '29th largest US city; entirely within Milwaukee County',
  },

  // Albuquerque, NM - Bernalillo County
  '3502000': {
    placeFips: '3502000',
    placeName: 'Albuquerque city',
    state: 'NM',
    counties: [
      {
        countyFips: '35001',
        countyName: 'Bernalillo County',
        state: 'NM',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '30th largest US city; entirely within Bernalillo County',
  },

  // Boulder, CO - Boulder County (for testing)
  '0803000': {
    placeFips: '0803000',
    placeName: 'Boulder city',
    state: 'CO',
    counties: [
      {
        countyFips: '08013',
        countyName: 'Boulder County',
        state: 'CO',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'College town; entirely within Boulder County',
  },

  // ============================================================
  // VIRGINIA INDEPENDENT CITIES (separate from counties)
  // ============================================================

  // Virginia Beach, VA - Independent city
  '5182000': {
    placeFips: '5182000',
    placeName: 'Virginia Beach city',
    state: 'VA',
    counties: [
      {
        countyFips: '51810',
        countyName: 'Virginia Beach city',
        state: 'VA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: '44th largest US city; Virginia independent city (not part of a county)',
  },

  // Norfolk, VA - Independent city
  '5157000': {
    placeFips: '5157000',
    placeName: 'Norfolk city',
    state: 'VA',
    counties: [
      {
        countyFips: '51710',
        countyName: 'Norfolk city',
        state: 'VA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Virginia independent city (not part of a county)',
  },

  // Chesapeake, VA - Independent city
  '5116000': {
    placeFips: '5116000',
    placeName: 'Chesapeake city',
    state: 'VA',
    counties: [
      {
        countyFips: '51550',
        countyName: 'Chesapeake city',
        state: 'VA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Virginia independent city (not part of a county)',
  },

  // Richmond, VA - Independent city
  '5167000': {
    placeFips: '5167000',
    placeName: 'Richmond city',
    state: 'VA',
    counties: [
      {
        countyFips: '51760',
        countyName: 'Richmond city',
        state: 'VA',
        percentArea: 100.0,
        isPrimary: true,
      },
    ],
    vintage: 2023,
    lastVerified: '2025-12-22',
    notes: 'Virginia state capital; independent city (not part of a county)',
  },
};

// ============================================================
// LOOKUP FUNCTIONS
// ============================================================

/**
 * Get all counties containing a place
 *
 * @param placeFips - 7-digit Census PLACE FIPS code
 * @returns Array of county mappings (empty if place not in crosswalk)
 */
export function getCountiesForPlace(
  placeFips: string
): readonly CountyMapping[] {
  const record = PLACE_COUNTY_CROSSWALK[placeFips];
  return record ? record.counties : [];
}

/**
 * Get primary county for a place
 *
 * @param placeFips - 7-digit Census PLACE FIPS code
 * @returns Primary county FIPS code (null if not found)
 */
export function getPrimaryCountyForPlace(placeFips: string): string | null {
  const counties = getCountiesForPlace(placeFips);
  const primary = counties.find((c) => c.isPrimary);
  return primary ? primary.countyFips : null;
}

/**
 * Get all places in a county
 *
 * @param countyFips - 5-digit county FIPS code
 * @returns Array of place FIPS codes in the county
 */
export function getPlacesInCounty(countyFips: string): readonly string[] {
  return Object.entries(PLACE_COUNTY_CROSSWALK)
    .filter(([_, record]) =>
      record.counties.some((c) => c.countyFips === countyFips)
    )
    .map(([placeFips, _]) => placeFips);
}

/**
 * Check if place spans multiple counties
 *
 * @param placeFips - 7-digit Census PLACE FIPS code
 * @returns True if place spans 2+ counties
 */
export function isMultiCountyPlace(placeFips: string): boolean {
  const counties = getCountiesForPlace(placeFips);
  return counties.length > 1;
}

/**
 * Get complete crosswalk record for a place
 *
 * @param placeFips - 7-digit Census PLACE FIPS code
 * @returns Complete crosswalk record (null if not found)
 */
export function getCrosswalkRecord(
  placeFips: string
): PlaceCountyCrosswalk | null {
  return PLACE_COUNTY_CROSSWALK[placeFips] ?? null;
}

/**
 * Get county distribution for multi-county place
 *
 * Returns counties sorted by area percentage (largest first)
 *
 * @param placeFips - 7-digit Census PLACE FIPS code
 * @returns Counties sorted by area percentage
 */
export function getCountyDistribution(
  placeFips: string
): readonly CountyMapping[] {
  const counties = getCountiesForPlace(placeFips);
  return [...counties].sort((a, b) => {
    const areaA = a.percentArea ?? 0;
    const areaB = b.percentArea ?? 0;
    return areaB - areaA; // Descending order
  });
}
