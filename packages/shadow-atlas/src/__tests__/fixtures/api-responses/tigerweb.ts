/**
 * TIGERweb API Response Fixtures
 *
 * SCOPE: Frozen API responses for deterministic testing
 *
 * USAGE: Unit tests that need realistic API responses without network calls
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { FeatureCollection } from 'geojson';

/**
 * TIGERweb Congressional Districts Response (Wisconsin)
 *
 * Frozen response from:
 * https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query
 * ?where=STATE='55'&outFields=*&f=geojson
 */
export const TIGERWEB_WISCONSIN_CONGRESSIONAL_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-88.0, 42.5],
            [-88.0, 43.0],
            [-87.5, 43.0],
            [-87.5, 42.5],
            [-88.0, 42.5],
          ],
        ],
      },
      properties: {
        OBJECTID: 1,
        GEOID: '5501',
        STATEFP: '55',
        CD118FP: '01',
        NAMELSAD: 'Congressional District 1',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 5000000000,
        AWATER: 500000000,
        INTPTLAT: '+42.7500000',
        INTPTLON: '-087.7500000',
      },
    },
    {
      type: 'Feature',
      id: 2,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-89.5, 42.5],
            [-89.5, 43.5],
            [-88.5, 43.5],
            [-88.5, 42.5],
            [-89.5, 42.5],
          ],
        ],
      },
      properties: {
        OBJECTID: 2,
        GEOID: '5502',
        STATEFP: '55',
        CD118FP: '02',
        NAMELSAD: 'Congressional District 2',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 6000000000,
        AWATER: 600000000,
        INTPTLAT: '+43.0000000',
        INTPTLON: '-089.0000000',
      },
    },
    {
      type: 'Feature',
      id: 3,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-91.5, 42.5],
            [-91.5, 44.0],
            [-90.0, 44.0],
            [-90.0, 42.5],
            [-91.5, 42.5],
          ],
        ],
      },
      properties: {
        OBJECTID: 3,
        GEOID: '5503',
        STATEFP: '55',
        CD118FP: '03',
        NAMELSAD: 'Congressional District 3',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 8000000000,
        AWATER: 700000000,
        INTPTLAT: '+43.2500000',
        INTPTLON: '-090.7500000',
      },
    },
    {
      type: 'Feature',
      id: 4,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-88.0, 43.0],
            [-88.0, 43.2],
            [-87.8, 43.2],
            [-87.8, 43.0],
            [-88.0, 43.0],
          ],
        ],
      },
      properties: {
        OBJECTID: 4,
        GEOID: '5504',
        STATEFP: '55',
        CD118FP: '04',
        NAMELSAD: 'Congressional District 4',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 500000000,
        AWATER: 50000000,
        INTPTLAT: '+43.1000000',
        INTPTLON: '-087.9000000',
      },
    },
    {
      type: 'Feature',
      id: 5,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-88.5, 43.5],
            [-88.5, 44.0],
            [-88.0, 44.0],
            [-88.0, 43.5],
            [-88.5, 43.5],
          ],
        ],
      },
      properties: {
        OBJECTID: 5,
        GEOID: '5505',
        STATEFP: '55',
        CD118FP: '05',
        NAMELSAD: 'Congressional District 5',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 4000000000,
        AWATER: 400000000,
        INTPTLAT: '+43.7500000',
        INTPTLON: '-088.2500000',
      },
    },
    {
      type: 'Feature',
      id: 6,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-89.0, 43.5],
            [-89.0, 44.5],
            [-88.5, 44.5],
            [-88.5, 43.5],
            [-89.0, 43.5],
          ],
        ],
      },
      properties: {
        OBJECTID: 6,
        GEOID: '5506',
        STATEFP: '55',
        CD118FP: '06',
        NAMELSAD: 'Congressional District 6',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 7000000000,
        AWATER: 650000000,
        INTPTLAT: '+44.0000000',
        INTPTLON: '-088.7500000',
      },
    },
    {
      type: 'Feature',
      id: 7,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-91.0, 44.0],
            [-91.0, 46.0],
            [-89.5, 46.0],
            [-89.5, 44.0],
            [-91.0, 44.0],
          ],
        ],
      },
      properties: {
        OBJECTID: 7,
        GEOID: '5507',
        STATEFP: '55',
        CD118FP: '07',
        NAMELSAD: 'Congressional District 7',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 12000000000,
        AWATER: 800000000,
        INTPTLAT: '+45.0000000',
        INTPTLON: '-090.2500000',
      },
    },
    {
      type: 'Feature',
      id: 8,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-88.5, 44.5],
              [-88.5, 46.0],
              [-87.5, 46.0],
              [-87.5, 44.5],
              [-88.5, 44.5],
            ],
          ],
        ],
      },
      properties: {
        OBJECTID: 8,
        GEOID: '5508',
        STATEFP: '55',
        CD118FP: '08',
        NAMELSAD: 'Congressional District 8',
        LSAD: 'C2',
        CDSESSN: '118',
        MTFCC: 'G5200',
        FUNCSTAT: 'N',
        ALAND: 9000000000,
        AWATER: 900000000,
        INTPTLAT: '+45.2500000',
        INTPTLON: '-088.0000000',
      },
    },
  ],
};

/**
 * TIGERweb Error Response (rate limited)
 */
export const TIGERWEB_RATE_LIMIT_RESPONSE = {
  error: {
    code: 429,
    message: 'Rate limit exceeded',
    details: ['Please retry after 1 second'],
  },
};

/**
 * TIGERweb Error Response (service unavailable)
 */
export const TIGERWEB_SERVICE_UNAVAILABLE_RESPONSE = {
  error: {
    code: 503,
    message: 'Service temporarily unavailable',
    details: ['The service is currently under maintenance'],
  },
};

/**
 * TIGERweb Empty Response (no features found)
 */
export const TIGERWEB_EMPTY_RESPONSE: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};
