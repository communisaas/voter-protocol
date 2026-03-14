import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveBaseline,
  loadBaseline,
  compareToBaseline,
  BASELINES_SCHEMA_DDL,
  type ExtractionBaseline,
} from '../../../hydration/regression-tracker.js';

// ============================================================================
// Helpers
// ============================================================================

function makeBaseline(overrides: Partial<ExtractionBaseline> = {}): ExtractionBaseline {
  return {
    country: 'GB',
    timestamp: '2026-03-13T00:00:00.000Z',
    boundaries: [
      { layer: 'parliamentary', count: 650, expectedCount: 650 },
    ],
    officials: {
      count: 650,
      expectedCount: 650,
      resolved: 650,
      unmatched: 0,
    },
    overallConfidence: 96,
    ...overrides,
  };
}

// ============================================================================
// Persistence: saveBaseline + loadBaseline
// ============================================================================

describe('regression-tracker persistence', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = join(tmpdir(), `reg-tracker-${Date.now().toString(36)}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    try { unlinkSync(dbPath); } catch { /* noop */ }
  });

  it('saveBaseline + loadBaseline roundtrip', () => {
    const baseline = makeBaseline();
    saveBaseline(dbPath, baseline);

    const loaded = loadBaseline(dbPath, 'GB');
    expect(loaded).not.toBeNull();
    expect(loaded!.country).toBe('GB');
    expect(loaded!.timestamp).toBe(baseline.timestamp);
    expect(loaded!.overallConfidence).toBe(96);
    expect(loaded!.officials).toEqual(baseline.officials);
    expect(loaded!.boundaries).toEqual(baseline.boundaries);
  });

  it('loadBaseline returns null when no baseline exists', () => {
    // Create the DB file so loadBaseline can open it
    const db = new Database(dbPath);
    db.exec(BASELINES_SCHEMA_DDL);
    db.close();

    const loaded = loadBaseline(dbPath, 'XX');
    expect(loaded).toBeNull();
  });

  it('loadBaseline returns the most recent baseline', () => {
    const first = makeBaseline({ timestamp: '2026-03-01T00:00:00.000Z', overallConfidence: 90 });
    const second = makeBaseline({ timestamp: '2026-03-13T12:00:00.000Z', overallConfidence: 96 });

    saveBaseline(dbPath, first);
    saveBaseline(dbPath, second);

    const loaded = loadBaseline(dbPath, 'GB');
    expect(loaded).not.toBeNull();
    expect(loaded!.timestamp).toBe('2026-03-13T12:00:00.000Z');
    expect(loaded!.overallConfidence).toBe(96);
  });

  it('loadBaseline filters by country', () => {
    saveBaseline(dbPath, makeBaseline({ country: 'GB' }));
    saveBaseline(dbPath, makeBaseline({ country: 'AU', overallConfidence: 80 }));

    const gbBaseline = loadBaseline(dbPath, 'GB');
    expect(gbBaseline).not.toBeNull();
    expect(gbBaseline!.country).toBe('GB');
    expect(gbBaseline!.overallConfidence).toBe(96);

    const auBaseline = loadBaseline(dbPath, 'AU');
    expect(auBaseline).not.toBeNull();
    expect(auBaseline!.country).toBe('AU');
    expect(auBaseline!.overallConfidence).toBe(80);
  });

  it('boundary_counts are JSON-serialized with sorted keys', () => {
    const baseline = makeBaseline({
      boundaries: [
        { layer: 'maori', count: 7, expectedCount: 7 },
        { layer: 'general', count: 65, expectedCount: 65 },
      ],
    });
    saveBaseline(dbPath, baseline);

    // Read raw DB to verify sort order
    const db = new Database(dbPath);
    const row = db.prepare('SELECT boundary_counts FROM extraction_baselines LIMIT 1').get() as { boundary_counts: string };
    db.close();

    const parsed = JSON.parse(row.boundary_counts);
    // 'general' comes before 'maori' alphabetically
    expect(parsed[0].layer).toBe('general');
    expect(parsed[1].layer).toBe('maori');
  });
});

// ============================================================================
// Comparison: compareToBaseline
// ============================================================================

describe('compareToBaseline', () => {
  it('no change -> passed=true, no warnings or criticals', () => {
    const previous = makeBaseline({ timestamp: '2026-03-01T00:00:00.000Z' });
    const current = makeBaseline({ timestamp: '2026-03-13T00:00:00.000Z' });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.criticals).toEqual([]);
    expect(report.country).toBe('GB');
    expect(report.previousTimestamp).toBe('2026-03-01T00:00:00.000Z');
    expect(report.currentTimestamp).toBe('2026-03-13T00:00:00.000Z');
  });

  it('10% official count drop -> WARNING', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 650, unmatched: 0 },
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      // ~10% drop: 650 -> 585
      officials: { count: 585, expectedCount: 650, resolved: 585, unmatched: 0 },
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
    expect(report.warnings.some(w => w.includes('Official count dropped'))).toBe(true);
    expect(report.criticals.length).toBe(0);
  });

  it('25% official count drop -> CRITICAL', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 650, unmatched: 0 },
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      // ~25% drop: 650 -> 487
      officials: { count: 487, expectedCount: 650, resolved: 487, unmatched: 0 },
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(false);
    expect(report.criticals.length).toBeGreaterThanOrEqual(1);
    expect(report.criticals.some(c => c.includes('Official count dropped'))).toBe(true);
  });

  it('confidence drop 15 points -> WARNING', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      overallConfidence: 96,
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      overallConfidence: 80,
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings.some(w => w.includes('Confidence dropped'))).toBe(true);
    expect(report.criticals.length).toBe(0);
  });

  it('confidence drop 30 points -> CRITICAL', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      overallConfidence: 96,
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      overallConfidence: 60,
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(false);
    expect(report.criticals.some(c => c.includes('Confidence dropped'))).toBe(true);
  });

  it('new unmatched officials -> WARNING', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 650, unmatched: 0 },
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 645, unmatched: 5 },
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings.some(w => w.includes('Unmatched officials increased'))).toBe(true);
  });

  it('resolution count decreased -> WARNING', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 650, unmatched: 0 },
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 640, unmatched: 0 },
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings.some(w => w.includes('Resolved count decreased'))).toBe(true);
  });

  it('improvement (counts increased) -> passed=true, no warnings', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      officials: { count: 600, expectedCount: 650, resolved: 580, unmatched: 20 },
      overallConfidence: 85,
      boundaries: [{ layer: 'parliamentary', count: 640, expectedCount: 650 }],
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      officials: { count: 650, expectedCount: 650, resolved: 650, unmatched: 0 },
      overallConfidence: 96,
      boundaries: [{ layer: 'parliamentary', count: 650, expectedCount: 650 }],
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.criticals).toEqual([]);
  });

  it('boundary count drop per layer -> WARNING or CRITICAL', () => {
    const previous = makeBaseline({
      timestamp: '2026-03-01T00:00:00.000Z',
      boundaries: [
        { layer: 'general', count: 65, expectedCount: 65 },
        { layer: 'maori', count: 7, expectedCount: 7 },
      ],
    });
    const current = makeBaseline({
      timestamp: '2026-03-13T00:00:00.000Z',
      boundaries: [
        { layer: 'general', count: 60, expectedCount: 65 }, // ~7.7% drop -> WARNING
        { layer: 'maori', count: 5, expectedCount: 7 },     // ~28.6% drop -> CRITICAL
      ],
    });

    const report = compareToBaseline(current, previous);
    expect(report.passed).toBe(false); // has a CRITICAL
    expect(report.warnings.some(w => w.includes('general'))).toBe(true);
    expect(report.criticals.some(c => c.includes('maori'))).toBe(true);
  });
});
