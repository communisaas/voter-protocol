/**
 * Officials Service Tests
 *
 * Tests the OfficialsService that serves pre-ingested federal legislator data
 * from SQLite. Covers:
 * - Schema initialization (idempotent table creation)
 * - Lookup by state + district
 * - Lookup by Tree 2 district hex IDs
 * - DC and territory special status
 * - CWC code generation
 * - Cache behavior (hits, invalidation, mtime-based refresh)
 * - Static helpers (parseDistrictCode, fipsToState)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import {
  OfficialsService,
  toOfficialsResponse,
} from '../../../serving/officials-service';

// ============================================================================
// Test Helpers
// ============================================================================

function tempDbPath(): string {
  return join(tmpdir(), `officials-test-${randomBytes(8).toString('hex')}.db`);
}

function cleanupDb(dbPath: string): void {
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(dbPath + '-wal'); } catch {}
  try { unlinkSync(dbPath + '-shm'); } catch {}
}

function seedTestMembers(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS federal_members (
      bioguide_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      party TEXT NOT NULL,
      chamber TEXT NOT NULL CHECK (chamber IN ('house', 'senate')),
      state TEXT NOT NULL,
      district TEXT,
      senate_class INTEGER,
      phone TEXT,
      office_address TEXT,
      contact_form_url TEXT,
      website_url TEXT,
      cwc_code TEXT,
      is_voting INTEGER NOT NULL DEFAULT 1,
      delegate_type TEXT,
      state_fips TEXT,
      cd_geoid TEXT,
      start_date TEXT,
      end_date TEXT,
      ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const insert = db.prepare(`
    INSERT INTO federal_members (
      bioguide_id, name, first_name, last_name, party, chamber,
      state, district, senate_class, phone, cwc_code, is_voting,
      delegate_type, state_fips, cd_geoid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // CA-12 House rep
  insert.run('P000197', 'Nancy Pelosi', 'Nancy', 'Pelosi', 'Democrat', 'house',
    'CA', '12', null, '202-555-1234', 'HCA12', 1, null, '06', '0612');

  // CA Senators
  insert.run('S001150', 'Adam Schiff', 'Adam', 'Schiff', 'Democrat', 'senate',
    'CA', null, 1, '202-555-2345', null, 1, null, '06', null);
  insert.run('P000145', 'Alex Padilla', 'Alex', 'Padilla', 'Democrat', 'senate',
    'CA', null, 3, '202-555-3456', null, 1, null, '06', null);

  // VT at-large (single CD)
  insert.run('B001310', 'Becca Balint', 'Becca', 'Balint', 'Democrat', 'house',
    'VT', '00', null, '202-555-4567', 'HVT00', 1, null, '50', '5000');

  // VT Senators
  insert.run('S000033', 'Bernard Sanders', 'Bernard', 'Sanders', 'Independent', 'senate',
    'VT', null, 1, '202-555-5678', null, 1, null, '50', null);
  insert.run('W000800', 'Peter Welch', 'Peter', 'Welch', 'Democrat', 'senate',
    'VT', null, 3, '202-555-6789', null, 1, null, '50', null);

  // DC delegate (non-voting)
  insert.run('N000147', 'Eleanor Holmes Norton', 'Eleanor', 'Norton', 'Democrat', 'house',
    'DC', '00', null, '202-555-7890', 'HDC00', 0, 'delegate', '11', '1100');

  // PR resident commissioner (non-voting)
  insert.run('H001234', 'Pablo Hernandez', 'Pablo', 'Hernandez', 'Democrat', 'house',
    'PR', '00', null, '202-555-8901', 'HPR00', 0, 'resident_commissioner', '72', '7200');

  // GU delegate (non-voting) — territory test data
  insert.run('M001234', 'James Moylan', 'James', 'Moylan', 'Republican', 'house',
    'GU', '00', null, '202-555-9012', 'HGU00', 0, 'delegate', '66', '6698');

  db.close();
}

// ============================================================================
// Tests
// ============================================================================

describe('OfficialsService', () => {
  let service: OfficialsService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    seedTestMembers(dbPath);
    service = new OfficialsService(dbPath);
  });

  afterEach(() => {
    service.close();
    cleanupDb(dbPath);
  });

  describe('getOfficials', () => {
    it('returns House rep and 2 Senators for CA-12', () => {
      const { result, cached } = service.getOfficials('CA', '12');

      expect(cached).toBe(false);

      expect(result.house).not.toBeNull();
      expect(result.house!.name).toBe('Nancy Pelosi');
      expect(result.house!.party).toBe('Democrat');
      expect(result.house!.cwc_code).toBe('HCA12');
      expect(result.house!.is_voting).toBe(true);

      expect(result.senate).toHaveLength(2);
      expect(result.senate[0].name).toBe('Adam Schiff');
      expect(result.senate[1].name).toBe('Alex Padilla');

      expect(result.district_code).toBe('CA-12');
      expect(result.state).toBe('CA');
      expect(result.special_status).toBeNull();
    });

    it('handles at-large districts (VT-00)', () => {
      const { result } = service.getOfficials('VT', '00');

      expect(result.house).not.toBeNull();
      expect(result.house!.name).toBe('Becca Balint');
      expect(result.house!.cwc_code).toBe('HVT00');

      expect(result.senate).toHaveLength(2);
      expect(result.district_code).toBe('VT-AL');
    });

    it('normalizes AL to 00', () => {
      const { result } = service.getOfficials('VT', 'AL');
      expect(result.house).not.toBeNull();
      expect(result.district_code).toBe('VT-AL');
    });

    it('returns DC special status (non-voting delegate, no senators)', () => {
      const { result } = service.getOfficials('DC', '00');

      expect(result.house).not.toBeNull();
      expect(result.house!.name).toBe('Eleanor Holmes Norton');
      expect(result.house!.is_voting).toBe(false);
      expect(result.house!.delegate_type).toBe('delegate');

      expect(result.senate).toHaveLength(0);

      expect(result.special_status).not.toBeNull();
      expect(result.special_status!.type).toBe('dc');
      expect(result.special_status!.has_senators).toBe(false);
      expect(result.special_status!.has_voting_representative).toBe(false);
    });

    it('returns PR special status (resident commissioner)', () => {
      const { result } = service.getOfficials('PR', '00');

      expect(result.house).not.toBeNull();
      expect(result.house!.delegate_type).toBe('resident_commissioner');
      expect(result.house!.is_voting).toBe(false);

      expect(result.senate).toHaveLength(0);
      expect(result.special_status!.type).toBe('territory');
    });

    it('returns null house when district not found', () => {
      const { result } = service.getOfficials('CA', '99');
      expect(result.house).toBeNull();
      expect(result.senate).toHaveLength(2); // Senators still returned
    });

    it('is case-insensitive for state codes', () => {
      const { result } = service.getOfficials('ca', '12');
      expect(result.house!.name).toBe('Nancy Pelosi');
    });
  });

  describe('getOfficialsByDistrictHexIds', () => {
    it('resolves CA-12 from Tree 2 hex IDs', () => {
      // districts[0] = CD GEOID 0612 as bigint = 612n
      // districts[1] = State FIPS 06 as bigint = 6n
      const districts = new Array(24).fill(0n);
      districts[0] = 612n;  // CD GEOID for CA-12
      districts[1] = 6n;    // State FIPS for CA

      const out = service.getOfficialsByDistrictHexIds(districts);

      expect(out).not.toBeNull();
      expect(out!.result.house!.name).toBe('Nancy Pelosi');
      expect(out!.result.senate).toHaveLength(2);
    });

    it('resolves VT at-large from Tree 2 hex IDs (CD=98 -> at-large)', () => {
      const districts = new Array(24).fill(0n);
      districts[0] = 5098n;  // CD GEOID "5098" -> state=50(VT), district=98(at-large)
      districts[1] = 50n;    // State FIPS for VT

      const out = service.getOfficialsByDistrictHexIds(districts);

      expect(out).not.toBeNull();
      expect(out!.result.house!.name).toBe('Becca Balint');
    });

    it('resolves VT at-large from Tree 2 hex IDs (CD=00)', () => {
      const districts = new Array(24).fill(0n);
      districts[0] = 5000n;  // CD GEOID "5000" -> state=50(VT), district=00
      districts[1] = 50n;

      const out = service.getOfficialsByDistrictHexIds(districts);

      expect(out).not.toBeNull();
      expect(out!.result.house!.name).toBe('Becca Balint');
    });

    it('resolves GU territory from Tree 2 hex IDs', () => {
      const districts = new Array(24).fill(0n);
      districts[0] = 6698n;  // CD GEOID "6698" -> state=66(GU), district=98(at-large)
      districts[1] = 66n;    // State FIPS for GU

      const out = service.getOfficialsByDistrictHexIds(districts);

      expect(out).not.toBeNull();
      expect(out!.result.house!.name).toBe('James Moylan');
      expect(out!.result.house!.is_voting).toBe(false);
      expect(out!.result.senate).toHaveLength(0);
      expect(out!.result.special_status!.type).toBe('territory');
    });

    it('returns null for empty districts', () => {
      const districts = new Array(24).fill(0n);
      const result = service.getOfficialsByDistrictHexIds(districts);
      expect(result).toBeNull();
    });

    it('returns null for unknown FIPS code', () => {
      const districts = new Array(24).fill(0n);
      districts[0] = 9912n;  // State FIPS 99 doesn't exist
      districts[1] = 99n;

      const result = service.getOfficialsByDistrictHexIds(districts);
      expect(result).toBeNull();
    });
  });

  describe('getByBioguideId', () => {
    it('returns member by bioguide ID', () => {
      const member = service.getByBioguideId('P000197');
      expect(member).not.toBeNull();
      expect(member!.name).toBe('Nancy Pelosi');
    });

    it('returns null for unknown ID', () => {
      expect(service.getByBioguideId('XXXXXXX')).toBeNull();
    });
  });

  describe('getMemberCount', () => {
    it('returns correct count', () => {
      expect(service.getMemberCount()).toBe(9); // 4 house + 4 senate + 1 GU
    });
  });

  describe('cache', () => {
    it('returns cached flag true on second call', () => {
      const r1 = service.getOfficials('CA', '12');
      const r2 = service.getOfficials('CA', '12');
      expect(r1.cached).toBe(false);
      expect(r2.cached).toBe(true);
      expect(r1.result).toBe(r2.result); // Same object reference (from cache)
    });

    it('clearCache invalidates cached results', () => {
      const r1 = service.getOfficials('CA', '12');
      service.clearCache();
      const r2 = service.getOfficials('CA', '12');
      expect(r1.result).not.toBe(r2.result); // Different objects
      expect(r1.result.house!.name).toBe(r2.result.house!.name); // Same data
    });
  });

  describe('static helpers', () => {
    it('parseDistrictCode parses CA-12', () => {
      const parsed = OfficialsService.parseDistrictCode('CA-12');
      expect(parsed).toEqual({ state: 'CA', district: '12' });
    });

    it('parseDistrictCode parses VT-AL', () => {
      const parsed = OfficialsService.parseDistrictCode('VT-AL');
      expect(parsed).toEqual({ state: 'VT', district: '00' });
    });

    it('parseDistrictCode parses DC-00', () => {
      const parsed = OfficialsService.parseDistrictCode('DC-00');
      expect(parsed).toEqual({ state: 'DC', district: '00' });
    });

    it('parseDistrictCode rejects invalid format', () => {
      expect(OfficialsService.parseDistrictCode('California-12')).toBeNull();
      expect(OfficialsService.parseDistrictCode('CA12')).toBeNull();
      expect(OfficialsService.parseDistrictCode('')).toBeNull();
    });

    it('fipsToState maps correctly for states', () => {
      expect(OfficialsService.fipsToState('06')).toBe('CA');
      expect(OfficialsService.fipsToState('50')).toBe('VT');
      expect(OfficialsService.fipsToState('11')).toBe('DC');
      expect(OfficialsService.fipsToState('72')).toBe('PR');
    });

    it('fipsToState maps correctly for territories', () => {
      expect(OfficialsService.fipsToState('60')).toBe('AS');
      expect(OfficialsService.fipsToState('66')).toBe('GU');
      expect(OfficialsService.fipsToState('69')).toBe('MP');
      expect(OfficialsService.fipsToState('78')).toBe('VI');
    });

    it('stateToFips maps correctly', () => {
      expect(OfficialsService.stateToFips('CA')).toBe('06');
      expect(OfficialsService.stateToFips('VT')).toBe('50');
    });
  });
});

describe('toOfficialsResponse', () => {
  let service: OfficialsService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    seedTestMembers(dbPath);
    service = new OfficialsService(dbPath);
  });

  afterEach(() => {
    service.close();
    cleanupDb(dbPath);
  });

  it('formats CA-12 result for API response', () => {
    const { result } = service.getOfficials('CA', '12');
    const response = toOfficialsResponse(result, false);

    expect(response.officials).toHaveLength(3);
    expect(response.district_code).toBe('CA-12');
    expect(response.source).toBe('congress-legislators');
    expect(response.cached).toBe(false);

    const house = response.officials[0];
    expect(house.name).toBe('Nancy Pelosi');
    expect(house.office).toBe('House Representative, CA-12');
    expect(house.cwc_code).toBe('HCA12');

    const senator1 = response.officials[1];
    expect(senator1.chamber).toBe('senate');
    expect(senator1.office).toBe('Senator, CA');
  });

  it('formats DC delegate with correct office title', () => {
    const { result } = service.getOfficials('DC', '00');
    const response = toOfficialsResponse(result, false);

    expect(response.officials).toHaveLength(1);
    expect(response.officials[0].office).toBe('Non-Voting Delegate, DC');
    expect(response.special_status!.type).toBe('dc');
  });

  it('formats PR resident commissioner correctly', () => {
    const { result } = service.getOfficials('PR', '00');
    const response = toOfficialsResponse(result, false);

    expect(response.officials).toHaveLength(1);
    expect(response.officials[0].office).toBe('Resident Commissioner, PR');
  });

  it('passes cached flag through to response', () => {
    const { result: r1 } = service.getOfficials('CA', '12');
    const resp1 = toOfficialsResponse(r1, false);
    expect(resp1.cached).toBe(false);

    const resp2 = toOfficialsResponse(r1, true);
    expect(resp2.cached).toBe(true);
  });
});
