/**
 * Codegen Utilities for Shadow Atlas CLI
 *
 * Provides functions for bidirectional transformation between NDJSON and TypeScript
 * registry formats, plus verification of round-trip fidelity.
 *
 * @module cli/lib/codegen
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { atomicWriteFile } from '../../core/utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export interface NdjsonHeader {
  readonly _schema: string;
  readonly _type: string;
  readonly _count: number;
  readonly _extracted: string;
  readonly _description: string;
}

export interface VerificationResult {
  readonly registry: string;
  readonly ndjsonCount: number;
  readonly generatedCount: number;
  readonly matches: boolean;
  readonly missingInGenerated: readonly string[];
  readonly missingInNdjson: readonly string[];
  readonly fieldMismatches: readonly FieldMismatch[];
}

export interface FieldMismatch {
  readonly fips: string;
  readonly field: string;
  readonly ndjsonValue: unknown;
  readonly generatedValue: unknown;
}

export interface GenerationResult {
  readonly registry: string;
  readonly entryCount: number;
  readonly outputPath: string;
  readonly timestamp: string;
}

export interface ExtractionResult {
  readonly registry: string;
  readonly entryCount: number;
  readonly outputPath: string;
  readonly timestamp: string;
}

export type RegistryName = 'known-portals' | 'quarantined-portals' | 'at-large-cities';

export const REGISTRY_NAMES: readonly RegistryName[] = [
  'known-portals',
  'quarantined-portals',
  'at-large-cities',
];

// ============================================================================
// Path Utilities
// ============================================================================

export function getPackageRoot(): string {
  // Navigate from src/cli/lib to package root
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
}

export function getNdjsonPath(registry: RegistryName): string {
  return join(getPackageRoot(), 'data', 'registries', `${registry}.ndjson`);
}

export function getGeneratedPath(registry: RegistryName): string {
  return join(getPackageRoot(), 'src', 'core', 'registry', `${registry}.generated.ts`);
}

export function getSnapshotsDir(): string {
  return join(getPackageRoot(), 'data', 'snapshots');
}

// ============================================================================
// NDJSON Parsing
// ============================================================================

/**
 * Parse NDJSON file into header and entries
 */
export async function parseNdjson<T extends { _fips: string }>(
  filepath: string,
): Promise<{ header: NdjsonHeader; entries: Map<string, Omit<T, '_fips'>> }> {
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) {
    throw new Error(`Empty NDJSON file: ${filepath}`);
  }

  const header = JSON.parse(lines[0]) as NdjsonHeader;
  const entries = new Map<string, Omit<T, '_fips'>>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as T;
    const { _fips, ...rest } = entry;
    entries.set(_fips, rest);
  }

  return { header, entries };
}

/**
 * Parse NDJSON file returning entries as a Map (for verification)
 */
export async function parseNdjsonEntries(
  filepath: string,
): Promise<Map<string, Record<string, unknown>>> {
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  const entries = new Map<string, Record<string, unknown>>();

  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as Record<string, unknown>;
    const fips = entry._fips as string;
    // Remove _fips from entry for comparison (it's the key, not a data field)
    const { _fips, ...rest } = entry;
    entries.set(fips, rest);
  }

  return entries;
}

// ============================================================================
// TypeScript Generation
// ============================================================================

/**
 * Generate TypeScript code from NDJSON registry
 */
export async function generateFromNdjson(
  registry: RegistryName,
): Promise<string> {
  const ndjsonPath = getNdjsonPath(registry);
  const content = await readFile(ndjsonPath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length === 0) {
    throw new Error(`Empty NDJSON file: ${ndjsonPath}`);
  }

  const header = JSON.parse(lines[0]) as NdjsonHeader;
  const entries: Array<[string, Record<string, unknown>]> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as Record<string, unknown>;
    const fips = entry._fips as string;
    const { _fips, ...rest } = entry;
    entries.push([fips, rest]);
  }

  // Sort by FIPS for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  const now = new Date().toISOString();

  switch (registry) {
    case 'known-portals':
      return generateKnownPortalsTs(header, entries, now);
    case 'quarantined-portals':
      return generateQuarantinedPortalsTs(header, entries, now);
    case 'at-large-cities':
      return generateAtLargeCitiesTs(header, entries, now);
    default:
      throw new Error(`Unknown registry: ${registry}`);
  }
}

function generateKnownPortalsTs(
  header: NdjsonHeader,
  entries: Array<[string, Record<string, unknown>]>,
  timestamp: string,
): string {
  let output = `/**
 * Known Council District Data Portals
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/known-portals.ndjson
 * !! Generated: ${timestamp}
 * !! To modify: Edit the NDJSON file, then run: shadow-atlas codegen generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * City entries: ${entries.length}
 * Description: ${header._description}
 */

export type PortalType =
  | 'arcgis'           // Generic ArcGIS REST services
  | 'municipal-gis'    // City-operated GIS portal
  | 'regional-gis'     // Regional council operated GIS
  | 'county-gis'       // County-operated GIS portal
  | 'county-planning'  // County planning commission GIS
  | 'state-gis'        // State-operated GIS portal
  | 'socrata'          // Socrata open data platform
  | 'geojson'          // Direct GeoJSON file
  | 'webmap-embedded'  // Extracted from ArcGIS webmap
  | 'curated-data'     // Manually digitized/curated
  | 'shapefile'        // Shapefile download
  | 'kml'              // KML/KMZ file
  | 'golden-vector';   // Reconstructed from legal descriptions

/**
 * Discovery source for portal entries.
 * Common values: 'manual', 'automated', 'authoritative'
 * Wave-specific values: 'wave-g-extraction', 'wave-h-ca-specialist', etc.
 */
export type DiscoveredBy = string;

export interface KnownPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: DiscoveredBy;
  readonly notes?: string;
  readonly webmapLayerName?: string;
  readonly authoritativeSource?: string;
  readonly wardCount?: number;
  // Golden vector specific fields
  readonly sourceType?: 'golden-vector';
  readonly goldenVectorPath?: string;
  readonly expectedDistrictCount?: number;
  readonly precisionLevel?: 'approximate' | 'precise';
}

export const KNOWN_PORTALS: Record<string, KnownPortal> = {\n`;

  for (const [fips, entry] of entries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const PORTAL_COUNT = ${entries.length};\n`;
  return output;
}

function generateQuarantinedPortalsTs(
  header: NdjsonHeader,
  entries: Array<[string, Record<string, unknown>]>,
  timestamp: string,
): string {
  let output = `/**
 * Quarantined Portal Entries
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/quarantined-portals.ndjson
 * !! Generated: ${timestamp}
 * !! To modify: Edit the NDJSON file, then run: shadow-atlas codegen generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Entries removed from known-portals due to data quality issues
 * Quarantined entries: ${entries.length}
 * Description: ${header._description}
 */

import type { PortalType, DiscoveredBy } from './known-portals.generated.js';

export interface QuarantinedPortal {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: DiscoveredBy;
  readonly notes?: string;
  readonly quarantineReason: string;
  readonly matchedPattern: string;
  readonly quarantinedAt: string;
}

export const QUARANTINED_PORTALS: Record<string, QuarantinedPortal> = {\n`;

  for (const [fips, entry] of entries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const QUARANTINE_COUNT = ${entries.length};\n`;
  return output;
}

function generateAtLargeCitiesTs(
  header: NdjsonHeader,
  entries: Array<[string, Record<string, unknown>]>,
  timestamp: string,
): string {
  let output = `/**
 * At-Large City Council Registry
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/at-large-cities.ndjson
 * !! Generated: ${timestamp}
 * !! To modify: Edit the NDJSON file, then run: shadow-atlas codegen generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Cities with at-large voting (no geographic districts)
 * At-large cities: ${entries.length}
 * Description: ${header._description}
 */

export interface AtLargeCity {
  readonly cityName: string;
  readonly state: string;
  readonly councilSize: number;
  readonly electionMethod: 'at-large' | 'proportional';
  readonly source: string;
  readonly notes?: string;
}

export const AT_LARGE_CITIES: Record<string, AtLargeCity> = {\n`;

  for (const [fips, entry] of entries) {
    output += `  '${fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`;
  }

  output += `};\n\nexport const AT_LARGE_COUNT = ${entries.length};\n`;
  return output;
}

// ============================================================================
// NDJSON Extraction
// ============================================================================

/**
 * Extract NDJSON content from TypeScript registry
 */
export async function extractToNdjson(
  registry: RegistryName,
): Promise<string> {
  const generatedPath = getGeneratedPath(registry);

  // Dynamic import of the generated module
  const module = await import(generatedPath);

  // Find the exported registry constant
  const registryKey = Object.keys(module).find((k) =>
    k.endsWith('PORTALS') || k.endsWith('CITIES')
  );

  if (!registryKey) {
    throw new Error(`No registry found in ${generatedPath}`);
  }

  const data = module[registryKey] as Record<string, Record<string, unknown>>;
  const entries = Object.entries(data);
  const now = new Date().toISOString();

  const typeMap: Record<RegistryName, string> = {
    'known-portals': 'KnownPortal',
    'quarantined-portals': 'QuarantinedPortal',
    'at-large-cities': 'AtLargeCity',
  };

  const descriptionMap: Record<RegistryName, string> = {
    'known-portals': 'Verified municipal council district GIS sources with download URLs',
    'quarantined-portals': 'Entries removed due to data quality issues, pending review',
    'at-large-cities': 'Cities with at-large voting (no geographic districts)',
  };

  const header: NdjsonHeader = {
    _schema: 'v1',
    _type: typeMap[registry],
    _count: entries.length,
    _extracted: now,
    _description: descriptionMap[registry],
  };

  const lines: string[] = [JSON.stringify(header)];

  // Sort entries by key (FIPS code) for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [fips, entry] of entries) {
    // Include the FIPS key in the entry for round-trip
    const entryWithKey = { _fips: fips, ...entry };
    lines.push(JSON.stringify(entryWithKey));
  }

  return lines.join('\n') + '\n';
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Compare values for equality (deep comparison for objects/arrays)
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Verify round-trip fidelity between NDJSON and TypeScript
 */
export async function verifyRoundTrip(
  registry: RegistryName,
): Promise<VerificationResult> {
  const ndjsonPath = getNdjsonPath(registry);
  const generatedPath = getGeneratedPath(registry);

  // Parse NDJSON
  const ndjsonEntries = await parseNdjsonEntries(ndjsonPath);

  // Import generated TypeScript
  const module = await import(generatedPath);
  const registryKey = Object.keys(module).find((k) =>
    k.endsWith('PORTALS') || k.endsWith('CITIES')
  );

  if (!registryKey) {
    throw new Error(`No registry found in ${generatedPath}`);
  }

  const generatedData = module[registryKey] as Record<string, Record<string, unknown>>;
  const generatedEntries = new Map(Object.entries(generatedData));

  const result: VerificationResult = {
    registry,
    ndjsonCount: ndjsonEntries.size,
    generatedCount: generatedEntries.size,
    matches: true,
    missingInGenerated: [],
    missingInNdjson: [],
    fieldMismatches: [],
  };

  const missingInGenerated: string[] = [];
  const missingInNdjson: string[] = [];
  const fieldMismatches: FieldMismatch[] = [];

  // Check for missing entries
  for (const fips of ndjsonEntries.keys()) {
    if (!generatedEntries.has(fips)) {
      missingInGenerated.push(fips);
    }
  }

  for (const fips of generatedEntries.keys()) {
    if (!ndjsonEntries.has(fips)) {
      missingInNdjson.push(fips);
    }
  }

  // Check field values for entries that exist in both
  for (const [fips, ndjsonEntry] of ndjsonEntries) {
    const generatedEntry = generatedEntries.get(fips);
    if (!generatedEntry) continue;

    for (const [field, ndjsonValue] of Object.entries(ndjsonEntry)) {
      const generatedValue = generatedEntry[field];

      if (!valuesEqual(ndjsonValue, generatedValue)) {
        fieldMismatches.push({
          fips,
          field,
          ndjsonValue,
          generatedValue,
        });
      }
    }
  }

  const matches =
    missingInGenerated.length === 0 &&
    missingInNdjson.length === 0 &&
    fieldMismatches.length === 0;

  return {
    ...result,
    matches,
    missingInGenerated,
    missingInNdjson,
    fieldMismatches,
  };
}

// ============================================================================
// High-Level Operations
// ============================================================================

/**
 * Generate TypeScript file from NDJSON and write to disk
 */
export async function generateAndWrite(
  registry: RegistryName,
): Promise<GenerationResult> {
  const tsContent = await generateFromNdjson(registry);
  const outputPath = getGeneratedPath(registry);

  await mkdir(dirname(outputPath), { recursive: true });
  await atomicWriteFile(outputPath, tsContent);

  // Count entries from the content
  const entryCount = (tsContent.match(/'[0-9]{7}':/g) || []).length;
  const timestamp = new Date().toISOString();

  return {
    registry,
    entryCount,
    outputPath,
    timestamp,
  };
}

/**
 * Extract NDJSON file from TypeScript and write to disk
 */
export async function extractAndWrite(
  registry: RegistryName,
  outputDir?: string,
): Promise<ExtractionResult> {
  const ndjsonContent = await extractToNdjson(registry);
  const outputPath = outputDir
    ? join(outputDir, `${registry}.ndjson`)
    : getNdjsonPath(registry);

  await mkdir(dirname(outputPath), { recursive: true });
  await atomicWriteFile(outputPath, ndjsonContent);

  // Count entries from header
  const header = JSON.parse(ndjsonContent.split('\n')[0]) as NdjsonHeader;

  return {
    registry,
    entryCount: header._count,
    outputPath,
    timestamp: header._extracted,
  };
}

/**
 * Check if regeneration is needed by comparing file contents
 */
export async function checkNeedsRegeneration(
  registry: RegistryName,
): Promise<{ needsRegeneration: boolean; reason?: string }> {
  try {
    const verification = await verifyRoundTrip(registry);

    if (!verification.matches) {
      const reasons: string[] = [];

      if (verification.missingInGenerated.length > 0) {
        reasons.push(
          `${verification.missingInGenerated.length} entries missing in generated file`
        );
      }

      if (verification.missingInNdjson.length > 0) {
        reasons.push(
          `${verification.missingInNdjson.length} entries missing in NDJSON`
        );
      }

      if (verification.fieldMismatches.length > 0) {
        reasons.push(
          `${verification.fieldMismatches.length} field mismatches`
        );
      }

      return {
        needsRegeneration: true,
        reason: reasons.join('; '),
      };
    }

    return { needsRegeneration: false };
  } catch (error) {
    return {
      needsRegeneration: true,
      reason: error instanceof Error ? error.message : 'Unknown error during verification',
    };
  }
}
