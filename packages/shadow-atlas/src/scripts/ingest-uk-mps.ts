#!/usr/bin/env tsx
/**
 * @deprecated Use unified hydration pipeline instead:
 *   npx tsx src/hydration/hydrate-country.ts --country GB
 *
 * Ingest UK Members of Parliament from UK Parliament Members API
 *
 * Data source: https://members-api.parliament.uk/api/Members/Search
 * License: Open Parliament License
 * Format: JSON REST API with pagination (skip/take)
 *
 * Usage:
 *   tsx src/scripts/ingest-uk-mps.ts                    # Default: officials.db in cwd
 *   tsx src/scripts/ingest-uk-mps.ts --db /data/sa.db   # Custom DB path
 *   tsx src/scripts/ingest-uk-mps.ts --dry-run           # Fetch only, no DB writes
 *
 * This script:
 *   1. Fetches all House of Commons members from UK Parliament API
 *   2. Fetches contact details for each member (rate-limited)
 *   3. Upserts into uk_mps SQLite table
 *   4. Logs ingestion result to ingestion_log table
 *
 * Designed to run as a cron job (e.g., weekly or on Parliament composition change).
 * Idempotent: safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { OFFICIALS_SCHEMA_DDL } from '../db/officials-schema.js';

// ============================================================================
// Types (UK Parliament API response)
// ============================================================================

interface UKParliamentMember {
  value: {
    id: number;
    nameListAs: string;
    nameDisplayAs: string;
    nameFullTitle: string;
    nameAddressAs: string | null;
    latestParty: {
      id: number;
      name: string;
      abbreviation: string;
    };
    gender: string;
    latestHouseMembership: {
      membershipFrom: string;          // Constituency name
      membershipFromId: number;        // Constituency ID (not ONS code)
      house: number;
      membershipStartDate: string;
      membershipEndDate: string | null;
      membershipStatus: {
        statusIsActive: boolean;
      };
    };
    thumbnailUrl: string;
  };
}

interface UKSearchResponse {
  items: UKParliamentMember[];
  totalResults: number;
  skip: number;
  take: number;
}

interface UKContactEntry {
  type: string;       // "Parliamentary", "Website", etc.
  typeDescription: string;
  typeId: number;
  isPreferred: boolean;
  isWebAddress: boolean;
  notes: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  line5: string | null;
  postcode: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
}

interface UKContactResponse {
  value: UKContactEntry[];
}

// ============================================================================
// Rate Limiter
// ============================================================================

async function rateLimitedDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Fetcher
// ============================================================================

const BASE_URL = 'https://members-api.parliament.uk/api';
const PAGE_SIZE = 20;
const RATE_LIMIT_MS = 200; // 5 requests per second — polite for government API

async function fetchAllMembers(): Promise<UKParliamentMember[]> {
  const allMembers: UKParliamentMember[] = [];
  let skip = 0;

  while (true) {
    const url = `${BASE_URL}/Members/Search?House=1&IsCurrentMember=true&skip=${skip}&take=${PAGE_SIZE}`;
    console.log(`Fetching: skip=${skip}, take=${PAGE_SIZE}`);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as UKSearchResponse;
    allMembers.push(...data.items);
    console.log(`  Fetched ${data.items.length} members (total: ${allMembers.length}/${data.totalResults})`);

    if (allMembers.length >= data.totalResults || data.items.length === 0) {
      break;
    }

    skip += PAGE_SIZE;
    await rateLimitedDelay(RATE_LIMIT_MS);
  }

  return allMembers;
}

async function fetchContactDetails(memberId: number): Promise<{
  email: string | null;
  phone: string | null;
  office_address: string | null;
  website_url: string | null;
}> {
  try {
    const url = `${BASE_URL}/Members/${memberId}/Contact`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol-Ingestion/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { email: null, phone: null, office_address: null, website_url: null };
    }

    const data = await response.json() as UKContactResponse;

    let email: string | null = null;
    let phone: string | null = null;
    let office_address: string | null = null;
    let website_url: string | null = null;

    for (const entry of data.value) {
      if (entry.email && !email) {
        email = entry.email;
      }
      if (entry.phone && !phone) {
        phone = entry.phone;
      }
      if (entry.line1 && !office_address) {
        const parts = [entry.line1, entry.line2, entry.line3, entry.line4, entry.line5, entry.postcode]
          .filter(Boolean);
        office_address = parts.join(', ');
      }
      if (entry.isWebAddress && entry.line1 && !website_url) {
        website_url = entry.line1;
      }
    }

    return { email, phone, office_address, website_url };
  } catch {
    return { email: null, phone: null, office_address: null, website_url: null };
  }
}

// ============================================================================
// Name Parsing
// ============================================================================

function parseName(displayName: string): { first_name: string | null; last_name: string | null } {
  // "Ms Diane Abbott" → first="Diane", last="Abbott"
  // "Sir Keir Starmer" → first="Keir", last="Starmer"
  const parts = displayName.split(' ');
  const honorifics = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Sir', 'Dame', 'Rt', 'Hon', 'Lord', 'Lady', 'Prof'];

  // Strip honorifics from the beginning
  let startIdx = 0;
  while (startIdx < parts.length && honorifics.includes(parts[startIdx].replace(/\./g, ''))) {
    startIdx++;
  }

  const nameParts = parts.slice(startIdx);
  if (nameParts.length === 0) {
    return { first_name: null, last_name: null };
  }

  if (nameParts.length === 1) {
    return { first_name: nameParts[0], last_name: null };
  }

  return {
    first_name: nameParts[0],
    last_name: nameParts.slice(1).join(' '),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPathIdx = args.indexOf('--db');
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : 'officials.db';
  const dryRun = args.includes('--dry-run');
  const skipContacts = args.includes('--skip-contacts');

  console.log('UK MP Ingestion');
  console.log(`  DB: ${dbPath}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Skip contacts: ${skipContacts}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Fetch all MPs
  console.log('Step 1: Fetching MPs from UK Parliament API...');
  const members = await fetchAllMembers();
  console.log(`  Fetched ${members.length} MPs`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — sample records:');
    for (const m of members.slice(0, 5)) {
      console.log(`  ${m.value.nameDisplayAs} — ${m.value.latestHouseMembership.membershipFrom} (${m.value.latestParty.name})`);
    }
    console.log(`  ... and ${Math.max(0, members.length - 5)} more`);
    return;
  }

  // Step 2: Open DB + initialize schema
  console.log('Step 2: Initializing database...');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(OFFICIALS_SCHEMA_DDL);
  console.log('  Schema initialized');
  console.log('');

  // Step 3: Fetch contact details (rate-limited)
  interface ContactMap {
    email: string | null;
    phone: string | null;
    office_address: string | null;
    website_url: string | null;
  }
  const contactMap = new Map<number, ContactMap>();

  if (!skipContacts) {
    console.log('Step 3: Fetching contact details (rate-limited)...');
    let contactsFetched = 0;
    for (const m of members) {
      const contact = await fetchContactDetails(m.value.id);
      contactMap.set(m.value.id, contact);
      contactsFetched++;
      if (contactsFetched % 50 === 0) {
        console.log(`  Fetched contacts for ${contactsFetched}/${members.length} members`);
      }
      await rateLimitedDelay(RATE_LIMIT_MS);
    }
    console.log(`  Fetched contacts for ${contactsFetched} members`);
  } else {
    console.log('Step 3: Skipping contact details (--skip-contacts)');
  }
  console.log('');

  // Step 4: Upsert MPs
  console.log('Step 4: Upserting MPs...');
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

  let upserted = 0;
  const upsertAll = db.transaction(() => {
    for (const m of members) {
      const v = m.value;
      const { first_name, last_name } = parseName(v.nameDisplayAs);
      const contact = contactMap.get(v.id);

      upsert.run({
        parliament_id: v.id,
        name: v.nameDisplayAs,
        first_name,
        last_name,
        party: v.latestParty.name,
        constituency_name: v.latestHouseMembership.membershipFrom,
        constituency_ons_code: null,  // Will be matched from boundary data post-ingestion
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        office_address: contact?.office_address ?? null,
        website_url: contact?.website_url ?? null,
        photo_url: v.thumbnailUrl,
        is_active: v.latestHouseMembership.membershipStatus.statusIsActive ? 1 : 0,
      });
      upserted++;
    }
  });

  upsertAll();
  const durationMs = Date.now() - startTime;

  console.log(`  Upserted ${upserted} MPs`);
  console.log('');

  // Step 5: Log ingestion
  const logStmt = db.prepare(`
    INSERT INTO ingestion_log (source, status, records_upserted, records_deleted, duration_ms)
    VALUES ('uk-mps', 'success', ?, 0, ?)
  `);
  logStmt.run(upserted, durationMs);

  // Step 6: Verify
  const count = (db.prepare('SELECT COUNT(*) as count FROM uk_mps WHERE is_active = 1').get() as { count: number }).count;
  console.log(`Verification: ${count} active UK MPs in database`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);

  // Party breakdown
  const parties = db.prepare(
    'SELECT party, COUNT(*) as count FROM uk_mps WHERE is_active = 1 GROUP BY party ORDER BY count DESC'
  ).all() as Array<{ party: string; count: number }>;

  console.log('');
  console.log('Party breakdown:');
  for (const p of parties) {
    console.log(`  ${p.party}: ${p.count} MPs`);
  }

  db.close();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
