#!/usr/bin/env tsx
/**
 * @deprecated Use unified hydration pipeline instead:
 *   npx tsx src/hydration/hydrate-country.ts --country NZ
 *
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
  // Note: Te Atatū is a GENERAL electorate (West Auckland), not Māori
]);

function isMaoriElectorate(name: string): boolean {
  return MAORI_ELECTORATES.has(name) ||
    MAORI_ELECTORATES.has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

/**
 * Normalize a name into a stable, deterministic ID slug.
 * Strips diacritics (macrons etc.), lowercases, replaces non-alphanum with hyphens.
 * Same input always produces the same output regardless of source ordering.
 */
function normalizeForId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics (macrons, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')     // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '');         // trim leading/trailing hyphens
}

/**
 * Post-process an array of MPs to detect and fix parliament_id collisions.
 * If two MPs share the same name-based ID, disambiguate with electorate name.
 */
function deduplicateParliamentIds(mps: NZMP[]): void {
  const idCounts = new Map<string, number>();
  for (const mp of mps) {
    idCounts.set(mp.parliament_id, (idCounts.get(mp.parliament_id) ?? 0) + 1);
  }

  // Only process IDs that appear more than once
  const duplicateIds = new Set<string>();
  for (const [id, count] of idCounts) {
    if (count > 1) duplicateIds.add(id);
  }

  if (duplicateIds.size === 0) return;

  for (const mp of mps) {
    if (duplicateIds.has(mp.parliament_id)) {
      const suffix = mp.electorate_name ? normalizeForId(mp.electorate_name) : 'list';
      mp.parliament_id = `${mp.parliament_id}-${suffix}`;
    }
  }
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

/**
 * Fetch NZ MPs from Wikipedia's 54th Parliament page.
 *
 * Wikipedia has structured tables for electorate MPs and is not behind bot protection.
 * Uses the MediaWiki API to get wikitext, then parses the General/Māori electorate tables
 * plus the party composition for list MPs.
 */
async function fetchFromWikipedia(): Promise<NZMP[]> {
  console.log('  Trying Wikipedia API for 54th NZ Parliament...');

  const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=54th_New_Zealand_Parliament&prop=wikitext&format=json';

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VOTER-Protocol-Ingestion/1.0 (civic data, research)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Wikipedia API returned HTTP ${response.status}`);
  }

  const data = await response.json() as {
    parse?: { wikitext?: { '*'?: string } };
  };

  const wikitext = data.parse?.wikitext?.['*'] ?? '';
  if (!wikitext) {
    throw new Error('Wikipedia returned empty wikitext');
  }

  return parseWikipediaTables(wikitext);
}

function parseWikipediaTables(wikitext: string): NZMP[] {
  const mps: NZMP[] = [];

  // Find General Electorates table
  const generalIdx = wikitext.indexOf('General electorates===');
  // Māori heading may use macron: "===Māori electorates===" or "=== Māori electorates ==="
  let maoriIdx = wikitext.indexOf('ori electorates===');
  // Make sure we find the heading, not body text — search for === prefix
  const maoriHeadingPattern = /===\s*M[aā]ori electorates\s*===/i;
  const maoriMatch = maoriHeadingPattern.exec(wikitext);
  if (maoriMatch) {
    maoriIdx = maoriMatch.index;
  }

  if (generalIdx > 0) {
    // Find the table between General electorates and Maori electorates
    const tableEnd = maoriIdx > generalIdx ? maoriIdx : wikitext.indexOf('|}', generalIdx);
    const generalTable = wikitext.substring(generalIdx, tableEnd > generalIdx ? tableEnd : generalIdx + 10000);

    // Parse rows: each row starts with |- and contains cells starting with |
    const rows = generalTable.split(/\|-\s*\n/);
    for (const row of rows) {
      const mp = parseWikiRow(row, 'general');
      if (mp) {
        mps.push(mp);
      }
    }
  }

  if (maoriIdx > 0) {
    // Find end of Maori table
    const tableEnd = wikitext.indexOf('|}', maoriIdx);
    const maoriTable = wikitext.substring(maoriIdx, tableEnd > maoriIdx ? tableEnd : maoriIdx + 5000);

    const rows = maoriTable.split(/\|-\s*\n/);
    for (const row of rows) {
      const mp = parseWikiRow(row, 'maori');
      if (mp) {
        mps.push(mp);
      }
    }
  }

  // Also parse the Members section for list MPs
  const membersIdx = wikitext.indexOf('=== Members ===');
  if (membersIdx < 0) {
    // Try alternate heading
    const altIdx = wikitext.indexOf('===Members===');
  }
  // List MPs are harder to extract from Wikipedia — they're typically not in electorate tables
  // We'll note them as missing in the output

  deduplicateParliamentIds(mps);
  return mps;
}

function parseWikiRow(row: string, type: 'general' | 'maori'): NZMP | null {
  // Each row has cells like:
  // |{{NZ electorate link|Auckland Central}}
  // |{{Sort|2|[[Auckland Region|Auckland]]}}
  // |{{sortname|Chlöe|Swarbrick}}
  // |{{Party name with color|Green Party of Aotearoa New Zealand}}

  const cells = row.split(/\n\|/).map(c => c.replace(/^\|/, '').trim()).filter(c => c.length > 0);
  if (cells.length < 3) return null;

  // Extract electorate name from wiki markup
  const electorateRaw = cells[0];
  let electorate = '';

  // Match {{NZ electorate link|Name}} or [[Name (NZ electorate)|Name]] or plain [[Name]]
  const elecMatch = /(?:NZ electorate link\|([^}]+)\}\})|(?:\[\[([^|\]]+(?:\(New Zealand electorate\))?)\|?([^\]]*)\]\])/.exec(electorateRaw);
  if (elecMatch) {
    electorate = (elecMatch[1] || elecMatch[3] || elecMatch[2] || '').trim();
    // Clean up "(New Zealand electorate)" suffix
    electorate = electorate.replace(/\s*\(New Zealand electorate\)\s*/, '').trim();
  }
  if (!electorate) {
    // Try extracting from any [[...]] link
    const linkMatch = /\[\[([^|\]]+?)(?:\s*\(.*?\))?\|?([^\]]*)\]\]/.exec(electorateRaw);
    if (linkMatch) {
      electorate = (linkMatch[2] || linkMatch[1]).replace(/\s*\(.*?\)\s*/, '').trim();
    }
  }
  if (!electorate) return null;

  // Extract MP name from {{sortname|First|Last}} or [[Name]]
  const mpRaw = cells.length > 2 ? cells[2] : '';
  let firstName = '';
  let lastName = '';

  const sortnameMatch = /sortname\|([^|}]+)\|([^|}]+)/.exec(mpRaw);
  if (sortnameMatch) {
    firstName = sortnameMatch[1].trim();
    lastName = sortnameMatch[2].trim();
  } else {
    const linkMatch = /\[\[([^|\]]+)\|?([^\]]*)\]\]/.exec(mpRaw);
    if (linkMatch) {
      const name = (linkMatch[2] || linkMatch[1]).trim();
      const parts = name.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
  }
  if (!firstName && !lastName) return null;

  const name = `${firstName} ${lastName}`.trim();

  // Extract party — may be in cells[3] or cells[4] depending on table format.
  // General table: {{Party name with color|Green Party of Aotearoa New Zealand}}
  // Maori table: {{Party color cell|Te Pāti Māori}} \n |[[Te Pāti Māori|Māori]]
  // Search across all remaining cells for a party pattern.
  let party = '';
  for (let ci = 3; ci < cells.length && !party; ci++) {
    const cellText = cells[ci];
    // {{Party name with color|...}} or {{Party color cell|...}}
    const partyTemplateMatch = /Party (?:name with color|color cell)\|([^}]+)\}\}/.exec(cellText);
    if (partyTemplateMatch) {
      party = partyTemplateMatch[1].trim();
      break;
    }
    // [[Party Name|Display]] or [[Party Name]]
    const linkMatch = /\[\[([^|\]]+)\|?([^\]]*)\]\]/.exec(cellText);
    if (linkMatch) {
      const resolved = (linkMatch[2] || linkMatch[1]).trim();
      // Skip non-party links (e.g., "Independent politician")
      if (resolved && resolved !== 'Independent politician') {
        party = resolved;
        break;
      } else if (resolved === 'Independent politician' || linkMatch[1].includes('Independent')) {
        party = 'Independent';
        break;
      }
    }
    // Plain text "Independent"
    if (/independent/i.test(cellText) && cellText.length < 30) {
      party = 'Independent';
      break;
    }
  }
  if (!party) return null;

  // Simplify party names
  const partyMap: Record<string, string> = {
    'New Zealand National Party': 'National',
    'New Zealand Labour Party': 'Labour',
    'Green Party of Aotearoa New Zealand': 'Green',
    'ACT New Zealand': 'ACT',
    'New Zealand First': 'NZ First',
    'Te Pāti Māori': 'Te Pāti Māori',
  };
  party = partyMap[party] ?? party;

  return {
    parliament_id: `nzp-${normalizeForId(name)}`,
    name,
    first_name: firstName || null,
    last_name: lastName || null,
    party,
    electorate_name: electorate,
    electorate_type: type === 'maori' ? 'maori' : (isMaoriElectorate(electorate) ? 'maori' : 'general'),
    email: null,
  };
}

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

    let electorateType: 'general' | 'maori' | 'list' = 'list';
    if (electorateName) {
      electorateType = isMaoriElectorate(electorateName) ? 'maori' : 'general';
    }

    mps.push({
      parliament_id: `nzp-${normalizeForId(name)}`,
      name,
      first_name: firstName,
      last_name: lastName,
      party,
      electorate_name: electorateName,
      electorate_type: electorateType,
      email,
    });
  }

  deduplicateParliamentIds(mps);
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

      mps.push({
        parliament_id: `nzp-${normalizeForId(name)}`,
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

  deduplicateParliamentIds(mps);
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

  // Step 1: Fetch all MPs — try data.govt.nz first, then Wikipedia, then parliament.nz
  console.log('Step 1: Fetching MPs...');
  let mps: NZMP[] = [];

  try {
    mps = await fetchFromDataGovtNZ();
    console.log(`  Fetched ${mps.length} MPs from data.govt.nz CSV`);
  } catch (err) {
    console.warn(`  data.govt.nz failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log('  Falling back to Wikipedia...');

    try {
      mps = await fetchFromWikipedia();
      console.log(`  Fetched ${mps.length} MPs from Wikipedia (electorate MPs only, list MPs not included)`);
    } catch (err2) {
      console.warn(`  Wikipedia failed: ${err2 instanceof Error ? err2.message : String(err2)}`);
      console.log('  Falling back to parliament.nz...');

      try {
        await rateLimitedDelay(1000);
        mps = await fetchFromParliamentNZ();
        console.log(`  Fetched ${mps.length} MPs from parliament.nz`);
      } catch (err3) {
        console.error(`  parliament.nz also failed: ${err3 instanceof Error ? err3.message : String(err3)}`);
        console.error('');
        console.error('All data sources failed. NZ MP ingestion cannot proceed.');
        console.error('Manual data entry or alternative source required.');
        process.exit(1);
      }
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
