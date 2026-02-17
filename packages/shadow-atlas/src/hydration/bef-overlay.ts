/**
 * 119th Congress Block Equivalency File (BEF) Overlay
 *
 * After the 2020 Census, 5 states redistricted their congressional maps
 * for the 119th Congress. The BAF _CD files reflect the ORIGINAL 2020
 * district assignments. BEFs provide the UPDATED assignments.
 *
 * This module downloads BEFs and overlays them onto parsed BAF block records,
 * replacing slot 0 (Congressional District) for affected blocks.
 *
 * Redistricted states (119th Congress):
 *   AL (01), GA (13), LA (22), NC (37), NY (36)
 *
 * BEF source:
 *   https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2023/119-congressional-district-bef/
 *
 * @packageDocumentation
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { BlockRecord } from './baf-parser.js';

// ============================================================================
// Constants
// ============================================================================

const BEF_BASE_URL =
  'https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2023/119-congressional-district-bef';

/**
 * States redistricted for the 119th Congress.
 * Key = state FIPS, value = BEF filename.
 */
export const REDISTRICTED_STATES: ReadonlyMap<string, string> = new Map([
  ['01', 'BlockAssign_ST01_AL_CD_119.txt'],
  ['13', 'BlockAssign_ST13_GA_CD_119.txt'],
  ['22', 'BlockAssign_ST22_LA_CD_119.txt'],
  ['36', 'BlockAssign_ST36_NY_CD_119.txt'],
  ['37', 'BlockAssign_ST37_NC_CD_119.txt'],
]);

// ============================================================================
// Overlay
// ============================================================================

export interface BEFOverlayOptions {
  /** Cache directory for downloaded BEF files. */
  cacheDir: string;
  /** Max retry attempts per download (default: 3). */
  maxRetries?: number;
  /** Log function. */
  log?: (msg: string) => void;
}

export interface BEFOverlayResult {
  /** Number of blocks updated per state. */
  updatedByState: Map<string, number>;
  /** Total blocks updated across all redistricted states. */
  totalUpdated: number;
}

/**
 * Overlay 119th Congress BEF data onto parsed BAF block records.
 *
 * For each redistricted state, downloads the BEF file (if not cached),
 * parses it, and replaces slot 0 (Congressional District) in the block map.
 *
 * Only processes blocks that are already in the block map (from BAF parsing).
 * Blocks not in the BAF data are skipped.
 *
 * @param blocks - Mutable block map from parseBAFFilesAsync()
 * @param options - Download and cache configuration
 * @returns Overlay statistics
 */
export async function overlayBEFs(
  blocks: Map<string, BlockRecord>,
  options: BEFOverlayOptions,
): Promise<BEFOverlayResult> {
  const {
    cacheDir,
    maxRetries = 3,
    log = console.log,
  } = options;

  const befDir = join(cacheDir, 'bef');
  await mkdir(befDir, { recursive: true });

  // Determine which redistricted states are present in our block data
  const statesInData = new Set<string>();
  for (const [, block] of blocks) {
    if (REDISTRICTED_STATES.has(block.stateFips)) {
      statesInData.add(block.stateFips);
    }
  }

  const updatedByState = new Map<string, number>();
  let totalUpdated = 0;

  for (const [fips, befFilename] of REDISTRICTED_STATES) {
    if (!statesInData.has(fips)) continue;

    log(`[BEF] Overlaying 119th Congress CD for state ${fips}...`);

    // Download or read from cache
    const befPath = join(befDir, befFilename);
    let content: string;

    try {
      await stat(befPath);
      content = await readFile(befPath, 'utf-8');
    } catch {
      const url = `${BEF_BASE_URL}/${befFilename}`;
      const buffer = await fetchWithRetry(url, maxRetries);
      await writeFile(befPath, buffer);
      content = buffer.toString('utf-8');
    }

    // Parse BEF and overlay
    // BEF format: BLOCKID|DISTRICT (same as BAF _CD.txt)
    const lines = content.split('\n');
    let stateUpdated = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('|');
      const blockId = parts[0];
      const district = parts[1]?.trim();

      if (!blockId || !district || /^Z+$/.test(district)) continue;

      const block = blocks.get(blockId);
      if (!block) continue;

      // Replace slot 0 with updated CD
      const fullGeoid = block.stateFips + district;
      block.districts.set(0, fullGeoid);
      stateUpdated++;
    }

    updatedByState.set(fips, stateUpdated);
    totalUpdated += stateUpdated;
    log(`[BEF] Updated ${stateUpdated.toLocaleString()} blocks in state ${fips}`);
  }

  return { updatedByState, totalUpdated };
}

// ============================================================================
// Helpers
// ============================================================================

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
        const delay = 1000 * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to download ${url} after ${maxRetries} attempts: ${lastError?.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
