import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../../../db/officials-schema.js';
import {
  CONGRESSIONAL_DISTRICTS,
  NON_VOTING_DELEGATES,
} from '../../../core/registry/official-district-counts.js';
import { exportUSofficials } from '../../../../scripts/export-officials.js';

interface ExportedOfficial {
  id: string;
  chamber: string;
  state: string;
}

interface ExportedOfficialsFile {
  district_code: string;
  officials: ExportedOfficial[];
  houseSeatVacant: boolean;
}

describe('exportUSofficials', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'export-officials-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readOfficialsFile(outputDir: string, code: string): ExportedOfficialsFile {
    return JSON.parse(
      readFileSync(join(outputDir, 'US', 'officials', `${code}.json`), 'utf-8'),
    ) as ExportedOfficialsFile;
  }

  function insertFederalMember(
    db: Database.Database,
    member: {
      bioguide_id: string;
      name: string;
      first_name: string;
      last_name: string;
      party: string;
      chamber: 'house' | 'senate';
      state: string;
      district: string | null;
      senate_class: number | null;
      is_voting?: number;
      delegate_type?: string | null;
    },
  ): void {
    db.prepare(
      `INSERT INTO federal_members (
        bioguide_id,
        name,
        first_name,
        last_name,
        party,
        chamber,
        state,
        district,
        senate_class,
        phone,
        office_address,
        contact_form_url,
        website_url,
        cwc_code,
        is_voting,
        delegate_type
      ) VALUES (
        @bioguide_id,
        @name,
        @first_name,
        @last_name,
        @party,
        @chamber,
        @state,
        @district,
        @senate_class,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        @is_voting,
        @delegate_type
      )`,
    ).run({
      ...member,
      is_voting: member.is_voting ?? 1,
      delegate_type: member.delegate_type ?? null,
    });
  }

  it('emits every canonical US congressional district, including vacant House seats', () => {
    const dbPath = join(dir, 'officials.db');
    const outputDir = join(dir, 'output');
    const db = new Database(dbPath);

    try {
      db.exec(OFFICIALS_SCHEMA_DDL);

      insertFederalMember(db, {
        bioguide_id: 'TXH001',
        name: 'Texas House One',
        first_name: 'Texas',
        last_name: 'One',
        party: 'Independent',
        chamber: 'house',
        state: 'TX',
        district: '01',
        senate_class: null,
      });
      insertFederalMember(db, {
        bioguide_id: 'TXS001',
        name: 'Texas Senator One',
        first_name: 'Texas',
        last_name: 'Senator One',
        party: 'Independent',
        chamber: 'senate',
        state: 'TX',
        district: null,
        senate_class: 1,
      });
      insertFederalMember(db, {
        bioguide_id: 'TXS002',
        name: 'Texas Senator Two',
        first_name: 'Texas',
        last_name: 'Senator Two',
        party: 'Independent',
        chamber: 'senate',
        state: 'TX',
        district: null,
        senate_class: 2,
      });
      insertFederalMember(db, {
        bioguide_id: 'DCD001',
        name: 'District Delegate',
        first_name: 'District',
        last_name: 'Delegate',
        party: 'Independent',
        chamber: 'house',
        state: 'DC',
        district: null,
        senate_class: null,
        is_voting: 0,
        delegate_type: 'delegate',
      });
      insertFederalMember(db, {
        bioguide_id: 'WYS001',
        name: 'Wyoming Senator One',
        first_name: 'Wyoming',
        last_name: 'Senator One',
        party: 'Independent',
        chamber: 'senate',
        state: 'WY',
        district: null,
        senate_class: 1,
      });
      insertFederalMember(db, {
        bioguide_id: 'WYS002',
        name: 'Wyoming Senator Two',
        first_name: 'Wyoming',
        last_name: 'Senator Two',
        party: 'Independent',
        chamber: 'senate',
        state: 'WY',
        district: null,
        senate_class: 2,
      });

      const result = exportUSofficials(
        db,
        outputDir,
        '2026-07-06T00:00:00.000Z',
      );

      const tx01 = readOfficialsFile(outputDir, 'TX-01');
      expect(tx01.houseSeatVacant).toBe(false);
      expect(tx01.officials.map((official) => official.id)).toEqual([
        'TXH001',
        'TXS001',
        'TXS002',
      ]);

      const wyALPath = join(outputDir, 'US', 'officials', 'WY-AL.json');
      expect(existsSync(wyALPath)).toBe(true);
      const wyAL = readOfficialsFile(outputDir, 'WY-AL');
      expect(wyAL.houseSeatVacant).toBe(true);
      expect(wyAL.officials).toHaveLength(2);
      expect(wyAL.officials.every((official) => official.chamber === 'senate')).toBe(true);

      const dcAL = readOfficialsFile(outputDir, 'DC-AL');
      expect(dcAL.houseSeatVacant).toBe(false);
      expect(dcAL.officials.map((official) => official.id)).toEqual(['DCD001']);
      expect(dcAL.officials.every((official) => official.chamber !== 'senate')).toBe(true);

      const ca01 = readOfficialsFile(outputDir, 'CA-01');
      expect(ca01.houseSeatVacant).toBe(true);

      const nonVotingDelegateCodes = new Set(Object.keys(NON_VOTING_DELEGATES));
      const votingDistrictCount = Object.entries(CONGRESSIONAL_DISTRICTS).reduce(
        (sum, [state, count]) =>
          nonVotingDelegateCodes.has(state) ? sum : sum + count,
        0,
      );
      const expectedSetSize =
        votingDistrictCount + Object.keys(NON_VOTING_DELEGATES).length;
      const officialsFiles = readdirSync(join(outputDir, 'US', 'officials')).filter((file) =>
        file.endsWith('.json'),
      );

      expect(votingDistrictCount).toBe(435);
      expect(expectedSetSize).toBe(441);
      expect(result.districtCount).toBe(expectedSetSize);
      expect(officialsFiles).toHaveLength(expectedSetSize);
    } finally {
      db.close();
    }
  });
});
