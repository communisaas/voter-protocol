#!/usr/bin/env tsx
/**
 * Export Officials to Per-District JSON Files
 *
 * Reads the federal_members (and optional international) tables from the
 * shadow-atlas SQLite database, groups officials by state+district, and
 * writes per-district JSON files into the IPFS directory structure.
 *
 * Usage:
 * tsx scripts/export-officials.ts <dbPath> [outputDir]
 *
 * Examples:
 * tsx scripts/export-officials.ts./data/shadow-atlas-full.db./output
 * tsx scripts/export-officials.ts./data/shadow-atlas-full.db
 *
 * Output structure:
 * {outputDir}/US/officials/CA-12.json
 * {outputDir}/US/officials/NY-AL.json
 * {outputDir}/CA/officials/35001.json
 * {outputDir}/GB/officials/E14001234.json
 * {outputDir}/AU/officials/{division_code}.json
 * {outputDir}/NZ/officials/{electorate_code}.json
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { TERRITORIES } from '../src/db/fips-codes.js';

// ============================================================================
// Output Schema Types
// ============================================================================

interface Official {
  id: string;
  name: string;
  party: string;
  chamber: string;
  state: string;
  district: string | null;
  phone: string | null;
  office_address: string | null;
  contact_form_url: string | null;
  website_url: string | null;
  is_voting: boolean;
  delegate_type: string | null;
}

interface OfficialsFile {
  version: 1;
  country: string;
  district_code: string;
  officials: Official[];
  generated: string;
}

interface ManifestEntry {
  file: string;
  district_code: string;
  official_count: number;
  sha256: string;
}

interface CountryManifest {
  version: 1;
  country: string;
  generated: string;
  officials?: {
    total_districts: number;
    total_officials: number;
    entries: ManifestEntry[];
  };
  [key: string]: unknown;
}

// ============================================================================
// Raw Row Types (from SQLite)
// ============================================================================

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

interface RawUKMPRow {
  parliament_id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  constituency_name: string;
  constituency_ons_code: string | null;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website_url: string | null;
  photo_url: string | null;
  is_active: number;
}

interface RawAUMPRow {
  aph_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  division_name: string;
  division_code: string | null;
  state: string;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website_url: string | null;
  photo_url: string | null;
  is_active: number;
}

interface RawNZMPRow {
  parliament_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  electorate_name: string | null;
  electorate_code: string | null;
  electorate_type: string | null;
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website_url: string | null;
  photo_url: string | null;
  is_active: number;
}

// ============================================================================
// Helpers
// ============================================================================

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(name) as { count: number };
  return row.count > 0;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeJsonFile(filePath: string, data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(filePath, json);
  return sha256(json);
}

function readManifest(manifestPath: string): CountryManifest | null {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as CountryManifest;
  } catch {
    return null;
  }
}

// ============================================================================
// Generic Per-District Export Helper
// ============================================================================

interface CountryExportConfig<TRow> {
  readonly tableName: string;
  readonly countryCode: string;
  readonly groupKey: (row: TRow) => string | null;
  readonly toOfficial: (row: TRow) => Official;
}

/** Table name whitelist to prevent SQL injection */
const ALLOWED_TABLES = new Set([
  'federal_members',
  'canada_mps',
  'uk_mps',
  'au_mps',
  'nz_mps',
]);

interface ExportResult {
  districtCount: number;
  officialCount: number;
  manifestEntries: ManifestEntry[];
}

function exportByDistrict<TRow>(
  db: Database.Database,
  config: CountryExportConfig<TRow>,
  outputDir: string,
  generated: string,
): ExportResult {
  if (!ALLOWED_TABLES.has(config.tableName)) {
    throw new Error(`Disallowed table name: ${config.tableName}`);
  }

  const officialsDir = join(
    outputDir,
    config.countryCode,
    'officials',
  );
  ensureDir(officialsDir);

  const rows = db
    .prepare(
      `SELECT * FROM ${config.tableName} WHERE is_active = 1`,
    )
    .all() as TRow[];

  // Group by district key
  const byKey = new Map<string, TRow[]>();
  for (const row of rows) {
    const code = config.groupKey(row);
    if (!code) continue;
    let arr = byKey.get(code);
    if (!arr) {
      arr = [];
      byKey.set(code, arr);
    }
    arr.push(row);
  }

  // Write per-district files
  const manifestEntries: ManifestEntry[] = [];
  let totalOfficials = 0;

  for (const [code, groupRows] of byKey) {
    if (!/^[A-Za-z0-9._-]+$/.test(code)) {
      console.warn(`Skipping invalid district code: ${code}`);
      continue;
    }
    const officials = groupRows.map(config.toOfficial);
    const file: OfficialsFile = {
      version: 1,
      country: config.countryCode,
      district_code: code,
      officials,
      generated,
    };
    const fileName = `${code}.json`;
    const filePath = join(officialsDir, fileName);
    const hash = writeJsonFile(filePath, file);
    manifestEntries.push({
      file: `officials/${fileName}`,
      district_code: code,
      official_count: officials.length,
      sha256: hash,
    });
    totalOfficials += officials.length;
  }

  return {
    districtCount: byKey.size,
    officialCount: totalOfficials,
    manifestEntries,
  };
}

// ============================================================================
// US Officials Export
// ============================================================================

/** @deprecated Use ExportResult — kept as alias for backward compat */
type USExportResult = ExportResult;

function exportUSofficials(
  db: Database.Database,
  outputDir: string,
  generated: string,
): USExportResult {
  const officialsDir = join(outputDir, 'US', 'officials');
  ensureDir(officialsDir);

  // Fetch all house members
  const houseMembers = db
    .prepare(
      `SELECT * FROM federal_members WHERE chamber = 'house'`,
    )
    .all() as RawMemberRow[];

  // Fetch all senators
  const senators = db
    .prepare(
      `SELECT * FROM federal_members WHERE chamber = 'senate' ORDER BY senate_class`,
    )
    .all() as RawMemberRow[];

  // Group senators by state
  const senatorsByState = new Map<string, RawMemberRow[]>();
  for (const s of senators) {
    let arr = senatorsByState.get(s.state);
    if (!arr) {
      arr = [];
      senatorsByState.set(s.state, arr);
    }
    arr.push(s);
  }

  // Collect unique district codes from house members
  // Each house member defines a district: state + district number
  const districtMap = new Map<string, RawMemberRow>(); // districtCode -> house rep
  for (const m of houseMembers) {
    const districtLabel =
      m.district === '00' ? 'AL' : (m.district ?? 'AL');
    const districtCode = `${m.state}-${districtLabel}`;
    districtMap.set(districtCode, m);
  }

  const manifestEntries: ManifestEntry[] = [];
  let totalOfficials = 0;

  for (const [districtCode, houseRep] of districtMap) {
    if (!/^[A-Za-z0-9._-]+$/.test(districtCode)) {
      console.warn(`Skipping invalid district code: ${districtCode}`);
      continue;
    }
    const state = houseRep.state;
    const isTerritory = TERRITORIES.has(state);

    // Build officials list: house rep + state senators (no senators for territories)
    const officials: Official[] = [];

    // Add house representative / delegate
    officials.push({
      id: houseRep.bioguide_id,
      name: houseRep.name,
      party: houseRep.party,
      chamber: houseRep.chamber,
      state: houseRep.state,
      district: houseRep.district,
      phone: houseRep.phone,
      office_address: houseRep.office_address,
      contact_form_url: houseRep.contact_form_url,
      website_url: houseRep.website_url,
      is_voting: houseRep.is_voting === 1,
      delegate_type: houseRep.delegate_type,
    });

    // Add senators (territories have no senators)
    if (!isTerritory) {
      const stateSenators = senatorsByState.get(state) ?? [];
      for (const s of stateSenators) {
        officials.push({
          id: s.bioguide_id,
          name: s.name,
          party: s.party,
          chamber: s.chamber,
          state: s.state,
          district: s.district,
          phone: s.phone,
          office_address: s.office_address,
          contact_form_url: s.contact_form_url,
          website_url: s.website_url,
          is_voting: s.is_voting === 1,
          delegate_type: s.delegate_type,
        });
      }
    }

    const file: OfficialsFile = {
      version: 1,
      country: 'US',
      district_code: districtCode,
      officials,
      generated,
    };

    const fileName = `${districtCode}.json`;
    const filePath = join(officialsDir, fileName);
    const hash = writeJsonFile(filePath, file);

    manifestEntries.push({
      file: `officials/${fileName}`,
      district_code: districtCode,
      official_count: officials.length,
      sha256: hash,
    });

    totalOfficials += officials.length;
  }

  return {
    districtCount: districtMap.size,
    officialCount: totalOfficials,
    manifestEntries,
  };
}

// ============================================================================
// Canadian Officials Export
// ============================================================================

/** @deprecated Use ExportResult — kept as alias for backward compat */
type IntlExportResult = ExportResult;

function exportCanadianOfficials(
  db: Database.Database,
  outputDir: string,
  generated: string,
): IntlExportResult {
  return exportByDistrict<RawCanadaMPRow>(
    db,
    {
      tableName: 'canada_mps',
      countryCode: 'CA',
      groupKey: (row) => row.riding_code || null,
      toOfficial: (mp) => ({
        id: mp.parliament_id,
        name: mp.name,
        party: mp.party,
        chamber: 'house',
        state: mp.province,
        district: mp.riding_code,
        phone: mp.phone,
        office_address: mp.office_address,
        contact_form_url: null,
        website_url: mp.website_url,
        is_voting: true,
        delegate_type: null,
      }),
    },
    outputDir,
    generated,
  );
}

// ============================================================================
// UK Officials Export
// ============================================================================

function exportUKOfficials(
  db: Database.Database,
  outputDir: string,
  generated: string,
): IntlExportResult {
  return exportByDistrict<RawUKMPRow>(
    db,
    {
      tableName: 'uk_mps',
      countryCode: 'GB',
      groupKey: (row) => row.constituency_ons_code || null,
      toOfficial: (mp) => ({
        id: String(mp.parliament_id),
        name: mp.name,
        party: mp.party,
        chamber: 'house',
        state: '',
        district: mp.constituency_ons_code,
        phone: mp.phone,
        office_address: mp.office_address,
        contact_form_url: null,
        website_url: mp.website_url,
        is_voting: true,
        delegate_type: null,
      }),
    },
    outputDir,
    generated,
  );
}

// ============================================================================
// Australian Officials Export
// ============================================================================

function exportAUOfficials(
  db: Database.Database,
  outputDir: string,
  generated: string,
): IntlExportResult {
  return exportByDistrict<RawAUMPRow>(
    db,
    {
      tableName: 'au_mps',
      countryCode: 'AU',
      groupKey: (row) => row.division_code || null,
      toOfficial: (mp) => ({
        id: mp.aph_id,
        name: mp.name,
        party: mp.party,
        chamber: 'house',
        state: mp.state,
        district: mp.division_code,
        phone: mp.phone,
        office_address: mp.office_address,
        contact_form_url: null,
        website_url: mp.website_url,
        is_voting: true,
        delegate_type: null,
      }),
    },
    outputDir,
    generated,
  );
}

// ============================================================================
// New Zealand Officials Export
// ============================================================================

function exportNZOfficials(
  db: Database.Database,
  outputDir: string,
  generated: string,
): IntlExportResult {
  return exportByDistrict<RawNZMPRow>(
    db,
    {
      tableName: 'nz_mps',
      countryCode: 'NZ',
      groupKey: (row) => row.electorate_code || null,
      toOfficial: (mp) => ({
        id: mp.parliament_id,
        name: mp.name,
        party: mp.party,
        chamber: 'house',
        state: '',
        district: mp.electorate_code,
        phone: mp.phone,
        office_address: mp.office_address,
        contact_form_url: null,
        website_url: mp.website_url,
        is_voting: true,
        delegate_type: null,
      }),
    },
    outputDir,
    generated,
  );
}

// ============================================================================
// Manifest Management
// ============================================================================

function updateManifest(
  outputDir: string,
  country: string,
  entries: ManifestEntry[],
  totalDistricts: number,
  totalOfficials: number,
  generated: string,
): void {
  const manifestPath = join(outputDir, country, 'manifest.json');
  let manifest = readManifest(manifestPath);

  if (!manifest) {
    manifest = {
      version: 1,
      country,
      generated,
    };
  }

  manifest.officials = {
    total_districts: totalDistricts,
    total_officials: totalOfficials,
    entries,
  };

  manifest.generated = generated;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error(
      'Usage: tsx scripts/export-officials.ts <dbPath> [outputDir]',
    );
    console.error('  dbPath:    path to shadow-atlas SQLite database');
    console.error(
      '  outputDir: output directory (default: ./output)',
    );
    process.exit(1);
  }

  const outputDir = process.argv[3] || './output';
  const generated = new Date().toISOString();

  console.log('Export Officials to Per-District JSON Files');
  console.log('===========================================');
  console.log(`Database:   ${dbPath}`);
  console.log(`Output:     ${outputDir}`);
  console.log(`Generated:  ${generated}`);
  console.log();

  // Open database in read-only mode — export never writes to the source DB.
  // Schema must already exist (created by the hydration step). If tables are
  // missing, the per-country hasTable() checks below will skip gracefully.
  const db = new Database(dbPath, { readonly: true });
  try {
    ensureDir(outputDir);

    const summary: Array<{
      country: string;
      districts: number;
      officials: number;
    }> = [];

    // ---- US Officials ----
    if (hasTable(db, 'federal_members')) {
      const memberCount = (
        db
          .prepare('SELECT COUNT(*) as count FROM federal_members')
          .get() as { count: number }
      ).count;
      console.log(`US: Found ${memberCount} federal members`);

      const result = exportUSofficials(db, outputDir, generated);
      updateManifest(
        outputDir,
        'US',
        result.manifestEntries,
        result.districtCount,
        result.officialCount,
        generated,
      );

      summary.push({
        country: 'US',
        districts: result.districtCount,
        officials: result.officialCount,
      });
      console.log(
        `US: Exported ${result.districtCount} districts, ${result.officialCount} officials`,
      );
    } else {
      console.log('US: federal_members table not found, skipping');
    }

    // ---- Canada Officials ----
    if (hasTable(db, 'canada_mps')) {
      const mpCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM canada_mps WHERE is_active = 1',
          )
          .get() as { count: number }
      ).count;
      console.log(`CA: Found ${mpCount} active Canadian MPs`);

      const result = exportCanadianOfficials(db, outputDir, generated);
      updateManifest(
        outputDir,
        'CA',
        result.manifestEntries,
        result.districtCount,
        result.officialCount,
        generated,
      );

      summary.push({
        country: 'CA',
        districts: result.districtCount,
        officials: result.officialCount,
      });
      console.log(
        `CA: Exported ${result.districtCount} ridings, ${result.officialCount} officials`,
      );
    } else {
      console.log('CA: canada_mps table not found, skipping');
    }

    // ---- UK Officials ----
    if (hasTable(db, 'uk_mps')) {
      const mpCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM uk_mps WHERE is_active = 1',
          )
          .get() as { count: number }
      ).count;
      console.log(`GB: Found ${mpCount} active UK MPs`);

      const result = exportUKOfficials(db, outputDir, generated);
      updateManifest(
        outputDir,
        'GB',
        result.manifestEntries,
        result.districtCount,
        result.officialCount,
        generated,
      );

      summary.push({
        country: 'GB',
        districts: result.districtCount,
        officials: result.officialCount,
      });
      console.log(
        `GB: Exported ${result.districtCount} constituencies, ${result.officialCount} officials`,
      );
    } else {
      console.log('GB: uk_mps table not found, skipping');
    }

    // ---- Australia Officials ----
    if (hasTable(db, 'au_mps')) {
      const mpCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM au_mps WHERE is_active = 1',
          )
          .get() as { count: number }
      ).count;
      console.log(`AU: Found ${mpCount} active Australian MPs`);

      const result = exportAUOfficials(db, outputDir, generated);
      updateManifest(
        outputDir,
        'AU',
        result.manifestEntries,
        result.districtCount,
        result.officialCount,
        generated,
      );

      summary.push({
        country: 'AU',
        districts: result.districtCount,
        officials: result.officialCount,
      });
      console.log(
        `AU: Exported ${result.districtCount} divisions, ${result.officialCount} officials`,
      );
    } else {
      console.log('AU: au_mps table not found, skipping');
    }

    // ---- New Zealand Officials ----
    if (hasTable(db, 'nz_mps')) {
      const mpCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM nz_mps WHERE is_active = 1',
          )
          .get() as { count: number }
      ).count;
      console.log(`NZ: Found ${mpCount} active NZ MPs`);

      const result = exportNZOfficials(db, outputDir, generated);
      updateManifest(
        outputDir,
        'NZ',
        result.manifestEntries,
        result.districtCount,
        result.officialCount,
        generated,
      );

      summary.push({
        country: 'NZ',
        districts: result.districtCount,
        officials: result.officialCount,
      });
      console.log(
        `NZ: Exported ${result.districtCount} electorates, ${result.officialCount} officials`,
      );
    } else {
      console.log('NZ: nz_mps table not found, skipping');
    }
  } finally {
    db.close();
  }

  // ---- Summary ----
  console.log();
  console.log('Summary');
  console.log('-------');
  if (summary.length === 0) {
    console.log('No officials data found in database.');
  } else {
    let grandDistricts = 0;
    let grandOfficials = 0;
    for (const s of summary) {
      console.log(
        `  ${s.country}: ${s.districts} districts, ${s.officials} officials`,
      );
      grandDistricts += s.districts;
      grandOfficials += s.officials;
    }
    console.log(
      `  Total: ${grandDistricts} districts, ${grandOfficials} officials across ${summary.length} countries`,
    );
  }
  console.log();
  console.log('Done.');
}

main();
