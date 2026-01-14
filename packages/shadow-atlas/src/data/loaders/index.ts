/**
 * Data Loaders
 *
 * Centralized exports for all data loaders in the Shadow Atlas package.
 * Each loader provides runtime access to canonical data files without
 * bloating the TypeScript compilation and bundle size.
 *
 * WS-A6: Unified loader barrel file for Wave 1 data extraction
 *
 * Data extracted from validators/*.ts to data/canonical/*.json:
 * - vtd-geoids.json (2.3MB) - Voting Tabulation Districts
 * - place-geoids.json (534KB) - Incorporated Places & CDPs
 * - school-district-geoids.json (220KB) - UNSD/ELSD/SCSD districts
 * - geoid-reference.json (151KB) - CD/SLDU/SLDL/County GEOIDs
 * - tiger-expected-counts.json (12KB) - Expected feature counts
 */

// VTD (Voting Tabulation District) GEOIDs
export {
  getVTDGeoidsForState,
  getAllVTDGeoids,
  getVTDMetadata,
  getExpectedVTDCount,
  getActualVTDCount,
  isValidVTDGeoid,
  getNationalVTDTotal,
  type VTDMetadata,
} from './vtd-geoids-loader.js';

// Place GEOIDs (cities, towns, villages, CDPs)
export {
  NATIONAL_PLACE_TOTAL,
  EXPECTED_PLACE_BY_STATE,
  getPlaceGeoidsForState,
  getAllPlaceGeoids,
  getPlaceMetadata,
} from './place-geoids-loader.js';

// School District GEOIDs (UNSD, ELSD, SCSD)
export {
  getSchoolDistrictGeoids,
  getAllSchoolDistrictGeoids,
  getSchoolDistrictCount,
  type SchoolDistrictType,
} from './school-district-geoids-loader.js';

// GEOID Reference (CD, SLDU, SLDL, County)
export {
  CANONICAL_CD_GEOIDS,
  CANONICAL_SLDU_GEOIDS,
  CANONICAL_SLDL_GEOIDS,
  CANONICAL_COUNTY_GEOIDS,
} from './geoid-reference-loader.js';

// TIGER Expected Counts
export {
  EXPECTED_COUNTS,
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  EXPECTED_VTD_BY_STATE,
  EXPECTED_CDP_BY_STATE,
  EXPECTED_COUSUB_BY_STATE,
  EXPECTED_SUBMCD_BY_STATE,
  EXPECTED_CONCITY_BY_STATE,
  EXPECTED_AIANNH_BY_STATE,
  VTD_DATA_VINTAGE,
  NATIONAL_TOTALS,
  isVtdDataFresh,
  getExpectedCount,
  validateReferenceCounts,
  getMetadata as getTigerMetadata,
  type TigerCountLayer,
  type VtdDataVintage,
} from './tiger-expected-counts-loader.js';
