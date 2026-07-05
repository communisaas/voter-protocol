/**
 * Unit tests for scripts/remediation/deny-check.sh — the edit-surface
 * enforcement both jobs in .github/workflows/shadow-atlas-remediate.yml
 * source (no duplicated heredocs).
 *
 * Zero network, zero git: the script takes a plain file of changed paths
 * (the caller is responsible for producing that via `git diff --name-only`
 * in the real workflow) so these tests exercise it purely with fixture
 * path lists.
 *
 * Round-1 defect under regression test here: the deny pattern was a bare
 * substring blacklist containing "manifest", which matched
 * packages/shadow-atlas/src/providers/tiger-manifest.ts — the declared
 * configSite / edit target for 9+ SOURCE_REGISTRY rows and squarely INSIDE
 * the allowed edit surface (providers/). That false-positive would have
 * reddened every legitimate TIGER-vintage remediation PR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DENY_CHECK_SH = fileURLToPath(
  new URL('../../../../scripts/remediation/deny-check.sh', import.meta.url)
);

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'deny-check-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runDenyCheck(paths: string[]) {
  const file = join(workDir, 'changed.txt');
  writeFileSync(file, paths.join('\n') + (paths.length ? '\n' : ''));
  return execFileSync('bash', [DENY_CHECK_SH, file], { encoding: 'utf8' });
}

function runDenyCheckExpectFailure(paths: string[]): { status: number; stdout: string } {
  const file = join(workDir, 'changed.txt');
  writeFileSync(file, paths.join('\n') + (paths.length ? '\n' : ''));
  try {
    const stdout = execFileSync('bash', [DENY_CHECK_SH, file], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { status: e.status, stdout: e.stdout };
  }
}

describe('deny-check.sh — allowed edit surface', () => {
  it('passes real acquisition/providers/hydration/config/scripts paths', () => {
    const result = runDenyCheck([
      'packages/shadow-atlas/src/acquisition/change-detector.ts',
      'packages/shadow-atlas/src/providers/tiger-manifest.ts',
      'packages/shadow-atlas/src/hydration/ward-registry.ts',
      'packages/shadow-atlas/src/config/providers.ts',
      'packages/shadow-atlas/scripts/generate-tiger-manifest.ts',
    ]);
    expect(result.trim()).toBe('diff-guard-ok');
  });

  it('passes the matching unit test mirror paths', () => {
    const result = runDenyCheck([
      'packages/shadow-atlas/src/__tests__/unit/acquisition/change-detector.test.ts',
      'packages/shadow-atlas/src/__tests__/unit/providers/tiger-manifest.test.ts',
    ]);
    expect(result.trim()).toBe('diff-guard-ok');
  });

  it('regression: providers/tiger-manifest.ts is NOT denied by a bare "manifest" substring match', () => {
    const result = runDenyCheck(['packages/shadow-atlas/src/providers/tiger-manifest.ts']);
    expect(result.trim()).toBe('diff-guard-ok');
  });

  it('passes with an empty changed-file list (no-op)', () => {
    const result = runDenyCheck([]);
    expect(result.trim()).toBe('no-changes');
  });
});

describe('deny-check.sh — denied paths', () => {
  it('fails when the diff touches .github/workflows/', () => {
    const { status, stdout } = runDenyCheckExpectFailure([
      'packages/shadow-atlas/src/providers/tiger-manifest.ts',
      '.github/workflows/shadow-atlas-remediate.yml',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('.github/workflows/shadow-atlas-remediate.yml');
  });

  it('fails on the signed-manifest / signing path', () => {
    const { status, stdout } = runDenyCheckExpectFailure([
      'packages/shadow-atlas/src/serving/signing.ts',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('signing.ts');
  });

  it('fails on distribution/publish-adjacent paths', () => {
    const { status, stdout } = runDenyCheckExpectFailure([
      'packages/shadow-atlas/src/distribution/services/pinata.ts',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('pinata.ts');
  });

  it('fails on output/ and dist/ paths', () => {
    const { status } = runDenyCheckExpectFailure(['packages/shadow-atlas/output/atlas.db']);
    expect(status).not.toBe(0);

    const { status: status2 } = runDenyCheckExpectFailure(['dist/index.js']);
    expect(status2).not.toBe(0);
  });

  it('fails on any path outside the five allowed directories, even within the package', () => {
    const { status, stdout } = runDenyCheckExpectFailure([
      'packages/shadow-atlas/src/serving/api.ts',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('outside-edit-surface');
  });

  it('fails on root-level package.json (outside the allowlist entirely)', () => {
    const { status } = runDenyCheckExpectFailure(['package.json']);
    expect(status).not.toBe(0);
  });
});

describe('deny-check.sh — mixed changesets', () => {
  it('fails the whole check if even one path in a larger changeset is denied', () => {
    const { status, stdout } = runDenyCheckExpectFailure([
      'packages/shadow-atlas/src/acquisition/change-detector.ts',
      'packages/shadow-atlas/src/providers/tiger-manifest.ts',
      'packages/shadow-atlas/src/__tests__/unit/acquisition/change-detector.test.ts',
      '.github/workflows/shadow-atlas-quarterly.yml',
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('shadow-atlas-quarterly.yml');
  });
});
