import { describe, it, expect } from 'vitest';
import { resolveOutputDir } from '../../../../scripts/build-chunked-mapping.js';

/**
 * Guards the positional CLI contract for build-chunked-mapping: argv[3] is the
 * optional outputDir, but a flag token (`--tiger-vintage`, `--officials-db`)
 * in that slot must NOT be consumed as the output directory (it falls back to
 * './output').
 */
describe('resolveOutputDir', () => {
  it('does not treat a flag token as outputDir (falls back to ./output)', () => {
    expect(
      resolveOutputDir(['n', 's', 'db', '--tiger-vintage', 'TIGER2024'])
    ).toBe('./output');
  });

  it('does not treat --officials-db as outputDir (falls back to ./output)', () => {
    expect(
      resolveOutputDir(['n', 's', 'db', '--officials-db', './officials.db'])
    ).toBe('./output');
  });

  it('honors an explicit outputDir supplied before flags', () => {
    expect(
      resolveOutputDir(['n', 's', 'db', './out', '--tiger-vintage', 'TIGER2024'])
    ).toBe('./out');
  });

  it('defaults to ./output when no outputDir is supplied', () => {
    expect(resolveOutputDir(['n', 's', 'db'])).toBe('./output');
  });
});
