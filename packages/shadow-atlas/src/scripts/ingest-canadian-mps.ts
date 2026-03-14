#!/usr/bin/env tsx
/**
 * @deprecated Use unified hydration pipeline instead:
 *   npx tsx src/hydration/hydrate-country.ts --country CA
 *
 * Ingest Canadian Members of Parliament from Represent API (Open North)
 *
 * Data source: https://represent.opennorth.ca/representatives/house-of-commons/
 * License: Open Government License — Canada (OGL-CA)
 * Format: JSON REST API with pagination
 *
 * Usage:
 *   tsx src/scripts/ingest-canadian-mps.ts                    # Default: officials.db in cwd
 *   tsx src/scripts/ingest-canadian-mps.ts --db /data/sa.db   # Custom DB path
 *   tsx src/scripts/ingest-canadian-mps.ts --dry-run           # Fetch only, no DB writes
 *
 * This script:
 *   1. Fetches all House of Commons representatives from Represent API
 *   2. Parses JSON into structured MP records
 *   3. Upserts into canada_mps SQLite table
 *   4. Logs ingestion result to ingestion_log table
 *
 * Designed to run as a cron job (e.g., weekly or on Parliament composition change).
 * Idempotent: safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types (mirrors Represent API response)
// ============================================================================

interface RepresentMP {
  name: string;
  first_name: string;
  last_name: string;
  party_name: string;
  elected_office: string;
  district_name: string;
  email: string | null;
  url: string | null;
  photo_url: string | null;
  personal_url: string | null;
  offices: Array<{
    type: string;         // "legislature" | "constituency"
    postal: string | null;
    tel: string | null;
    fax: string | null;
  }>;
  extra: Record<string, unknown>;
  related: {
    boundary_url?: string;
    representative_set_url?: string;
  };
  source_url: string;
}

interface RepresentResponse {
  objects: RepresentMP[];
  meta: {
    total_count: number;
    next: string | null;
    previous: string | null;
    limit: number;
    offset: number;
  };
}

// Province code extraction from district name / boundary URL
const PROVINCE_PATTERNS: Record<string, string> = {
  'alberta': 'AB',
  'british columbia': 'BC',
  'manitoba': 'MB',
  'new brunswick': 'NB',
  'newfoundland': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  'nunavut': 'NU',
  'ontario': 'ON',
  'prince edward island': 'PE',
  'quebec': 'QC',
  'saskatchewan': 'SK',
  'yukon': 'YT',
};

// ============================================================================
// Fetcher
// ============================================================================

async function fetchAllMPs(): Promise<RepresentMP[]> {
  const allMPs: RepresentMP[] = [];
  let nextUrl: string | null = 'https://represent.opennorth.ca/representatives/house-of-commons/?limit=100';

  while (nextUrl) {
    console.log(`Fetching: ${nextUrl}`);
    const response = await fetch(nextUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as RepresentResponse;
    allMPs.push(...data.objects);
    console.log(`  Fetched ${data.objects.length} MPs (total: ${allMPs.length}/${data.meta.total_count})`);

    nextUrl = data.meta.next;
    if (nextUrl && !nextUrl.startsWith('http')) {
      nextUrl = `https://represent.opennorth.ca${nextUrl}`;
    }
  }

  return allMPs;
}

// ============================================================================
// Parsing
// ============================================================================

function extractRidingCode(mp: RepresentMP): string {
  // Extract riding code from boundary URL
  // Format: /boundaries/federal-electoral-districts-2023-representation-order/59028/
  // (boundary set name includes vintage suffix like -2023-representation-order)
  const boundaryUrl = mp.related?.boundary_url ?? '';
  const match = boundaryUrl.match(/\/boundaries\/[^/]+\/(\d+)\/?$/);
  if (match) return match[1];

  // Fallback: hash the district name (unreliable but better than nothing)
  console.warn(`  WARNING: Cannot extract riding code for "${mp.district_name}", using district name hash`);
  let hash = 0;
  for (let i = 0; i < mp.district_name.length; i++) {
    hash = ((hash << 5) - hash + mp.district_name.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash) % 100000).padStart(5, '0');
}

function extractProvince(mp: RepresentMP): string {
  // Check extra fields for province info
  const extra = mp.extra as Record<string, string | undefined>;
  if (extra.province) {
    const prov = extra.province.toLowerCase();
    for (const [pattern, code] of Object.entries(PROVINCE_PATTERNS)) {
      if (prov.includes(pattern)) return code;
    }
  }

  // Check boundary URL for province prefix
  const ridingCode = extractRidingCode(mp);
  const prefix = ridingCode.slice(0, 2);
  const prefixMap: Record<string, string> = {
    '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB',
    '24': 'QC', '35': 'ON', '46': 'MB', '47': 'SK',
    '48': 'AB', '59': 'BC', '60': 'YT', '61': 'NT', '62': 'NU',
  };
  if (prefixMap[prefix]) return prefixMap[prefix];

  console.warn(`  WARNING: Cannot determine province for "${mp.name}" in "${mp.district_name}"`);
  return 'XX';
}

function extractPhone(mp: RepresentMP): string | null {
  // Prefer legislature (Ottawa) office phone
  const legOffice = mp.offices.find(o => o.type === 'legislature');
  if (legOffice?.tel) return legOffice.tel;
  // Fallback to constituency office
  const conOffice = mp.offices.find(o => o.type === 'constituency');
  return conOffice?.tel ?? null;
}

function extractOfficeAddress(mp: RepresentMP): string | null {
  const legOffice = mp.offices.find(o => o.type === 'legislature');
  return legOffice?.postal ?? null;
}

function extractConstituencyOffice(mp: RepresentMP): string | null {
  const conOffice = mp.offices.find(o => o.type === 'constituency');
  return conOffice?.postal ?? null;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPathIdx = args.indexOf('--db');
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : 'officials.db';
  const dryRun = args.includes('--dry-run');

  console.log(`Canadian MP Ingestion`);
  console.log(`  DB: ${dbPath}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Fetch all MPs
  console.log('Step 1: Fetching MPs from Represent API...');
  const mps = await fetchAllMPs();
  console.log(`  Fetched ${mps.length} MPs`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — sample records:');
    for (const mp of mps.slice(0, 5)) {
      console.log(`  ${mp.name} — ${mp.district_name} (${mp.party_name})`);
    }
    console.log(`  ... and ${Math.max(0, mps.length - 5)} more`);
    return;
  }

  // Step 2: Open DB + initialize schema
  console.log('Step 2: Initializing database...');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(OFFICIALS_SCHEMA_DDL);
  console.log('  Schema initialized');
  console.log('');

  // Step 3: Upsert MPs
  console.log('Step 3: Upserting MPs...');
  const upsert = db.prepare(`
    INSERT INTO canada_mps (
      parliament_id, name, name_fr, first_name, last_name,
      party, party_fr, riding_code, riding_name, riding_name_fr,
      province, email, phone, office_address, constituency_office,
      website_url, photo_url, is_active, parliament_session,
      updated_at
    ) VALUES (
      @parliament_id, @name, @name_fr, @first_name, @last_name,
      @party, @party_fr, @riding_code, @riding_name, @riding_name_fr,
      @province, @email, @phone, @office_address, @constituency_office,
      @website_url, @photo_url, @is_active, @parliament_session,
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(parliament_id) DO UPDATE SET
      name = excluded.name,
      name_fr = excluded.name_fr,
      party = excluded.party,
      riding_code = excluded.riding_code,
      riding_name = excluded.riding_name,
      province = excluded.province,
      email = excluded.email,
      phone = excluded.phone,
      office_address = excluded.office_address,
      constituency_office = excluded.constituency_office,
      website_url = excluded.website_url,
      photo_url = excluded.photo_url,
      is_active = excluded.is_active,
      parliament_session = excluded.parliament_session,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `);

  let upserted = 0;
  const upsertAll = db.transaction(() => {
    for (const mp of mps) {
      const ridingCode = extractRidingCode(mp);
      const province = extractProvince(mp);

      // Generate parliament_id from personal URL (unique per MP) or riding+name
      // mp.url = "https://www.ourcommons.ca/Members/en/parm-bains(111067)"
      // mp.source_url = shared search URL (NOT unique, same for all MPs)
      const memberIdMatch = (mp.url ?? '').match(/\((\d+)\)/);
      const parliamentId = memberIdMatch
        ? `occ-${memberIdMatch[1]}`  // "occ-111067" (ourcommons.ca member ID)
        : `${ridingCode}-${mp.last_name.toLowerCase().replace(/\s/g, '-')}`;

      upsert.run({
        parliament_id: parliamentId,
        name: mp.name,
        name_fr: null,  // Represent API doesn't provide French names consistently
        first_name: mp.first_name,
        last_name: mp.last_name,
        party: mp.party_name,
        party_fr: null,
        riding_code: ridingCode,
        riding_name: mp.district_name,
        riding_name_fr: null,
        province,
        email: mp.email,
        phone: extractPhone(mp),
        office_address: extractOfficeAddress(mp),
        constituency_office: extractConstituencyOffice(mp),
        website_url: mp.url ?? mp.personal_url,
        photo_url: mp.photo_url,
        is_active: 1,
        parliament_session: '45th',  // Current parliament
      });
      upserted++;
    }
  });

  upsertAll();
  const durationMs = Date.now() - startTime;

  console.log(`  Upserted ${upserted} MPs`);
  console.log('');

  // Step 4: Log ingestion
  const logStmt = db.prepare(`
    INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms)
    VALUES ('canada-mps', 'success', ?, 0, ?)
  `);
  logStmt.run(upserted, durationMs);

  // Step 5: Verify
  const count = (db.prepare('SELECT COUNT(*) as count FROM canada_mps WHERE is_active = 1').get() as { count: number }).count;
  console.log(`Verification: ${count} active Canadian MPs in database`);
  console.log(`Duration: ${durationMs}ms`);

  // Province breakdown
  const provinces = db.prepare(
    'SELECT province, COUNT(*) as count FROM canada_mps WHERE is_active = 1 GROUP BY province ORDER BY count DESC'
  ).all() as Array<{ province: string; count: number }>;

  console.log('');
  console.log('Province breakdown:');
  for (const p of provinces) {
    console.log(`  ${p.province}: ${p.count} MPs`);
  }

  db.close();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
