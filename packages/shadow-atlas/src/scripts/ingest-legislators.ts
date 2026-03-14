#!/usr/bin/env tsx
/**
 * @deprecated Use unified hydration pipeline instead:
 *   npx tsx src/hydration/hydrate-country.ts --country US
 *
 * Ingest Federal Legislators from unitedstates/congress-legislators
 *
 * Data source: https://github.com/unitedstates/congress-legislators
 * License: CC0 (public domain)
 * Format: YAML with nested term records
 *
 * Usage:
 *   tsx src/scripts/ingest-legislators.ts                    # Default: officials.db in cwd
 *   tsx src/scripts/ingest-legislators.ts --db /data/sa.db   # Custom DB path
 *   tsx src/scripts/ingest-legislators.ts --dry-run           # Parse only, no DB writes
 *
 * This script:
 *   1. Fetches legislators-current.yaml from GitHub (raw)
 *   2. Parses YAML into structured member records
 *   3. Generates CWC codes: House = "H" + state + lpad(district, 2, '0')
 *   4. Upserts into federal_members SQLite table
 *   5. Logs ingestion result to ingestion_log table
 *
 * Designed to run as a cron job (e.g., daily or on Congress composition change).
 * Idempotent: safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { STATE_TO_FIPS, TERRITORIES } from '../db/fips-codes.js';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types (mirrors congress-legislators YAML schema)
// ============================================================================

interface LegislatorYaml {
  id: {
    bioguide: string;
    thomas?: string;
    lis?: string;
    govtrack?: number;
    opensecrets?: string;
    fec?: string[];
  };
  name: {
    first: string;
    last: string;
    middle?: string;
    suffix?: string;
    nickname?: string;
    official_full?: string;
  };
  bio: {
    birthday?: string;
    gender?: string;
  };
  terms: TermYaml[];
}

interface TermYaml {
  type: 'rep' | 'sen';
  start: string;
  end: string;
  state: string;
  district?: number;
  class?: number;  // Senate class (1, 2, or 3)
  party: string;
  url?: string;
  address?: string;
  phone?: string;
  contact_form?: string;
  office?: string;
  state_rank?: string;
}


// At-large states (single congressional district)
const AT_LARGE_STATES = new Set(['AK', 'DE', 'MT', 'ND', 'SD', 'VT', 'WY']);

// ============================================================================
// Fetching
// ============================================================================

const LEGISLATORS_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml';

async function fetchLegislatorsYaml(): Promise<string> {
  console.log(`Fetching ${LEGISLATORS_URL}...`);
  const res = await fetch(LEGISLATORS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch legislators: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  console.log(`Fetched ${(text.length / 1024).toFixed(1)} KB of YAML`);
  return text;
}

// ============================================================================
// Parsing
// ============================================================================

interface ParsedMember {
  bioguide_id: string;
  name: string;
  first_name: string;
  last_name: string;
  party: string;
  chamber: 'house' | 'senate';
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
  state_fips: string | null;
  cd_geoid: string | null;
  start_date: string;
  end_date: string;
}

function parseLegislators(yamlText: string): ParsedMember[] {
  const raw = parseYaml(yamlText);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Expected YAML array of legislators, got ${typeof raw} (length: ${Array.isArray(raw) ? raw.length : 'N/A'})`);
  }
  const legislators = raw as LegislatorYaml[];

  // Validate first entry has expected shape
  const sample = legislators[0];
  if (!sample?.id?.bioguide || !sample?.terms || !Array.isArray(sample.terms)) {
    throw new Error('YAML schema mismatch: first entry missing id.bioguide or terms array');
  }

  console.log(`Parsed ${legislators.length} legislators from YAML`);

  const members: ParsedMember[] = [];

  for (const leg of legislators) {
    if (!leg.terms || leg.terms.length === 0) continue;

    // Use the most recent (last) term — that's the current one
    const currentTerm = leg.terms[leg.terms.length - 1];
    if (!currentTerm) continue;

    const bioguide = leg.id.bioguide;
    const state = currentTerm.state;
    const chamber: 'house' | 'senate' = currentTerm.type === 'sen' ? 'senate' : 'house';

    // Build display name
    const officialName = leg.name.official_full
      || `${leg.name.first} ${leg.name.last}${leg.name.suffix ? ' ' + leg.name.suffix : ''}`;

    // District (House only)
    let district: string | null = null;
    if (chamber === 'house') {
      if (currentTerm.district !== undefined && currentTerm.district !== null) {
        district = currentTerm.district.toString().padStart(2, '0');
      } else if (AT_LARGE_STATES.has(state) || TERRITORIES.has(state)) {
        district = '00';
      }
    }

    // CWC code
    let cwcCode: string | null = null;
    if (chamber === 'house' && district !== null) {
      cwcCode = `H${state}${district}`;
    }
    // Senate CWC codes use bioguide_id + contact form (not constructible from district alone)

    // Voting status
    const isTerritory = TERRITORIES.has(state);
    const isVoting = isTerritory ? 0 : 1;
    let delegateType: string | null = null;
    if (isTerritory && chamber === 'house') {
      delegateType = state === 'PR' ? 'resident_commissioner' : 'delegate';
    }

    // FIPS codes
    const stateFips = STATE_TO_FIPS[state] || null;
    let cdGeoid: string | null = null;
    if (chamber === 'house' && stateFips && district) {
      cdGeoid = `${stateFips}${district}`;
    }

    // Party name normalization
    const party = normalizeParty(currentTerm.party);

    members.push({
      bioguide_id: bioguide,
      name: officialName,
      first_name: leg.name.first,
      last_name: leg.name.last,
      party,
      chamber,
      state,
      district,
      senate_class: currentTerm.class ?? null,
      phone: currentTerm.phone || null,
      office_address: currentTerm.address || currentTerm.office || null,
      contact_form_url: currentTerm.contact_form || null,
      website_url: currentTerm.url || null,
      cwc_code: cwcCode,
      is_voting: isVoting,
      delegate_type: delegateType,
      state_fips: stateFips,
      cd_geoid: cdGeoid,
      start_date: currentTerm.start,
      end_date: currentTerm.end,
    });
  }

  return members;
}

function normalizeParty(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'democrat' || lower === 'democratic') return 'Democrat';
  if (lower === 'republican') return 'Republican';
  if (lower === 'independent' || lower === 'libertarian' || lower === 'green') return raw;
  return raw;
}

// ============================================================================
// Database Upsert
// ============================================================================

function upsertMembers(db: Database.Database, members: ParsedMember[]): { upserted: number; deleted: number } {
  // Initialize schema from shared DDL
  db.exec(OFFICIALS_SCHEMA_DDL);

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

  // Get current bioguide IDs before upsert (for deletion of departed members)
  const currentIds = new Set(members.map(m => m.bioguide_id));
  const existingRows = db.prepare('SELECT bioguide_id FROM federal_members').all() as { bioguide_id: string }[];
  const toDelete = existingRows.filter(r => !currentIds.has(r.bioguide_id));

  // Sanity check: if more than 20 members would be deleted, the YAML is likely truncated
  if (toDelete.length > 20) {
    throw new Error(
      `Ingestion safety: ${toDelete.length} members would be deleted (threshold: 20). Possible truncated YAML. Aborting.`,
    );
  }

  // Transaction: upsert all + delete departed
  const run = db.transaction(() => {
    for (const member of members) {
      upsert.run(member);
    }
    if (toDelete.length > 0) {
      const deleteSql = db.prepare('DELETE FROM federal_members WHERE bioguide_id = ?');
      for (const row of toDelete) {
        deleteSql.run(row.bioguide_id);
      }
    }
  });

  run();

  return { upserted: members.length, deleted: toDelete.length };
}

function logIngestion(
  db: Database.Database,
  source: string,
  status: 'success' | 'failure',
  upserted: number,
  deleted: number,
  durationMs: number,
  error?: string,
): void {
  db.prepare(`
    INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(source, status, upserted, deleted, durationMs, error ?? null);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dbPathIdx = args.indexOf('--db');
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : 'officials.db';

  console.log(`\n=== Congress Legislators Ingestion ===`);
  console.log(`Database: ${dryRun ? '(dry run — no writes)' : dbPath}`);
  console.log(`Source: unitedstates/congress-legislators (CC0)\n`);

  const startTime = performance.now();

  try {
    // 1. Fetch YAML
    const yamlText = await fetchLegislatorsYaml();

    // 2. Parse
    const members = parseLegislators(yamlText);

    // Stats
    const house = members.filter(m => m.chamber === 'house');
    const senate = members.filter(m => m.chamber === 'senate');
    const delegates = members.filter(m => m.is_voting === 0);
    console.log(`\nParsed members:`);
    console.log(`  House:    ${house.length} (${house.filter(m => m.is_voting === 1).length} voting + ${delegates.filter(m => m.chamber === 'house').length} delegates)`);
    console.log(`  Senate:   ${senate.length}`);
    console.log(`  Total:    ${members.length}`);
    console.log(`  CWC codes: ${members.filter(m => m.cwc_code).length}`);

    if (dryRun) {
      console.log('\n[Dry run] Skipping database writes.');
      // Print a sample
      console.log('\nSample records:');
      for (const m of members.slice(0, 3)) {
        console.log(`  ${m.name} (${m.party[0]}) — ${m.chamber === 'house' ? `${m.state}-${m.district}` : m.state} — CWC: ${m.cwc_code || 'N/A'}`);
      }
      return;
    }

    // 3. Upsert into SQLite
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    const { upserted, deleted } = upsertMembers(db, members);
    const durationMs = Math.round(performance.now() - startTime);

    logIngestion(db, 'congress-legislators', 'success', upserted, deleted, durationMs);

    console.log(`\nIngestion complete:`);
    console.log(`  Upserted: ${upserted}`);
    console.log(`  Deleted:  ${deleted} (departed members)`);
    console.log(`  Duration: ${durationMs}ms`);

    // Verify
    const count = db.prepare('SELECT COUNT(*) as c FROM federal_members').get() as { c: number };
    console.log(`  Total in DB: ${count.c}`);

    db.close();
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    console.error('\nIngestion FAILED:', error);

    if (!dryRun) {
      try {
        const db = new Database(dbPath);
        logIngestion(db, 'congress-legislators', 'failure', 0, 0, durationMs,
          error instanceof Error ? error.message : String(error));
        db.close();
      } catch {
        // Can't even log — just exit
      }
    }

    process.exit(1);
  }
}

main();
