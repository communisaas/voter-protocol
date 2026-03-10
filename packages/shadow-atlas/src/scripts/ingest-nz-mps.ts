#!/usr/bin/env tsx
/**
 * Ingest New Zealand Members of Parliament
 *
 * Data source: NZ Parliament website (HTML scraping)
 * URL: https://www.parliament.nz/en/mps-and-electorates/members-of-parliament/
 * License: Creative Commons Attribution 4.0 (NZ Government)
 *
 * Fallback: data.govt.nz CSV dataset
 *
 * Usage:
 *   tsx src/scripts/ingest-nz-mps.ts                    # Default: officials.db in cwd
 *   tsx src/scripts/ingest-nz-mps.ts --db /data/sa.db   # Custom DB path
 *   tsx src/scripts/ingest-nz-mps.ts --dry-run           # Fetch only, no DB writes
 *
 * This script:
 *   1. Fetches all current NZ MPs
 *   2. Parses into structured MP records
 *   3. Upserts into nz_mps SQLite table
 *   4. Logs ingestion result to ingestion_log table
 *
 * NZ Parliament: 54th Parliament, ~123 MPs
 *   - 65 general electorate MPs
 *   - 7 Maori electorate MPs
 *   - ~51 list MPs (proportional representation, no electorate)
 *
 * Designed to run as a cron job. Idempotent: safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types
// ============================================================================

interface NZMP {
  parliament_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  electorate_name: string | null;
  electorate_type: 'general' | 'maori' | 'list';
  email: string | null;
}

// ============================================================================
// Known Maori Electorates (54th Parliament, 2025 boundaries)
// ============================================================================

const MAORI_ELECTORATES = new Set([
  'Hauraki-Waikato',
  'Ikaroa-Rāwhiti',
  'Ikaroa-Rawhiti',
  'Tāmaki Makaurau',
  'Tamaki Makaurau',
  'Te Tai Hauāuru',
  'Te Tai Hauauru',
  'Te Tai Tokerau',
  'Te Tai Tonga',
  'Waiariki',
  // Pre-2025 name variants
  'Te Atatū',
  'Te Atatu',
]);

function isMaoriElectorate(name: string): boolean {
  return MAORI_ELECTORATES.has(name) ||
    MAORI_ELECTORATES.has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

// ============================================================================
// Rate Limiter
// ============================================================================

async function rateLimitedDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Data Source: data.govt.nz CSV
// ============================================================================

const DATA_GOVT_NZ_URL = 'https://catalogue.data.govt.nz/dataset/members-of-parliament/resource/89069a40-abcf-4190-9665-3513ff004dd8';

// The CSV resource URL from data.govt.nz
// Format: Honorific, First Name, Last Name, Electorate, Party, Email
async function fetchFromDataGovtNZ(): Promise<NZMP[]> {
  // Try the direct download URL for the resource
  const downloadUrl = 'https://catalogue.data.govt.nz/dataset/d97b9a53-4660-4dd5-89df-6c4536e92a02/resource/89069a40-abcf-4190-9665-3513ff004dd8/download/mp-contact-details.csv';

  console.log(`  Trying data.govt.nz CSV: ${downloadUrl}`);

  const response = await fetch(downloadUrl, {
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
  return parseCSV(csv);
}

function parseCSV(csv: string): NZMP[] {
  const lines = csv.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV has fewer than 2 lines');
  }

  // Parse header to find column indices
  const header = parseCSVLine(lines[0]);
  const headerLower = header.map(h => h.toLowerCase().trim());

  const firstNameIdx = headerLower.findIndex(h => h.includes('first') && h.includes('name'));
  const lastNameIdx = headerLower.findIndex(h => h.includes('last') && h.includes('name'));
  const electorateIdx = headerLower.findIndex(h => h.includes('electorate'));
  const partyIdx = headerLower.findIndex(h => h.includes('party'));
  const emailIdx = headerLower.findIndex(h => h.includes('email'));
  const honorificIdx = headerLower.findIndex(h => h.includes('honorific') || h.includes('title'));

  if (partyIdx === -1) {
    throw new Error(`Cannot find party column in CSV header: ${header.join(', ')}`);
  }

  const mps: NZMP[] = [];
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
    const parliamentId = `nz-${(lastName ?? name).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${i}`;

    let electorateType: 'general' | 'maori' | 'list' = 'list';
    if (electorateName) {
      electorateType = isMaoriElectorate(electorateName) ? 'maori' : 'general';
    }

    mps.push({
      parliament_id: parliamentId,
      name,
      first_name: firstName,
      last_name: lastName,
      party,
      electorate_name: electorateName,
      electorate_type: electorateType,
      email,
    });
  }

  return mps;
}

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

// ============================================================================
// Fallback: NZ Parliament website HTML scraping
// ============================================================================

async function fetchFromParliamentNZ(): Promise<NZMP[]> {
  console.log('  Trying parliament.nz HTML scraping...');
  const url = 'https://www.parliament.nz/en/mps-and-electorates/members-of-parliament/';

  const response = await fetch(url, {
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

  // Check for bot protection
  if (html.includes('Verifying your browser') || html.includes('Radware') || html.includes('Incapsula')) {
    throw new Error('parliament.nz returned bot protection page');
  }

  return parseParliamentNZHTML(html);
}

function parseParliamentNZHTML(html: string): NZMP[] {
  const mps: NZMP[] = [];

  // NZ Parliament lists MPs in card-like elements
  // Pattern: member name, party, electorate
  const memberPattern = /class="[^"]*member[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li)>/gi;
  let match;
  let idx = 0;

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

      idx++;
      mps.push({
        parliament_id: `nzp-${(lastName ?? name).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${idx}`,
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

  return mps;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPathIdx = args.indexOf('--db');
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : 'officials.db';
  const dryRun = args.includes('--dry-run');

  console.log('New Zealand MP Ingestion');
  console.log(`  DB: ${dbPath}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Fetch all MPs — try data.govt.nz first, then parliament.nz
  console.log('Step 1: Fetching MPs...');
  let mps: NZMP[] = [];

  try {
    mps = await fetchFromDataGovtNZ();
    console.log(`  Fetched ${mps.length} MPs from data.govt.nz CSV`);
  } catch (err) {
    console.warn(`  data.govt.nz failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log('  Falling back to parliament.nz...');

    try {
      await rateLimitedDelay(1000);
      mps = await fetchFromParliamentNZ();
      console.log(`  Fetched ${mps.length} MPs from parliament.nz`);
    } catch (err2) {
      console.error(`  parliament.nz also failed: ${err2 instanceof Error ? err2.message : String(err2)}`);
      console.error('');
      console.error('Both data sources failed. NZ MP ingestion cannot proceed.');
      console.error('Manual data entry or alternative source required.');
      process.exit(1);
    }
  }

  if (mps.length === 0) {
    console.error('No MPs fetched from any source. Aborting.');
    process.exit(1);
  }

  console.log('');

  if (dryRun) {
    console.log('DRY RUN — sample records:');
    for (const mp of mps.slice(0, 10)) {
      const elec = mp.electorate_name ? `${mp.electorate_name} (${mp.electorate_type})` : 'List MP';
      console.log(`  ${mp.name} — ${elec} (${mp.party})`);
    }
    console.log(`  ... and ${Math.max(0, mps.length - 10)} more`);
    const types = { general: 0, maori: 0, list: 0 };
    for (const mp of mps) types[mp.electorate_type]++;
    console.log(`  Types: ${types.general} general, ${types.maori} Maori, ${types.list} list`);
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

  let upserted = 0;
  const upsertAll = db.transaction(() => {
    for (const mp of mps) {
      upsert.run({
        parliament_id: mp.parliament_id,
        name: mp.name,
        first_name: mp.first_name,
        last_name: mp.last_name,
        party: mp.party,
        electorate_name: mp.electorate_name,
        electorate_code: null,  // Will be matched from boundary data post-ingestion
        electorate_type: mp.electorate_type,
        email: mp.email,
        phone: null,
        office_address: null,
        website_url: null,
        photo_url: null,
        is_active: 1,
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
    VALUES ('nz-mps', 'success', ?, 0, ?)
  `);
  logStmt.run(upserted, durationMs);

  // Step 5: Verify
  const count = (db.prepare('SELECT COUNT(*) as count FROM nz_mps WHERE is_active = 1').get() as { count: number }).count;
  console.log(`Verification: ${count} active NZ MPs in database`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);

  // Party breakdown
  const parties = db.prepare(
    'SELECT party, COUNT(*) as count FROM nz_mps WHERE is_active = 1 GROUP BY party ORDER BY count DESC'
  ).all() as Array<{ party: string; count: number }>;

  console.log('');
  console.log('Party breakdown:');
  for (const p of parties) {
    console.log(`  ${p.party}: ${p.count} MPs`);
  }

  // Electorate type breakdown
  const types = db.prepare(
    'SELECT electorate_type, COUNT(*) as count FROM nz_mps WHERE is_active = 1 GROUP BY electorate_type ORDER BY count DESC'
  ).all() as Array<{ electorate_type: string; count: number }>;

  console.log('');
  console.log('Electorate type breakdown:');
  for (const t of types) {
    console.log(`  ${t.electorate_type}: ${t.count} MPs`);
  }

  db.close();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
