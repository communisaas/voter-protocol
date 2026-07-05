/**
 * Unit tests for scripts/remediation/guard.sh — the pre-flight guard both
 * jobs in .github/workflows/shadow-atlas-remediate.yml source (no duplicated
 * heredocs; this IS what "both jobs source the same script" means).
 *
 * Zero network: `gh` is replaced on PATH with a scriptable fake
 * (fixtures/remediation/fake-gh.mjs) driven entirely by fixture JSON files
 * written per-test to a tmpdir. Round-1's guard used `gh --jq --arg`, which
 * is invalid gh CLI syntax (gh's --jq takes a single expression, not jq's
 * --arg) and was silently masked by `2>/dev/null || echo 0`, permanently
 * zeroing two of the four no-op conditions. These tests exercise the real
 * script end-to-end via child_process so a regression back to that pattern
 * fails loudly instead of being grep-invisible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD_SH = fileURLToPath(
  new URL('../../../../scripts/remediation/guard.sh', import.meta.url)
);
const FAKE_GH = fileURLToPath(
  new URL('../../fixtures/remediation/fake-gh.mjs', import.meta.url)
);

let workDir: string;
let binDir: string;
let fixturePath: string;
let logPath: string;

function writeFixture(fixture: Record<string, unknown>) {
  writeFileSync(fixturePath, JSON.stringify(fixture));
}

function runGuard(sourceId: string, issueNumber: string, env: Record<string, string> = {}) {
  return execFileSync('bash', [GUARD_SH, sourceId, issueNumber], {
    cwd: workDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_TOKEN: 'fake-token-for-test',
      FAKE_GH_FIXTURE: fixturePath,
      FAKE_GH_LOG: logPath,
      GUARD_SKIP_MARKER: '0',
      ...env,
    },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'guard-test-'));
  binDir = mkdtempSync(join(tmpdir(), 'guard-bin-'));
  // Symlink-free shim: a tiny wrapper script named `gh` that execs the fake.
  writeFileSync(
    join(binDir, 'gh'),
    `#!/usr/bin/env bash\nexec node "${FAKE_GH}" "$@"\n`,
    { mode: 0o755 }
  );
  fixturePath = join(workDir, 'fixture.json');
  logPath = join(workDir, 'gh-invocations.ndjson');
  writeFixture({});
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

describe('guard.sh — proceed path', () => {
  it('proceeds when no no-op condition holds, and stamps a run-marker comment', () => {
    writeFixture({ prList: [], issueLabels: {}, issueComments: {}, breachIssueNumbers: [] });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toBe('proceed=true');

    const log = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const commentCall = log.find((entry) => entry.args[0] === 'issue' && entry.args[1] === 'comment');
    expect(commentCall).toBeDefined();
    expect(commentCall.args).toContain('42');
  });
});

describe('guard.sh — condition (a): open PR dedupe', () => {
  it('no-ops when an open PR already matches remediate/<source_id>/*', () => {
    writeFixture({
      prList: [{ headRefName: 'remediate/tiger-cd119/20260701' }],
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toContain('proceed=false:open PR already exists');
  });

  it('proceeds when open PRs exist for a DIFFERENT source', () => {
    writeFixture({
      prList: [{ headRefName: 'remediate/some-other-source/20260701' }],
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toBe('proceed=true');
  });
});

describe('guard.sh — condition (b): atlas-needs-human escalation', () => {
  it('no-ops when the issue already carries atlas-needs-human', () => {
    writeFixture({
      issueLabels: { '42': ['atlas-slo-breach', 'atlas-needs-human'] },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toContain('already carries atlas-needs-human');
  });
});

describe('guard.sh — condition (c): 72h cooldown', () => {
  it('no-ops when a cooldown marker is newer than 72h', () => {
    const recent = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10h ago
    writeFixture({
      issueComments: {
        '42': [{ body: '<!-- remediate-cooldown-marker -->\nattempt done', createdAt: recent }],
      },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toContain('cooldown marker newer than 72h');
  });

  it('proceeds when the cooldown marker is older than 72h', () => {
    const old = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100h ago
    writeFixture({
      issueComments: {
        '42': [{ body: '<!-- remediate-cooldown-marker -->\nattempt done', createdAt: old }],
      },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toBe('proceed=true');
  });
});

describe('guard.sh — condition (d): global 3-runs/day cap', () => {
  it('no-ops when 3 run-markers already exist today across open breach issues', () => {
    const today = new Date().toISOString().slice(0, 10);
    writeFixture({
      breachIssueNumbers: [42, 43],
      issueComments: {
        '42': [
          { body: `<!-- remediate-run-marker:${today} -->`, createdAt: new Date().toISOString() },
          { body: `<!-- remediate-run-marker:${today} -->`, createdAt: new Date().toISOString() },
        ],
        '43': [
          { body: `<!-- remediate-run-marker:${today} -->`, createdAt: new Date().toISOString() },
        ],
      },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toContain('global cap of 3 remediate runs/day already reached');
  });

  it('proceeds when fewer than 3 run-markers exist today', () => {
    const today = new Date().toISOString().slice(0, 10);
    writeFixture({
      breachIssueNumbers: [42],
      issueComments: {
        '42': [{ body: `<!-- remediate-run-marker:${today} -->`, createdAt: new Date().toISOString() }],
      },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toBe('proceed=true');
  });

  it('does not count markers from a different day', () => {
    writeFixture({
      breachIssueNumbers: [42],
      issueComments: {
        '42': [
          { body: '<!-- remediate-run-marker:2020-01-01 -->', createdAt: '2020-01-01T00:00:00Z' },
          { body: '<!-- remediate-run-marker:2020-01-01 -->', createdAt: '2020-01-01T00:00:00Z' },
          { body: '<!-- remediate-run-marker:2020-01-01 -->', createdAt: '2020-01-01T00:00:00Z' },
        ],
      },
    });
    const result = runGuard('tiger-cd119', '42');
    expect(result.trim()).toBe('proceed=true');
  });
});

describe('guard.sh — gh CLI contract regression guard', () => {
  it('never invokes gh with the invalid --jq --arg combination', () => {
    // Regression test for the round-1 defect: `gh ... --jq --arg ...` is
    // invalid gh CLI syntax (gh's --jq takes exactly one expression
    // argument). grep the committed script itself so this fails loudly at
    // review time, not just at fixture-mismatch time.
    const source = readFileSync(GUARD_SH, 'utf8');
    const ghJqArgLines = source
      .split('\n')
      .filter((line) => !/^\s*#/.test(line)) // executable lines only — comments may
      // legitimately describe the historical defect by name.
      .filter((line) => /gh\s+.*--jq\s+--arg/.test(line));
    expect(ghJqArgLines).toEqual([]);
  });

  it('exits nonzero and does not silently mask a gh failure with || echo 0', () => {
    // If gh itself fails (e.g. auth error), the script must not swallow it
    // into a false "proceed=true". Point PATH at a `gh` that always fails.
    const failingBinDir = mkdtempSync(join(tmpdir(), 'guard-failbin-'));
    writeFileSync(
      join(failingBinDir, 'gh'),
      `#!/usr/bin/env bash\necho "simulated gh auth failure" >&2\nexit 1\n`,
      { mode: 0o755 }
    );
    try {
      expect(() =>
        execFileSync('bash', [GUARD_SH, 'tiger-cd119', '42'], {
          cwd: workDir,
          env: {
            ...process.env,
            PATH: `${failingBinDir}:${process.env.PATH}`,
            GH_TOKEN: 'fake-token-for-test',
          },
          encoding: 'utf8',
        })
      ).toThrow();
    } finally {
      rmSync(failingBinDir, { recursive: true, force: true });
    }
  });
});
