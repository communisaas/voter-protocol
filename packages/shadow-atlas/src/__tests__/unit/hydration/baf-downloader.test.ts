import { describe, it, expect } from 'vitest';
import { STATE_FIPS, downloadBAFs } from '../../../hydration/baf-downloader.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// STATE_FIPS table
// ============================================================================

describe('STATE_FIPS', () => {
  it('should contain 50 states + DC + 5 territories = 56 entries', () => {
    expect(STATE_FIPS.size).toBe(56);
  });

  it('should map known states correctly', () => {
    expect(STATE_FIPS.get('01')).toBe('AL');
    expect(STATE_FIPS.get('06')).toBe('CA');
    expect(STATE_FIPS.get('11')).toBe('DC');
    expect(STATE_FIPS.get('36')).toBe('NY');
    expect(STATE_FIPS.get('48')).toBe('TX');
    expect(STATE_FIPS.get('56')).toBe('WY');
  });

  it('should include territories', () => {
    expect(STATE_FIPS.get('60')).toBe('AS');
    expect(STATE_FIPS.get('66')).toBe('GU');
    expect(STATE_FIPS.get('69')).toBe('MP');
    expect(STATE_FIPS.get('72')).toBe('PR');
    expect(STATE_FIPS.get('78')).toBe('VI');
  });

  it('should not include gap FIPS codes', () => {
    // 03, 07, 14, etc. are unused
    expect(STATE_FIPS.has('03')).toBe(false);
    expect(STATE_FIPS.has('07')).toBe(false);
    expect(STATE_FIPS.has('14')).toBe(false);
  });

  it('should have all values as 2-char uppercase abbreviations', () => {
    for (const [fips, abbr] of STATE_FIPS) {
      expect(fips).toMatch(/^\d{2}$/);
      expect(abbr).toMatch(/^[A-Z]{2}$/);
    }
  });
});

// ============================================================================
// downloadBAFs — cache behavior
// ============================================================================

describe('downloadBAFs', () => {
  it('should return cached results when cache directory is populated', async () => {
    const testDir = join(tmpdir(), `baf-dl-test-${Date.now().toString(36)}`);
    const stateDir = join(testDir, '11'); // DC
    await mkdir(stateDir, { recursive: true });

    // Create fake cached files
    await writeFile(join(stateDir, 'BlockAssign_ST11_DC_CD.txt'), 'BLOCKID|DISTRICT\n110010001011000|98\n');
    await writeFile(join(stateDir, 'BlockAssign_ST11_DC_SLDU.txt'), 'BLOCKID|DISTRICT\n110010001011000|002\n');

    const results = await downloadBAFs({
      cacheDir: testDir,
      stateCode: '11',
      log: () => {}, // suppress logs
    });

    expect(results).toHaveLength(1);
    expect(results[0].stateCode).toBe('11');
    expect(results[0].stateAbbr).toBe('DC');
    expect(results[0].cached).toBe(true);
    expect(results[0].files).toHaveLength(2);

    await rm(testDir, { recursive: true });
  });

  it('should reject unknown state FIPS code', async () => {
    const testDir = join(tmpdir(), `baf-dl-test-${Date.now().toString(36)}`);

    await expect(downloadBAFs({
      cacheDir: testDir,
      stateCode: '99',
      log: () => {},
    })).rejects.toThrow('Unknown state FIPS code: 99');

    await rm(testDir, { recursive: true, force: true });
  });
});
