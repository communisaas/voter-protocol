/**
 * Ward Registry — Unified Index of Validated City Council Ward Data
 *
 * Joins two data sources to produce a clean, deduplicated registry:
 *   - bulk-ingestion-results.json: 424 validated cities with FIPS + ward counts
 *   - attributed-council-districts.json: 2,898 ArcGIS feature server URLs with FIPS attribution
 *
 * The registry is a pure index — no network calls, no geometry.
 * It answers: "which cities have ward data, and where do we download it?"
 *
 * Deduplication: Multiple ArcGIS layers may resolve to the same city FIPS.
 * We pick the highest-confidence entry per city.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Types
// ============================================================================

export interface WardEntry {
  /** 5-7 digit city/county FIPS code. */
  cityFips: string;
  /** City name. */
  cityName: string;
  /** 2-letter state abbreviation. */
  state: string;
  /** Number of ward/council district features. */
  featureCount: number;
  /** ArcGIS FeatureServer layer URL (without /query suffix). */
  sourceUrl: string;
  /** Attribution confidence score (0-100). */
  confidence: number;
  /** Attribution method (e.g., EXTENT_GEOCODE, NAME_PARSE). */
  method: string;
}

export interface WardRegistry {
  /** All entries keyed by cityFips. */
  readonly entries: ReadonlyMap<string, WardEntry>;
  /** Get entries for a specific state (2-letter abbreviation). */
  getByState(stateAbbr: string): WardEntry[];
  /** Get all covered city FIPS codes. */
  getCoveredCityFips(): Set<string>;
  /** Get all covered state abbreviations. */
  getCoveredStates(): Set<string>;
}

// ============================================================================
// Data Source Types (JSON shapes)
// ============================================================================

interface BulkIngestionResults {
  validated: number;
  totalDistricts: number;
  byState: Record<string, { cities: number; districts: number }>;
  validCities: Array<{
    fips: string;
    name: string;
    state: string;
    featureCount: number;
    score: number;
  }>;
}

interface AttributedCouncilDistricts {
  metadata: {
    resolvedCount: number;
    unresolvedCount: number;
  };
  resolved: Array<{
    url: string;
    name: string;
    resolution: {
      fips: string;
      name: string;
      state: string;
      method: string;
      confidence: number;
    };
  }>;
}

// ============================================================================
// Registry Construction
// ============================================================================

/**
 * Build a WardRegistry from the canonical data files in agents/data/.
 *
 * @param options - Optional overrides for data file paths
 * @returns Populated WardRegistry
 */
export async function loadWardRegistry(options?: {
  ingestionPath?: string;
  attributedPath?: string;
  minConfidence?: number;
}): Promise<WardRegistry> {
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../agents/data',
  );

  const ingestionPath =
    options?.ingestionPath ?? resolve(dataDir, 'bulk-ingestion-results.json');
  const attributedPath =
    options?.attributedPath ??
    resolve(dataDir, 'attributed-council-districts.json');
  const minConfidence = options?.minConfidence ?? 70;

  // Load both data files
  const [ingestionRaw, attributedRaw] = await Promise.all([
    readFile(ingestionPath, 'utf-8'),
    readFile(attributedPath, 'utf-8'),
  ]);

  const ingestion: BulkIngestionResults = JSON.parse(ingestionRaw);
  const attributed: AttributedCouncilDistricts = JSON.parse(attributedRaw);

  // Build index: cityFips → best attributed entry (highest confidence)
  const bestByFips = new Map<
    string,
    { url: string; confidence: number; method: string }
  >();

  for (const entry of attributed.resolved) {
    const fips = entry.resolution.fips;
    const existing = bestByFips.get(fips);
    if (!existing || entry.resolution.confidence > existing.confidence) {
      bestByFips.set(fips, {
        url: entry.url,
        confidence: entry.resolution.confidence,
        method: entry.resolution.method,
      });
    }
  }

  // Join: validated cities (primary list) + best attributed URL
  const entries = new Map<string, WardEntry>();

  for (const city of ingestion.validCities) {
    const attr = bestByFips.get(city.fips);
    if (!attr) continue;

    const confidence = attr.confidence;
    if (confidence < minConfidence) continue;

    entries.set(city.fips, {
      cityFips: city.fips,
      cityName: city.name,
      state: city.state,
      featureCount: city.featureCount,
      sourceUrl: attr.url,
      confidence,
      method: attr.method,
    });
  }

  return createRegistry(entries);
}

function createRegistry(entries: Map<string, WardEntry>): WardRegistry {
  // Pre-build state index
  const byState = new Map<string, WardEntry[]>();
  for (const entry of entries.values()) {
    const existing = byState.get(entry.state);
    if (existing) {
      existing.push(entry);
    } else {
      byState.set(entry.state, [entry]);
    }
  }

  return {
    entries,

    getByState(stateAbbr: string): WardEntry[] {
      return byState.get(stateAbbr.toUpperCase()) ?? [];
    },

    getCoveredCityFips(): Set<string> {
      return new Set(entries.keys());
    },

    getCoveredStates(): Set<string> {
      return new Set(byState.keys());
    },
  };
}
