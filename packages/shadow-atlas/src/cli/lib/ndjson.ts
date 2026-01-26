/**
 * NDJSON Utilities for Registry Management
 *
 * Provides parsing, writing, and manipulation of NDJSON registry files.
 * NDJSON (Newline-Delimited JSON) format:
 * - Line 1: Header object with schema version, type, count, timestamp
 * - Lines 2+: Individual entry objects
 *
 * @module cli/lib/ndjson
 */

import { readFile } from 'fs/promises';
import { atomicWriteFile } from '../../core/utils/atomic-write.js';
import type { PortalType } from '../../core/registry/known-portals.generated.js';

/**
 * NDJSON header schema - first line of every registry file
 */
export interface NdjsonHeader {
  readonly _schema: 'v1';
  readonly _type: 'KnownPortal' | 'QuarantinedPortal' | 'AtLargeCity';
  readonly _count: number;
  readonly _extracted: string; // ISO 8601 timestamp
  readonly _description: string;
}

/**
 * Known portal entry schema
 */
export interface KnownPortalEntry {
  readonly _fips: string;
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: string;
  readonly notes?: string;
  readonly webmapLayerName?: string;
  readonly authoritativeSource?: string;
}

/**
 * Quarantine pattern codes
 */
export type QuarantinePattern =
  | 'cvra_gis_unavailable'
  | 'hybrid_gis_unavailable'
  | 'containment_failure'
  | 'single_feature'
  | 'ward_gis_unavailable'
  | 'wrong_data'
  | 'exclusivity_topology_error'
  | 'unknown';

/**
 * Quarantined portal entry schema
 */
export interface QuarantinedPortalEntry extends KnownPortalEntry {
  readonly quarantineReason: string;
  readonly matchedPattern: QuarantinePattern;
  readonly quarantinedAt: string;
}

/**
 * At-large city entry schema
 */
export interface AtLargeCityEntry {
  readonly _fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly councilSize: number;
  readonly electionMethod: 'at-large' | 'at-large-with-residency' | 'proportional';
  readonly source: string;
  readonly notes?: string;
  readonly discoveredBy?: string;
  readonly lastVerified?: string;
}

/**
 * Union type for all registry entries
 */
export type RegistryEntry = KnownPortalEntry | QuarantinedPortalEntry | AtLargeCityEntry;

/**
 * Registry name enumeration
 */
export type RegistryName = 'known-portals' | 'quarantined-portals' | 'at-large-cities';

/**
 * Parsed NDJSON file result
 */
export interface ParsedNdjson<T extends RegistryEntry> {
  readonly header: NdjsonHeader;
  readonly entries: Map<string, T>;
  readonly filepath: string;
}

/**
 * Get the file path for a registry
 */
export function getRegistryPath(registryName: RegistryName, dataDir: string): string {
  return `${dataDir}/registries/${registryName}.ndjson`;
}

/**
 * Parse an NDJSON registry file
 *
 * @param filepath - Absolute path to NDJSON file
 * @returns Parsed header and entries map keyed by FIPS
 * @throws Error if file cannot be read or parsed
 */
export async function parseNdjson<T extends RegistryEntry>(
  filepath: string
): Promise<ParsedNdjson<T>> {
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) {
    throw new Error(`NDJSON file is empty: ${filepath}`);
  }

  // Parse header (first line)
  const header = JSON.parse(lines[0]) as NdjsonHeader;

  if (header._schema !== 'v1') {
    throw new Error(`Unsupported NDJSON schema version: ${header._schema}`);
  }

  // Parse entries (remaining lines)
  const entries = new Map<string, T>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const entry = JSON.parse(line) as T;
      const fips = (entry as RegistryEntry)._fips;
      if (fips) {
        entries.set(fips, entry);
      }
    } catch (error) {
      throw new Error(`Failed to parse line ${i + 1} in ${filepath}: ${error}`);
    }
  }

  return { header, entries, filepath };
}

/**
 * Write an NDJSON registry file
 *
 * @param filepath - Absolute path to NDJSON file
 * @param header - NDJSON header (count will be auto-updated)
 * @param entries - Map of entries keyed by FIPS
 */
export async function writeNdjson<T extends RegistryEntry>(
  filepath: string,
  header: Omit<NdjsonHeader, '_count' | '_extracted'>,
  entries: Map<string, T>
): Promise<void> {
  // Sort entries by FIPS for deterministic output
  const sortedFips = Array.from(entries.keys()).sort();

  // Build updated header
  const updatedHeader: NdjsonHeader = {
    ...header,
    _count: entries.size,
    _extracted: new Date().toISOString(),
  };

  // Build content
  const lines: string[] = [JSON.stringify(updatedHeader)];

  for (const fips of sortedFips) {
    const entry = entries.get(fips);
    if (entry) {
      lines.push(JSON.stringify(entry));
    }
  }

  // Add trailing newline
  const content = lines.join('\n') + '\n';

  await atomicWriteFile(filepath, content);
}

/**
 * Append a single entry to an NDJSON file
 *
 * This reads the file, adds the entry, updates the count, and rewrites.
 * For bulk operations, use parseNdjson + writeNdjson instead.
 *
 * @param filepath - Absolute path to NDJSON file
 * @param entry - Entry to append
 * @returns true if entry was added, false if FIPS already exists
 */
export async function appendEntry<T extends RegistryEntry>(
  filepath: string,
  entry: T
): Promise<boolean> {
  const { header, entries } = await parseNdjson<T>(filepath);
  const fips = (entry as RegistryEntry)._fips;

  if (entries.has(fips)) {
    return false; // Entry already exists
  }

  entries.set(fips, entry);

  await writeNdjson(filepath, header, entries);
  return true;
}

/**
 * Update an existing entry in an NDJSON file
 *
 * @param filepath - Absolute path to NDJSON file
 * @param fips - FIPS code of entry to update
 * @param updates - Partial updates to apply
 * @returns The updated entry, or null if not found
 */
export async function updateEntry<T extends RegistryEntry>(
  filepath: string,
  fips: string,
  updates: Partial<T>
): Promise<{ before: T; after: T } | null> {
  const { header, entries } = await parseNdjson<T>(filepath);

  const existing = entries.get(fips);
  if (!existing) {
    return null;
  }

  const before = existing;
  const after = { ...existing, ...updates } as T;
  entries.set(fips, after);

  await writeNdjson(filepath, header, entries);
  return { before, after };
}

/**
 * Remove an entry from an NDJSON file
 *
 * @param filepath - Absolute path to NDJSON file
 * @param fips - FIPS code of entry to remove
 * @returns The removed entry, or null if not found
 */
export async function removeEntry<T extends RegistryEntry>(
  filepath: string,
  fips: string
): Promise<T | null> {
  const { header, entries } = await parseNdjson<T>(filepath);

  const existing = entries.get(fips);
  if (!existing) {
    return null;
  }

  entries.delete(fips);

  await writeNdjson(filepath, header, entries);
  return existing;
}

/**
 * Search for an entry across all registries
 *
 * @param dataDir - Base data directory
 * @param fips - FIPS code to search for
 * @returns Entry with registry name, or null if not found
 */
export async function findEntry(
  dataDir: string,
  fips: string
): Promise<{ registry: RegistryName; entry: RegistryEntry } | null> {
  const registries: RegistryName[] = ['known-portals', 'quarantined-portals', 'at-large-cities'];

  for (const registryName of registries) {
    const filepath = getRegistryPath(registryName, dataDir);
    try {
      const { entries } = await parseNdjson<RegistryEntry>(filepath);
      const entry = entries.get(fips);
      if (entry) {
        return { registry: registryName, entry };
      }
    } catch {
      // Registry file might not exist, continue to next
      continue;
    }
  }

  return null;
}

/**
 * Load all registries
 *
 * @param dataDir - Base data directory
 * @returns Object with all parsed registries
 */
export async function loadAllRegistries(dataDir: string): Promise<{
  knownPortals: ParsedNdjson<KnownPortalEntry>;
  quarantinedPortals: ParsedNdjson<QuarantinedPortalEntry>;
  atLargeCities: ParsedNdjson<AtLargeCityEntry>;
}> {
  const [knownPortals, quarantinedPortals, atLargeCities] = await Promise.all([
    parseNdjson<KnownPortalEntry>(getRegistryPath('known-portals', dataDir)),
    parseNdjson<QuarantinedPortalEntry>(getRegistryPath('quarantined-portals', dataDir)),
    parseNdjson<AtLargeCityEntry>(getRegistryPath('at-large-cities', dataDir)),
  ]);

  return { knownPortals, quarantinedPortals, atLargeCities };
}

/**
 * Validate FIPS format
 *
 * FIPS codes should be 7 digits (2-digit state + 5-digit place)
 *
 * @param fips - FIPS code to validate
 * @returns Validation result with error message if invalid
 */
export function validateFips(fips: string): { valid: boolean; error?: string } {
  if (!fips) {
    return { valid: false, error: 'FIPS code is required' };
  }

  if (!/^\d{7}$/.test(fips)) {
    return { valid: false, error: 'FIPS must be exactly 7 digits' };
  }

  const stateCode = parseInt(fips.substring(0, 2), 10);
  if (stateCode < 1 || stateCode > 78) {
    return { valid: false, error: `Invalid state code: ${stateCode}` };
  }

  return { valid: true };
}

/**
 * Validate URL format and optionally check reachability
 *
 * @param url - URL to validate
 * @param checkReachable - Whether to make HTTP request to check URL
 * @returns Validation result
 */
export async function validateUrl(
  url: string,
  checkReachable = false
): Promise<{ valid: boolean; error?: string; statusCode?: number }> {
  if (!url) {
    return { valid: false, error: 'URL is required' };
  }

  try {
    new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { valid: false, error: 'URL must use http or https protocol' };
  }

  if (!checkReachable) {
    return { valid: true };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { valid: true, statusCode: response.status };
    }

    return {
      valid: false,
      error: `URL returned status ${response.status}`,
      statusCode: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, error: `Failed to reach URL: ${message}` };
  }
}
