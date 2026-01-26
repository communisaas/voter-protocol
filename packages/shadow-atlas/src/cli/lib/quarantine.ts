/**
 * Quarantine Workflow Utilities
 *
 * Shared utilities for quarantine state machine operations.
 * Manages transitions between: KNOWN_PORTALS <-> QUARANTINED -> AT_LARGE_CITIES
 *
 * STATE MACHINE:
 * ```
 * DISCOVERED -> VALIDATED -> KNOWN_PORTALS (active)
 *                         \
 *                          QUARANTINED (suspended)
 *                         /           \
 *               KNOWN_PORTALS       AT_LARGE_CITIES
 *                (restored)           (terminal)
 * ```
 *
 * ATOMICITY: All file operations use atomic writes to prevent corruption.
 */

import { readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { atomicWriteFile } from '../../core/utils/atomic-write.js';
import type { KnownPortal, PortalType } from '../../core/registry/known-portals.generated.js';
import type { QuarantinedPortal } from '../../core/registry/quarantined-portals.generated.js';
import type { AtLargeCity } from '../../core/registry/at-large-cities.generated.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Quarantine pattern codes for classification
 */
export type QuarantinePattern =
  | 'cvra_gis_unavailable'     // CVRA transition without public GIS
  | 'hybrid_gis_unavailable'   // Hybrid system without boundaries
  | 'containment_failure'      // Districts outside city boundary
  | 'single_feature'           // Only 1 feature (likely at-large)
  | 'ward_gis_unavailable'     // Ward system without GIS
  | 'wrong_data'               // URL returns wrong dataset
  | 'exclusivity_topology_error' // Overlapping districts
  | 'county_for_city'          // County data for city
  | 'regional_data_bleeding'   // Regional/metro data
  | 'other';                   // Uncategorized

/**
 * NDJSON header for registry files
 */
export interface NdjsonHeader {
  _schema: 'v1';
  _type: 'KnownPortal' | 'QuarantinedPortal' | 'AtLargeCity';
  _count: number;
  _extracted: string;
  _description: string;
}

/**
 * NDJSON entry with FIPS key
 */
export interface NdjsonEntry {
  _fips: string;
  [key: string]: unknown;
}

/**
 * Audit log entry for registry mutations
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  action: 'quarantine' | 'restore' | 'promote' | 'add' | 'update' | 'delete';
  registry: 'known-portals' | 'quarantined-portals' | 'at-large-cities';
  fips: string;
  actor: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: {
    cliVersion: string;
    command: string;
    duration_ms?: number;
  };
}

/**
 * Quarantine statistics
 */
export interface QuarantineStats {
  total: number;
  byPattern: Record<string, number>;
  byState: Record<string, number>;
  avgAgeDays: number;
  oldestEntry?: { fips: string; cityName: string; ageDays: number };
  newestEntry?: { fips: string; cityName: string; ageDays: number };
}

/**
 * Resolution assessment for a quarantined entry
 */
export interface ResolutionAssessment {
  isResolvable: boolean;
  suggestedStrategy: 'arcgis' | 'socrata' | 'manual' | 'promote_to_at_large' | 'needs_research';
  confidence: number;
  notes: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default registry paths relative to package root
 */
export const REGISTRY_PATHS = {
  knownPortals: 'data/registries/known-portals.ndjson',
  quarantinedPortals: 'data/registries/quarantined-portals.ndjson',
  atLargeCities: 'data/registries/at-large-cities.ndjson',
  auditLog: 'data/audit/registry-audit.ndjson',
};

/**
 * CLI version for audit logging
 */
export const CLI_VERSION = '1.0.0';

// ============================================================================
// NDJSON File Operations
// ============================================================================

/**
 * Parse an NDJSON registry file
 *
 * @param filePath - Path to NDJSON file
 * @returns Parsed header and entries
 */
export async function parseNdjsonFile<T extends NdjsonEntry>(
  filePath: string
): Promise<{ header: NdjsonHeader; entries: Map<string, T> }> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error(`Empty NDJSON file: ${filePath}`);
  }

  // First line is header
  const header = JSON.parse(lines[0]!) as NdjsonHeader;
  const entries = new Map<string, T>();

  // Remaining lines are entries
  for (let i = 1; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]!) as T;
    const fips = entry._fips || (entry as Record<string, unknown>).cityFips as string;
    if (fips) {
      entries.set(fips, entry);
    }
  }

  return { header, entries };
}

/**
 * Write an NDJSON registry file atomically
 *
 * @param filePath - Path to NDJSON file
 * @param header - File header
 * @param entries - Entries map (FIPS -> entry)
 */
export async function writeNdjsonFile<T extends NdjsonEntry>(
  filePath: string,
  header: NdjsonHeader,
  entries: Map<string, T>
): Promise<void> {
  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Update header count
  const updatedHeader = {
    ...header,
    _count: entries.size,
    _extracted: new Date().toISOString(),
  };

  // Sort entries by FIPS for deterministic output
  const sortedFips = Array.from(entries.keys()).sort();

  // Build NDJSON content
  const lines: string[] = [JSON.stringify(updatedHeader)];
  for (const fips of sortedFips) {
    const entry = entries.get(fips)!;
    lines.push(JSON.stringify(entry));
  }

  await atomicWriteFile(filePath, lines.join('\n') + '\n');
}

/**
 * Get the package root directory
 */
export function getPackageRoot(): string {
  // Navigate up from src/cli/lib to package root
  // Use fileURLToPath for cross-platform compatibility
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, '..', '..', '..');
}

/**
 * Get full path for a registry file
 */
export function getRegistryPath(registry: keyof typeof REGISTRY_PATHS): string {
  return join(getPackageRoot(), REGISTRY_PATHS[registry]);
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Append an audit entry to the audit log
 */
export async function appendAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
  const auditPath = getRegistryPath('auditLog');
  await mkdir(dirname(auditPath), { recursive: true });

  const fullEntry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
    metadata: {
      cliVersion: CLI_VERSION,
      command: entry.metadata?.command || 'unknown',
      ...entry.metadata,
    },
  };

  // Append to audit log (create if doesn't exist)
  const line = JSON.stringify(fullEntry) + '\n';

  try {
    const { appendFile } = await import('fs/promises');
    await appendFile(auditPath, line, 'utf-8');
  } catch (error) {
    // If file doesn't exist, create it
    await atomicWriteFile(auditPath, line);
  }
}

// ============================================================================
// Core Quarantine Operations
// ============================================================================

/**
 * Move an entry from known-portals to quarantined-portals
 *
 * @param fips - 7-digit Census PLACE FIPS
 * @param reason - Detailed quarantine reason
 * @param pattern - Quarantine pattern code
 * @param actor - Who initiated the quarantine
 * @returns The quarantined entry
 */
export async function moveToQuarantine(
  fips: string,
  reason: string,
  pattern: QuarantinePattern = 'other',
  actor: string = 'cli'
): Promise<QuarantinedPortal> {
  const knownPath = getRegistryPath('knownPortals');
  const quarantinedPath = getRegistryPath('quarantinedPortals');

  // Load both registries
  const { header: knownHeader, entries: knownEntries } = await parseNdjsonFile<NdjsonEntry>(knownPath);
  const { header: quarantinedHeader, entries: quarantinedEntries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

  // Find entry in known-portals
  const entry = knownEntries.get(fips);
  if (!entry) {
    throw new Error(`Entry not found in known-portals: ${fips}`);
  }

  // Check if already quarantined
  if (quarantinedEntries.has(fips)) {
    throw new Error(`Entry already in quarantined-portals: ${fips}`);
  }

  // Create quarantined entry
  const quarantinedEntry: NdjsonEntry = {
    ...entry,
    _fips: fips,
    quarantineReason: reason,
    matchedPattern: pattern,
    quarantinedAt: new Date().toISOString(),
    confidence: 0, // Reset confidence to 0 when quarantined
  };

  // Remove from known-portals
  knownEntries.delete(fips);

  // Add to quarantined-portals
  quarantinedEntries.set(fips, quarantinedEntry);

  // Write both files atomically
  await writeNdjsonFile(knownPath, knownHeader, knownEntries);
  await writeNdjsonFile(quarantinedPath, quarantinedHeader, quarantinedEntries);

  // Log to audit
  await appendAuditEntry({
    action: 'quarantine',
    registry: 'known-portals',
    fips,
    actor,
    reason,
    before: entry as Record<string, unknown>,
    after: quarantinedEntry as Record<string, unknown>,
    metadata: {
      cliVersion: CLI_VERSION,
      command: `quarantine add ${fips} --reason "${reason}" --pattern ${pattern}`,
    },
  });

  return quarantinedEntry as unknown as QuarantinedPortal;
}

/**
 * Restore an entry from quarantined-portals to known-portals
 *
 * @param fips - 7-digit Census PLACE FIPS
 * @param newUrl - Optional new URL (if original was bad)
 * @param validate - Whether to validate before restoring
 * @param actor - Who initiated the restore
 * @param reason - Audit log reason
 * @returns The restored entry
 */
export async function restoreFromQuarantine(
  fips: string,
  newUrl?: string,
  validate: boolean = false,
  actor: string = 'cli',
  reason?: string
): Promise<KnownPortal> {
  const knownPath = getRegistryPath('knownPortals');
  const quarantinedPath = getRegistryPath('quarantinedPortals');

  // Load both registries
  const { header: knownHeader, entries: knownEntries } = await parseNdjsonFile<NdjsonEntry>(knownPath);
  const { header: quarantinedHeader, entries: quarantinedEntries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

  // Find entry in quarantined-portals
  const entry = quarantinedEntries.get(fips);
  if (!entry) {
    throw new Error(`Entry not found in quarantined-portals: ${fips}`);
  }

  // Check if already in known-portals
  if (knownEntries.has(fips)) {
    throw new Error(`Entry already in known-portals: ${fips}`);
  }

  // Validate if requested
  if (validate) {
    const urlToValidate = newUrl || (entry.downloadUrl as string);
    const isValid = await validateUrl(urlToValidate);
    if (!isValid) {
      throw new Error(`URL validation failed: ${urlToValidate}`);
    }
  }

  // Create restored entry (remove quarantine-specific fields)
  const restoredEntry: NdjsonEntry = {
    _fips: fips,
    cityFips: entry.cityFips || fips,
    cityName: entry.cityName,
    state: entry.state,
    portalType: entry.portalType,
    downloadUrl: newUrl || entry.downloadUrl,
    featureCount: entry.featureCount,
    lastVerified: new Date().toISOString(),
    confidence: entry.confidence && (entry.confidence as number) > 0 ? entry.confidence : 60,
    discoveredBy: entry.discoveredBy,
    notes: entry.notes ? `${entry.notes} RESTORED: ${reason || 'Quarantine resolved.'}` : `RESTORED: ${reason || 'Quarantine resolved.'}`,
  };

  // Copy optional fields if present
  if (entry.webmapLayerName) restoredEntry.webmapLayerName = entry.webmapLayerName;
  if (entry.authoritativeSource) restoredEntry.authoritativeSource = entry.authoritativeSource;

  // Remove from quarantined-portals
  quarantinedEntries.delete(fips);

  // Add to known-portals
  knownEntries.set(fips, restoredEntry);

  // Write both files atomically
  await writeNdjsonFile(quarantinedPath, quarantinedHeader, quarantinedEntries);
  await writeNdjsonFile(knownPath, knownHeader, knownEntries);

  // Log to audit
  await appendAuditEntry({
    action: 'restore',
    registry: 'quarantined-portals',
    fips,
    actor,
    reason: reason || 'Restored from quarantine',
    before: entry as Record<string, unknown>,
    after: restoredEntry as Record<string, unknown>,
    metadata: {
      cliVersion: CLI_VERSION,
      command: `quarantine restore ${fips}${newUrl ? ` --url "${newUrl}"` : ''}${validate ? ' --validate' : ''}`,
    },
  });

  return restoredEntry as unknown as KnownPortal;
}

/**
 * Promote a quarantined entry to at-large-cities (terminal state)
 *
 * @param fips - 7-digit Census PLACE FIPS
 * @param councilSize - Number of council seats
 * @param source - Verification source
 * @param electionMethod - Election method (default: at-large)
 * @param notes - Additional notes
 * @param actor - Who initiated the promotion
 * @returns The at-large city entry
 */
export async function promoteToAtLarge(
  fips: string,
  councilSize: number,
  source: string,
  electionMethod: 'at-large' | 'at-large-with-residency' | 'proportional' = 'at-large',
  notes?: string,
  actor: string = 'cli'
): Promise<AtLargeCity> {
  const quarantinedPath = getRegistryPath('quarantinedPortals');
  const atLargePath = getRegistryPath('atLargeCities');

  // Load both registries
  const { header: quarantinedHeader, entries: quarantinedEntries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);
  const { header: atLargeHeader, entries: atLargeEntries } = await parseNdjsonFile<NdjsonEntry>(atLargePath);

  // Find entry in quarantined-portals
  const entry = quarantinedEntries.get(fips);
  if (!entry) {
    throw new Error(`Entry not found in quarantined-portals: ${fips}`);
  }

  // Check if already in at-large-cities
  if (atLargeEntries.has(fips)) {
    throw new Error(`Entry already in at-large-cities: ${fips}`);
  }

  // Build notes combining original and quarantine context
  const combinedNotes = [
    notes || '',
    entry.notes ? `Original registry notes: ${entry.notes}` : '',
    entry.quarantineReason ? `Quarantine reason: ${entry.quarantineReason}` : '',
  ].filter(Boolean).join(' ');

  // Create at-large entry
  const atLargeEntry: NdjsonEntry = {
    _fips: fips,
    cityName: entry.cityName,
    state: entry.state,
    councilSize,
    electionMethod,
    source,
    notes: combinedNotes || undefined,
    discoveredBy: actor,
    lastVerified: new Date().toISOString(),
  };

  // Remove undefined fields
  Object.keys(atLargeEntry).forEach(key => {
    if (atLargeEntry[key] === undefined) {
      delete atLargeEntry[key];
    }
  });

  // Remove from quarantined-portals
  quarantinedEntries.delete(fips);

  // Add to at-large-cities
  atLargeEntries.set(fips, atLargeEntry);

  // Write both files atomically
  await writeNdjsonFile(quarantinedPath, quarantinedHeader, quarantinedEntries);
  await writeNdjsonFile(atLargePath, atLargeHeader, atLargeEntries);

  // Log to audit
  await appendAuditEntry({
    action: 'promote',
    registry: 'quarantined-portals',
    fips,
    actor,
    reason: `Promoted to at-large: ${source}`,
    before: entry as Record<string, unknown>,
    after: atLargeEntry as Record<string, unknown>,
    metadata: {
      cliVersion: CLI_VERSION,
      command: `quarantine promote ${fips} --council-size ${councilSize} --source "${source}"`,
    },
  });

  return atLargeEntry as unknown as AtLargeCity;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Get quarantine statistics
 */
export async function getQuarantineStats(): Promise<QuarantineStats> {
  const quarantinedPath = getRegistryPath('quarantinedPortals');
  const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

  const stats: QuarantineStats = {
    total: entries.size,
    byPattern: {},
    byState: {},
    avgAgeDays: 0,
  };

  if (entries.size === 0) {
    return stats;
  }

  let totalAgeDays = 0;
  let oldestAge = -Infinity;
  let newestAge = Infinity;
  let oldestEntry: { fips: string; cityName: string; ageDays: number } | undefined;
  let newestEntry: { fips: string; cityName: string; ageDays: number } | undefined;

  const now = Date.now();

  for (const [fips, entry] of Array.from(entries)) {
    // Count by pattern
    const pattern = (entry.matchedPattern as string) || 'other';
    stats.byPattern[pattern] = (stats.byPattern[pattern] || 0) + 1;

    // Count by state
    const state = entry.state as string;
    stats.byState[state] = (stats.byState[state] || 0) + 1;

    // Calculate age
    const quarantinedAt = entry.quarantinedAt as string;
    if (quarantinedAt) {
      const ageDays = Math.floor((now - new Date(quarantinedAt).getTime()) / (1000 * 60 * 60 * 24));
      totalAgeDays += ageDays;

      if (ageDays > oldestAge) {
        oldestAge = ageDays;
        oldestEntry = { fips, cityName: entry.cityName as string, ageDays };
      }
      if (ageDays < newestAge) {
        newestAge = ageDays;
        newestEntry = { fips, cityName: entry.cityName as string, ageDays };
      }
    }
  }

  stats.avgAgeDays = Math.round(totalAgeDays / entries.size);
  stats.oldestEntry = oldestEntry;
  stats.newestEntry = newestEntry;

  return stats;
}

/**
 * Assess if a quarantined entry is potentially resolvable
 */
export function isResolvable(entry: NdjsonEntry): ResolutionAssessment {
  const pattern = (entry.matchedPattern as string) || 'other';
  const assessment: ResolutionAssessment = {
    isResolvable: false,
    suggestedStrategy: 'needs_research',
    confidence: 0,
    notes: [],
  };

  switch (pattern) {
    case 'single_feature':
      // Single feature usually means at-large
      assessment.isResolvable = true;
      assessment.suggestedStrategy = 'promote_to_at_large';
      assessment.confidence = 70;
      assessment.notes.push('Single feature often indicates at-large voting system');
      assessment.notes.push('Verify on city website or Ballotpedia before promoting');
      break;

    case 'wrong_data':
    case 'county_for_city':
    case 'regional_data_bleeding':
      // Can often find correct layer on same or different portal
      assessment.isResolvable = true;
      assessment.suggestedStrategy = 'arcgis';
      assessment.confidence = 60;
      assessment.notes.push('Search ArcGIS Hub for city-specific council district layer');
      assessment.notes.push('May need WHERE clause to filter from regional data');
      break;

    case 'containment_failure':
      // May be fixable with correct FIPS or boundary alignment
      assessment.isResolvable = true;
      assessment.suggestedStrategy = 'arcgis';
      assessment.confidence = 40;
      assessment.notes.push('Check if city boundaries recently changed (annexation)');
      assessment.notes.push('Verify correct FIPS code match');
      break;

    case 'cvra_gis_unavailable':
    case 'hybrid_gis_unavailable':
    case 'ward_gis_unavailable':
      // Need to contact city or wait for GIS publication
      assessment.isResolvable = false;
      assessment.suggestedStrategy = 'manual';
      assessment.confidence = 20;
      assessment.notes.push('No public GIS endpoint available');
      assessment.notes.push('May need to contact city GIS department');
      break;

    case 'exclusivity_topology_error':
      // Topology errors in source data - hard to fix
      assessment.isResolvable = false;
      assessment.suggestedStrategy = 'manual';
      assessment.confidence = 10;
      assessment.notes.push('Source data has topology errors (overlapping polygons)');
      assessment.notes.push('Report issue to city GIS department');
      break;

    default:
      assessment.notes.push('Manual investigation required');
  }

  return assessment;
}

/**
 * Get all quarantined entries with resolution assessments
 */
export async function getQuarantinedWithAssessments(): Promise<Array<{
  fips: string;
  entry: NdjsonEntry;
  assessment: ResolutionAssessment;
}>> {
  const quarantinedPath = getRegistryPath('quarantinedPortals');
  const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

  return Array.from(entries).map(([fips, entry]) => ({
    fips,
    entry,
    assessment: isResolvable(entry),
  }));
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Basic URL validation (HEAD request to check if endpoint is alive)
 */
export async function validateUrl(url: string): Promise<boolean> {
  try {
    // Skip validation for quarantined.invalid URLs
    if (url.includes('quarantined.invalid')) {
      return false;
    }

    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Search ArcGIS Hub for council district layers
 *
 * @param cityName - City name to search
 * @param state - State abbreviation
 * @returns Array of potential URLs
 */
export async function searchArcGISHub(
  cityName: string,
  state: string
): Promise<Array<{ url: string; title: string; confidence: number }>> {
  const results: Array<{ url: string; title: string; confidence: number }> = [];

  try {
    const searchQuery = encodeURIComponent(`"${cityName}" "${state}" council districts`);
    const hubUrl = `https://hub.arcgis.com/api/v3/search?q=${searchQuery}&types=Feature%20Service`;

    const response = await fetch(hubUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return results;
    }

    const data = await response.json() as { data?: Array<{ attributes?: { name?: string; url?: string } }> };

    if (data.data && Array.isArray(data.data)) {
      for (const item of data.data.slice(0, 5)) {
        if (item.attributes?.url && item.attributes?.name) {
          // Score based on name match
          const nameLower = item.attributes.name.toLowerCase();
          let confidence = 30;

          if (nameLower.includes('council') && nameLower.includes('district')) {
            confidence = 80;
          } else if (nameLower.includes('council') || nameLower.includes('ward')) {
            confidence = 60;
          } else if (nameLower.includes('district')) {
            confidence = 40;
          }

          if (nameLower.includes(cityName.toLowerCase())) {
            confidence += 10;
          }

          results.push({
            url: item.attributes.url,
            title: item.attributes.name,
            confidence,
          });
        }
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);
  } catch {
    // Search failed, return empty results
  }

  return results;
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format a quarantined entry for table display
 */
export function formatQuarantinedEntry(entry: NdjsonEntry): {
  fips: string;
  city: string;
  state: string;
  pattern: string;
  reason: string;
  age: string;
} {
  const quarantinedAt = entry.quarantinedAt as string;
  let age = 'unknown';
  if (quarantinedAt) {
    const days = Math.floor((Date.now() - new Date(quarantinedAt).getTime()) / (1000 * 60 * 60 * 24));
    age = `${days}d`;
  }

  return {
    fips: (entry._fips || entry.cityFips) as string,
    city: entry.cityName as string,
    state: entry.state as string,
    pattern: (entry.matchedPattern as string) || 'other',
    reason: ((entry.quarantineReason as string) || '').slice(0, 50) + '...',
    age,
  };
}

/**
 * Print entries as a table
 */
export function printTable(
  headers: string[],
  rows: string[][],
  columnWidths?: number[]
): void {
  // Calculate column widths if not provided
  const widths = columnWidths || headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRowWidth, 10);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i]!)).join(' | ');
  const separatorLine = widths.map(w => '-'.repeat(w)).join('-+-');

  console.log(headerLine);
  console.log(separatorLine);

  // Print rows
  for (const row of rows) {
    const rowLine = row.map((cell, i) => (cell || '').padEnd(widths[i]!)).join(' | ');
    console.log(rowLine);
  }
}
