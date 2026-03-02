/**
 * Officials Service
 *
 * Serves pre-ingested federal and state legislator data from SQLite.
 * Eliminates all runtime Congress.gov API dependencies.
 *
 * Data flow:
 *   1. Ingestion cron → congress-legislators YAML → SQLite (ingest-legislators.ts)
 *   2. API request → district code → this service → officials from SQLite
 *   3. No runtime calls to any government API
 *
 * Cache strategy: LRU cache keyed on (state, district) with 1-hour TTL.
 * Since officials change only when Congress changes composition, the TTL
 * is generous. Cache auto-invalidates when DB file mtime changes.
 */

import Database from 'better-sqlite3';
import { statSync } from 'fs';
import { logger } from '../core/utils/logger.js';
import { FIPS_TO_STATE, STATE_TO_FIPS, TERRITORIES } from '../db/fips-codes.js';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types
// ============================================================================

/** Raw SQLite row type (integers for booleans) */
interface RawMemberRow {
  bioguide_id: string;
  name: string;
  first_name: string;
  last_name: string;
  party: string;
  chamber: string;
  state: string;
  district: string | null;
  senate_class: number | null;
  phone: string | null;
  office_address: string | null;
  contact_form_url: string | null;
  website_url: string | null;
  cwc_code: string | null;
  is_voting: number;
  delegate_type: string | null;
}

export interface FederalMember {
  readonly bioguide_id: string;
  readonly name: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly party: string;
  readonly chamber: 'house' | 'senate';
  readonly state: string;
  readonly district: string | null;
  readonly senate_class: number | null;
  readonly phone: string | null;
  readonly office_address: string | null;
  readonly contact_form_url: string | null;
  readonly website_url: string | null;
  readonly cwc_code: string | null;
  readonly is_voting: boolean;
  readonly delegate_type: string | null;
}

export interface OfficialsResult {
  readonly house: FederalMember | null;
  readonly senate: readonly FederalMember[];
  readonly district_code: string;
  readonly state: string;
  readonly special_status: SpecialStatus | null;
}

export interface SpecialStatus {
  readonly type: 'dc' | 'territory';
  readonly message: string;
  readonly has_senators: boolean;
  readonly has_voting_representative: boolean;
}

/** Flat official for API response — chamber-agnostic */
export interface Official {
  readonly bioguide_id: string;
  readonly name: string;
  readonly party: string;
  readonly chamber: 'house' | 'senate';
  readonly state: string;
  readonly district: string | null;
  readonly office: string;
  readonly phone: string | null;
  readonly contact_form_url: string | null;
  readonly website_url: string | null;
  readonly cwc_code: string | null;
  readonly is_voting: boolean;
  readonly delegate_type: string | null;
}

export interface OfficialsResponse {
  readonly officials: readonly Official[];
  readonly district_code: string;
  readonly state: string;
  readonly special_status: SpecialStatus | null;
  readonly source: 'congress-legislators';
  readonly cached: boolean;
}

// ============================================================================
// Canada Types
// ============================================================================

/** Raw SQLite row for canada_mps table */
interface RawCanadaMPRow {
  parliament_id: string;
  name: string;
  name_fr: string | null;
  first_name: string;
  last_name: string;
  party: string;
  party_fr: string | null;
  riding_code: string;
  riding_name: string;
  riding_name_fr: string | null;
  province: string;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  constituency_office: string | null;
  website_url: string | null;
  photo_url: string | null;
  is_active: number;
  parliament_session: string | null;
}

export interface CanadianMP {
  readonly parliament_id: string;
  readonly name: string;
  readonly name_fr: string | null;
  readonly first_name: string;
  readonly last_name: string;
  readonly party: string;
  readonly party_fr: string | null;
  readonly riding_code: string;
  readonly riding_name: string;
  readonly riding_name_fr: string | null;
  readonly province: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly office_address: string | null;
  readonly constituency_office: string | null;
  readonly website_url: string | null;
  readonly photo_url: string | null;
  readonly is_active: boolean;
  readonly parliament_session: string | null;
}

export interface CanadaOfficialsResult {
  readonly mp: CanadianMP | null;
  readonly riding_code: string;
  readonly riding_name: string | null;
  readonly province: string | null;
}

// ============================================================================
// US Special Status Messages
// ============================================================================

const SPECIAL_STATUS_MESSAGES: Record<string, string> = {
  'DC': 'District of Columbia residents have a non-voting delegate in the House and no senators.',
  'AS': 'American Samoa residents have a non-voting delegate in the House and no senators.',
  'GU': 'Guam residents have a non-voting delegate in the House and no senators.',
  'MP': 'Northern Mariana Islands residents have a non-voting delegate in the House and no senators.',
  'PR': 'Puerto Rico residents have a resident commissioner in the House and no senators.',
  'VI': 'U.S. Virgin Islands residents have a non-voting delegate in the House and no senators.',
};

// ============================================================================
// LRU Cache
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expires: number;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Service
// ============================================================================

export class OfficialsService {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private readonly cache: LRUCache<OfficialsResult>;
  private readonly stmtHouseRep: Database.Statement;
  private readonly stmtSenators: Database.Statement;
  private readonly stmtByBioguide: Database.Statement;
  private readonly stmtCount: Database.Statement;
  private readonly stmtCanadaMP: Database.Statement | null;
  private readonly stmtCanadaCount: Database.Statement | null;
  private readonly stmtHouseRepBySession: Database.Statement;
  private readonly stmtSenatorsBySession: Database.Statement;
  private lastRefreshTime: number;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Initialize schema
    this.initSchema();

    // 5000-entry cache, 1-hour TTL
    this.cache = new LRUCache(5000, 3600_000);

    // Track DB file mtime for staleness detection
    this.lastRefreshTime = this.getDbMtime();

    // Prepare statements (SQLite prepared statements are fast, reusable)
    this.stmtHouseRep = this.db.prepare(
      `SELECT * FROM federal_members WHERE state = ? AND district = ? AND chamber = 'house' LIMIT 1`
    );
    this.stmtSenators = this.db.prepare(
      `SELECT * FROM federal_members WHERE state = ? AND chamber = 'senate' ORDER BY senate_class`
    );
    this.stmtByBioguide = this.db.prepare(
      `SELECT * FROM federal_members WHERE bioguide_id = ?`
    );
    this.stmtCount = this.db.prepare(
      `SELECT COUNT(*) as count FROM federal_members`
    );

    // Vintage-aware queries: filter by congress_session
    this.stmtHouseRepBySession = this.db.prepare(
      `SELECT * FROM federal_members WHERE state = ? AND district = ? AND chamber = 'house' AND congress_session = ? LIMIT 1`
    );
    this.stmtSenatorsBySession = this.db.prepare(
      `SELECT * FROM federal_members WHERE state = ? AND chamber = 'senate' AND congress_session = ? ORDER BY senate_class`
    );

    // Canada MP statements — only initialize if table exists
    if (this.hasTable('canada_mps')) {
      this.stmtCanadaMP = this.db.prepare(
        `SELECT * FROM canada_mps WHERE riding_code = ? AND is_active = 1 LIMIT 1`
      );
      this.stmtCanadaCount = this.db.prepare(
        `SELECT COUNT(*) as count FROM canada_mps WHERE is_active = 1`
      );
    } else {
      this.stmtCanadaMP = null;
      this.stmtCanadaCount = null;
    }
  }

  private hasTable(name: string): boolean {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`
    ).get(name) as { count: number };
    return row.count > 0;
  }

  private initSchema(): void {
    this.db.exec(OFFICIALS_SCHEMA_DDL);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get officials by state + district code.
   * This is the primary lookup method used by all endpoints.
   *
   * Returns `{ result, cached }` so callers can set X-Cache headers.
   *
   * @param state - 2-letter USPS state code (e.g., "CA")
   * @param district - District number (e.g., "12") or "00"/"AL" for at-large
   */
  getOfficials(state: string, district: string): { result: OfficialsResult; cached: boolean } {
    this.refreshIfStale();

    const stateUpper = state.toUpperCase();
    const districtNorm = this.normalizeDistrict(district);
    const cacheKey = `${stateUpper}-${districtNorm}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return { result: cached, cached: true };

    const result = this.lookupOfficials(stateUpper, districtNorm);
    this.cache.set(cacheKey, result);
    return { result, cached: false };
  }

  /**
   * Get officials by state + district + congress session (vintage-aware).
   *
   * @param state - 2-letter USPS state code
   * @param district - District number or "00"/"AL" for at-large
   * @param session - Congress session label (e.g., "119th", "118th")
   */
  getOfficialsBySession(
    state: string,
    district: string,
    session: string,
  ): { result: OfficialsResult; cached: boolean } {
    this.refreshIfStale();

    const stateUpper = state.toUpperCase();
    const districtNorm = this.normalizeDistrict(district);
    const cacheKey = `${stateUpper}-${districtNorm}@${session}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return { result: cached, cached: true };

    const result = this.lookupOfficialsBySession(stateUpper, districtNorm, session);
    this.cache.set(cacheKey, result);
    return { result, cached: false };
  }

  /**
   * Get officials from Tree 2 district hex IDs.
   *
   * @param districts - Array of 24 bigint district IDs from cellMapState
   * @returns Officials result (with cached flag) or null if district IDs can't be parsed
   */
  getOfficialsByDistrictHexIds(districts: readonly bigint[]): { result: OfficialsResult; cached: boolean } | null {
    if (!districts || districts.length < 2) return null;

    // Slot 0: Congressional District GEOID (bigint)
    // Slot 1: State/Federal Senate GEOID (state FIPS as bigint)
    const cdGeoidBigint = districts[0];
    const stateGeoidBigint = districts[1];

    if (cdGeoidBigint === 0n && stateGeoidBigint === 0n) return null;

    // Parse Congressional District GEOID
    // GEOID format: SSDD where SS = state FIPS (2 digits), DD = district (2 digits)
    // e.g., BigInt("0612") = 612n → padded to "0612" → state="06", district="12"
    const cdGeoidStr = cdGeoidBigint.toString().padStart(4, '0');
    const stateFips = cdGeoidStr.slice(0, 2);
    const districtNum = cdGeoidStr.slice(2, 4);

    const stateCode = FIPS_TO_STATE[stateFips];
    if (!stateCode) {
      logger.warn('Unknown state FIPS in district hex ID', { stateFips, cdGeoidStr });
      return null;
    }

    // Special case: "98" = at-large/delegate district in Census data
    const district = districtNum === '98' ? '00' : districtNum;

    return this.getOfficials(stateCode, district);
  }

  /**
   * Get a single official by bioguide ID.
   */
  getByBioguideId(bioguideId: string): FederalMember | null {
    const row = this.stmtByBioguide.get(bioguideId) as RawMemberRow | undefined;
    return row ? this.rowToMember(row) : null;
  }

  /**
   * Get total count of ingested members.
   */
  getMemberCount(): number {
    const row = this.stmtCount.get() as { count: number };
    return row.count;
  }

  /**
   * Clear cache (called after ingestion refresh).
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ==========================================================================
  // Canada API
  // ==========================================================================

  /**
   * Get Canadian MP by riding code.
   *
   * @param ridingCode - 5-digit federal electoral district code (e.g., "35001")
   * @returns Canadian MP data or null if not found
   */
  getCanadianMP(ridingCode: string): { result: CanadaOfficialsResult; cached: boolean } {
    this.refreshIfStale();

    const cacheKey = `CA-${ridingCode}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Reuse LRU cache — OfficialsResult | CanadaOfficialsResult
      return { result: cached as unknown as CanadaOfficialsResult, cached: true };
    }

    const result = this.lookupCanadianMP(ridingCode);
    this.cache.set(cacheKey, result as unknown as OfficialsResult);
    return { result, cached: false };
  }

  /**
   * Get total count of active Canadian MPs.
   */
  getCanadianMPCount(): number {
    if (!this.stmtCanadaCount) return 0;
    const row = this.stmtCanadaCount.get() as { count: number };
    return row.count;
  }

  /**
   * Check if Canada MP data is available.
   */
  hasCanadaData(): boolean {
    return this.stmtCanadaMP !== null && this.getCanadianMPCount() > 0;
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }

  // ==========================================================================
  // Static Helpers
  // ==========================================================================

  /** Parse "CA-12" district code into { state, district } */
  static parseDistrictCode(code: string): { state: string; district: string } | null {
    const match = code.match(/^([A-Z]{2})-(\d{1,2}|AL|00)$/i);
    if (!match) return null;
    return {
      state: match[1].toUpperCase(),
      district: match[2].toUpperCase() === 'AL' ? '00' : match[2].padStart(2, '0'),
    };
  }

  /** Get state code from FIPS */
  static fipsToState(fips: string): string | undefined {
    return FIPS_TO_STATE[fips.padStart(2, '0')];
  }

  /** Get FIPS from state code */
  static stateToFips(state: string): string | undefined {
    return STATE_TO_FIPS[state.toUpperCase()];
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private getDbMtime(): number {
    try {
      return statSync(this.dbPath).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Check if the SQLite file has been modified since the last cache fill.
   * If so, clear the cache so fresh data is served after ingestion.
   */
  private refreshIfStale(): void {
    const currentMtime = this.getDbMtime();
    if (currentMtime > this.lastRefreshTime) {
      logger.info('DB file mtime changed, clearing officials cache');
      this.cache.clear();
      this.lastRefreshTime = currentMtime;
    }
  }

  private normalizeDistrict(district: string): string {
    const upper = district.toUpperCase();
    if (upper === 'AL' || upper === 'AT-LARGE') return '00';
    return upper.padStart(2, '0');
  }

  private lookupOfficials(state: string, district: string): OfficialsResult {
    const districtCode = `${state}-${district === '00' ? 'AL' : district}`;

    // Check for DC/territory special status
    const specialStatus = this.getSpecialStatus(state);

    // House representative (or delegate for DC/territories)
    const houseRow = this.stmtHouseRep.get(state, district) as RawMemberRow | undefined;
    const house = houseRow ? this.rowToMember(houseRow) : null;

    // Senators (empty for territories)
    const senatorRows = TERRITORIES.has(state)
      ? []
      : (this.stmtSenators.all(state) as RawMemberRow[]);
    const senate = senatorRows.map(r => this.rowToMember(r));

    return {
      house,
      senate,
      district_code: districtCode,
      state,
      special_status: specialStatus,
    };
  }

  private getSpecialStatus(state: string): SpecialStatus | null {
    if (!TERRITORIES.has(state)) return null;

    return {
      type: state === 'DC' ? 'dc' : 'territory',
      message: SPECIAL_STATUS_MESSAGES[state] || '',
      has_senators: false,
      has_voting_representative: false,
    };
  }

  private lookupOfficialsBySession(
    state: string,
    district: string,
    session: string,
  ): OfficialsResult {
    const districtCode = `${state}-${district === '00' ? 'AL' : district}`;
    const specialStatus = this.getSpecialStatus(state);

    const houseRow = this.stmtHouseRepBySession.get(state, district, session) as RawMemberRow | undefined;
    const house = houseRow ? this.rowToMember(houseRow) : null;

    const senatorRows = TERRITORIES.has(state)
      ? []
      : (this.stmtSenatorsBySession.all(state, session) as RawMemberRow[]);
    const senate = senatorRows.map(r => this.rowToMember(r));

    return {
      house,
      senate,
      district_code: districtCode,
      state,
      special_status: specialStatus,
    };
  }

  private lookupCanadianMP(ridingCode: string): CanadaOfficialsResult {
    if (!this.stmtCanadaMP) {
      return {
        mp: null,
        riding_code: ridingCode,
        riding_name: null,
        province: null,
      };
    }

    const row = this.stmtCanadaMP.get(ridingCode) as RawCanadaMPRow | undefined;
    const mp = row ? this.rowToCanadianMP(row) : null;

    return {
      mp,
      riding_code: ridingCode,
      riding_name: mp?.riding_name ?? null,
      province: mp?.province ?? null,
    };
  }

  private rowToCanadianMP(row: RawCanadaMPRow): CanadianMP {
    return {
      parliament_id: row.parliament_id,
      name: row.name,
      name_fr: row.name_fr,
      first_name: row.first_name,
      last_name: row.last_name,
      party: row.party,
      party_fr: row.party_fr,
      riding_code: row.riding_code,
      riding_name: row.riding_name,
      riding_name_fr: row.riding_name_fr,
      province: row.province,
      email: row.email,
      phone: row.phone,
      office_address: row.office_address,
      constituency_office: row.constituency_office,
      website_url: row.website_url,
      photo_url: row.photo_url,
      is_active: row.is_active === 1,
      parliament_session: row.parliament_session,
    };
  }

  private rowToMember(row: RawMemberRow): FederalMember {
    return {
      bioguide_id: row.bioguide_id,
      name: row.name,
      first_name: row.first_name,
      last_name: row.last_name,
      party: row.party,
      chamber: row.chamber as 'house' | 'senate',
      state: row.state,
      district: row.district,
      senate_class: row.senate_class,
      phone: row.phone,
      office_address: row.office_address,
      contact_form_url: row.contact_form_url,
      website_url: row.website_url,
      cwc_code: row.cwc_code,
      is_voting: row.is_voting === 1,
      delegate_type: row.delegate_type,
    };
  }
}

/**
 * Convert OfficialsResult to flat Official[] array for API response.
 */
export function toOfficialsResponse(
  result: OfficialsResult,
  cached: boolean,
): OfficialsResponse {
  const officials: Official[] = [];

  if (result.house) {
    const m = result.house;
    officials.push({
      bioguide_id: m.bioguide_id,
      name: m.name,
      party: m.party,
      chamber: 'house',
      state: m.state,
      district: m.district,
      office: m.is_voting
        ? `House Representative, ${m.state}-${m.district}`
        : m.delegate_type === 'resident_commissioner'
          ? `Resident Commissioner, ${m.state}`
          : `Non-Voting Delegate, ${m.state}`,
      phone: m.phone,
      contact_form_url: m.contact_form_url,
      website_url: m.website_url,
      cwc_code: m.cwc_code,
      is_voting: m.is_voting,
      delegate_type: m.delegate_type,
    });
  }

  for (const s of result.senate) {
    officials.push({
      bioguide_id: s.bioguide_id,
      name: s.name,
      party: s.party,
      chamber: 'senate',
      state: s.state,
      district: null,
      office: `Senator, ${s.state}`,
      phone: s.phone,
      contact_form_url: s.contact_form_url,
      website_url: s.website_url,
      cwc_code: s.cwc_code,
      is_voting: s.is_voting,
      delegate_type: null,
    });
  }

  return {
    officials,
    district_code: result.district_code,
    state: result.state,
    special_status: result.special_status,
    source: 'congress-legislators',
    cached,
  };
}

/**
 * Convert CanadaOfficialsResult to flat Official[] for API response.
 * Maps Canadian MP fields to the unified Official interface.
 */
export function toCanadaOfficialsResponse(
  result: CanadaOfficialsResult,
  cached: boolean,
): OfficialsResponse {
  const officials: Official[] = [];

  if (result.mp) {
    const m = result.mp;
    officials.push({
      bioguide_id: m.parliament_id,
      name: m.name,
      party: m.party,
      chamber: 'house',  // Canada has unicameral elected chamber (House of Commons)
      state: m.province,
      district: m.riding_code,
      office: `Member of Parliament, ${m.riding_name}`,
      phone: m.phone,
      contact_form_url: null,
      website_url: m.website_url,
      cwc_code: null,
      is_voting: true,
      delegate_type: null,
    });
  }

  return {
    officials,
    district_code: result.riding_code,
    state: result.province ?? '',
    special_status: null,
    source: 'congress-legislators',  // Generic source tag (reuse existing type)
    cached,
  };
}
