/**
 * ISO 3166-1 Country Registry
 *
 * Comprehensive mapping of all 195 UN member states to ISO codes and regions.
 * This is the canonical source for country metadata in Shadow Atlas.
 *
 * COVERAGE:
 * - 193 UN member states
 * - 2 observer states (Holy See/Vatican City, Palestine)
 * - Grouped by continental region for Merkle tree hierarchy
 *
 * DATA SOURCE:
 * - ISO 3166-1 alpha-2 codes (official standard)
 * - UN geoscheme for regional classification
 * - Last updated: 2025-12-22
 *
 * USAGE:
 * ```typescript
 * import { COUNTRIES, getCountryByCode, getCountriesByRegion } from './iso-3166-countries';
 *
 * const usa = getCountryByCode('US');
 * const europeanCountries = getCountriesByRegion('europe');
 * ```
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Continental regions (aligned with global Merkle tree structure)
 */
export type ContinentalRegion =
  | 'americas'
  | 'europe'
  | 'asia-pacific'
  | 'africa'
  | 'middle-east';

/**
 * Country registry entry
 */
export interface CountryEntry {
  /** ISO 3166-1 alpha-2 code (e.g., "US") */
  readonly code: string;

  /** ISO 3166-1 alpha-3 code (e.g., "USA") */
  readonly code3: string;

  /** ISO 3166-1 numeric code (e.g., "840") */
  readonly numeric: string;

  /** Official country name (English) */
  readonly name: string;

  /** Common short name (English) */
  readonly shortName: string;

  /** Continental region for Merkle tree grouping */
  readonly region: ContinentalRegion;

  /** Whether we have a boundary data provider for this country */
  readonly hasProvider: boolean;

  /** UN member status */
  readonly unMember: boolean;

  /** Electoral system type (if known) */
  readonly electoralSystem?: 'parliamentary' | 'presidential' | 'mixed' | 'other';

  /** Notes about data availability or special cases */
  readonly notes?: string;
}

// ============================================================================
// Country Registry (195 Countries)
// ============================================================================

/**
 * Comprehensive ISO 3166-1 country registry
 *
 * ORGANIZATION:
 * - Americas (35 countries)
 * - Europe (50 countries)
 * - Asia-Pacific (48 countries)
 * - Africa (54 countries)
 * - Middle East (8 countries)
 *
 * Total: 195 countries
 */
export const COUNTRIES: readonly CountryEntry[] = [
  // ========================================================================
  // AMERICAS (35 countries)
  // ========================================================================

  // North America
  { code: 'US', code3: 'USA', numeric: '840', name: 'United States of America', shortName: 'United States', region: 'americas', hasProvider: true, unMember: true, electoralSystem: 'presidential' },
  { code: 'CA', code3: 'CAN', numeric: '124', name: 'Canada', shortName: 'Canada', region: 'americas', hasProvider: true, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MX', code3: 'MEX', numeric: '484', name: 'United Mexican States', shortName: 'Mexico', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // Central America
  { code: 'BZ', code3: 'BLZ', numeric: '084', name: 'Belize', shortName: 'Belize', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CR', code3: 'CRI', numeric: '188', name: 'Republic of Costa Rica', shortName: 'Costa Rica', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SV', code3: 'SLV', numeric: '222', name: 'Republic of El Salvador', shortName: 'El Salvador', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GT', code3: 'GTM', numeric: '320', name: 'Republic of Guatemala', shortName: 'Guatemala', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'HN', code3: 'HND', numeric: '340', name: 'Republic of Honduras', shortName: 'Honduras', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'NI', code3: 'NIC', numeric: '558', name: 'Republic of Nicaragua', shortName: 'Nicaragua', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'PA', code3: 'PAN', numeric: '591', name: 'Republic of Panama', shortName: 'Panama', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // Caribbean
  { code: 'AG', code3: 'ATG', numeric: '028', name: 'Antigua and Barbuda', shortName: 'Antigua and Barbuda', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BS', code3: 'BHS', numeric: '044', name: 'Commonwealth of The Bahamas', shortName: 'Bahamas', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BB', code3: 'BRB', numeric: '052', name: 'Barbados', shortName: 'Barbados', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CU', code3: 'CUB', numeric: '192', name: 'Republic of Cuba', shortName: 'Cuba', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'DM', code3: 'DMA', numeric: '212', name: 'Commonwealth of Dominica', shortName: 'Dominica', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'DO', code3: 'DOM', numeric: '214', name: 'Dominican Republic', shortName: 'Dominican Republic', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GD', code3: 'GRD', numeric: '308', name: 'Grenada', shortName: 'Grenada', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'HT', code3: 'HTI', numeric: '332', name: 'Republic of Haiti', shortName: 'Haiti', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'JM', code3: 'JAM', numeric: '388', name: 'Jamaica', shortName: 'Jamaica', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'KN', code3: 'KNA', numeric: '659', name: 'Federation of Saint Christopher and Nevis', shortName: 'Saint Kitts and Nevis', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LC', code3: 'LCA', numeric: '662', name: 'Saint Lucia', shortName: 'Saint Lucia', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'VC', code3: 'VCT', numeric: '670', name: 'Saint Vincent and the Grenadines', shortName: 'Saint Vincent and the Grenadines', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TT', code3: 'TTO', numeric: '780', name: 'Republic of Trinidad and Tobago', shortName: 'Trinidad and Tobago', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // South America
  { code: 'AR', code3: 'ARG', numeric: '032', name: 'Argentine Republic', shortName: 'Argentina', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'BO', code3: 'BOL', numeric: '068', name: 'Plurinational State of Bolivia', shortName: 'Bolivia', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'BR', code3: 'BRA', numeric: '076', name: 'Federative Republic of Brazil', shortName: 'Brazil', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CL', code3: 'CHL', numeric: '152', name: 'Republic of Chile', shortName: 'Chile', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CO', code3: 'COL', numeric: '170', name: 'Republic of Colombia', shortName: 'Colombia', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'EC', code3: 'ECU', numeric: '218', name: 'Republic of Ecuador', shortName: 'Ecuador', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GY', code3: 'GUY', numeric: '328', name: 'Co-operative Republic of Guyana', shortName: 'Guyana', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PY', code3: 'PRY', numeric: '600', name: 'Republic of Paraguay', shortName: 'Paraguay', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'PE', code3: 'PER', numeric: '604', name: 'Republic of Peru', shortName: 'Peru', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SR', code3: 'SUR', numeric: '740', name: 'Republic of Suriname', shortName: 'Suriname', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'UY', code3: 'URY', numeric: '858', name: 'Oriental Republic of Uruguay', shortName: 'Uruguay', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'VE', code3: 'VEN', numeric: '862', name: 'Bolivarian Republic of Venezuela', shortName: 'Venezuela', region: 'americas', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // ========================================================================
  // EUROPE (50 countries)
  // ========================================================================

  // Western Europe
  { code: 'GB', code3: 'GBR', numeric: '826', name: 'United Kingdom of Great Britain and Northern Ireland', shortName: 'United Kingdom', region: 'europe', hasProvider: true, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'IE', code3: 'IRL', numeric: '372', name: 'Ireland', shortName: 'Ireland', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'FR', code3: 'FRA', numeric: '250', name: 'French Republic', shortName: 'France', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'mixed' },
  { code: 'BE', code3: 'BEL', numeric: '056', name: 'Kingdom of Belgium', shortName: 'Belgium', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'NL', code3: 'NLD', numeric: '528', name: 'Kingdom of the Netherlands', shortName: 'Netherlands', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LU', code3: 'LUX', numeric: '442', name: 'Grand Duchy of Luxembourg', shortName: 'Luxembourg', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MC', code3: 'MCO', numeric: '492', name: 'Principality of Monaco', shortName: 'Monaco', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'other' },

  // Central Europe
  { code: 'DE', code3: 'DEU', numeric: '276', name: 'Federal Republic of Germany', shortName: 'Germany', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'AT', code3: 'AUT', numeric: '040', name: 'Republic of Austria', shortName: 'Austria', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CH', code3: 'CHE', numeric: '756', name: 'Swiss Confederation', shortName: 'Switzerland', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'mixed' },
  { code: 'LI', code3: 'LIE', numeric: '438', name: 'Principality of Liechtenstein', shortName: 'Liechtenstein', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CZ', code3: 'CZE', numeric: '203', name: 'Czech Republic', shortName: 'Czechia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SK', code3: 'SVK', numeric: '703', name: 'Slovak Republic', shortName: 'Slovakia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PL', code3: 'POL', numeric: '616', name: 'Republic of Poland', shortName: 'Poland', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'HU', code3: 'HUN', numeric: '348', name: 'Hungary', shortName: 'Hungary', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // Northern Europe
  { code: 'SE', code3: 'SWE', numeric: '752', name: 'Kingdom of Sweden', shortName: 'Sweden', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'NO', code3: 'NOR', numeric: '578', name: 'Kingdom of Norway', shortName: 'Norway', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'DK', code3: 'DNK', numeric: '208', name: 'Kingdom of Denmark', shortName: 'Denmark', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'FI', code3: 'FIN', numeric: '246', name: 'Republic of Finland', shortName: 'Finland', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'IS', code3: 'ISL', numeric: '352', name: 'Iceland', shortName: 'Iceland', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // Baltic States
  { code: 'EE', code3: 'EST', numeric: '233', name: 'Republic of Estonia', shortName: 'Estonia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LV', code3: 'LVA', numeric: '428', name: 'Republic of Latvia', shortName: 'Latvia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LT', code3: 'LTU', numeric: '440', name: 'Republic of Lithuania', shortName: 'Lithuania', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // Southern Europe
  { code: 'ES', code3: 'ESP', numeric: '724', name: 'Kingdom of Spain', shortName: 'Spain', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PT', code3: 'PRT', numeric: '620', name: 'Portuguese Republic', shortName: 'Portugal', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'IT', code3: 'ITA', numeric: '380', name: 'Italian Republic', shortName: 'Italy', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'VA', code3: 'VAT', numeric: '336', name: 'Holy See', shortName: 'Vatican City', region: 'europe', hasProvider: false, unMember: false, electoralSystem: 'other', notes: 'Observer state' },
  { code: 'SM', code3: 'SMR', numeric: '674', name: 'Republic of San Marino', shortName: 'San Marino', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MT', code3: 'MLT', numeric: '470', name: 'Republic of Malta', shortName: 'Malta', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'GR', code3: 'GRC', numeric: '300', name: 'Hellenic Republic', shortName: 'Greece', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CY', code3: 'CYP', numeric: '196', name: 'Republic of Cyprus', shortName: 'Cyprus', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'AL', code3: 'ALB', numeric: '008', name: 'Republic of Albania', shortName: 'Albania', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MK', code3: 'MKD', numeric: '807', name: 'Republic of North Macedonia', shortName: 'North Macedonia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'ME', code3: 'MNE', numeric: '499', name: 'Montenegro', shortName: 'Montenegro', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'RS', code3: 'SRB', numeric: '688', name: 'Republic of Serbia', shortName: 'Serbia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BA', code3: 'BIH', numeric: '070', name: 'Bosnia and Herzegovina', shortName: 'Bosnia and Herzegovina', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'HR', code3: 'HRV', numeric: '191', name: 'Republic of Croatia', shortName: 'Croatia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SI', code3: 'SVN', numeric: '705', name: 'Republic of Slovenia', shortName: 'Slovenia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // Eastern Europe
  { code: 'RO', code3: 'ROU', numeric: '642', name: 'Romania', shortName: 'Romania', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BG', code3: 'BGR', numeric: '100', name: 'Republic of Bulgaria', shortName: 'Bulgaria', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MD', code3: 'MDA', numeric: '498', name: 'Republic of Moldova', shortName: 'Moldova', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'UA', code3: 'UKR', numeric: '804', name: 'Ukraine', shortName: 'Ukraine', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'mixed' },
  { code: 'BY', code3: 'BLR', numeric: '112', name: 'Republic of Belarus', shortName: 'Belarus', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'RU', code3: 'RUS', numeric: '643', name: 'Russian Federation', shortName: 'Russia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'mixed' },
  { code: 'GE', code3: 'GEO', numeric: '268', name: 'Georgia', shortName: 'Georgia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'AM', code3: 'ARM', numeric: '051', name: 'Republic of Armenia', shortName: 'Armenia', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'AZ', code3: 'AZE', numeric: '031', name: 'Republic of Azerbaijan', shortName: 'Azerbaijan', region: 'europe', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // ========================================================================
  // ASIA-PACIFIC (48 countries)
  // ========================================================================

  // Oceania
  { code: 'AU', code3: 'AUS', numeric: '036', name: 'Commonwealth of Australia', shortName: 'Australia', region: 'asia-pacific', hasProvider: true, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'NZ', code3: 'NZL', numeric: '554', name: 'New Zealand', shortName: 'New Zealand', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'FJ', code3: 'FJI', numeric: '242', name: 'Republic of Fiji', shortName: 'Fiji', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PG', code3: 'PNG', numeric: '598', name: 'Independent State of Papua New Guinea', shortName: 'Papua New Guinea', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SB', code3: 'SLB', numeric: '090', name: 'Solomon Islands', shortName: 'Solomon Islands', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'VU', code3: 'VUT', numeric: '548', name: 'Republic of Vanuatu', shortName: 'Vanuatu', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'WS', code3: 'WSM', numeric: '882', name: 'Independent State of Samoa', shortName: 'Samoa', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TO', code3: 'TON', numeric: '776', name: 'Kingdom of Tonga', shortName: 'Tonga', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'KI', code3: 'KIR', numeric: '296', name: 'Republic of Kiribati', shortName: 'Kiribati', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TV', code3: 'TUV', numeric: '798', name: 'Tuvalu', shortName: 'Tuvalu', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'NR', code3: 'NRU', numeric: '520', name: 'Republic of Nauru', shortName: 'Nauru', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PW', code3: 'PLW', numeric: '585', name: 'Republic of Palau', shortName: 'Palau', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MH', code3: 'MHL', numeric: '584', name: 'Republic of the Marshall Islands', shortName: 'Marshall Islands', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'FM', code3: 'FSM', numeric: '583', name: 'Federated States of Micronesia', shortName: 'Micronesia', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // East Asia
  { code: 'JP', code3: 'JPN', numeric: '392', name: 'Japan', shortName: 'Japan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'KR', code3: 'KOR', numeric: '410', name: 'Republic of Korea', shortName: 'South Korea', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'KP', code3: 'PRK', numeric: '408', name: 'Democratic People\'s Republic of Korea', shortName: 'North Korea', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'CN', code3: 'CHN', numeric: '156', name: 'People\'s Republic of China', shortName: 'China', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'MN', code3: 'MNG', numeric: '496', name: 'Mongolia', shortName: 'Mongolia', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TW', code3: 'TWN', numeric: '158', name: 'Taiwan', shortName: 'Taiwan', region: 'asia-pacific', hasProvider: false, unMember: false, electoralSystem: 'mixed', notes: 'Disputed status' },

  // Southeast Asia
  { code: 'ID', code3: 'IDN', numeric: '360', name: 'Republic of Indonesia', shortName: 'Indonesia', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MY', code3: 'MYS', numeric: '458', name: 'Malaysia', shortName: 'Malaysia', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PH', code3: 'PHL', numeric: '608', name: 'Republic of the Philippines', shortName: 'Philippines', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SG', code3: 'SGP', numeric: '702', name: 'Republic of Singapore', shortName: 'Singapore', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TH', code3: 'THA', numeric: '764', name: 'Kingdom of Thailand', shortName: 'Thailand', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'VN', code3: 'VNM', numeric: '704', name: 'Socialist Republic of Vietnam', shortName: 'Vietnam', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'BN', code3: 'BRN', numeric: '096', name: 'Brunei Darussalam', shortName: 'Brunei', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'KH', code3: 'KHM', numeric: '116', name: 'Kingdom of Cambodia', shortName: 'Cambodia', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LA', code3: 'LAO', numeric: '418', name: 'Lao People\'s Democratic Republic', shortName: 'Laos', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'MM', code3: 'MMR', numeric: '104', name: 'Republic of the Union of Myanmar', shortName: 'Myanmar', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TL', code3: 'TLS', numeric: '626', name: 'Democratic Republic of Timor-Leste', shortName: 'Timor-Leste', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // South Asia
  { code: 'IN', code3: 'IND', numeric: '356', name: 'Republic of India', shortName: 'India', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PK', code3: 'PAK', numeric: '586', name: 'Islamic Republic of Pakistan', shortName: 'Pakistan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BD', code3: 'BGD', numeric: '050', name: 'People\'s Republic of Bangladesh', shortName: 'Bangladesh', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LK', code3: 'LKA', numeric: '144', name: 'Democratic Socialist Republic of Sri Lanka', shortName: 'Sri Lanka', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'NP', code3: 'NPL', numeric: '524', name: 'Federal Democratic Republic of Nepal', shortName: 'Nepal', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BT', code3: 'BTN', numeric: '064', name: 'Kingdom of Bhutan', shortName: 'Bhutan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'MV', code3: 'MDV', numeric: '462', name: 'Republic of Maldives', shortName: 'Maldives', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'AF', code3: 'AFG', numeric: '004', name: 'Islamic Emirate of Afghanistan', shortName: 'Afghanistan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'other' },

  // Central Asia
  { code: 'KZ', code3: 'KAZ', numeric: '398', name: 'Republic of Kazakhstan', shortName: 'Kazakhstan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'UZ', code3: 'UZB', numeric: '860', name: 'Republic of Uzbekistan', shortName: 'Uzbekistan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'TM', code3: 'TKM', numeric: '795', name: 'Turkmenistan', shortName: 'Turkmenistan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'KG', code3: 'KGZ', numeric: '417', name: 'Kyrgyz Republic', shortName: 'Kyrgyzstan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TJ', code3: 'TJK', numeric: '762', name: 'Republic of Tajikistan', shortName: 'Tajikistan', region: 'asia-pacific', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // ========================================================================
  // AFRICA (54 countries)
  // ========================================================================

  // North Africa
  { code: 'EG', code3: 'EGY', numeric: '818', name: 'Arab Republic of Egypt', shortName: 'Egypt', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'LY', code3: 'LBY', numeric: '434', name: 'State of Libya', shortName: 'Libya', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'TN', code3: 'TUN', numeric: '788', name: 'Republic of Tunisia', shortName: 'Tunisia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'DZ', code3: 'DZA', numeric: '012', name: 'People\'s Democratic Republic of Algeria', shortName: 'Algeria', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MA', code3: 'MAR', numeric: '504', name: 'Kingdom of Morocco', shortName: 'Morocco', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SD', code3: 'SDN', numeric: '729', name: 'Republic of the Sudan', shortName: 'Sudan', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'SS', code3: 'SSD', numeric: '728', name: 'Republic of South Sudan', shortName: 'South Sudan', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // West Africa
  { code: 'NG', code3: 'NGA', numeric: '566', name: 'Federal Republic of Nigeria', shortName: 'Nigeria', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GH', code3: 'GHA', numeric: '288', name: 'Republic of Ghana', shortName: 'Ghana', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CI', code3: 'CIV', numeric: '384', name: 'Republic of Côte d\'Ivoire', shortName: 'Côte d\'Ivoire', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SN', code3: 'SEN', numeric: '686', name: 'Republic of Senegal', shortName: 'Senegal', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'ML', code3: 'MLI', numeric: '466', name: 'Republic of Mali', shortName: 'Mali', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'BF', code3: 'BFA', numeric: '854', name: 'Burkina Faso', shortName: 'Burkina Faso', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'NE', code3: 'NER', numeric: '562', name: 'Republic of Niger', shortName: 'Niger', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'GN', code3: 'GIN', numeric: '324', name: 'Republic of Guinea', shortName: 'Guinea', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SL', code3: 'SLE', numeric: '694', name: 'Republic of Sierra Leone', shortName: 'Sierra Leone', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'LR', code3: 'LBR', numeric: '430', name: 'Republic of Liberia', shortName: 'Liberia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'TG', code3: 'TGO', numeric: '768', name: 'Togolese Republic', shortName: 'Togo', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'BJ', code3: 'BEN', numeric: '204', name: 'Republic of Benin', shortName: 'Benin', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MR', code3: 'MRT', numeric: '478', name: 'Islamic Republic of Mauritania', shortName: 'Mauritania', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GM', code3: 'GMB', numeric: '270', name: 'Republic of The Gambia', shortName: 'Gambia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GW', code3: 'GNB', numeric: '624', name: 'Republic of Guinea-Bissau', shortName: 'Guinea-Bissau', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'CV', code3: 'CPV', numeric: '132', name: 'Republic of Cabo Verde', shortName: 'Cabo Verde', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // Central Africa
  { code: 'CM', code3: 'CMR', numeric: '120', name: 'Republic of Cameroon', shortName: 'Cameroon', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CF', code3: 'CAF', numeric: '140', name: 'Central African Republic', shortName: 'Central African Republic', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'TD', code3: 'TCD', numeric: '148', name: 'Republic of Chad', shortName: 'Chad', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CG', code3: 'COG', numeric: '178', name: 'Republic of the Congo', shortName: 'Congo', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'CD', code3: 'COD', numeric: '180', name: 'Democratic Republic of the Congo', shortName: 'DR Congo', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GA', code3: 'GAB', numeric: '266', name: 'Gabonese Republic', shortName: 'Gabon', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'GQ', code3: 'GNQ', numeric: '226', name: 'Republic of Equatorial Guinea', shortName: 'Equatorial Guinea', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'ST', code3: 'STP', numeric: '678', name: 'Democratic Republic of São Tomé and Príncipe', shortName: 'São Tomé and Príncipe', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },

  // East Africa
  { code: 'KE', code3: 'KEN', numeric: '404', name: 'Republic of Kenya', shortName: 'Kenya', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'TZ', code3: 'TZA', numeric: '834', name: 'United Republic of Tanzania', shortName: 'Tanzania', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'UG', code3: 'UGA', numeric: '800', name: 'Republic of Uganda', shortName: 'Uganda', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'RW', code3: 'RWA', numeric: '646', name: 'Republic of Rwanda', shortName: 'Rwanda', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'BI', code3: 'BDI', numeric: '108', name: 'Republic of Burundi', shortName: 'Burundi', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SO', code3: 'SOM', numeric: '706', name: 'Federal Republic of Somalia', shortName: 'Somalia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'ET', code3: 'ETH', numeric: '231', name: 'Federal Democratic Republic of Ethiopia', shortName: 'Ethiopia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'ER', code3: 'ERI', numeric: '232', name: 'State of Eritrea', shortName: 'Eritrea', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'DJ', code3: 'DJI', numeric: '262', name: 'Republic of Djibouti', shortName: 'Djibouti', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'SC', code3: 'SYC', numeric: '690', name: 'Republic of Seychelles', shortName: 'Seychelles', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MU', code3: 'MUS', numeric: '480', name: 'Republic of Mauritius', shortName: 'Mauritius', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'KM', code3: 'COM', numeric: '174', name: 'Union of the Comoros', shortName: 'Comoros', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },

  // Southern Africa
  { code: 'ZA', code3: 'ZAF', numeric: '710', name: 'Republic of South Africa', shortName: 'South Africa', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'NA', code3: 'NAM', numeric: '516', name: 'Republic of Namibia', shortName: 'Namibia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'BW', code3: 'BWA', numeric: '072', name: 'Republic of Botswana', shortName: 'Botswana', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'ZW', code3: 'ZWE', numeric: '716', name: 'Republic of Zimbabwe', shortName: 'Zimbabwe', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'ZM', code3: 'ZMB', numeric: '894', name: 'Republic of Zambia', shortName: 'Zambia', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MW', code3: 'MWI', numeric: '454', name: 'Republic of Malawi', shortName: 'Malawi', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MZ', code3: 'MOZ', numeric: '508', name: 'Republic of Mozambique', shortName: 'Mozambique', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'MG', code3: 'MDG', numeric: '450', name: 'Republic of Madagascar', shortName: 'Madagascar', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'AO', code3: 'AGO', numeric: '024', name: 'Republic of Angola', shortName: 'Angola', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'LS', code3: 'LSO', numeric: '426', name: 'Kingdom of Lesotho', shortName: 'Lesotho', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SZ', code3: 'SWZ', numeric: '748', name: 'Kingdom of Eswatini', shortName: 'Eswatini', region: 'africa', hasProvider: false, unMember: true, electoralSystem: 'other' },

  // ========================================================================
  // MIDDLE EAST (8 countries)
  // ========================================================================

  { code: 'IL', code3: 'ISR', numeric: '376', name: 'State of Israel', shortName: 'Israel', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'PS', code3: 'PSE', numeric: '275', name: 'State of Palestine', shortName: 'Palestine', region: 'middle-east', hasProvider: false, unMember: false, electoralSystem: 'parliamentary', notes: 'Observer state' },
  { code: 'JO', code3: 'JOR', numeric: '400', name: 'Hashemite Kingdom of Jordan', shortName: 'Jordan', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'LB', code3: 'LBN', numeric: '422', name: 'Lebanese Republic', shortName: 'Lebanon', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'SY', code3: 'SYR', numeric: '760', name: 'Syrian Arab Republic', shortName: 'Syria', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'IQ', code3: 'IRQ', numeric: '368', name: 'Republic of Iraq', shortName: 'Iraq', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'YE', code3: 'YEM', numeric: '887', name: 'Republic of Yemen', shortName: 'Yemen', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'OM', code3: 'OMN', numeric: '512', name: 'Sultanate of Oman', shortName: 'Oman', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'AE', code3: 'ARE', numeric: '784', name: 'United Arab Emirates', shortName: 'UAE', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'SA', code3: 'SAU', numeric: '682', name: 'Kingdom of Saudi Arabia', shortName: 'Saudi Arabia', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'KW', code3: 'KWT', numeric: '414', name: 'State of Kuwait', shortName: 'Kuwait', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'QA', code3: 'QAT', numeric: '634', name: 'State of Qatar', shortName: 'Qatar', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'other' },
  { code: 'BH', code3: 'BHR', numeric: '048', name: 'Kingdom of Bahrain', shortName: 'Bahrain', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'parliamentary' },
  { code: 'TR', code3: 'TUR', numeric: '792', name: 'Republic of Türkiye', shortName: 'Turkey', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'presidential' },
  { code: 'IR', code3: 'IRN', numeric: '364', name: 'Islamic Republic of Iran', shortName: 'Iran', region: 'middle-east', hasProvider: false, unMember: true, electoralSystem: 'mixed' },
] as const;

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Country lookup map (code → entry)
 * Built once at module load for O(1) lookups
 */
const COUNTRY_BY_CODE: ReadonlyMap<string, CountryEntry> = new Map(
  COUNTRIES.map(c => [c.code, c])
);

/**
 * Alpha-3 to Alpha-2 code mapping
 */
const CODE3_TO_CODE2: ReadonlyMap<string, string> = new Map(
  COUNTRIES.map(c => [c.code3, c.code])
);

/**
 * Get country by ISO 3166-1 alpha-2 code
 *
 * @param code - ISO alpha-2 code (e.g., "US", "GB")
 * @returns Country entry or undefined
 */
export function getCountryByCode(code: string): CountryEntry | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase());
}

/**
 * Get country by ISO 3166-1 alpha-3 code
 *
 * @param code3 - ISO alpha-3 code (e.g., "USA", "GBR")
 * @returns Country entry or undefined
 */
export function getCountryByCode3(code3: string): CountryEntry | undefined {
  const code2 = CODE3_TO_CODE2.get(code3.toUpperCase());
  return code2 ? COUNTRY_BY_CODE.get(code2) : undefined;
}

/**
 * Get all countries in a region
 *
 * @param region - Continental region
 * @returns Array of country entries in that region
 */
export function getCountriesByRegion(region: ContinentalRegion): readonly CountryEntry[] {
  return COUNTRIES.filter(c => c.region === region);
}

/**
 * Get all countries with boundary providers
 *
 * @returns Array of country codes with active providers
 */
export function getCountriesWithProviders(): readonly string[] {
  return COUNTRIES.filter(c => c.hasProvider).map(c => c.code);
}

/**
 * Check if a country code is valid
 *
 * @param code - ISO alpha-2 code
 * @returns true if valid country code
 */
export function isValidCountryCode(code: string): boolean {
  return COUNTRY_BY_CODE.has(code.toUpperCase());
}

/**
 * Get region for country code
 *
 * @param code - ISO alpha-2 code
 * @returns Continental region or undefined
 */
export function getRegionForCountry(code: string): ContinentalRegion | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase())?.region;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get registry statistics
 *
 * @returns Registry statistics
 */
export function getRegistryStatistics() {
  const byRegion: Record<ContinentalRegion, number> = {
    americas: 0,
    europe: 0,
    'asia-pacific': 0,
    africa: 0,
    'middle-east': 0,
  };

  let withProviders = 0;
  let unMembers = 0;

  for (const country of COUNTRIES) {
    byRegion[country.region]++;
    if (country.hasProvider) withProviders++;
    if (country.unMember) unMembers++;
  }

  return {
    total: COUNTRIES.length,
    unMembers,
    byRegion,
    withProviders,
    providerCoverage: ((withProviders / COUNTRIES.length) * 100).toFixed(1) + '%',
  };
}
