/**
 * GEOID Reference Data Loader
 *
 * Loads canonical GEOID lists from JSON for TIGER/Line boundary validation.
 *
 * DATA SOURCE: Census Bureau TIGER/Line 2024 shapefiles
 * EXTRACTED: 2026-01-11 (from src/validators/geoid-reference.ts)
 *
 * GEOID FORMAT SPECIFICATIONS:
 * - Congressional Districts (CD): 4 digits SSDD (State FIPS + District number)
 * - State Legislative Upper (SLDU): 5 digits SSDDD (State FIPS + District)
 * - State Legislative Lower (SLDL): 5 digits SSDDD (State FIPS + District)
 * - County: 5 digits SSCCC (State FIPS + County FIPS)
 */

import geoidData from '../canonical/geoid-reference.json' assert { type: 'json' };

/**
 * Canonical Congressional District GEOIDs by State
 *
 * FORMAT: SSDD (State FIPS + 2-digit district number)
 * - State FIPS: 2 digits (01-56)
 * - District: 2 digits (01-52 for regular districts, 00 for at-large)
 *
 * AT-LARGE STATES (district 00):
 * - Alaska (02), Delaware (10), North Dakota (38), South Dakota (46), Vermont (50), Wyoming (56)
 * - Territories: American Samoa (60), Guam (66), N. Mariana Islands (69), Puerto Rico (72), Virgin Islands (78)
 *
 * SOURCE: 118th Congress apportionment (2023-2025), based on 2020 Census
 */
export const CANONICAL_CD_GEOIDS = geoidData.cd as Record<string, readonly string[]>;

/**
 * Canonical State Legislative Upper (State Senate) GEOIDs by State
 *
 * FORMAT: SSDDD (State FIPS + 3-digit district number) for most states
 * Some states use non-sequential or letter-based GEOIDs.
 *
 * NON-SEQUENTIAL GEOID STATES:
 * - Alaska (02): Letter codes A-T (0200A, 0200B, ..., 0200T)
 * - Massachusetts (25): D## format (25D01, 25D02, ..., 25D40)
 * - Vermont (50): 3-letter county codes (50ADD, 50BEN, 50CAL, ...)
 * - West Virginia (54): Multi-member - 17 districts for 34 seats
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles (authoritative)
 */
export const CANONICAL_SLDU_GEOIDS = geoidData.sldu as Record<string, readonly string[]>;

/**
 * Canonical State Legislative Lower (State House) GEOIDs by State
 *
 * FORMAT: SSDDD (State FIPS + 3-digit district number) for most states
 * Some states use non-sequential or letter-based GEOIDs.
 *
 * NON-SEQUENTIAL GEOID STATES:
 * - Alaska (02): Letter codes A-Z, AA-HH (0200A, ..., 0200Z, 02AA, ..., 02HH)
 * - Massachusetts (25): S##P# format (25S01P1, 25S01P2, ..., 25S40P3)
 * - New Hampshire (33): ### format with gaps (331, 332, ..., 400)
 * - Vermont (50): 3-letter town codes (50ADD-1, 50BEN-1, 50CAL-2, ...)
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles (authoritative)
 */
export const CANONICAL_SLDL_GEOIDS = geoidData.sldl as Record<string, readonly string[]>;

/**
 * Canonical County GEOIDs by State/Territory
 *
 * FORMAT: SSCCC (State FIPS + 3-digit county FIPS)
 * - State FIPS: 2 digits (01-78 including territories)
 * - County FIPS: 3 digits (001-999, typically odd numbers for Census convention)
 *
 * COUNTY EQUIVALENTS:
 * - Alaska (02): Boroughs and census areas (29 entities)
 * - Louisiana (22): Parishes instead of counties (64 parishes)
 * - DC (11): District of Columbia (single entity, GEOID 11001)
 * - Territories: Municipalities and districts (varying structures)
 *
 * NUMBERING CONVENTION:
 * - Census typically uses odd numbers (001, 003, 005, ...)
 * - Gaps in numbering reflect historical changes or consolidated entities
 * - Independent cities in Virginia have FIPS codes 5xx-8xx
 *
 * SOURCE: Census TIGER/Line 2024 shapefiles (authoritative)
 * Last Updated: 2026-01-02
 */
export const CANONICAL_COUNTY_GEOIDS = geoidData.county as Record<string, readonly string[]>;
