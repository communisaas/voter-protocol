/**
 * Census Block Assignment File (BAF) Downloader
 *
 * Downloads BAF zip files from the Census Bureau for all 50 states + DC + territories.
 * BAFs map every census block to its congressional, legislative, school,
 * and other administrative districts — the authoritative federal assignment.
 *
 * URL pattern: https://www2.census.gov/geo/docs/maps-data/data/baf2020/BlockAssign_ST{fips}_{abbr}.zip
 *
 * Each zip contains separate pipe-delimited files per entity type:
 *   _CD.txt, _SLDU.txt, _SLDL.txt, _INCPLACE_CDP.txt, _SDUNI.txt,
 *   _SDELM.txt, _SDSEC.txt, _VTD.txt, _MCD.txt, _AIANNH.txt
 *
 * @packageDocumentation
 */

import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';

// ============================================================================
// State FIPS Table
// ============================================================================

/**
 * FIPS code → state abbreviation mapping.
 * Source: Census Bureau FIPS State Codes (INCITS 38:2009).
 * Includes 50 states + DC + 5 populated territories.
 */
export const STATE_FIPS: ReadonlyMap<string, string> = new Map([
  ['01', 'AL'], ['02', 'AK'], ['04', 'AZ'], ['05', 'AR'], ['06', 'CA'],
  ['08', 'CO'], ['09', 'CT'], ['10', 'DE'], ['11', 'DC'], ['12', 'FL'],
  ['13', 'GA'], ['15', 'HI'], ['16', 'ID'], ['17', 'IL'], ['18', 'IN'],
  ['19', 'IA'], ['20', 'KS'], ['21', 'KY'], ['22', 'LA'], ['23', 'ME'],
  ['24', 'MD'], ['25', 'MA'], ['26', 'MI'], ['27', 'MN'], ['28', 'MS'],
  ['29', 'MO'], ['30', 'MT'], ['31', 'NE'], ['32', 'NV'], ['33', 'NH'],
  ['34', 'NJ'], ['35', 'NM'], ['36', 'NY'], ['37', 'NC'], ['38', 'ND'],
  ['39', 'OH'], ['40', 'OK'], ['41', 'OR'], ['42', 'PA'], ['44', 'RI'],
  ['45', 'SC'], ['46', 'SD'], ['47', 'TN'], ['48', 'TX'], ['49', 'UT'],
  ['50', 'VT'], ['51', 'VA'], ['53', 'WA'], ['54', 'WV'], ['55', 'WI'],
  ['56', 'WY'],
  // Territories
  ['60', 'AS'], ['66', 'GU'], ['69', 'MP'], ['72', 'PR'], ['78', 'VI'],
]);

const BAF_BASE_URL = 'https://www2.census.gov/geo/docs/maps-data/data/baf2020';

// ============================================================================
// Download Logic
// ============================================================================

export interface BAFDownloadOptions {
  /** Cache directory for downloaded + extracted BAF files. */
  cacheDir: string;
  /** Filter to a single state FIPS code (e.g., "06" for CA). If omitted, downloads all. */
  stateCode?: string;
  /** Rate limit delay in ms between requests (default: 1000 — Census.gov courtesy). */
  rateLimitMs?: number;
  /** Max retry attempts per file (default: 3). */
  maxRetries?: number;
  /** Log function (default: console.log). */
  log?: (msg: string) => void;
}

export interface BAFDownloadResult {
  /** State FIPS code. */
  stateCode: string;
  /** State abbreviation. */
  stateAbbr: string;
  /** Directory containing extracted .txt files for this state. */
  extractDir: string;
  /** List of extracted .txt file paths. */
  files: string[];
  /** Whether this state was already cached (skipped download). */
  cached: boolean;
}

/**
 * Download and extract BAF files for one or all states.
 *
 * Downloads zip from Census.gov, extracts .txt files to cacheDir/{stateCode}/.
 * Skips states that already have extracted files (checks directory existence).
 */
export async function downloadBAFs(
  options: BAFDownloadOptions,
): Promise<BAFDownloadResult[]> {
  const {
    cacheDir,
    stateCode,
    rateLimitMs = 1000,
    maxRetries = 3,
    log = console.log,
  } = options;

  await mkdir(cacheDir, { recursive: true });

  // Determine which states to download
  const states: [string, string][] = stateCode
    ? [[stateCode, STATE_FIPS.get(stateCode) ?? '']]
    : [...STATE_FIPS.entries()];

  if (stateCode && !STATE_FIPS.has(stateCode)) {
    throw new Error(`Unknown state FIPS code: ${stateCode}`);
  }

  const results: BAFDownloadResult[] = [];

  for (let i = 0; i < states.length; i++) {
    const [fips, abbr] = states[i];
    const stateDir = join(cacheDir, fips);

    // Check cache
    if (await isDirectoryPopulated(stateDir)) {
      const files = (await readdir(stateDir)).filter(f => f.endsWith('.txt')).map(f => join(stateDir, f));
      results.push({ stateCode: fips, stateAbbr: abbr, extractDir: stateDir, files, cached: true });
      continue;
    }

    // Download with retry
    const zipName = `BlockAssign_ST${fips}_${abbr}.zip`;
    const url = `${BAF_BASE_URL}/${zipName}`;

    log(`[${i + 1}/${states.length}] Downloading ${zipName}...`);

    let zipBuffer: Buffer;
    try {
      zipBuffer = await fetchWithRetry(url, maxRetries);
    } catch (err) {
      // Territories (AS, GU, MP, VI) may not have BAF files — skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        log(`  → Skipped ${abbr} (${fips}): BAF file not available (404)`);
        continue;
      }
      throw err;
    }
    const zip = await JSZip.loadAsync(zipBuffer);

    // Extract .txt files
    await mkdir(stateDir, { recursive: true });
    const files: string[] = [];

    for (const [name, entry] of Object.entries(zip.files)) {
      if (name.endsWith('.txt') && !entry.dir) {
        const content = await entry.async('nodebuffer');
        const outPath = join(stateDir, name);
        await writeFile(outPath, content);
        files.push(outPath);
      }
    }

    results.push({ stateCode: fips, stateAbbr: abbr, extractDir: stateDir, files, cached: false });

    // Rate limit (skip delay after last state)
    if (i < states.length - 1 && rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

async function isDirectoryPopulated(dir: string): Promise<boolean> {
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return false;
    const entries = await readdir(dir);
    return entries.some(e => e.endsWith('.txt'));
  } catch {
    return false;
  }
}

async function fetchWithRetry(url: string, maxRetries: number): Promise<Buffer> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      const arrayBuffer = await resp.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to download ${url} after ${maxRetries} attempts: ${lastError?.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
