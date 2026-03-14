/**
 * New Zealand Country Provider
 *
 * Unified provider for NZ boundaries, officials, cell maps, and validation.
 * Extends CountryProvider (Wave 1 contract) with NZ-specific source chains.
 *
 * DATA SOURCES:
 * - Boundaries: Stats NZ ArcGIS FeatureServer (CC-BY-4.0)
 * - Officials (source chain):
 *   1. data.govt.nz CSV (national-statistics, CC-BY-4.0)
 *   2. Wikipedia 54th Parliament (community)
 *   3. parliament.nz HTML (electoral-commission, blocked by Imperva WAF)
 *
 * COVERAGE:
 * - General Electorates: 64 (2025 boundary review, live API count)
 * - Maori Electorates: 7
 * - List MPs: ~51 (proportional representation, no electorate)
 * - Total: ~123 MPs
 *
 * USAGE:
 * ```typescript
 * const provider = new NZCountryProvider();
 *
 * // Extract boundaries (inherited)
 * const result = await provider.extractAll();
 *
 * // Extract officials with boundary code resolution
 * const boundaryIndex = new Map(boundaries.map(b => [b.name, b]));
 * const officials = await provider.extractOfficials(boundaryIndex);
 *
 * // Validate (4-layer pipeline)
 * const report = await provider.validate(boundaries, officials.officials);
 * ```
 *
 * API ENDPOINTS:
 * - General Electorates: ArcGIS FeatureServer Layer 6
 * - Maori Electorates: ArcGIS FeatureServer Layer 8
 *
 * NOTES:
 * - 2025 boundary review finalized August 2025
 * - Data updates are event-driven (following boundary reviews)
 * - Next scheduled review: Post-2028 census
 * - Maori electorates provide dedicated representation (Electoral Act 1993)
 * - List MPs have NO electorate and are SKIPPED in boundary code resolution
 *
 * SOURCES:
 * - Stats NZ Boundary Review: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
 * - Elections NZ Maps: https://elections.nz/democracy-in-nz/historical-events/boundary-review-2025/electorate-maps/
 * - Stats NZ Geographic Data Service: https://datafinder.stats.govt.nz/group/census/data/category/electorates/
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  type InternationalExtractionResult,
  type LayerConfig,
  type ProviderHealth,
  type LayerExtractionResult,
} from './base-provider.js';
import { CountryProvider } from './country-provider.js';
import type {
  OfficialRecord,
  OfficialsExtractionResult,
  CellMapResult,
  StatisticalUnitType,
  ValidationReport,
  SourceConfig,
  GeocoderFn,
  PIPCheckFn,
} from './country-provider-types.js';
import { NZMPSchema } from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// NZ-Specific Types
// ============================================================================

/**
 * NZ layer types
 */
export type NZLayerType = 'general' | 'maori';

/**
 * NZ region (North Island, South Island, Chatham Islands)
 */
export type NZRegion = 'North Island' | 'South Island' | 'Chatham Islands';

/**
 * NZ electoral district
 */
export interface NZElectorate {
  /** Stats NZ electorate code (e.g., '1' for Northland, '72' for Te Tai Tonga) */
  readonly id: string;

  /** Electorate name (e.g., 'Auckland Central', 'Te Tai Tonga') */
  readonly name: string;

  /** Boundary type */
  readonly type: NZLayerType;

  /** Region */
  readonly region: NZRegion;

  /** Population (2023 census) */
  readonly population?: number;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'NZ';
    readonly dataSource: 'Stats NZ';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'national-statistics';
  };

  /** Original properties from Stats NZ */
  readonly properties: Record<string, unknown>;
}

/**
 * NZ extraction result
 */
export interface NZExtractionResult extends LayerExtractionResult {
  readonly layer: NZLayerType;
  readonly boundaries: readonly NZElectorate[];
}

/**
 * Layer metadata from Stats NZ service
 */
export interface LayerMetadata {
  readonly name: string;
  readonly description: string;
  readonly geometryType: string;
  readonly featureCount: number;
  readonly maxRecordCount: number;
  readonly lastEditDate?: number;
}

/**
 * NZ Official (MP) record extending the base OfficialRecord.
 *
 * NZ has three types of MPs:
 * - General electorate MPs (65): represent general electorates
 * - Maori electorate MPs (7): represent Maori electorates
 * - List MPs (~51): proportional representation, no electorate
 */
export interface NZOfficial extends OfficialRecord {
  /** Parliament ID (nzp-{normalized-name}, deduplicated) */
  readonly parliamentId: string;

  /** Electorate name (null for list MPs) */
  readonly electorateName: string | undefined;

  /** Electorate boundary code (nz-gen-{CODE} or nz-maori-{CODE}, null for list MPs) */
  readonly electorateCode: string | undefined;

  /** Electorate type: general, maori, or list */
  readonly electorateType: 'general' | 'maori' | 'list';
}

// ============================================================================
// Known Maori Electorates (54th Parliament, 2025 boundaries)
// ============================================================================

const MAORI_ELECTORATES = new Set([
  'Hauraki-Waikato',
  'Ikaroa-Rawhiti',
  'Ikaroa-R\u0101whiti',
  'Tamaki Makaurau',
  'T\u0101maki Makaurau',
  'Te Tai Hauauru',
  'Te Tai Hau\u0101uru',
  'Te Tai Tokerau',
  'Te Tai Tonga',
  'Waiariki',
  // Note: Te Atatu is a GENERAL electorate (West Auckland), not Maori
]);

// ============================================================================
// 2020→2025 Electorate Name Aliases
// ============================================================================
// The 54th Parliament (elected 2023) uses 2020 boundary names, but Stats NZ
// ArcGIS serves 2025 redistribution boundaries (finalized August 2025).
// This map bridges the 11 renamed/reconfigured electorates.
//
// Sources:
// - Stats NZ: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
// - Elections NZ: https://elections.nz/media-and-news/2025/electorate-boundaries-finalised/
//
// 2025 changes: North Island lost 1 general seat (65→64 general, 7 Māori).
// Three Wellington seats (Ōhāriu, Mana, Ōtaki) → two (Kenepuru, Kapiti).
// Three Auckland seats (New Lynn, Kelston, Te Atatū) → three (Waitākere, Glendene, Henderson).
// Four renamed: East Coast→East Cape, Rongotai→Wellington Bays,
//   Wellington Central→Wellington North, Bay of Plenty→Mt Maunganui.
// One renamed: Panmure-Ōtāhuhu→Ōtāhuhu.

const NZ_ELECTORATE_ALIASES: Record<string, string> = {
  // Straight renames
  'East Coast': 'East Cape',
  'Rongotai': 'Wellington Bays',
  'Wellington Central': 'Wellington North',
  'Bay of Plenty': 'Mt Maunganui',
  'Panmure-Ōtāhuhu': 'Ōtāhuhu',

  // Auckland reconfiguration (3→3)
  'New Lynn': 'Waitākere',
  'Kelston': 'Glendene',
  'Te Atatū': 'Henderson',

  // Wellington reconfiguration (3→2, net -1 seat)
  'Ōhāriu': 'Kenepuru',
  'Mana': 'Kapiti',
  'Ōtaki': 'Kapiti',  // abolished; closest successor
};

function isMaoriElectorate(name: string): boolean {
  return MAORI_ELECTORATES.has(name) ||
    MAORI_ELECTORATES.has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

/**
 * Normalize a name into a stable, deterministic ID slug.
 * Strips diacritics (macrons etc.), lowercases, replaces non-alphanum with hyphens.
 * Same input always produces the same output regardless of source ordering.
 */
function normalizeForId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics (macrons, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')     // non-alphanum -> hyphen
    .replace(/^-+|-+$/g, '');         // trim leading/trailing hyphens
}

/**
 * Normalize name for boundary matching.
 * Strips diacritics, lowercases, trims whitespace.
 */
function normalizeBoundaryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Internal mutable MP type used during parsing, before conversion to NZOfficial.
 */
interface RawNZMP {
  parliament_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  electorate_name: string | null;
  electorate_type: 'general' | 'maori' | 'list';
  email: string | null;
}

/**
 * Post-process an array of MPs to detect and fix parliament_id collisions.
 * If two MPs share the same name-based ID, disambiguate with electorate name.
 */
function deduplicateParliamentIds(mps: RawNZMP[]): void {
  const idCounts = new Map<string, number>();
  for (const mp of mps) {
    idCounts.set(mp.parliament_id, (idCounts.get(mp.parliament_id) ?? 0) + 1);
  }

  const duplicateIds = new Set<string>();
  for (const [id, count] of idCounts) {
    if (count > 1) duplicateIds.add(id);
  }

  if (duplicateIds.size === 0) return;

  for (const mp of mps) {
    if (duplicateIds.has(mp.parliament_id)) {
      const suffix = mp.electorate_name ? normalizeForId(mp.electorate_name) : 'list';
      mp.parliament_id = `${mp.parliament_id}-${suffix}`;
    }
  }
}

// ============================================================================
// CSV Parser
// ============================================================================

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csv: string): RawNZMP[] {
  const lines = csv.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV has fewer than 2 lines');
  }

  const header = parseCSVLine(lines[0]);
  const headerLower = header.map(h => h.toLowerCase().trim());

  const firstNameIdx = headerLower.findIndex(h => h.includes('first') && h.includes('name'));
  const lastNameIdx = headerLower.findIndex(h => h.includes('last') && h.includes('name'));
  const electorateIdx = headerLower.findIndex(h => h.includes('electorate'));
  const partyIdx = headerLower.findIndex(h => h.includes('party'));
  const emailIdx = headerLower.findIndex(h => h.includes('email'));

  if (partyIdx === -1) {
    throw new Error(`Cannot find party column in CSV header: ${header.join(', ')}`);
  }

  const mps: RawNZMP[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;

    const firstName = firstNameIdx >= 0 ? cols[firstNameIdx]?.trim() : null;
    const lastName = lastNameIdx >= 0 ? cols[lastNameIdx]?.trim() : null;
    const electorateName = electorateIdx >= 0 ? cols[electorateIdx]?.trim() || null : null;
    const party = cols[partyIdx]?.trim() ?? '';
    const email = emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null;

    if (!party) continue;

    const name = [firstName, lastName].filter(Boolean).join(' ');

    let electorateType: 'general' | 'maori' | 'list' = 'list';
    if (electorateName) {
      electorateType = isMaoriElectorate(electorateName) ? 'maori' : 'general';
    }

    mps.push({
      parliament_id: `nzp-${normalizeForId(name)}`,
      name,
      first_name: firstName,
      last_name: lastName,
      party,
      electorate_name: electorateName,
      electorate_type: electorateType,
      email,
    });
  }

  deduplicateParliamentIds(mps);
  return mps;
}

// ============================================================================
// Wikipedia Parser
// ============================================================================

function parseWikiRow(row: string, type: 'general' | 'maori'): RawNZMP | null {
  const cells = row.split(/\n\|/).map(c => c.replace(/^\|/, '').trim()).filter(c => c.length > 0);
  if (cells.length < 3) return null;

  // Extract electorate name from wiki markup
  const electorateRaw = cells[0];
  let electorate = '';

  const elecMatch = /(?:NZ electorate link\|([^}]+)\}\})|(?:\[\[([^|\]]+(?:\(New Zealand electorate\))?)\|?([^\]]*)\]\])/.exec(electorateRaw);
  if (elecMatch) {
    electorate = (elecMatch[1] || elecMatch[3] || elecMatch[2] || '').trim();
    electorate = electorate.replace(/\s*\(New Zealand electorate\)\s*/, '').trim();
  }
  if (!electorate) {
    const linkMatch = /\[\[([^|\]]+?)(?:\s*\(.*?\))?\|?([^\]]*)\]\]/.exec(electorateRaw);
    if (linkMatch) {
      electorate = (linkMatch[2] || linkMatch[1]).replace(/\s*\(.*?\)\s*/, '').trim();
    }
  }
  if (!electorate) return null;

  // Extract MP name from {{sortname|First|Last}} or [[Name]]
  const mpRaw = cells.length > 2 ? cells[2] : '';
  let firstName = '';
  let lastName = '';

  const sortnameMatch = /sortname\|([^|}]+)\|([^|}]+)/.exec(mpRaw);
  if (sortnameMatch) {
    firstName = sortnameMatch[1].trim();
    lastName = sortnameMatch[2].trim();
  } else {
    const linkMatch = /\[\[([^|\]]+)\|?([^\]]*)\]\]/.exec(mpRaw);
    if (linkMatch) {
      const name = (linkMatch[2] || linkMatch[1]).trim();
      const parts = name.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
  }
  if (!firstName && !lastName) return null;

  const name = `${firstName} ${lastName}`.trim();

  // Extract party
  let party = '';
  for (let ci = 3; ci < cells.length && !party; ci++) {
    const cellText = cells[ci];
    const partyTemplateMatch = /Party (?:name with color|color cell)\|([^}]+)\}\}/.exec(cellText);
    if (partyTemplateMatch) {
      party = partyTemplateMatch[1].trim();
      break;
    }
    const linkMatch = /\[\[([^|\]]+)\|?([^\]]*)\]\]/.exec(cellText);
    if (linkMatch) {
      const resolved = (linkMatch[2] || linkMatch[1]).trim();
      if (resolved && resolved !== 'Independent politician') {
        party = resolved;
        break;
      } else if (resolved === 'Independent politician' || linkMatch[1].includes('Independent')) {
        party = 'Independent';
        break;
      }
    }
    if (/independent/i.test(cellText) && cellText.length < 30) {
      party = 'Independent';
      break;
    }
  }
  if (!party) return null;

  // Simplify party names
  const partyMap: Record<string, string> = {
    'New Zealand National Party': 'National',
    'New Zealand Labour Party': 'Labour',
    'Green Party of Aotearoa New Zealand': 'Green',
    'ACT New Zealand': 'ACT',
    'New Zealand First': 'NZ First',
    'Te P\u0101ti M\u0101ori': 'Te P\u0101ti M\u0101ori',
  };
  party = partyMap[party] ?? party;

  return {
    parliament_id: `nzp-${normalizeForId(name)}`,
    name,
    first_name: firstName || null,
    last_name: lastName || null,
    party,
    electorate_name: electorate,
    electorate_type: type === 'maori' ? 'maori' : (isMaoriElectorate(electorate) ? 'maori' : 'general'),
    email: null,
  };
}

function parseWikipediaTables(wikitext: string): RawNZMP[] {
  const mps: RawNZMP[] = [];

  const generalIdx = wikitext.indexOf('General electorates===');
  const maoriHeadingPattern = /===\s*M[a\u0101]ori electorates\s*===/i;
  const maoriMatch = maoriHeadingPattern.exec(wikitext);
  let maoriIdx = maoriMatch ? maoriMatch.index : wikitext.indexOf('ori electorates===');

  if (generalIdx > 0) {
    const tableEnd = maoriIdx > generalIdx ? maoriIdx : wikitext.indexOf('|}', generalIdx);
    const generalTable = wikitext.substring(generalIdx, tableEnd > generalIdx ? tableEnd : generalIdx + 10000);
    const rows = generalTable.split(/\|-\s*\n/);
    for (const row of rows) {
      const mp = parseWikiRow(row, 'general');
      if (mp) mps.push(mp);
    }
  }

  if (maoriIdx > 0) {
    const tableEnd = wikitext.indexOf('|}', maoriIdx);
    const maoriTable = wikitext.substring(maoriIdx, tableEnd > maoriIdx ? tableEnd : maoriIdx + 5000);
    const rows = maoriTable.split(/\|-\s*\n/);
    for (const row of rows) {
      const mp = parseWikiRow(row, 'maori');
      if (mp) mps.push(mp);
    }
  }

  deduplicateParliamentIds(mps);
  return mps;
}

// ============================================================================
// Parliament.nz HTML Parser
// ============================================================================

function parseParliamentNZHTML(html: string): RawNZMP[] {
  const mps: RawNZMP[] = [];

  const memberPattern = /class="[^"]*member[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li)>/gi;
  let match;

  while ((match = memberPattern.exec(html)) !== null) {
    const block = match[0];

    const nameMatch = /<h\d[^>]*>([^<]+)<\/h\d>/i.exec(block);
    const partyMatch = /(?:party|caucus)[^>]*>([^<]+)/i.exec(block);
    const electorateMatch = /(?:electorate|constituency)[^>]*>([^<]+)/i.exec(block);
    const emailMatch = /href="mailto:([^"]+)"/i.exec(block);

    if (nameMatch) {
      const name = nameMatch[1].trim();
      const nameParts = name.split(' ');
      const firstName = nameParts[0] ?? null;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
      const party = partyMatch ? partyMatch[1].trim() : 'Unknown';
      const electorateName = electorateMatch ? electorateMatch[1].trim() : null;
      const email = emailMatch ? emailMatch[1].trim() : null;

      let electorateType: 'general' | 'maori' | 'list' = 'list';
      if (electorateName) {
        electorateType = isMaoriElectorate(electorateName) ? 'maori' : 'general';
      }

      mps.push({
        parliament_id: `nzp-${normalizeForId(name)}`,
        name,
        first_name: firstName,
        last_name: lastName,
        party,
        electorate_name: electorateName,
        electorate_type: electorateType,
        email,
      });
    }
  }

  deduplicateParliamentIds(mps);
  return mps;
}

// ============================================================================
// NZ Country Provider
// ============================================================================

/**
 * New Zealand Country Provider
 *
 * Unified provider for boundaries + officials + cell map + validation.
 * Extends CountryProvider<NZLayerType, NZElectorate, NZOfficial>.
 */
export class NZCountryProvider extends CountryProvider<
  NZLayerType,
  NZElectorate,
  NZOfficial
> {
  readonly country = 'NZ';
  readonly countryName = 'New Zealand';
  readonly dataSource = 'Stats NZ (Statistics New Zealand)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'CC-BY-4.0';

  private readonly baseUrl = 'https://services8.arcgis.com/tYgpmYB86cSiECQ3/arcgis/rest/services';

  // ==========================================================================
  // CountryProvider Abstract Properties
  // ==========================================================================

  /** Officials data sources in priority order */
  readonly officialsSources: readonly SourceConfig[] = [
    {
      name: 'data.govt.nz CSV',
      endpoint: 'https://catalogue.data.govt.nz/dataset/d97b9a53-4660-4dd5-89df-6c4536e92a02/resource/89069a40-abcf-4190-9665-3513ff004dd8/download/mp-contact-details.csv',
      authority: 'national-statistics',
      priority: 1,
    },
    {
      name: 'Wikipedia 54th Parliament',
      endpoint: 'https://en.wikipedia.org/w/api.php?action=parse&page=54th_New_Zealand_Parliament&prop=wikitext&format=json',
      authority: 'community',
      priority: 2,
    },
    {
      name: 'parliament.nz HTML',
      endpoint: 'https://www.parliament.nz/en/mps-and-electorates/members-of-parliament/',
      authority: 'electoral-commission',
      priority: 3,
    },
  ];

  /** Expected official count per chamber */
  readonly expectedOfficialCounts: ReadonlyMap<string, number> = new Map([
    ['general', 65],
    ['maori', 7],
    ['list', 51],  // approximate
  ]);

  /** Statistical geography unit type for Tree 2 cell maps */
  readonly statisticalUnit: StatisticalUnitType = 'meshblock';

  // ==========================================================================
  // Boundary Layer Configuration
  // ==========================================================================

  /**
   * Available boundary layers
   *
   * EXPECTED COUNTS (2025 boundary review):
   * - General Electorates: 64 (actual count from live API; originally expected 65)
   * - Maori Electorates: 7 (Te Tai Tokerau, Tamaki Makaurau, Hauraki-Waikato,
   *   Waiariki, Ikaroa-Rawhiti, Te Tai Hauauru, Te Tai Tonga)
   *
   * TOTAL: 71 electorates
   *
   * Source: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
   *
   * NOTE: Original Stats NZ Koordinates endpoints require API key.
   * Using ArcGIS-hosted mirror (charles.feltham@NZPS, NZ Parliament Service).
   * Service: New_Zealand_Electorates__2020_and_2025__WFL1
   *   Layer 6: General Electorates (2025)
   *   Layer 8: Maori Electorates (2025)
   */
  readonly layers: ReadonlyMap<NZLayerType, LayerConfig<NZLayerType>> = new Map([
    [
      'general',
      {
        type: 'general',
        name: 'General Electorates (2025)',
        endpoint: `${this.baseUrl}/New_Zealand_Electorates__2020_and_2025__WFL1/FeatureServer/6`,
        expectedCount: 64,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2025,
        lastVerified: '2026-03-10',
      },
    ],
    [
      'maori',
      {
        type: 'maori',
        name: 'Maori Electorates (2025)',
        endpoint: `${this.baseUrl}/New_Zealand_Electorates__2020_and_2025__WFL1/FeatureServer/8`,
        expectedCount: 7,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2025,
        lastVerified: '2026-03-10',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  // ==========================================================================
  // Boundary Extraction (inherited interface)
  // ==========================================================================

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<NZLayerType, NZElectorate>> {
    const startTime = Date.now();

    // Extract both general and Maori electorates in parallel
    const [general, maori] = await Promise.all([
      this.extractLayer('general'),
      this.extractLayer('maori'),
    ]);

    const totalBoundaries = general.actualCount + maori.actualCount;
    const successfulLayers = (general.success ? 1 : 0) + (maori.success ? 1 : 0);

    return {
      country: this.country,
      layers: [general, maori],
      totalBoundaries,
      successfulLayers,
      failedLayers: 2 - successfulLayers,
      extractedAt: new Date(),
      providerVersion: '2.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specific layer
   */
  async extractLayer(layerType: NZLayerType): Promise<LayerExtractionResult<NZLayerType, NZElectorate>> {
    switch (layerType) {
      case 'general':
        return this.extractGeneralElectorates();
      case 'maori':
        return this.extractMaoriElectorates();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  // ==========================================================================
  // Officials Extraction (CountryProvider abstract)
  // ==========================================================================

  /**
   * Extract NZ MPs with boundary code resolution.
   *
   * Uses 3-source fallback chain:
   * 1. data.govt.nz CSV (national-statistics authority)
   * 2. Wikipedia 54th Parliament (community, electorate MPs only)
   * 3. parliament.nz HTML (electoral-commission, blocked by Imperva WAF)
   *
   * List MPs (~51) are included but SKIPPED in boundary code resolution.
   * Their boundaryCode is null, electorateType is 'list'.
   *
   * @param boundaryIndex - Map of boundary name -> NZElectorate
   */
  async extractOfficials(
    boundaryIndex: Map<string, NZElectorate>
  ): Promise<OfficialsExtractionResult<NZOfficial>> {
    const startTime = Date.now();

    const { result: rawMPs, source, attempts } = await this.trySourceChain(
      this.officialsSources,
      async (sourceConfig) => {
        switch (sourceConfig.priority) {
          case 1:
            return this.fetchFromDataGovtNZ(sourceConfig.endpoint);
          case 2:
            return this.fetchFromWikipedia(sourceConfig.endpoint);
          case 3:
            return this.fetchFromParliamentNZ(sourceConfig.endpoint);
          default:
            throw new Error(`Unknown source priority: ${sourceConfig.priority}`);
        }
      }
    );

    // Convert raw MPs to NZOfficial records with boundary code resolution
    const officials = this.resolveOfficialBoundaryCodes(rawMPs, boundaryIndex);

    const listCount = officials.filter(o => o.electorateType === 'list').length;
    const electorateCount = officials.filter(o => o.electorateType !== 'list').length;

    // Expected count adjusts to source capability:
    // - data.govt.nz CSV / parliament.nz include all MPs (general + maori + list = ~123)
    // - Wikipedia only includes electorate MPs (general + maori = ~72)
    const hasListMPs = listCount > 0;
    const expectedTotal = hasListMPs ? 65 + 7 + 51 : 65 + 7; // 123 or 72
    const durationMs = Date.now() - startTime;

    logger.info('NZ officials extraction complete', {
      source: source.name,
      total: officials.length,
      electorate: electorateCount,
      list: listCount,
      expectedTotal,
      resolved: officials.filter(o => o.boundaryCode !== null).length,
      durationMs,
    });

    return {
      country: 'NZ',
      officials,
      expectedCount: expectedTotal,
      actualCount: officials.length,
      matched: officials.length >= Math.floor(expectedTotal * 0.8),
      confidence: source.authority === 'national-statistics' ? 80 : (source.authority === 'community' ? 40 : 60),
      sources: attempts,
      extractedAt: new Date(),
      durationMs,
    };
  }

  // ==========================================================================
  // Cell Map (Tree 2 — Meshblock → Electorate)
  // ==========================================================================

  /**
   * Stats NZ concordance URL for meshblock-to-electorate lookup.
   *
   * The 2025 Meshblock Higher Geographies table maps each meshblock to
   * its general electorate (GED2025) and Maori electorate (MED2025).
   * The file is published on Stats NZ Datafinder under CC-BY-4.0.
   *
   * If the direct download URL changes (Stats NZ periodically reorganizes),
   * the file can also be found by searching Datafinder for
   * "meshblock higher geographies 2025".
   */
  private readonly concordanceUrl =
    'https://datafinder.stats.govt.nz/layer/115067-meshblock-higher-geographies-2025-high-def/data/';

  /**
   * Build cell map for Tree 2 (NZ meshblocks → electorates).
   *
   * Loads the Stats NZ meshblock concordance CSV, which maps each of
   * ~57,500 meshblocks to both a general electorate and a Maori electorate.
   * Both are encoded into the 24-slot district array:
   *   - Slot 0: General Electorate code (numeric)
   *   - Slot 1: Maori Electorate code (numeric, 0n if not assigned)
   *   - Slots 2-23: 0n (reserved for Regional Council, TA, etc.)
   *
   * @param boundaries - NZ electoral boundaries (used for code resolution)
   * @returns CellMapResult with mappings ready for tree builder
   */
  async buildCellMap(
    boundaries: NZElectorate[]
  ): Promise<CellMapResult> {
    const startTime = Date.now();
    const { loadConcordance } = await import('../../hydration/concordance-loader.js');
    const { NZ_JURISDICTION } = await import('../../jurisdiction.js');
    const { buildCellMapTree } = await import('../../tree-builder.js');
    const { DISTRICT_SLOT_COUNT } = await import('../../tree-builder.js');

    // Build boundary name → numeric code lookup from boundaries
    const generalCodeMap = new Map<string, bigint>();
    const maoriCodeMap = new Map<string, bigint>();
    for (const b of boundaries) {
      const numericId = BigInt(b.id);
      if (b.type === 'general') {
        generalCodeMap.set(b.name, numericId);
      } else if (b.type === 'maori') {
        maoriCodeMap.set(b.name, numericId);
      }
    }

    // Load concordance CSV
    const concordance = await loadConcordance(
      {
        url: this.concordanceUrl,
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        secondaryBoundaryColumn: 'MED2025_V1_00',
        cacheFilename: 'nz-meshblock-higher-geographies-2025.csv',
      },
      'data/country-cache/nz',
    );

    logger.info(
      `NZ concordance loaded: ${concordance.rowCount} meshblocks, ` +
      `columns: [${concordance.columns.join(', ')}], ` +
      `fromCache: ${concordance.fromCache}`
    );

    // Convert to CellDistrictMapping[]
    const cellMappings: import('../../tree-builder.js').CellDistrictMapping[] = [];
    const seenCellIds = new Set<string>();
    let skippedEmpty = 0;
    let skippedDuplicate = 0;

    for (const m of concordance.mappings) {
      // Encode meshblock code as cell ID
      const cellId = NZ_JURISDICTION.encodeCellId(m.unitId);
      const cellIdStr = cellId.toString();

      if (seenCellIds.has(cellIdStr)) {
        skippedDuplicate++;
        continue;
      }
      seenCellIds.add(cellIdStr);

      // Populate 24-slot district array
      const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

      // Slot 0: General Electorate (numeric code from concordance)
      if (m.boundaryCode) {
        // Concordance CSV uses electorate codes (numeric strings like "01", "64")
        const gedCode = m.boundaryCode.replace(/\D/g, '');
        if (gedCode) {
          districts[0] = BigInt(gedCode);
        }
      }

      // Slot 1: Maori Electorate (numeric code from concordance)
      if (m.secondaryBoundaryCode) {
        const medCode = m.secondaryBoundaryCode.replace(/\D/g, '');
        if (medCode) {
          districts[1] = BigInt(medCode);
        }
      }

      // Skip meshblocks with no electorate assignment (e.g., offshore, non-residential)
      if (districts[0] === 0n && districts[1] === 0n) {
        skippedEmpty++;
        continue;
      }

      cellMappings.push({ cellId, districts });
    }

    logger.info(
      `NZ cell mappings: ${cellMappings.length} cells, ` +
      `${skippedEmpty} skipped (no electorate), ` +
      `${skippedDuplicate} skipped (duplicate)`
    );

    // Build the Sparse Merkle Tree
    const treeResult = await buildCellMapTree(
      cellMappings,
      NZ_JURISDICTION.recommendedDepth,
    );

    return {
      country: 'NZ',
      statisticalUnit: 'meshblock',
      cellCount: cellMappings.length,
      root: treeResult.root,
      depth: treeResult.depth,
      mappings: cellMappings,
      durationMs: Date.now() - startTime,
    };
  }

  // ==========================================================================
  // Validation (CountryProvider abstract)
  // ==========================================================================

  /**
   * Run 4-layer validation pipeline for NZ data.
   *
   * Layer 1: Source Authority — confidence scoring
   * Layer 2: Schema & Count — zod validation against NZMPSchema
   * Layer 3: Boundary Code Resolution — name-match electorate MPs
   * Layer 4: PIP Verification — geocode office addresses (if services provided)
   *
   * List MPs are excluded from Layer 3 code resolution (they have no electorate).
   */
  async validate(
    boundaries: NZElectorate[],
    officials: NZOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport> {
    // Layer 1: Source Authority
    const boundarySources = [
      ...Array.from(this.layers.values()).map(l => ({
        name: l.name,
        authority: l.authority,
        vintage: l.vintage,
      })),
    ];

    // Use officials source info — assume the first successful source is what was used
    const officialAttempts = [{
      source: this.officialsSources[0].name,
      success: true,
      durationMs: 0,
    }];

    const sourceAuthority = this.assessSourceAuthority(boundarySources, officialAttempts);

    // Layer 2: Schema & Count Validation
    // Adjust expected count based on whether list MPs are present
    const hasListMPs = officials.some(o => o.electorateType === 'list');
    const totalExpected = hasListMPs ? 65 + 7 + 51 : 65 + 7; // 123 or 72
    const schemaValidation = this.validateSchema(officials, NZMPSchema, totalExpected);

    // Layer 3: Boundary Code Resolution
    // Only check electorate MPs (general + maori), not list MPs
    const electorateMPs = officials.filter(o => o.electorateType !== 'list');
    const boundaryIndex = new Map<string, NZElectorate>();
    for (const b of boundaries) {
      boundaryIndex.set(b.name, b);
    }

    // Build alias lookup for validation (same as in resolveOfficialBoundaryCodes)
    const validationAliases = new Map<string, string>();
    for (const [oldName, newName] of Object.entries(NZ_ELECTORATE_ALIASES)) {
      validationAliases.set(normalizeBoundaryName(oldName), newName);
    }

    const codeResolution = this.resolveBoundaryCodes(
      electorateMPs,
      boundaryIndex,
      (o: NZOfficial) => {
        const name = o.electorateName ?? '';
        // Apply 2020→2025 alias so validation matches extraction behavior
        const aliased = validationAliases.get(normalizeBoundaryName(name));
        return aliased ?? name;
      },
      normalizeBoundaryName,
    );

    // Layer 4: PIP Verification
    let pipVerification: {
      confirmed: number;
      mismatched: readonly import('./country-provider-types.js').PIPDiagnostic[];
      skipped: number;
      total: number;
    };

    if (geocoder && pipCheck) {
      pipVerification = await this.verifyPIP(officials, geocoder, pipCheck);
    } else {
      // PIP services not provided — skip all
      pipVerification = {
        confirmed: 0,
        mismatched: [],
        skipped: officials.length,
        total: officials.length,
      };
    }

    return this.buildValidationReport({
      sourceAuthority,
      schemaValidation,
      codeResolution,
      pipVerification,
    });
  }

  // ==========================================================================
  // Change Detection
  // ==========================================================================

  /**
   * Check for upstream changes using ArcGIS editingInfo metadata.
   *
   * Stats NZ ArcGIS FeatureServer exposes `editingInfo.lastEditDate` (epoch ms)
   * at the service level. We query the FeatureServer root (without layer number)
   * and compare against lastExtraction.
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    try {
      // FeatureServer root URL (without layer number) exposes editingInfo
      const featureServerBase = `${this.baseUrl}/New_Zealand_Electorates__2020_and_2025__WFL1/FeatureServer`;
      const metaUrl = `${featureServerBase}?f=json`;

      const res = await fetch(metaUrl, {
        headers: { 'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return true;

      const meta = await res.json() as Record<string, unknown>;
      const editInfo = meta?.editingInfo as { lastEditDate?: number } | undefined;

      if (editInfo?.lastEditDate && typeof editInfo.lastEditDate === 'number') {
        const lastEdit = new Date(editInfo.lastEditDate);
        logger.debug('NZ ArcGIS editingInfo check', {
          lastEditDate: lastEdit.toISOString(),
          lastExtraction: lastExtraction.toISOString(),
          changed: lastEdit > lastExtraction,
        });
        return lastEdit > lastExtraction;
      }

      // editingInfo not available — fall back to feature count comparison
      const [generalConfig, maoriConfig] = [
        this.layers.get('general'),
        this.layers.get('maori'),
      ];

      if (!generalConfig || !maoriConfig) {
        return true;
      }

      const generalCount = await this.fetchFeatureCount(generalConfig.endpoint);
      const maoriCount = await this.fetchFeatureCount(maoriConfig.endpoint);

      return (
        generalCount !== generalConfig.expectedCount ||
        maoriCount !== maoriConfig.expectedCount
      );
    } catch (error) {
      logger.warn('Change detection failed, assuming changed', {
        country: 'NZ',
        error: error instanceof Error ? error.message : String(error)
      });
      // Conservative fallback: assume changed
      return true;
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Health check
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const [generalConfig, maoriConfig] = [
        this.layers.get('general'),
        this.layers.get('maori'),
      ];

      if (!generalConfig || !maoriConfig) {
        throw new Error('Layer configuration missing');
      }

      const [generalCount, maoriCount] = await Promise.all([
        this.fetchFeatureCount(generalConfig.endpoint),
        this.fetchFeatureCount(maoriConfig.endpoint),
      ]);

      if (generalCount !== generalConfig.expectedCount) {
        issues.push(`General electorate count mismatch: expected ${generalConfig.expectedCount}, got ${generalCount}`);
      }

      if (maoriCount !== maoriConfig.expectedCount) {
        issues.push(`Maori electorate count mismatch: expected ${maoriConfig.expectedCount}, got ${maoriCount}`);
      }

      const latencyMs = Date.now() - startTime;

      return {
        available: issues.length === 0,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues: [`Health check failed: ${message}`],
      };
    }
  }

  // getExpectedCounts() inherited from BaseInternationalProvider -- reads from this.layers
  // (general: 64, maori: 7). Do not override.

  // ==========================================================================
  // Private: Boundary Extraction Helpers
  // ==========================================================================

  /**
   * Extract general electorates
   */
  private async extractGeneralElectorates(): Promise<NZExtractionResult> {
    const layerConfig = this.layers.get('general');
    if (!layerConfig) {
      throw new Error('General electorate layer not configured');
    }

    const geojson = await this.fetchArcGISFeatureService(layerConfig.endpoint);

    const electorates: NZElectorate[] = geojson.features.map((feature) => {
      const props = feature.properties || {};

      return {
        id: String(props.GED2025_V1 || props.electorate_code || props.ELECTORATE_CODE || props.OBJECTID || ''),
        name: String(props['General_Electorate__2025_'] || props.GED2025__1 || props.electorate_name || props.ELECTORATE_NAME || props.name || 'Unknown'),
        type: 'general' as const,
        region: this.inferRegion(props),
        population: this.parsePopulation(props),
        geometry: feature.geometry as Polygon | MultiPolygon,
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: layerConfig.endpoint,
          vintage: layerConfig.vintage,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: props,
      };
    });

    const validationErrors = this.validateBoundaryCounts('general', electorates.length, layerConfig.expectedCount);
    const matched = electorates.length === layerConfig.expectedCount;
    const confidence = matched ? 100 : Math.max(0, 100 - (Math.abs(electorates.length - layerConfig.expectedCount) * 10));

    return {
      layer: 'general',
      boundaries: electorates,
      success: true,
      expectedCount: layerConfig.expectedCount,
      actualCount: electorates.length,
      matched,
      confidence,
      extractedAt: new Date(),
      source: layerConfig.endpoint,
      durationMs: 0,
      error: validationErrors.length > 0 ? validationErrors.join('; ') : undefined,
    };
  }

  /**
   * Extract Maori electorates
   */
  private async extractMaoriElectorates(): Promise<NZExtractionResult> {
    const layerConfig = this.layers.get('maori');
    if (!layerConfig) {
      throw new Error('Maori electorate layer not configured');
    }

    const geojson = await this.fetchArcGISFeatureService(layerConfig.endpoint);

    const electorates: NZElectorate[] = geojson.features.map((feature) => {
      const props = feature.properties || {};

      return {
        id: String(props.MED2025_V1 || props.electorate_code || props.ELECTORATE_CODE || props.OBJECTID || ''),
        name: String(props['M\u0101ori_Electorate__2025_'] || props.MED2025__1 || props.electorate_name || props.ELECTORATE_NAME || props.name || 'Unknown'),
        type: 'maori' as const,
        region: this.inferRegion(props),
        population: this.parsePopulation(props),
        geometry: feature.geometry as Polygon | MultiPolygon,
        source: {
          country: 'NZ',
          dataSource: 'Stats NZ',
          endpoint: layerConfig.endpoint,
          vintage: layerConfig.vintage,
          retrievedAt: new Date().toISOString(),
          authority: 'national-statistics',
        },
        properties: props,
      };
    });

    const validationErrors = this.validateBoundaryCounts('maori', electorates.length, layerConfig.expectedCount);
    const matched = electorates.length === layerConfig.expectedCount;
    const confidence = matched ? 100 : Math.max(0, 100 - (Math.abs(electorates.length - layerConfig.expectedCount) * 10));

    return {
      layer: 'maori',
      boundaries: electorates,
      success: true,
      expectedCount: layerConfig.expectedCount,
      actualCount: electorates.length,
      matched,
      confidence,
      extractedAt: new Date(),
      source: layerConfig.endpoint,
      durationMs: 0,
      error: validationErrors.length > 0 ? validationErrors.join('; ') : undefined,
    };
  }

  /**
   * Fetch GeoJSON from ArcGIS FeatureServer.
   * Uses base class fetchGeoJSONPaginated() for retry logic and pagination safety,
   * even though NZ's 71 features fit in a single page.
   */
  private async fetchArcGISFeatureService(endpoint: string): Promise<FeatureCollection> {
    const queryUrl = `${endpoint}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`;
    return this.fetchGeoJSONPaginated(queryUrl, 200);
  }

  /**
   * Infer region from properties
   */
  private inferRegion(props: Record<string, unknown>): NZRegion {
    const name = String(props['General_Electorate__2025_'] || props['M\u0101ori_Electorate__2025_'] || props.GED2025__1 || props.MED2025__1 || props.electorate_name || props.ELECTORATE_NAME || '').toLowerCase();
    const region = String(props.region || props.REGION || '').toLowerCase();

    if (name.includes('chatham') || region.includes('chatham')) {
      return 'Chatham Islands';
    }

    const southIslandRegions = [
      'canterbury', 'otago', 'southland', 'west coast', 'marlborough',
      'nelson', 'tasman', 'christchurch', 'dunedin', 'invercargill'
    ];

    if (southIslandRegions.some(r => region.includes(r) || name.includes(r))) {
      return 'South Island';
    }

    return 'North Island';
  }

  /**
   * Parse population from properties
   */
  private parsePopulation(props: Record<string, unknown>): number | undefined {
    const population = props.Total_Population || props.population || props.POPULATION || props.pop_2023 || props.POP_2023;

    if (typeof population === 'number') {
      return population;
    }

    if (typeof population === 'string') {
      const parsed = parseInt(population, 10);
      return isNaN(parsed) ? undefined : parsed;
    }

    return undefined;
  }

  /**
   * Validate boundary feature counts against expected
   */
  private validateBoundaryCounts(
    layerType: NZLayerType,
    actualCount: number,
    expectedCount: number
  ): string[] {
    const errors: string[] = [];

    if (actualCount !== expectedCount) {
      errors.push(
        `Count mismatch for ${layerType} electorates: expected ${expectedCount}, got ${actualCount}`
      );
    }

    if (actualCount === 0) {
      errors.push(`No ${layerType} electorates extracted`);
    }

    return errors;
  }

  /**
   * Fetch feature count from ArcGIS service
   */
  private async fetchFeatureCount(endpoint: string): Promise<number> {
    const params = new URLSearchParams({
      where: '1=1',
      returnCountOnly: 'true',
      f: 'json',
    });

    const url = `${endpoint}/query?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { count?: number };
    return data.count || 0;
  }

  // ==========================================================================
  // Private: Officials Source Chain Fetchers
  // ==========================================================================

  /**
   * Fetch NZ MPs from data.govt.nz CSV
   */
  private async fetchFromDataGovtNZ(endpoint: string): Promise<RawNZMP[]> {
    logger.info('Fetching NZ MPs from data.govt.nz CSV', { endpoint });

    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
        Accept: 'text/csv,*/*',
      },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`data.govt.nz returned HTTP ${response.status}`);
    }

    const csv = await response.text();
    const mps = parseCSV(csv);

    if (mps.length === 0) {
      throw new Error('data.govt.nz CSV returned 0 MPs');
    }

    logger.info('data.govt.nz CSV parsed', { count: mps.length });
    return mps;
  }

  /**
   * Fetch NZ MPs from Wikipedia's 54th Parliament page.
   * Wikipedia has structured tables for electorate MPs and is not behind bot protection.
   * NOTE: Wikipedia source only captures electorate MPs, not list MPs.
   */
  private async fetchFromWikipedia(endpoint: string): Promise<RawNZMP[]> {
    logger.info('Fetching NZ MPs from Wikipedia', { endpoint });

    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Wikipedia API returned HTTP ${response.status}`);
    }

    const data = await response.json() as {
      parse?: { wikitext?: { '*'?: string } };
    };

    const wikitext = data.parse?.wikitext?.['*'] ?? '';
    if (!wikitext) {
      throw new Error('Wikipedia returned empty wikitext');
    }

    const mps = parseWikipediaTables(wikitext);

    if (mps.length === 0) {
      throw new Error('Wikipedia parsing returned 0 MPs');
    }

    logger.info('Wikipedia parsed (electorate MPs only)', { count: mps.length });
    return mps;
  }

  /**
   * Fetch NZ MPs from parliament.nz HTML scraping.
   * NOTE: Currently blocked by Imperva WAF. Included as fallback of last resort.
   */
  private async fetchFromParliamentNZ(endpoint: string): Promise<RawNZMP[]> {
    logger.info('Fetching NZ MPs from parliament.nz', { endpoint });

    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VOTER-Protocol-Ingestion/1.0)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`parliament.nz returned HTTP ${response.status}`);
    }

    const html = await response.text();

    if (html.includes('Verifying your browser') || html.includes('Radware') || html.includes('Incapsula')) {
      throw new Error('parliament.nz returned bot protection page');
    }

    const mps = parseParliamentNZHTML(html);

    if (mps.length === 0) {
      throw new Error('parliament.nz HTML parsing returned 0 MPs');
    }

    logger.info('parliament.nz parsed', { count: mps.length });
    return mps;
  }

  // ==========================================================================
  // Private: Boundary Code Resolution
  // ==========================================================================

  /**
   * Convert raw MP records to NZOfficial records with boundary codes resolved.
   *
   * For electorate MPs (general/maori), matches electorateName against boundary
   * index using normalized comparison (diacritic-stripped, lowercase, trimmed).
   *
   * List MPs are included but get boundaryCode = null (no electorate to resolve).
   */
  private resolveOfficialBoundaryCodes(
    rawMPs: RawNZMP[],
    boundaryIndex: Map<string, NZElectorate>
  ): NZOfficial[] {
    // Build normalized lookup: normalized name -> boundary
    const normalizedLookup = new Map<string, NZElectorate>();
    for (const [name, boundary] of boundaryIndex) {
      normalizedLookup.set(normalizeBoundaryName(name), boundary);
    }

    // Build normalized alias lookup: normalized old name -> normalized new name
    const normalizedAliases = new Map<string, string>();
    for (const [oldName, newName] of Object.entries(NZ_ELECTORATE_ALIASES)) {
      normalizedAliases.set(normalizeBoundaryName(oldName), normalizeBoundaryName(newName));
    }

    const officials: NZOfficial[] = [];

    for (const mp of rawMPs) {
      let boundaryCode: string | null = null;
      let electorateCode: string | undefined;

      if (mp.electorate_name && mp.electorate_type !== 'list') {
        const normalizedName = normalizeBoundaryName(mp.electorate_name);
        let boundary = normalizedLookup.get(normalizedName);

        // If direct match fails, try 2020→2025 alias
        if (!boundary) {
          const aliasedName = normalizedAliases.get(normalizedName);
          if (aliasedName) {
            boundary = normalizedLookup.get(aliasedName);
            if (boundary) {
              logger.info('NZ MP matched via 2020→2025 alias', {
                mp: mp.name,
                oldElectorate: mp.electorate_name,
                newElectorate: boundary.name,
              });
            }
          }
        }

        if (boundary) {
          // Build boundary code: nz-gen-{id} or nz-maori-{id}
          const prefix = boundary.type === 'maori' ? 'nz-maori' : 'nz-gen';
          boundaryCode = `${prefix}-${boundary.id}`;
          electorateCode = boundaryCode;
        } else {
          logger.warn('NZ MP electorate not matched to boundary', {
            mp: mp.name,
            electorate: mp.electorate_name,
            type: mp.electorate_type,
          });
        }
      }

      officials.push({
        id: mp.parliament_id,
        name: mp.name,
        firstName: mp.first_name ?? undefined,
        lastName: mp.last_name ?? undefined,
        party: mp.party,
        boundaryName: mp.electorate_name ?? '',
        boundaryCode,
        email: mp.email ?? undefined,
        isActive: true,
        parliamentId: mp.parliament_id,
        electorateName: mp.electorate_name ?? undefined,
        electorateCode,
        electorateType: mp.electorate_type,
      });
    }

    return officials;
  }
}

// ============================================================================
// Backward Compatibility Alias
// ============================================================================

/**
 * Backward compatibility alias.
 * New code should use NZCountryProvider directly.
 */
export const NewZealandBoundaryProvider = NZCountryProvider;
