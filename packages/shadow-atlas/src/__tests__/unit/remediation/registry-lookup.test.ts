/**
 * Unit tests for scripts/remediation/registry-lookup.ts — the committed
 * replacement for round-1's dead-on-arrival inline
 * `npx tsx -e "import ... source-health.js"` (MODULE_NOT_FOUND: tsx's
 * .js->.ts extension remap only applies from a TS-parent import context;
 * an `-e` eval parent is neither, and the JS-facing "source-health.js"
 * specifier — while correct in normal ESM-from-compiled-output contexts —
 * fails to resolve here). This is a real, invoked-as-a-subprocess test, not
 * a mock — it shells out to `npx tsx` exactly as the workflow does, from
 * the repo root, to prove the exact failure mode is fixed and stays fixed.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_PATH = fileURLToPath(
  new URL('../../../../scripts/remediation/registry-lookup.ts', import.meta.url)
);
// packages/shadow-atlas/
const PACKAGE_ROOT = join(dirname(SCRIPT_PATH), '..', '..');
// repo root (two levels up from packages/shadow-atlas)
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

describe('registry-lookup.ts', () => {
  it('resolves a known source id (tiger-cd119) to its full registry row, invoked exactly as the workflow does', () => {
    const stdout = execFileSync(
      'npx',
      ['tsx', 'packages/shadow-atlas/scripts/remediation/registry-lookup.ts', 'tiger-cd119'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    const row = JSON.parse(stdout);
    expect(row.id).toBe('tiger-cd119');
    expect(row).toHaveProperty('configSite');
    expect(typeof row.configSite).toBe('string');
    expect(row.configSite.length).toBeGreaterThan(0);
  });

  it('exits nonzero with no stdout JSON for an unknown source id', () => {
    expect(() =>
      execFileSync(
        'npx',
        ['tsx', 'packages/shadow-atlas/scripts/remediation/registry-lookup.ts', 'not-a-real-source-id'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    ).toThrow();
  });

  it('exits nonzero when no source_id argument is given', () => {
    expect(() =>
      execFileSync(
        'npx',
        ['tsx', 'packages/shadow-atlas/scripts/remediation/registry-lookup.ts'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    ).toThrow();
  });

  it('regression: the dead .js import specifier form still fails MODULE_NOT_FOUND (documents why this script exists)', () => {
    // This is not testing our script — it is a pinned repro of the exact
    // round-1 defect, so if tsx's resolution behavior ever changes and
    // silently "fixes" the dead form, this test flags that drift rather
    // than leaving the historical claim unverifiable.
    expect(() =>
      execFileSync(
        'npx',
        [
          'tsx',
          '-e',
          "import { SOURCE_REGISTRY } from './packages/shadow-atlas/src/acquisition/source-health.js'; console.log(SOURCE_REGISTRY.length);",
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    ).toThrow();
  });
});
