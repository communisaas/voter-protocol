/**
 * Extraction Regression Tracker
 *
 * Compares successive hydration runs to detect degradation in boundary
 * or official extraction quality. Stores baselines in SQLite and produces
 * a regression report with WARNING / CRITICAL severity levels.
 *
 * Regressions are diagnostic (not blocking) — they surface quality drops
 * so operators can investigate before they compound.
 *
 * @see hydrate-country.ts — wired after the validation report
 */

import Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export interface ExtractionBaseline {
  country: string;
  timestamp: string; // ISO 8601
  boundaries: { layer: string; count: number; expectedCount: number }[];
  officials: { count: number; expectedCount: number; resolved: number; unmatched: number };
  overallConfidence: number;
}

export interface RegressionReport {
  country: string;
  passed: boolean;
  warnings: string[];
  criticals: string[];
  previousTimestamp: string;
  currentTimestamp: string;
}

// ============================================================================
// DDL
// ============================================================================

export const BASELINES_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS extraction_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  boundary_counts TEXT NOT NULL,
  official_count INTEGER NOT NULL,
  expected_official_count INTEGER NOT NULL,
  resolved_count INTEGER NOT NULL,
  unmatched_count INTEGER NOT NULL,
  overall_confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_baselines_country ON extraction_baselines(country, created_at DESC);
`;

// ============================================================================
// Persistence
// ============================================================================

function ensureSchema(db: InstanceType<typeof Database>): void {
  db.exec(BASELINES_SCHEMA_DDL);
}

/**
 * Save a baseline after successful extraction.
 */
export function saveBaseline(dbPath: string, baseline: ExtractionBaseline): void {
  const db = new Database(dbPath);
  try {
    ensureSchema(db);

    // Sort boundary keys for stable JSON serialization
    const sortedBoundaries = [...baseline.boundaries].sort((a, b) =>
      a.layer.localeCompare(b.layer),
    );

    db.prepare(`
      INSERT INTO extraction_baselines (
        country, timestamp, boundary_counts,
        official_count, expected_official_count,
        resolved_count, unmatched_count, overall_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      baseline.country,
      baseline.timestamp,
      JSON.stringify(sortedBoundaries),
      baseline.officials.count,
      baseline.officials.expectedCount,
      baseline.officials.resolved,
      baseline.officials.unmatched,
      baseline.overallConfidence,
    );
  } finally {
    db.close();
  }
}

/**
 * Load the most recent baseline for a country.
 */
export function loadBaseline(dbPath: string, country: string): ExtractionBaseline | null {
  // Open read-only — loadBaseline should never mutate the DB
  const db = new Database(dbPath, { readonly: true });
  try {

    let row: {
      country: string;
      timestamp: string;
      boundary_counts: string;
      official_count: number;
      expected_official_count: number;
      resolved_count: number;
      unmatched_count: number;
      overall_confidence: number;
    } | undefined;

    try {
      row = db.prepare(`
        SELECT country, timestamp, boundary_counts,
               official_count, expected_official_count,
               resolved_count, unmatched_count, overall_confidence
        FROM extraction_baselines
        WHERE country = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(country) as typeof row;
    } catch (err: unknown) {
      // Gracefully handle missing table — DB may pre-exist from db-writer without baselines schema
      if (err instanceof Error && err.message.includes('no such table')) {
        return null;
      }
      throw err;
    }

    if (!row) return null;

    return {
      country: row.country,
      timestamp: row.timestamp,
      boundaries: JSON.parse(row.boundary_counts) as ExtractionBaseline['boundaries'],
      officials: {
        count: row.official_count,
        expectedCount: row.expected_official_count,
        resolved: row.resolved_count,
        unmatched: row.unmatched_count,
      },
      overallConfidence: row.overall_confidence,
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare a current extraction to the previous baseline.
 *
 * Thresholds:
 * - Official count decrease > 5% → WARNING
 * - Official count decrease > 20% → CRITICAL
 * - Boundary count decrease > 5% → WARNING
 * - Boundary count decrease > 20% → CRITICAL
 * - Confidence decrease > 10 pts → WARNING
 * - Confidence decrease > 25 pts → CRITICAL
 * - New unmatched officials → WARNING
 * - Resolution count decreased → WARNING
 */
export function compareToBaseline(
  current: ExtractionBaseline,
  previous: ExtractionBaseline,
): RegressionReport {
  const warnings: string[] = [];
  const criticals: string[] = [];

  // --- Official count ---
  if (previous.officials.count > 0) {
    const pct = (previous.officials.count - current.officials.count) / previous.officials.count;
    if (pct > 0.20) {
      criticals.push(
        `Official count dropped ${(pct * 100).toFixed(1)}%: ${previous.officials.count} → ${current.officials.count}`,
      );
    } else if (pct > 0.05) {
      warnings.push(
        `Official count dropped ${(pct * 100).toFixed(1)}%: ${previous.officials.count} → ${current.officials.count}`,
      );
    }
  }

  // --- Boundary counts (per layer) ---
  const prevBoundaryMap = new Map(previous.boundaries.map(b => [b.layer, b.count]));
  const curBoundarySet = new Set(current.boundaries.map(b => b.layer));
  for (const cur of current.boundaries) {
    const prevCount = prevBoundaryMap.get(cur.layer);
    if (prevCount != null && prevCount > 0) {
      const pct = (prevCount - cur.count) / prevCount;
      if (pct > 0.20) {
        criticals.push(
          `Boundary "${cur.layer}" dropped ${(pct * 100).toFixed(1)}%: ${prevCount} → ${cur.count}`,
        );
      } else if (pct > 0.05) {
        warnings.push(
          `Boundary "${cur.layer}" dropped ${(pct * 100).toFixed(1)}%: ${prevCount} → ${cur.count}`,
        );
      }
    }
  }

  // R34-M2: Detect entirely dropped layers — previous layers absent from current run
  for (const prev of previous.boundaries) {
    if (!curBoundarySet.has(prev.layer) && prev.count > 0) {
      criticals.push(
        `Boundary layer "${prev.layer}" entirely missing from current run (was ${prev.count})`,
      );
    }
  }

  // --- Overall confidence ---
  const confDrop = previous.overallConfidence - current.overallConfidence;
  if (confDrop > 25) {
    criticals.push(
      `Confidence dropped ${confDrop} points: ${previous.overallConfidence} → ${current.overallConfidence}`,
    );
  } else if (confDrop > 10) {
    warnings.push(
      `Confidence dropped ${confDrop} points: ${previous.overallConfidence} → ${current.overallConfidence}`,
    );
  }

  // --- New unmatched officials ---
  if (current.officials.unmatched > previous.officials.unmatched) {
    const increase = current.officials.unmatched - previous.officials.unmatched;
    warnings.push(
      `Unmatched officials increased by ${increase}: ${previous.officials.unmatched} → ${current.officials.unmatched}`,
    );
  }

  // --- Resolution count decreased ---
  if (current.officials.resolved < previous.officials.resolved) {
    const decrease = previous.officials.resolved - current.officials.resolved;
    warnings.push(
      `Resolved count decreased by ${decrease}: ${previous.officials.resolved} → ${current.officials.resolved}`,
    );
  }

  return {
    country: current.country,
    passed: criticals.length === 0,
    warnings,
    criticals,
    previousTimestamp: previous.timestamp,
    currentTimestamp: current.timestamp,
  };
}
