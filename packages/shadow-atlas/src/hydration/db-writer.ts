/**
 * DB Writer for Unified Country Hydration Pipeline
 *
 * Writes OfficialRecord[] to the correct country-specific SQLite table,
 * using the same upsert (INSERT ... ON CONFLICT ... DO UPDATE) pattern
 * as the legacy per-country ingest scripts.
 *
 * Tables: federal_members (US), canada_mps, uk_mps, au_mps, nz_mps.
 *
 * @see hydrate-country.ts — the CLI that calls writeOfficials()
 * @see ../db/officials-schema.sql — canonical DDL
 */

import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';
import type { OfficialRecord } from '../providers/international/country-provider-types.js';
import type { CAOfficial } from '../providers/international/canada-provider.js';
import type { UKOfficial } from '../providers/international/uk-provider.js';
import type { AUOfficial } from '../providers/international/australia-provider.js';
import type { NZOfficial } from '../providers/international/nz-provider.js';
import type { USOfficial } from '../providers/international/us-provider.js';

// ============================================================================
// Public API
// ============================================================================

export interface WriteSummary {
  readonly inserted: number;
  readonly updated: number;
  readonly country: string;
}

/**
 * Write officials to the country-specific SQLite table.
 *
 * - Opens (or creates) the DB at `dbPath`
 * - Ensures schema exists via DDL exec
 * - Upserts each official into the correct table
 * - Logs to ingestion_log
 * - Returns a summary of the operation
 */
export function writeOfficials(
  dbPath: string,
  country: string,
  officials: readonly OfficialRecord[],
): WriteSummary {
  const startTime = Date.now();

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(OFFICIALS_SCHEMA_DDL);

  const writer = getCountryWriter(country);
  if (!writer) {
    db.close();
    throw new Error(`No DB writer for country "${country}". Supported: US, CA, GB, AU, NZ`);
  }

  const { inserted, updated } = writer(db, officials);
  const durationMs = Date.now() - startTime;

  // Log to ingestion_log
  const sourceName = COUNTRY_SOURCE_NAME[country] ?? `${country.toLowerCase()}-officials`;
  db.prepare(`
    INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms)
    VALUES (?, 'success', ?, 0, ?)
  `).run(sourceName, inserted + updated, durationMs);

  db.close();

  return { inserted, updated, country };
}

// ============================================================================
// Country Writer Dispatch
// ============================================================================

/** Source name used in ingestion_log per country */
const COUNTRY_SOURCE_NAME: Record<string, string> = {
  CA: 'canada-mps',
  GB: 'uk-mps',
  AU: 'au-mps',
  NZ: 'nz-mps',
  US: 'congress-legislators',
};

type CountryWriterFn = (
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
) => { inserted: number; updated: number };

function getCountryWriter(country: string): CountryWriterFn | null {
  switch (country) {
    case 'CA': return writeCanadaMPs;
    case 'GB': return writeUKMPs;
    case 'AU': return writeAUMPs;
    case 'NZ': return writeNZMPs;
    case 'US': return writeUSMembers;
    default: return null;
  }
}

// ============================================================================
// Canada
// ============================================================================

function writeCanadaMPs(
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
): { inserted: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO canada_mps (
      parliament_id, name, name_fr, first_name, last_name,
      party, party_fr, riding_code, riding_name, riding_name_fr,
      province, email, phone, office_address, constituency_office,
      website_url, photo_url, is_active,
      updated_at
    ) VALUES (
      @parliament_id, @name, @name_fr, @first_name, @last_name,
      @party, @party_fr, @riding_code, @riding_name, @riding_name_fr,
      @province, @email, @phone, @office_address, @constituency_office,
      @website_url, @photo_url, @is_active,
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(parliament_id) DO UPDATE SET
      name = excluded.name,
      name_fr = excluded.name_fr,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      party = excluded.party,
      party_fr = excluded.party_fr,
      riding_code = excluded.riding_code,
      riding_name = excluded.riding_name,
      riding_name_fr = excluded.riding_name_fr,
      province = excluded.province,
      email = excluded.email,
      phone = excluded.phone,
      office_address = excluded.office_address,
      constituency_office = excluded.constituency_office,
      website_url = excluded.website_url,
      photo_url = excluded.photo_url,
      is_active = excluded.is_active,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  // Count existing rows to distinguish inserts from updates
  const existingIds = new Set<string>();
  const rows = db.prepare('SELECT parliament_id FROM canada_mps').all() as Array<{ parliament_id: string }>;
  for (const r of rows) existingIds.add(r.parliament_id);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const official of officials) {
      const o = official as CAOfficial;
      const isExisting = existingIds.has(o.parliamentId);

      upsert.run({
        parliament_id: o.parliamentId,
        name: o.name,
        name_fr: o.nameFr ?? null,
        first_name: o.firstName ?? null,
        last_name: o.lastName ?? null,
        party: o.party,
        party_fr: null, // Not available in OfficialRecord
        riding_code: o.ridingCode,
        riding_name: o.ridingName,
        riding_name_fr: o.ridingNameFr ?? null,
        province: o.province,
        email: o.email ?? null,
        phone: o.phone ?? null,
        office_address: o.officeAddress ?? null,
        constituency_office: null, // Not available from unified pipeline
        website_url: o.websiteUrl ?? null,
        photo_url: o.photoUrl ?? null,
        is_active: o.isActive ? 1 : 0,
      });

      if (isExisting) updated++;
      else inserted++;
    }
  });

  runAll();
  return { inserted, updated };
}

// ============================================================================
// United Kingdom
// ============================================================================

function writeUKMPs(
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
): { inserted: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO uk_mps (
      parliament_id, name, first_name, last_name,
      party, constituency_name, constituency_ons_code,
      email, phone, office_address, website_url, photo_url,
      is_active, updated_at
    ) VALUES (
      @parliament_id, @name, @first_name, @last_name,
      @party, @constituency_name, @constituency_ons_code,
      @email, @phone, @office_address, @website_url, @photo_url,
      @is_active, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(parliament_id) DO UPDATE SET
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      party = excluded.party,
      constituency_name = excluded.constituency_name,
      constituency_ons_code = excluded.constituency_ons_code,
      email = excluded.email,
      phone = excluded.phone,
      office_address = excluded.office_address,
      website_url = excluded.website_url,
      photo_url = excluded.photo_url,
      is_active = excluded.is_active,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  const existingIds = new Set<number>();
  const rows = db.prepare('SELECT parliament_id FROM uk_mps').all() as Array<{ parliament_id: number }>;
  for (const r of rows) existingIds.add(r.parliament_id);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const official of officials) {
      const o = official as UKOfficial;
      const isExisting = existingIds.has(o.parliamentId);

      upsert.run({
        parliament_id: o.parliamentId,
        name: o.name,
        first_name: o.firstName ?? null,
        last_name: o.lastName ?? null,
        party: o.party,
        constituency_name: o.constituencyName,
        constituency_ons_code: o.constituencyOnsCode ?? o.boundaryCode ?? null,
        email: o.email ?? null,
        phone: o.phone ?? null,
        office_address: o.officeAddress ?? null,
        website_url: o.websiteUrl ?? null,
        photo_url: o.photoUrl ?? null,
        is_active: o.isActive ? 1 : 0,
      });

      if (isExisting) updated++;
      else inserted++;
    }
  });

  runAll();
  return { inserted, updated };
}

// ============================================================================
// Australia
// ============================================================================

function writeAUMPs(
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
): { inserted: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO au_mps (
      aph_id, name, first_name, last_name,
      party, division_name, division_code, state,
      email, phone, office_address, website_url, photo_url,
      is_active, updated_at
    ) VALUES (
      @aph_id, @name, @first_name, @last_name,
      @party, @division_name, @division_code, @state,
      @email, @phone, @office_address, @website_url, @photo_url,
      @is_active, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(aph_id) DO UPDATE SET
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      party = excluded.party,
      division_name = excluded.division_name,
      division_code = excluded.division_code,
      state = excluded.state,
      email = excluded.email,
      phone = excluded.phone,
      office_address = excluded.office_address,
      website_url = excluded.website_url,
      photo_url = excluded.photo_url,
      is_active = excluded.is_active,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  const existingIds = new Set<string>();
  const rows = db.prepare('SELECT aph_id FROM au_mps').all() as Array<{ aph_id: string }>;
  for (const r of rows) existingIds.add(r.aph_id);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const official of officials) {
      const o = official as AUOfficial;
      const isExisting = existingIds.has(o.aphId);

      upsert.run({
        aph_id: o.aphId,
        name: o.name,
        first_name: o.firstName ?? null,
        last_name: o.lastName ?? null,
        party: o.party,
        division_name: o.divisionName,
        division_code: o.divisionCode ?? o.boundaryCode ?? null,
        state: o.state,
        email: o.email ?? null,
        phone: o.phone ?? null,
        office_address: o.officeAddress ?? null,
        website_url: o.websiteUrl ?? null,
        photo_url: o.photoUrl ?? null,
        is_active: o.isActive ? 1 : 0,
      });

      if (isExisting) updated++;
      else inserted++;
    }
  });

  runAll();
  return { inserted, updated };
}

// ============================================================================
// New Zealand
// ============================================================================

function writeNZMPs(
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
): { inserted: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO nz_mps (
      parliament_id, name, first_name, last_name,
      party, electorate_name, electorate_code, electorate_type,
      email, phone, office_address, website_url, photo_url,
      is_active, updated_at
    ) VALUES (
      @parliament_id, @name, @first_name, @last_name,
      @party, @electorate_name, @electorate_code, @electorate_type,
      @email, @phone, @office_address, @website_url, @photo_url,
      @is_active, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(parliament_id) DO UPDATE SET
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      party = excluded.party,
      electorate_name = excluded.electorate_name,
      electorate_code = excluded.electorate_code,
      electorate_type = excluded.electorate_type,
      email = excluded.email,
      phone = excluded.phone,
      office_address = excluded.office_address,
      website_url = excluded.website_url,
      photo_url = excluded.photo_url,
      is_active = excluded.is_active,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  const existingIds = new Set<string>();
  const rows = db.prepare('SELECT parliament_id FROM nz_mps').all() as Array<{ parliament_id: string }>;
  for (const r of rows) existingIds.add(r.parliament_id);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const official of officials) {
      const o = official as NZOfficial;
      const isExisting = existingIds.has(o.parliamentId);

      upsert.run({
        parliament_id: o.parliamentId,
        name: o.name,
        first_name: o.firstName ?? null,
        last_name: o.lastName ?? null,
        party: o.party,
        electorate_name: o.electorateName ?? null,
        electorate_code: o.electorateCode ?? o.boundaryCode ?? null,
        electorate_type: o.electorateType,
        email: o.email ?? null,
        phone: o.phone ?? null,
        office_address: o.officeAddress ?? null,
        website_url: o.websiteUrl ?? null,
        photo_url: o.photoUrl ?? null,
        is_active: o.isActive ? 1 : 0,
      });

      if (isExisting) updated++;
      else inserted++;
    }
  });

  runAll();
  return { inserted, updated };
}

// ============================================================================
// United States
// ============================================================================

function writeUSMembers(
  db: InstanceType<typeof Database>,
  officials: readonly OfficialRecord[],
): { inserted: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO federal_members (
      bioguide_id, name, first_name, last_name, party, chamber,
      state, district, senate_class, phone, office_address,
      contact_form_url, website_url, cwc_code, is_voting, delegate_type,
      state_fips, cd_geoid, start_date, end_date, updated_at
    ) VALUES (
      @bioguide_id, @name, @first_name, @last_name, @party, @chamber,
      @state, @district, @senate_class, @phone, @office_address,
      @contact_form_url, @website_url, @cwc_code, @is_voting, @delegate_type,
      @state_fips, @cd_geoid, @start_date, @end_date,
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(bioguide_id) DO UPDATE SET
      name = excluded.name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      party = excluded.party,
      chamber = excluded.chamber,
      state = excluded.state,
      district = excluded.district,
      senate_class = excluded.senate_class,
      phone = excluded.phone,
      office_address = excluded.office_address,
      contact_form_url = excluded.contact_form_url,
      website_url = excluded.website_url,
      cwc_code = excluded.cwc_code,
      is_voting = excluded.is_voting,
      delegate_type = excluded.delegate_type,
      state_fips = excluded.state_fips,
      cd_geoid = excluded.cd_geoid,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  const existingIds = new Set<string>();
  const rows = db.prepare('SELECT bioguide_id FROM federal_members').all() as Array<{ bioguide_id: string }>;
  for (const r of rows) existingIds.add(r.bioguide_id);

  let inserted = 0;
  let updated = 0;

  const runAll = db.transaction(() => {
    for (const official of officials) {
      const o = official as USOfficial;
      const isExisting = existingIds.has(o.bioguideId);

      upsert.run({
        bioguide_id: o.bioguideId,
        name: o.name,
        first_name: o.firstName,
        last_name: o.lastName,
        party: o.party,
        chamber: o.chamber,
        state: o.state,
        district: o.district ?? null,
        senate_class: o.senateClass ?? null,
        phone: o.phone ?? null,
        office_address: o.officeAddress ?? null,
        contact_form_url: o.contactFormUrl ?? null,
        website_url: o.websiteUrl ?? null,
        cwc_code: o.cwcCode ?? null,
        is_voting: o.isVoting ? 1 : 0,
        delegate_type: o.delegateType ?? null,
        state_fips: o.stateFips ?? null,
        cd_geoid: o.cdGeoid ?? null,
        start_date: null,
        end_date: null,
      });

      if (isExisting) updated++;
      else inserted++;
    }
  });

  runAll();
  return { inserted, updated };
}
