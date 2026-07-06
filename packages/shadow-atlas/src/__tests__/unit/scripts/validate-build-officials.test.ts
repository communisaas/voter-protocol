import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkOfficialsCompleteness,
  congressionalSlotToOfficialDistrictCode,
  type ChunkAccumulator,
  type ManifestFile,
} from '../../../../scripts/validate-build.js';

describe('validate-build officials cross-reference', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `validate-build-officials-${process.pid}-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  function manifest(): ManifestFile {
    return {
      version: 1,
      generated: '2026-07-06T00:00:00.000Z',
      country: 'US',
      totalCells: 0,
      totalChunks: 0,
      resolution: 8,
      slotNames: {},
      chunks: {},
    };
  }

  function accumulator(primaryDistricts: string[]): ChunkAccumulator {
    return {
      sha256Verified: 0,
      sha256Mismatches: 0,
      sha256MismatchDetails: [],
      allCells: new Set(),
      duplicateCells: [],
      totalCellsFromChunks: 0,
      chunksChecked: 0,
      failedChunks: 0,
      formatFailures: [],
      primaryDistricts: new Set(primaryDistricts),
      cellOwnership: new Map(),
      crossChunkDuplicates: [],
      cellCountMismatches: 0,
      cellCountMismatchDetails: [],
    };
  }

  function createOfficialsDir(): string {
    const officialsDir = join(outputDir, 'US', 'officials');
    mkdirSync(officialsDir, { recursive: true });
    return officialsDir;
  }

  function writeOfficialsFile(districtCode: string, officials: unknown[] = [{ name: 'Rep' }]): void {
    writeFileSync(
      join(createOfficialsDir(), `${districtCode}.json`),
      JSON.stringify({
        version: 1,
        country: 'US',
        district_code: districtCode,
        officials,
        generated: '2026-07-06T00:00:00.000Z',
      }),
      'utf-8',
    );
  }

  it('converts cd slot values to officials district codes', () => {
    expect(congressionalSlotToOfficialDistrictCode('cd-4801')).toBe('TX-01');
    expect(congressionalSlotToOfficialDistrictCode('cd-0200')).toBe('AK-AL');
    expect(congressionalSlotToOfficialDistrictCode('cd-1198')).toBe('DC-AL');
    expect(congressionalSlotToOfficialDistrictCode('vtd-4801')).toBeNull();
  });

  it('cross-references a mapped congressional district against its officials file', () => {
    writeOfficialsFile('TX-01');

    const result = checkOfficialsCompleteness(
      outputDir,
      'US',
      accumulator(['cd-4801']),
      manifest(),
    );

    expect(result.status).toBe('pass');
    expect(result.details).toMatchObject({
      vacantOrMissing: [],
      vacantOrMissingCount: 0,
    });
  });

  it('excludes non-numeric ZZ congressional tokens from missing officials output', () => {
    writeOfficialsFile('TX-01');

    const result = checkOfficialsCompleteness(
      outputDir,
      'US',
      accumulator(['cd-4801', 'cd-09ZZ', 'cd-17ZZ']),
      manifest(),
    );

    expect(result.status).toBe('pass');
    expect(result.details).toMatchObject({
      vacantOrMissing: [],
      vacantOrMissingCount: 0,
    });
  });

  it('treats small missing mapped district counts and empty rosters as informational', () => {
    writeOfficialsFile('TX-01', []);

    const result = checkOfficialsCompleteness(
      outputDir,
      'US',
      accumulator(['cd-4801', 'cd-0614', 'cd-1220', 'cd-1313', 'cd-4823']),
      manifest(),
    );

    expect(result.status).toBe('pass');
    expect(result.details).toMatchObject({
      vacantOrMissingCount: 4,
    });

    const details = result.details as {
      emptyOfficials: string[];
      vacantOrMissing: string[];
    };
    expect(details.emptyOfficials).toEqual(['TX-01.json: district TX-01 has 0 officials']);
    expect(details.vacantOrMissing).toEqual([
      'cd-0614 -> CA-14',
      'cd-1220 -> FL-20',
      'cd-1313 -> GA-13',
      'cd-4823 -> TX-23',
    ]);
  });

  it('warns when mapped districts missing officials exceed the vacancy threshold', () => {
    writeOfficialsFile('TX-01');
    const districts = Array.from({ length: 27 }, (_, index) => {
      const district = String(index + 1).padStart(2, '0');
      return `cd-48${district}`;
    });

    const result = checkOfficialsCompleteness(
      outputDir,
      'US',
      accumulator(districts),
      manifest(),
    );

    expect(result.status).toBe('warn');
    expect(result.message).toContain('1 warning(s)');
    expect(result.details).toMatchObject({
      vacantOrMissingCount: 26,
      warnings: [
        '26 mapped districts have no officials file (exceeds vacancy threshold — possible export/format break)',
      ],
    });
  });

  it('preserves the structural warning for a missing officials directory', () => {
    const result = checkOfficialsCompleteness(
      outputDir,
      'US',
      accumulator(['cd-4801']),
      manifest(),
    );

    expect(result.status).toBe('warn');
    expect(result.message).toBe('No officials/ directory found — skipping officials validation');
    expect(result.status === 'pass').toBe(false);
  });
});
