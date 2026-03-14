#!/usr/bin/env tsx
/**
 * @deprecated Use unified hydration pipeline instead:
 *   npx tsx src/hydration/hydrate-country.ts --country AU
 *
 * Ingest Australian Members of Parliament (House of Representatives)
 *
 * Data source: APH (Parliament of Australia) Parliamentarian Search
 * URL: https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results
 * License: Open Government (Commonwealth of Australia)
 *
 * Strategy: Scrape the paginated search results HTML. No public JSON API exists
 * without requiring an API key (OpenAustralia, TheyVoteForYou both need keys).
 * The APH website is the authoritative source.
 *
 * Usage:
 *   tsx src/scripts/ingest-au-mps.ts                    # Default: officials.db in cwd
 *   tsx src/scripts/ingest-au-mps.ts --db /data/sa.db   # Custom DB path
 *   tsx src/scripts/ingest-au-mps.ts --dry-run           # Fetch only, no DB writes
 *
 * This script:
 *   1. Fetches all House of Representatives members from APH search pages
 *   2. Parses HTML into structured MP records
 *   3. Upserts into au_mps SQLite table
 *   4. Logs ingestion result to ingestion_log table
 *
 * Designed to run as a cron job. Idempotent: safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types
// ============================================================================

interface AustralianMP {
  aph_id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  party: string;
  division_name: string;
  state: string;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
}

// ============================================================================
// State Name → Code Mapping
// ============================================================================

const STATE_MAP: Record<string, string> = {
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

function normalizeState(raw: string): string {
  return STATE_MAP[raw.toLowerCase().trim()] ?? raw.trim();
}

// ============================================================================
// Rate Limiter
// ============================================================================

async function rateLimitedDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// HTML Parser (lightweight, no external dependency)
// ============================================================================

function parseSearchPage(html: string): AustralianMP[] {
  const members: AustralianMP[] = [];

  // APH HTML structure (2026):
  // <div class="row border-bottom padding-top">
  //   <div>
  //     <h4><a href="/Senators_and_Members/Parliamentarian?MPID=XXX">NAME MP</a></h4>
  //     <dl>
  //       <dt>For</dt><dd>ELECTORATE, STATE</dd>
  //       <dt>Party</dt><dd>PARTY NAME</dd>
  //       <dd><a href="mailto:...">...</a></dd>
  //     </dl>
  //   </div>
  // </div>
  //
  // Split by the containing div (border-bottom) to get complete sections.
  const sections = html.split(/(?=<div\s+class="row\s+border-bottom)/);

  for (const section of sections) {
    // Find MPID link
    const localMatch = /href="\/Senators_and_Members\/Parliamentarian\?MPID=([^"]+)"[^>]*>([^<]+)<\/a>/i.exec(section);
    if (!localMatch) continue;

    const aphId = localMatch[1].trim();
    let rawName = localMatch[2].trim();
    // Strip honorifics and " MP" suffix
    rawName = rawName.replace(/\s+MP$/i, '').trim();
    // Strip leading Hon, Mr, Mrs, Ms, Dr, etc.
    rawName = rawName.replace(/^(?:Hon\.?\s+|Rt\.?\s+Hon\.?\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Dr\.?\s+|Prof\.?\s+)+/i, '').trim();

    // Extract electorate from <dt>For</dt><dd>ELECTORATE, STATE</dd>
    const electorateMatch = /<dt>For<\/dt>\s*<dd>([^<]+)<\/dd>/i.exec(section);
    let divisionName = '';
    let state = '';

    if (electorateMatch) {
      const parts = electorateMatch[1].split(',').map(s => s.trim());
      divisionName = parts[0] || '';
      state = parts.length > 1 ? normalizeState(parts[1]) : '';
    }

    // Extract party from <dt>Party</dt><dd>PARTY NAME</dd>
    const partyMatch = /<dt>Party<\/dt>\s*<dd>([^<]+)<\/dd>/i.exec(section);
    let party = '';
    if (partyMatch) {
      party = partyMatch[1].trim();
    }

    // Extract email
    const emailMatch = /href="mailto:([^"]+)"/i.exec(section);
    const email = emailMatch ? emailMatch[1].trim() : null;

    // Extract phone
    const phoneMatch = /(?:Tel|Phone|Ph)[:\s]*([0-9()\s\-+]+)/i.exec(section);
    const phone = phoneMatch ? phoneMatch[1].trim() : null;

    // Extract photo URL
    const photoMatch = /src="(\/api\/parliamentarian\/[^"]+\/image[^"]*)"/i.exec(section);
    const photoUrl = photoMatch ? `https://www.aph.gov.au${photoMatch[1]}` : null;

    // Parse name
    const nameParts = rawName.split(' ');
    const first_name = nameParts.length > 1 ? nameParts[0] : rawName;
    const last_name = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    if (divisionName && party) {
      members.push({
        aph_id: aphId,
        name: rawName,
        first_name,
        last_name,
        party,
        division_name: divisionName,
        state,
        email,
        phone,
        photo_url: photoUrl,
      });
    }
  }

  return members;
}

function parseTotalResults(html: string): number {
  // Pattern: "1 to 12 of 149 results"
  const match = /of\s+(\d+)\s+results/i.exec(html);
  return match ? parseInt(match[1], 10) : 0;
}

// ============================================================================
// Fetcher
// ============================================================================

const BASE_URL = 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results';
const RATE_LIMIT_MS = 1000; // 1 request per second for government website

async function fetchAllMembers(): Promise<AustralianMP[]> {
  const allMembers: AustralianMP[] = [];
  let page = 0;
  let totalResults = 0;
  const seen = new Set<string>();

  // First page to get total
  const firstUrl = `${BASE_URL}?q=&mem=1&par=-1&gen=0&ps=0&st=1`;
  console.log(`Fetching page 1: ${firstUrl}`);

  const firstResponse = await fetch(firstUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!firstResponse.ok) {
    throw new Error(`HTTP ${firstResponse.status}: ${firstResponse.statusText}`);
  }

  const firstHtml = await firstResponse.text();
  totalResults = parseTotalResults(firstHtml);
  console.log(`  Total results: ${totalResults}`);

  const firstPageMembers = parseSearchPage(firstHtml);
  for (const m of firstPageMembers) {
    if (!seen.has(m.aph_id)) {
      allMembers.push(m);
      seen.add(m.aph_id);
    }
  }
  console.log(`  Parsed ${firstPageMembers.length} members from page 1 (total: ${allMembers.length})`);

  // Paginate through remaining pages
  const pageSize = Math.max(firstPageMembers.length, 12);
  const totalPages = Math.ceil(totalResults / pageSize);

  for (let p = 2; p <= totalPages; p++) {
    await rateLimitedDelay(RATE_LIMIT_MS);
    const pageUrl = `${BASE_URL}?q=&mem=1&par=-1&gen=0&ps=0&st=1&page=${p}`;
    console.log(`Fetching page ${p}/${totalPages}`);

    try {
      const response = await fetch(pageUrl, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.warn(`  WARNING: Page ${p} returned HTTP ${response.status}, skipping`);
        continue;
      }

      const html = await response.text();
      const pageMembers = parseSearchPage(html);
      for (const m of pageMembers) {
        if (!seen.has(m.aph_id)) {
          allMembers.push(m);
          seen.add(m.aph_id);
        }
      }
      console.log(`  Parsed ${pageMembers.length} members from page ${p} (total: ${allMembers.length})`);
    } catch (err) {
      console.warn(`  WARNING: Failed to fetch page ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return allMembers;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPathIdx = args.indexOf('--db');
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : 'officials.db';
  const dryRun = args.includes('--dry-run');

  console.log('Australian MP Ingestion (House of Representatives)');
  console.log(`  DB: ${dbPath}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Fetch all MPs
  console.log('Step 1: Fetching MPs from APH website...');
  const mps = await fetchAllMembers();
  console.log(`  Fetched ${mps.length} MPs`);

  if (mps.length < 100) {
    throw new Error(
      `Sanity check failed: only ${mps.length} MPs found (expected ~150). ` +
      `APH website structure may have changed. Aborting to prevent partial data.`
    );
  }
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — sample records:');
    for (const mp of mps.slice(0, 10)) {
      console.log(`  [${mp.aph_id}] ${mp.name} — ${mp.division_name}, ${mp.state} (${mp.party})`);
    }
    console.log(`  ... and ${Math.max(0, mps.length - 10)} more`);
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

  let upserted = 0;
  const upsertAll = db.transaction(() => {
    for (const mp of mps) {
      upsert.run({
        aph_id: mp.aph_id,
        name: mp.name,
        first_name: mp.first_name,
        last_name: mp.last_name,
        party: mp.party,
        division_name: mp.division_name,
        division_code: null,  // Will be matched from boundary data post-ingestion
        state: mp.state,
        email: mp.email,
        phone: mp.phone,
        office_address: null,
        website_url: null,
        photo_url: mp.photo_url,
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
    VALUES ('au-mps', 'success', ?, 0, ?)
  `);
  logStmt.run(upserted, durationMs);

  // Step 5: Verify
  const count = (db.prepare('SELECT COUNT(*) as count FROM au_mps WHERE is_active = 1').get() as { count: number }).count;
  console.log(`Verification: ${count} active Australian MPs in database`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);

  // Party breakdown
  const parties = db.prepare(
    'SELECT party, COUNT(*) as count FROM au_mps WHERE is_active = 1 GROUP BY party ORDER BY count DESC'
  ).all() as Array<{ party: string; count: number }>;

  console.log('');
  console.log('Party breakdown:');
  for (const p of parties) {
    console.log(`  ${p.party}: ${p.count} MPs`);
  }

  // State breakdown
  const states = db.prepare(
    'SELECT state, COUNT(*) as count FROM au_mps WHERE is_active = 1 GROUP BY state ORDER BY count DESC'
  ).all() as Array<{ state: string; count: number }>;

  console.log('');
  console.log('State breakdown:');
  for (const s of states) {
    console.log(`  ${s.state}: ${s.count} MPs`);
  }

  db.close();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
