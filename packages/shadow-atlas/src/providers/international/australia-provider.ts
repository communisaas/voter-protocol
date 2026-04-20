/**
 * Australia Country Provider
 *
 * Unified provider for Australian electoral boundaries AND officials.
 * Extends CountryProvider (Wave 1 contract) with:
 * - Boundary extraction from ABS ArcGIS (existing)
 * - Officials extraction from APH (CSV primary, HTML scrape fallback)
 * - Cell map stub (SA1 integration is Wave 3)
 * - 4-layer validation pipeline
 *
 * DATA SOURCES:
 * - Boundaries: Australian Bureau of Statistics (ABS) — ArcGIS REST (CED 2024)
 * - Officials (priority 1): APH CSV download — Parliamentarian Search Results export
 * - Officials (priority 2): APH HTML scraping — Paginated search result pages
 *
 * COVERAGE:
 * - Federal Electoral Divisions: 151 (2021 redistribution, ABS CED 2024)
 * - House of Representatives: 151 members
 *
 * LICENSE: Creative Commons Attribution 4.0 (CC-BY-4.0)
 *
 * @see country-provider.ts for the abstract CountryProvider class
 * @see country-provider-types.ts for OfficialRecord, AustralianMPSchema, etc.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { CountryProvider } from './country-provider.js';
import type {
  InternationalExtractionResult,
  LayerConfig,
  LayerExtractionResult,
  InternationalBoundary,
  BoundarySource,
  ProviderHealth,
} from './base-provider.js';
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
import { AustralianMPSchema } from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Australia-Specific Types
// ============================================================================

/**
 * Australia layer types
 */
export type AustraliaLayerType = 'federal';

/**
 * Australia state/territory codes (ISO 3166-2:AU)
 */
export type AustraliaState =
  | 'NSW' // New South Wales
  | 'VIC' // Victoria
  | 'QLD' // Queensland
  | 'SA'  // South Australia
  | 'WA'  // Western Australia
  | 'TAS' // Tasmania
  | 'NT'  // Northern Territory
  | 'ACT'; // Australian Capital Territory

/**
 * Australia federal electoral division
 */
export interface AustraliaDivision extends InternationalBoundary {
  /** Electoral division code (e.g., 'NSW01' for first NSW division) */
  readonly id: string;

  /** Division name (e.g., 'Banks', 'Barton', 'Bradfield') */
  readonly name: string;

  /** Boundary type (always 'federal') */
  readonly type: 'federal';

  /** State/territory code */
  readonly state: AustraliaState;

  /** Population (from latest census) */
  readonly population?: number;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: BoundarySource & {
    readonly country: 'AU';
  };

  /** Original properties from AEC */
  readonly properties: Record<string, unknown>;
}

/**
 * Australia extraction result
 */
export interface AustraliaExtractionResult extends LayerExtractionResult<AustraliaLayerType, AustraliaDivision> {
  readonly layer: 'federal';
}

/**
 * Australian MP official record — extends OfficialRecord with AU-specific fields
 */
export interface AUOfficial extends OfficialRecord {
  /** APH parliamentarian ID (e.g., "R36") */
  readonly aphId: string;

  /** Electoral division name (e.g., "Grayndler") */
  readonly divisionName: string;

  /** Division code matching boundary ID (e.g., "101" from CED_CODE_2024) */
  readonly divisionCode: string | undefined;

  /** State/territory code (ISO 3166-2:AU) */
  readonly state: AustraliaState;
}

// ============================================================================
// State Name/Code Mapping
// ============================================================================

const STATE_MAP: Record<string, AustraliaState> = {
  'new south wales': 'NSW',
  'nsw': 'NSW',
  'victoria': 'VIC',
  'vic': 'VIC',
  'queensland': 'QLD',
  'qld': 'QLD',
  'south australia': 'SA',
  'sa': 'SA',
  'western australia': 'WA',
  'wa': 'WA',
  'tasmania': 'TAS',
  'tas': 'TAS',
  'northern territory': 'NT',
  'nt': 'NT',
  'australian capital territory': 'ACT',
  'act': 'ACT',
};

function normalizeState(raw: string): AustraliaState | undefined {
  return STATE_MAP[raw.toLowerCase().trim()];
}

// ============================================================================
// HTML Parser (from ingest-au-mps.ts — lightweight, no external dependency)
// ============================================================================

interface RawAustralianMP {
  aphId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  party: string;
  divisionName: string;
  state: string;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
}

/**
 * Parse APH search results HTML page into structured MP records.
 *
 * APH HTML structure (2026):
 * ```html
 * <div class="row border-bottom padding-top">
 *   <h4><a href="/Senators_and_Members/Parliamentarian?MPID=XXX">NAME MP</a></h4>
 *   <dl>
 *     <dt>For</dt><dd>ELECTORATE, STATE</dd>
 *     <dt>Party</dt><dd>PARTY NAME</dd>
 *     <dd><a href="mailto:...">...</a></dd>
 *   </dl>
 * </div>
 * ```
 */
function parseSearchPage(html: string): RawAustralianMP[] {
  const members: RawAustralianMP[] = [];
  const sections = html.split(/(?=<div\s+class="row\s+border-bottom)/);

  for (const section of sections) {
    const localMatch = /href="\/Senators_and_Members\/Parliamentarian\?MPID=([^"]+)"[^>]*>([^<]+)<\/a>/i.exec(section);
    if (!localMatch) continue;

    const aphId = localMatch[1].trim();
    let rawName = localMatch[2].trim();
    rawName = rawName.replace(/\s+MP$/i, '').trim();
    rawName = rawName.replace(/^(?:Hon\.?\s+|Rt\.?\s+Hon\.?\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Dr\.?\s+|Prof\.?\s+)+/i, '').trim();

    const electorateMatch = /<dt>For<\/dt>\s*<dd>([^<]+)<\/dd>/i.exec(section);
    let divisionName = '';
    let state = '';

    if (electorateMatch) {
      const parts = electorateMatch[1].split(',').map(s => s.trim());
      divisionName = parts[0] || '';
      state = parts.length > 1 ? (normalizeState(parts[1]) ?? parts[1].trim()) : '';
    }

    const partyMatch = /<dt>Party<\/dt>\s*<dd>([^<]+)<\/dd>/i.exec(section);
    let party = '';
    if (partyMatch) {
      party = partyMatch[1].trim();
    }

    const emailMatch = /href="mailto:([^"]+)"/i.exec(section);
    const email = emailMatch ? emailMatch[1].trim() : null;

    const phoneMatch = /(?:Tel|Phone|Ph)[:\s]*([0-9()\s\-+]+)/i.exec(section);
    const phone = phoneMatch ? phoneMatch[1].trim() : null;

    const photoMatch = /src="(\/api\/parliamentarian\/[^"]+\/image[^"]*)"/i.exec(section);
    const photoUrl = photoMatch ? `https://www.aph.gov.au${photoMatch[1]}` : null;

    const nameParts = rawName.split(' ');
    const firstName = nameParts.length > 1 ? nameParts[0] : rawName;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    if (divisionName && party) {
      members.push({
        aphId,
        name: rawName,
        firstName,
        lastName,
        party,
        divisionName,
        state,
        email,
        phone,
        photoUrl,
      });
    }
  }

  return members;
}

function parseTotalResults(html: string): number {
  const match = /of\s+(\d+)\s+results/i.exec(html);
  return match ? parseInt(match[1], 10) : 0;
}

// ============================================================================
// CSV Parser (APH CSV download — primary source)
// ============================================================================

/**
 * Parse APH CSV export into structured MP records.
 *
 * The APH Parliamentarian Search export CSV includes fields such as:
 * Title, Surname, First Name, Electorate, State, Party, Email, Phone, etc.
 *
 * We handle both quoted and unquoted CSV fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseAPHCSV(csvText: string): RawAustralianMP[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

  // Find column indices by common APH CSV header names
  const find = (candidates: string[]): number =>
    headers.findIndex(h => candidates.some(c => h.includes(c)));

  const surnameIdx = find(['surname', 'last_name', 'family_name']);
  const firstNameIdx = find(['first_name', 'given_name', 'firstname']);
  const titleIdx = find(['title', 'salutation']);
  const electorateIdx = find(['electorate', 'division', 'electoral_division']);
  const stateIdx = find(['state', 'state_territory']);
  const partyIdx = find(['party', 'political_party']);
  const emailIdx = find(['email', 'e_mail']);
  const phoneIdx = find(['phone', 'telephone']);
  const idIdx = find(['mpid', 'parliamentarian_id', 'id', 'member_id']);

  if (surnameIdx === -1 || electorateIdx === -1 || partyIdx === -1) {
    throw new Error('APH CSV missing required columns (surname, electorate, party)');
  }

  const members: RawAustralianMP[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < Math.max(surnameIdx, electorateIdx, partyIdx) + 1) continue;

    const surname = fields[surnameIdx] || '';
    const firstName = firstNameIdx >= 0 ? (fields[firstNameIdx] || '') : '';
    const name = firstName ? `${firstName} ${surname}` : surname;
    const divisionName = fields[electorateIdx] || '';
    const rawState = stateIdx >= 0 ? (fields[stateIdx] || '') : '';
    const state = normalizeState(rawState) ?? rawState.trim();
    const party = fields[partyIdx] || '';
    const email = emailIdx >= 0 ? (fields[emailIdx] || null) : null;
    const phone = phoneIdx >= 0 ? (fields[phoneIdx] || null) : null;

    // Build a stable ID: prefer the CSV's own ID, else derive from name
    let aphId = idIdx >= 0 ? (fields[idIdx] || '') : '';
    if (!aphId) {
      aphId = `aph-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
    }

    if (divisionName && party && surname) {
      members.push({
        aphId,
        name: name.trim(),
        firstName: firstName || null,
        lastName: surname || null,
        party: party.trim(),
        divisionName: divisionName.trim(),
        state,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        photoUrl: null,
      });
    }
  }

  return members;
}

// ============================================================================
// Rate limiter for HTML scraping
// ============================================================================

function rateLimitedDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Australia Country Provider
// ============================================================================

/**
 * Australia Country Provider
 *
 * Unified provider for AU electoral boundaries and House of Representatives officials.
 * Extends CountryProvider with source chain for officials (APH CSV + HTML fallback).
 */
export class AustraliaCountryProvider extends CountryProvider<
  AustraliaLayerType,
  AustraliaDivision,
  AUOfficial
> {
  readonly country = 'AU';
  readonly countryName = 'Australia';
  readonly dataSource = 'AEC (Australian Electoral Commission)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'CC-BY-4.0';

  private readonly baseUrl =
    'https://geo.abs.gov.au/arcgis/rest/services';

  // ==========================================================================
  // CountryProvider abstract properties
  // ==========================================================================

  /** Officials sources in priority order (source chain) */
  readonly officialsSources: readonly SourceConfig[] = [
    {
      name: 'APH CSV Download',
      endpoint: 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results?q=&mem=1&par=-1&gen=0&ps=0&st=1',
      authority: 'electoral-commission',
      priority: 1,
    },
    {
      name: 'APH HTML Scraping',
      endpoint: 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results',
      authority: 'electoral-commission',
      priority: 2,
    },
  ];

  /** Expected 151 House of Representatives members */
  readonly expectedOfficialCounts: ReadonlyMap<string, number> = new Map([
    ['house-of-representatives', 151],
  ]);

  /** Statistical geography unit for Tree 2 cell maps */
  readonly statisticalUnit: StatisticalUnitType = 'sa1';

  // ==========================================================================
  // Boundary layer configuration
  // ==========================================================================

  /**
   * Available boundary layers
   *
   * Uses ABS (Australian Bureau of Statistics) CED layer which includes state codes.
   * The aus_digitalatlas 2025 endpoint lacks state fields.
   * ABS 2024 has 169 records but includes "No usual address" and "Outside Australia"
   * entries — these are filtered out during normalization (codes >= 900).
   */
  readonly layers = new Map<AustraliaLayerType, LayerConfig<AustraliaLayerType>>([
    [
      'federal',
      {
        type: 'federal',
        name: 'CED (2024) ASGS Ed. 3',
        endpoint: `${this.baseUrl}/ASGS2024/CED/FeatureServer/0`,
        // Corrected from 150 to 151 (2021 redistribution added Bean).
        expectedCount: 151,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2024,
        lastVerified: '2026-03-10',
        notes: 'ABS ASGS Ed. 3 — includes state codes; filter codes >= 900',
      },
    ],
  ]);

  // ==========================================================================
  // Boundary Extraction (existing logic preserved)
  // ==========================================================================

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<AustraliaLayerType, AustraliaDivision>> {
    const startTime = Date.now();
    const federal = await this.extractFederalDivisions();

    return {
      country: this.country,
      layers: [federal],
      totalBoundaries: federal.actualCount,
      successfulLayers: federal.success ? 1 : 0,
      failedLayers: federal.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '2.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract a specific layer
   */
  async extractLayer(layerType: AustraliaLayerType): Promise<AustraliaExtractionResult> {
    if (layerType === 'federal') {
      return this.extractFederalDivisions();
    }

    throw new Error(`Unknown layer type: ${layerType}`);
  }

  /**
   * Extract federal electoral divisions
   */
  async extractFederalDivisions(): Promise<AustraliaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal');
    if (!layer) {
      throw new Error('Federal layer not configured');
    }

    try {
      logger.info('Extracting federal electoral divisions', { country: 'Australia' });
      const geojson = await this.fetchGeoJSONPaginated(
        `${layer.endpoint}/query?where=1%3D1&outFields=*&f=geojson`,
        200, 169, 0.0001
      );
      const divisions = this.normalizeDivisions(geojson, layer);
      const durationMs = Date.now() - startTime;

      const confidence = this.calculateConfidence(
        divisions.length,
        layer.expectedCount,
        layer.vintage,
        layer.authority
      );

      logger.info('Federal extraction complete', {
        country: 'Australia',
        divisionCount: divisions.length,
        expectedCount: layer.expectedCount,
        durationMs,
        confidence
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: divisions,
        expectedCount: layer.expectedCount,
        actualCount: divisions.length,
        matched: divisions.length === layer.expectedCount,
        confidence,
        extractedAt: new Date(),
        source: layer.endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Federal extraction failed', { country: 'Australia', error: message });

      return this.createFailedResult('federal', message, layer.expectedCount, layer.endpoint, startTime);
    }
  }

  /**
   * Extract divisions for a specific state/territory
   *
   * @param stateCode - State/territory code (ISO 3166-2:AU)
   * @returns Divisions for the specified state
   */
  async extractByState(stateCode: AustraliaState): Promise<AustraliaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal');
    if (!layer) {
      throw new Error('Federal layer not configured');
    }

    try {
      logger.info('Extracting federal divisions by state', { country: 'Australia', state: stateCode });
      const allDivisions = await this.extractFederalDivisions();
      const stateDivisions = allDivisions.boundaries.filter((d) => d.state === stateCode);
      const durationMs = Date.now() - startTime;

      logger.info('State extraction complete', {
        country: 'Australia',
        state: stateCode,
        divisionCount: stateDivisions.length,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: stateDivisions,
        expectedCount: stateDivisions.length,
        actualCount: stateDivisions.length,
        matched: true,
        confidence: 100,
        extractedAt: new Date(),
        source: layer.endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('State extraction failed', { country: 'Australia', state: stateCode, error: message });

      return this.createFailedResult('federal', message, 0, layer.endpoint, startTime);
    }
  }

  /**
   * Check if data has changed since last extraction using ArcGIS editingInfo.
   *
   * ABS ArcGIS FeatureServer exposes `editingInfo.lastEditDate` (epoch ms)
   * at the layer level. Compare against lastExtraction date.
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    try {
      const layer = this.layers.get('federal');
      if (!layer) return true;

      const metadataUrl = `${layer.endpoint}?f=json`;
      // Block redirects to prevent SSRF.
      const res = await fetch(metadataUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });

      if (!res.ok) return true;

      const data = await res.json() as {
        editingInfo?: { lastEditDate?: number };
      };

      if (data.editingInfo?.lastEditDate && typeof data.editingInfo.lastEditDate === 'number') {
        const lastEdit = new Date(data.editingInfo.lastEditDate);
        logger.debug('AU ArcGIS editingInfo check', {
          lastEditDate: lastEdit.toISOString(),
          lastExtraction: lastExtraction.toISOString(),
          changed: lastEdit > lastExtraction,
        });
        return lastEdit > lastExtraction;
      }

      // editingInfo not available — fall back to HTTP headers
      return super.hasChangedSince(lastExtraction);
    } catch (error) {
      logger.warn('Change detection failed, assuming changed', {
        country: 'AU',
        error: error instanceof Error ? error.message : String(error),
      });
      // Conservative fallback
      return true;
    }
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const layer = this.layers.get('federal');
      if (!layer) {
        issues.push('Federal layer not configured');
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      const metadataUrl = `${layer.endpoint}?f=json`;
      // Block redirects to prevent SSRF.
      const response = await fetch(metadataUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });

      if (!response.ok) {
        issues.push(`HTTP ${response.status}: ${response.statusText}`);
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      const metadata = (await response.json()) as {
        count?: number;
        name?: string;
      };
      const latencyMs = Date.now() - startTime;

      if (metadata.count === 0) {
        issues.push('Service reports zero features');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to connect: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  // ==========================================================================
  // Officials Extraction (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Extract Australian House of Representatives members.
   *
   * Source chain:
   * 1. APH CSV download (structured export, most reliable)
   * 2. APH HTML scraping (paginated search results, fallback)
   *
   * Boundary code resolution happens at extraction time via the boundary index.
   * Each official's divisionName is matched against boundary names to resolve
   * the boundary code. Unresolved officials are still returned (with null
   * boundaryCode) and flagged in validation diagnostics.
   *
   * @param boundaryIndex - Map of boundary name -> boundary object
   */
  async extractOfficials(
    boundaryIndex: Map<string, AustraliaDivision>
  ): Promise<OfficialsExtractionResult<AUOfficial>> {
    const startTime = Date.now();

    const { result: rawMPs, source, attempts } = await this.trySourceChain(
      this.officialsSources,
      async (sourceConfig) => {
        if (sourceConfig.priority === 1) {
          return this.fetchFromCSV(sourceConfig.endpoint);
        } else {
          return this.fetchFromHTML(sourceConfig.endpoint);
        }
      }
    );

    // Resolve boundary codes at extraction time
    const officials = this.resolveOfficialBoundaryCodes(rawMPs, boundaryIndex);

    const expectedCount = this.expectedOfficialCounts.get('house-of-representatives') ?? 151;
    const durationMs = Date.now() - startTime;

    logger.info('AU officials extraction complete', {
      source: source.name,
      count: officials.length,
      expectedCount,
      durationMs,
    });

    return {
      country: this.country,
      officials,
      expectedCount,
      actualCount: officials.length,
      matched: officials.length === expectedCount,
      confidence: officials.length >= expectedCount * 0.8 ? 90 : 60,
      sources: attempts,
      extractedAt: new Date(),
      durationMs,
    };
  }

  // ==========================================================================
  // Cell Map (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Concordance URL — ABS ASGS Ed. 3 correspondences ZIP on data.gov.au.
   * Contains CG_SA1_2021_CED_2021.csv (SA1 → CED 2021 correspondence).
   * We also chain through CG_CED_2021_CED_2024.csv to get 2024 CED codes.
   *
   * The ZIP is ~34MB but only downloaded once and cached.
   */
  private readonly concordanceZipUrl =
    'https://data.gov.au/data/dataset/2c79581f-600e-4560-80a8-98adb1922dfc/resource/33d822ba-138e-47ae-a15f-460279c3acc3/download/asgs2021_correspondences.zip';

  /**
   * Build cell map for Tree 2 using ABS SA1 statistical areas.
   *
   * Pipeline:
   * 1. Download ABS ASGS correspondences ZIP (cached)
   * 2. Extract CG_SA1_2021_CED_2021.csv — SA1→CED 2021 correspondence
   * 3. Extract CG_CED_2021_CED_2024.csv — CED 2021→CED 2024 recode
   * 4. Chain SA1→CED2021→CED2024 for current electoral division codes
   * 5. Derive state code from SA1 code (first digit)
   * 6. Build 24-slot district arrays (slot 0 = CED, slot 1 = state)
   * 7. Build sparse Merkle tree via buildCellMapTree()
   *
   * ABS correspondence CSV columns:
   *   SA1_MAINCODE_2021, CED_MAINCODE_2021, RATIO_FROM_TO, ...
   *   (RATIO_FROM_TO = population-weighted fraction; we use plurality)
   *
   * @param _boundaries - Federal division boundaries (used for validation only)
   */
  async buildCellMap(
    _boundaries: AustraliaDivision[]
  ): Promise<CellMapResult> {
    const startTime = Date.now();
    const { loadConcordance } = await import('../../hydration/concordance-loader.js');
    const { AU_JURISDICTION } = await import('../../jurisdiction.js');
    const { buildCellMapTree, DISTRICT_SLOT_COUNT } = await import('../../tree-builder.js');

    // Step 1: Load SA1→CED concordance
    // The concordance-loader fetches and caches the CSV.
    // For ABS data, the correspondences ZIP must be downloaded and
    // the CSV extracted. We handle this by pre-extracting to cache
    // or by providing a direct CSV URL if available.
    //
    // Since ABS only publishes the correspondence as a ZIP, we attempt
    // to load from cache first. If not cached, we download the ZIP,
    // extract the needed CSV, and cache it.
    const cacheDir = 'data/country-cache/au';
    const sa1CedCsv = await this.loadSA1CEDConcordance(cacheDir);

    logger.info(
      `AU concordance loaded: ${sa1CedCsv.rowCount} SA1→CED mappings, ` +
      `columns: [${sa1CedCsv.columns.join(', ')}], ` +
      `fromCache: ${sa1CedCsv.fromCache}`
    );

    // Step 2: Convert to CellDistrictMapping[]
    const cellMappings: import('../../tree-builder.js').CellDistrictMapping[] = [];
    const seenCellIds = new Set<string>();
    let skippedEmpty = 0;
    let skippedDuplicate = 0;
    let skippedNonGeographic = 0;

    // ABS state code map: first digit of SA1 code → state number
    // SA1 codes: first digit = state (1=NSW, 2=VIC, 3=QLD, 4=SA, 5=WA, 6=TAS, 7=NT, 8=ACT, 9=Other)
    for (const m of sa1CedCsv.mappings) {
      const sa1Code = m.unitId;
      const cedCode = m.boundaryCode;

      // Filter non-geographic CED codes (>= 900)
      const cedNum = parseInt(cedCode, 10);
      if (isNaN(cedNum) || cedNum >= 900) {
        skippedNonGeographic++;
        continue;
      }

      // Encode SA1 code as cell ID
      const cellId = AU_JURISDICTION.encodeCellId(sa1Code);
      const cellIdStr = cellId.toString();

      if (seenCellIds.has(cellIdStr)) {
        skippedDuplicate++;
        continue;
      }
      seenCellIds.add(cellIdStr);

      // Populate 24-slot district array
      const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

      // Slot 0: Federal Division (CED code, numeric)
      if (cedCode) {
        const cleanCode = cedCode.replace(/\D/g, '');
        if (cleanCode) {
          districts[0] = BigInt(cleanCode);
        }
      }

      // Slot 1: State/Territory code (derived from SA1 code first digit)
      // ABS SA1 codes start with state digit: 1=NSW, 2=VIC, ..., 8=ACT
      const stateDigit = sa1Code.charAt(0);
      if (/^[1-8]$/.test(stateDigit)) {
        districts[1] = BigInt(stateDigit);
      }

      // Skip SA1s with no CED assignment
      if (districts[0] === 0n) {
        skippedEmpty++;
        continue;
      }

      cellMappings.push({ cellId, districts });
    }

    logger.info(
      `AU cell mappings: ${cellMappings.length} cells, ` +
      `${skippedEmpty} skipped (no CED), ` +
      `${skippedDuplicate} skipped (duplicate), ` +
      `${skippedNonGeographic} skipped (non-geographic CED >= 900)`
    );

    // Step 3: Build the Sparse Merkle Tree
    const treeResult = await buildCellMapTree(
      cellMappings,
      AU_JURISDICTION.recommendedDepth,
    );

    return {
      country: 'AU',
      statisticalUnit: 'sa1',
      cellCount: cellMappings.length,
      root: treeResult.root,
      depth: treeResult.depth,
      mappings: cellMappings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Load the SA1→CED concordance CSV.
   *
   * ABS publishes correspondences in a large ZIP file. This method:
   * 1. Checks for a cached extracted CSV
   * 2. If not cached, downloads the ZIP and extracts the needed CSV
   * 3. Parses via the standard concordance loader
   *
   * The ABS correspondence CSV format uses columns:
   *   SA1_MAINCODE_2021, SA1_NAME, CED_MAINCODE_2021, CED_NAME,
   *   RATIO_FROM_TO, INDIV_TO_REGION_QLTY_INDICATOR, ...
   *
   * For SA1s that span multiple CEDs, we use plurality assignment
   * (highest RATIO_FROM_TO value).
   */
  private async loadSA1CEDConcordance(
    cacheDir: string,
  ): Promise<import('../../hydration/concordance-loader.js').ConcordanceResult> {
    const { existsSync, mkdirSync } = await import('fs');
    const { writeFile, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { loadConcordance } = await import('../../hydration/concordance-loader.js');

    const csvFilename = 'au-sa1-ced-2021.csv';
    const csvPath = join(cacheDir, csvFilename);

    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // If cached CSV exists, load it directly
    if (!existsSync(csvPath)) {
      // Download the ZIP and extract the SA1→CED CSV
      logger.info('Downloading ABS ASGS correspondences ZIP...', {
        url: this.concordanceZipUrl,
      });

      // Block redirects to prevent SSRF.
      const response = await fetch(this.concordanceZipUrl, {
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (civic data, research)',
        },
        signal: AbortSignal.timeout(120000), // 2 min timeout for large file
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(
          `Failed to download ABS correspondences ZIP: ${response.status} ${response.statusText}`
        );
      }

      const zipBuffer = Buffer.from(await response.arrayBuffer());

      // Extract CSV from ZIP using built-in zlib
      // ZIP format: scan for the target filename in the central directory
      const csvContent = await this.extractCSVFromZip(
        zipBuffer,
        'CG_SA1_2021_CED_2021.csv',
      );

      if (!csvContent) {
        throw new Error(
          'CG_SA1_2021_CED_2021.csv not found in ABS correspondences ZIP'
        );
      }

      // Pre-process: resolve SA1s that span multiple CEDs using plurality
      const resolvedCsv = this.resolvePluralityCED(csvContent);

      await writeFile(csvPath, resolvedCsv, 'utf-8');
      logger.info('AU SA1→CED concordance extracted and cached', {
        path: csvPath,
      });
    }

    // Load via standard concordance loader
    return loadConcordance(
      {
        url: `file://${csvPath}`, // URL unused since file is already cached
        unitColumn: 'SA1_MAINCODE_2021',
        boundaryColumn: 'CED_MAINCODE_2021',
        cacheFilename: csvFilename,
      },
      cacheDir,
    );
  }

  /**
   * Extract a named CSV file from a ZIP buffer.
   *
   * Implements minimal ZIP parsing (local file headers) without external
   * dependencies. Handles both stored and deflated entries.
   */
  private async extractCSVFromZip(
    zipBuffer: Buffer,
    targetFilename: string,
  ): Promise<string | null> {
    const { inflateRawSync } = await import('zlib');

    let offset = 0;
    while (offset < zipBuffer.length - 4) {
      // Local file header signature: 0x04034b50
      const sig = zipBuffer.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;

      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
      const filenameLen = zipBuffer.readUInt16LE(offset + 26);
      const extraLen = zipBuffer.readUInt16LE(offset + 28);

      const filename = zipBuffer.toString('utf-8', offset + 30, offset + 30 + filenameLen);
      const dataStart = offset + 30 + filenameLen + extraLen;

      // R66-C2: Reject path traversal entries (zip-slip defense-in-depth)
      if (filename.includes('..') || filename.startsWith('/')) {
        offset = dataStart + compressedSize;
        continue;
      }

      // Match only the basename to prevent directory prefix confusion
      const basename = filename.split('/').pop() ?? '';
      if (basename === targetFilename) {
        const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          return compressedData.toString('utf-8');
        } else if (compressionMethod === 8) {
          // Deflated
          // Decompression bomb protection
          const decompressed = inflateRawSync(compressedData, { maxOutputLength: 500 * 1024 * 1024 });
          return decompressed.toString('utf-8');
        } else {
          throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
        }
      }

      offset = dataStart + compressedSize;
    }

    return null;
  }

  /**
   * Resolve SA1s that span multiple CEDs to their plurality CED.
   *
   * ABS correspondence files include RATIO_FROM_TO for split SA1s.
   * For each SA1, we keep the CED with the highest ratio.
   *
   * Input CSV columns: SA1_MAINCODE_2021, ..., CED_MAINCODE_2021, ..., RATIO_FROM_TO, ...
   * Output CSV: same columns but with only one row per SA1 (highest ratio).
   */
  private resolvePluralityCED(csvContent: string): string {
    const lines = csvContent.split(/\r?\n/);
    if (lines.length < 2) return csvContent;

    const headerLine = lines[0].replace(/^\uFEFF/, '');
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const sa1Idx = headers.findIndex(h => h === 'SA1_MAINCODE_2021');
    const cedIdx = headers.findIndex(h => h === 'CED_MAINCODE_2021');
    const ratioIdx = headers.findIndex(h => h === 'RATIO_FROM_TO');

    if (sa1Idx === -1 || cedIdx === -1) {
      // Column names might differ; return as-is and let the loader handle it
      logger.warn('AU correspondence CSV has unexpected column names', {
        columns: headers,
      });
      return csvContent;
    }

    // Group by SA1, keep row with highest ratio
    const sa1Best = new Map<string, { line: string; ratio: number }>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split(',').map(f => f.trim().replace(/^"|"$/g, ''));
      const sa1 = fields[sa1Idx];
      const ratio = ratioIdx >= 0 ? parseFloat(fields[ratioIdx]) : 1.0;

      if (!sa1) continue;

      const existing = sa1Best.get(sa1);
      if (!existing || ratio > existing.ratio) {
        sa1Best.set(sa1, { line, ratio });
      }
    }

    // Reconstruct CSV with only plurality rows
    const resultLines = [headerLine];
    for (const { line } of sa1Best.values()) {
      resultLines.push(line);
    }

    return resultLines.join('\n');
  }

  // ==========================================================================
  // Validation (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Run 4-layer validation pipeline for AU data.
   *
   * Layers:
   * 1. Source Authority — confidence scoring from boundary + officials sources
   * 2. Schema & Count — zod validation (AustralianMPSchema) + 80% threshold
   * 3. Boundary Code Resolution — name-match officials against boundary index
   * 4. PIP Verification — geocode office addresses, check containment (optional)
   */
  async validate(
    boundaries: AustraliaDivision[],
    officials: AUOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport> {
    const federalLayer = this.layers.get('federal');

    // Layer 1: Source Authority
    const boundarySources = federalLayer ? [{
      name: federalLayer.name,
      authority: federalLayer.authority,
      vintage: federalLayer.vintage,
    }] : [];

    // Build source attempts from officials sources that succeeded
    // (we use the successful source name to look up authority)
    const officialAttempts = this.officialsSources.map(s => ({
      source: s.name,
      success: true, // At validation time, we already have officials
      durationMs: 0,
    })).slice(0, 1); // Only the first (successful) source

    const sourceAuthority = this.assessSourceAuthority(boundarySources, officialAttempts);

    // Layer 2: Schema & Count Validation
    const expectedCount = this.expectedOfficialCounts.get('house-of-representatives') ?? 151;
    const schemaValidation = this.validateSchema(officials, AustralianMPSchema, expectedCount);

    // Layer 3: Boundary Code Resolution
    const boundaryIndex = new Map<string, AustraliaDivision>();
    for (const b of boundaries) {
      boundaryIndex.set(b.name, b);
    }
    const codeResolution = this.resolveBoundaryCodes(
      officials,
      boundaryIndex,
      (o: AUOfficial) => o.divisionName,
      (name: string) => name.toLowerCase().trim(),
    );

    // Layer 4: PIP Verification (optional — diagnostic only)
    let pipVerification: ValidationReport['layers']['pipVerification'];
    if (geocoder && pipCheck) {
      pipVerification = await this.verifyPIP(officials, geocoder, pipCheck);
    } else {
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
  // Private: Officials Data Fetching
  // ==========================================================================

  /**
   * Fetch officials from APH CSV download.
   *
   * The APH search page at the given URL has a CSV export link. We attempt
   * to fetch the CSV format directly by requesting with appropriate headers.
   *
   * If a true CSV download URL is not available, we request the search page
   * with an export parameter. The APH CSV contains columns: Title, Surname,
   * First Name, Electorate, State, Party, Email, Phone, etc.
   */
  private async fetchFromCSV(endpoint: string): Promise<RawAustralianMP[]> {
    logger.info('Fetching AU MPs from APH CSV', { endpoint });

    // APH provides CSV export via the same search URL with different parameters/headers
    // Try the export/download variation
    const csvUrl = `${endpoint}&csv=1`;

    // Block redirects to prevent SSRF.
    const response = await fetch(csvUrl, {
      headers: {
        Accept: 'text/csv, application/csv, */*',
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
      },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`APH CSV download HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    // Verify we got actual CSV (not HTML redirect)
    if (contentType.includes('text/html') || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('APH CSV endpoint returned HTML instead of CSV — export format may have changed');
    }

    const members = parseAPHCSV(text);

    if (members.length < 100) {
      throw new Error(
        `APH CSV sanity check failed: only ${members.length} MPs parsed (expected ~151). ` +
        `CSV format may have changed.`
      );
    }

    logger.info('APH CSV parsed', { count: members.length });
    return members;
  }

  /**
   * Fetch officials from APH HTML scraping (fallback).
   *
   * Paginates through the APH Parliamentarian Search Results HTML pages,
   * extracting MP records from the search result markup.
   *
   * Rate-limited to 1 request/second for government website courtesy.
   */
  private async fetchFromHTML(baseEndpoint: string): Promise<RawAustralianMP[]> {
    logger.info('Fetching AU MPs from APH HTML scraping', { endpoint: baseEndpoint });

    const allMembers: RawAustralianMP[] = [];
    const seen = new Set<string>();
    const rateLimitMs = 1000;

    // First page with House of Representatives filter
    const firstUrl = `${baseEndpoint}?q=&mem=1&par=-1&gen=0&ps=0&st=1`;

    // Block redirects to prevent SSRF.
    const firstResponse = await fetch(firstUrl, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
      },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });

    if (!firstResponse.ok) {
      throw new Error(`APH HTML HTTP ${firstResponse.status}: ${firstResponse.statusText}`);
    }

    const firstHtml = await firstResponse.text();
    const totalResults = parseTotalResults(firstHtml);

    logger.info('APH HTML first page', { totalResults });

    const firstPageMembers = parseSearchPage(firstHtml);
    for (const m of firstPageMembers) {
      if (!seen.has(m.aphId)) {
        allMembers.push(m);
        seen.add(m.aphId);
      }
    }

    // Paginate through remaining pages
    const pageSize = Math.max(firstPageMembers.length, 12);
    const totalPages = Math.ceil(totalResults / pageSize);

    for (let p = 2; p <= totalPages; p++) {
      await rateLimitedDelay(rateLimitMs);
      const pageUrl = `${baseEndpoint}?q=&mem=1&par=-1&gen=0&ps=0&st=1&page=${p}`;

      try {
        // Block redirects to prevent SSRF.
        const response = await fetch(pageUrl, {
          headers: {
            Accept: 'text/html',
            'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
          },
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });

        if (!response.ok) {
          logger.warn('APH HTML page failed', { page: p, status: response.status });
          continue;
        }

        const html = await response.text();
        const pageMembers = parseSearchPage(html);
        for (const m of pageMembers) {
          if (!seen.has(m.aphId)) {
            allMembers.push(m);
            seen.add(m.aphId);
          }
        }
      } catch (err) {
        logger.warn('APH HTML page fetch error', {
          page: p,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (allMembers.length < 100) {
      throw new Error(
        `APH HTML sanity check failed: only ${allMembers.length} MPs parsed (expected ~151). ` +
        `Website structure may have changed.`
      );
    }

    logger.info('APH HTML scraping complete', { count: allMembers.length });
    return allMembers;
  }

  // ==========================================================================
  // Private: Boundary Code Resolution at Extraction Time
  // ==========================================================================

  /**
   * Transform raw MP records into AUOfficial records with resolved boundary codes.
   *
   * Matches each MP's divisionName against the boundary index (case-insensitive).
   * AU divisions have unique names, so no ambiguity is expected.
   */
  private resolveOfficialBoundaryCodes(
    rawMPs: readonly RawAustralianMP[],
    boundaryIndex: Map<string, AustraliaDivision>,
  ): AUOfficial[] {
    // Build normalized lookup: lowercase name -> boundary
    const normalizedIndex = new Map<string, AustraliaDivision>();
    for (const [name, boundary] of boundaryIndex) {
      normalizedIndex.set(name.toLowerCase().trim(), boundary);
    }

    return rawMPs.map((mp) => {
      const normalizedName = mp.divisionName.toLowerCase().trim();
      const boundary = normalizedIndex.get(normalizedName);

      const boundaryCode = boundary?.id ?? null;
      const divisionCode = boundary?.id;
      const state = (normalizeState(mp.state) ?? mp.state) as AustraliaState;

      if (!boundary) {
        logger.warn('AU official boundary code unresolved', {
          name: mp.name,
          divisionName: mp.divisionName,
        });
      }

      return {
        id: mp.aphId,
        name: mp.name,
        firstName: mp.firstName ?? undefined,
        lastName: mp.lastName ?? undefined,
        party: mp.party,
        chamber: 'house-of-representatives',
        boundaryName: mp.divisionName,
        boundaryCode,
        email: mp.email ?? undefined,
        phone: mp.phone ?? undefined,
        photoUrl: mp.photoUrl ?? undefined,
        isActive: true,

        // AU-specific fields
        aphId: mp.aphId,
        divisionName: mp.divisionName,
        divisionCode,
        state,
      };
    });
  }

  // ==========================================================================
  // Private: Boundary Normalization (existing logic preserved)
  // ==========================================================================

  /**
   * Normalize GeoJSON features to AustraliaDivision format
   */
  private normalizeDivisions(geojson: FeatureCollection, layer: LayerConfig): AustraliaDivision[] {
    return geojson.features
      .filter((f) => {
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
          return false;
        }
        const props = f.properties ?? {};
        const code = Number(props.CED_CODE_2024 ?? props.ced_code_2021 ?? props.e_div_numb ?? 0);
        const name = String(props.CED_NAME_2024 ?? props.ced_name_2021 ?? props.elect_div ?? '');
        if (code >= 900 || name.includes('No usual address') || name.includes('Outside Australia') || name.includes('Migratory')) {
          return false;
        }
        return true;
      })
      .map((f) => {
        const props = f.properties ?? {};

        const divisionCode = String(
          props.CED_CODE_2024 ?? props.ced_code_2021 ?? props.e_div_numb ?? props.DIV_CODE ?? props.DIV_ID ?? props.ELECT_DIV ?? props.code ?? ''
        );
        const name = String(
          props.CED_NAME_2024 ?? props.ced_name_2021 ?? props.elect_div ?? props.sortname ?? props.DIV_NAME ?? props.ELECT_DIV_NAME ?? props.name ?? 'Unknown Division'
        );

        const stateCode = this.extractStateCode(divisionCode, props);

        const population = typeof props.POPULATION === 'number' ? props.POPULATION : undefined;

        return {
          id: divisionCode,
          name,
          type: 'federal',
          state: stateCode,
          population,
          geometry: f.geometry as Polygon | MultiPolygon,
          source: {
            country: 'AU',
            dataSource: 'AEC',
            endpoint: layer.endpoint,
            authority: layer.authority,
            vintage: layer.vintage,
            retrievedAt: new Date().toISOString(),
          },
          properties: props,
        };
      });
  }

  /**
   * Extract state code from division code or properties
   *
   * AEC division codes sometimes include state prefix (e.g., 'NSW01')
   * Otherwise, extract from STATE or STATE_NAME property
   */
  private extractStateCode(divisionCode: string, props: Record<string, unknown>): AustraliaState {
    const validStates: AustraliaState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

    // ABS uses numeric state codes: 1=NSW, 2=VIC, 3=QLD, 4=SA, 5=WA, 6=TAS, 7=NT, 8=ACT
    const absStateCode = Number(props.STATE_CODE_2021 ?? props.state_code_2021 ?? 0);
    const absStateMap: Record<number, AustraliaState> = {
      1: 'NSW', 2: 'VIC', 3: 'QLD', 4: 'SA', 5: 'WA', 6: 'TAS', 7: 'NT', 8: 'ACT',
    };
    if (absStateMap[absStateCode]) {
      return absStateMap[absStateCode];
    }

    // ABS CED codes: first digit = state (1xx=NSW, 2xx=VIC, etc.)
    const codeNum = parseInt(divisionCode, 10);
    if (!isNaN(codeNum) && codeNum >= 100 && codeNum < 900) {
      const stateDigit = Math.floor(codeNum / 100);
      if (absStateMap[stateDigit]) {
        return absStateMap[stateDigit];
      }
    }

    // Check for state prefix in division code (3-letter)
    const statePrefix = divisionCode.substring(0, 3).toUpperCase();
    if (validStates.includes(statePrefix as AustraliaState)) {
      return statePrefix as AustraliaState;
    }

    // Extract from properties
    const stateProp = String(props.STATE ?? props.STATE_CODE ?? props.STATE_AB ?? '').toUpperCase();
    if (validStates.includes(stateProp as AustraliaState)) {
      return stateProp as AustraliaState;
    }

    // Map state names to codes
    const stateName = String(props.STATE_NAME_2021 ?? props.state_name_2021 ?? props.STATE_NAME ?? '').toUpperCase();
    const stateNameMap: Record<string, AustraliaState> = {
      'NEW SOUTH WALES': 'NSW',
      VICTORIA: 'VIC',
      QUEENSLAND: 'QLD',
      'SOUTH AUSTRALIA': 'SA',
      'WESTERN AUSTRALIA': 'WA',
      TASMANIA: 'TAS',
      'NORTHERN TERRITORY': 'NT',
      'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
    };

    const mapped = stateNameMap[stateName];
    if (!mapped) {
      logger.warn('Could not determine state for AU division, defaulting to NSW', {
        cedCode: String(props.CED_CODE_2024 ?? props.CED_CODE ?? ''),
        stateName: stateName || '(empty)',
      });
    }
    return mapped ?? 'NSW';
  }
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/**
 * Backward-compatible alias for the old class name.
 *
 * Existing code that imports `AustraliaBoundaryProvider` continues to work
 * since AustraliaCountryProvider still exposes all boundary extraction methods
 * (extractAll, extractLayer, extractFederalDivisions, extractByState, healthCheck).
 */
export const AustraliaBoundaryProvider = AustraliaCountryProvider;
