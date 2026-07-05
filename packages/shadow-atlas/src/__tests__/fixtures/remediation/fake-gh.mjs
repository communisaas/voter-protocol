#!/usr/bin/env node
/**
 * Fake `gh` CLI for remediation guard/deny-check unit tests.
 *
 * Zero network: this script never talks to GitHub. It reads a JSON fixture
 * (path from $FAKE_GH_FIXTURE) describing canned responses for the exact
 * subcommands guard.sh issues, and appends every invocation to
 * $FAKE_GH_LOG (newline-delimited JSON) so tests can assert on side
 * effects (e.g. "was a run-marker comment posted?") without a real gh/network.
 *
 * Fixture shape:
 * {
 *   "prList": [{ "headRefName": "remediate/foo/20260101" }],
 *   "issueLabels": { "42": ["atlas-slo-breach"] },
 *   "issueComments": { "42": [{ "body": "...", "createdAt": "..." }] },
 *   "breachIssueNumbers": [42, 43]
 * }
 * Missing keys default to empty.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const fixturePath = process.env.FAKE_GH_FIXTURE;
const logPath = process.env.FAKE_GH_LOG;
const fixture = fixturePath && existsSync(fixturePath)
  ? JSON.parse(readFileSync(fixturePath, 'utf8'))
  : {};

const args = process.argv.slice(2);

if (logPath) {
  appendFileSync(logPath, JSON.stringify({ args }) + '\n');
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const [cmd, sub] = args;

if (cmd === 'pr' && sub === 'list') {
  out(fixture.prList ?? []);
  process.exit(0);
}

if (cmd === 'issue' && sub === 'view') {
  const issueNumber = args[2];
  if (args.includes('labels') || args.join(' ').includes('--json labels')) {
    const labels = fixture.issueLabels?.[issueNumber] ?? [];
    out({ labels: labels.map((name) => ({ name })) });
    process.exit(0);
  }
  if (args.join(' ').includes('--json comments')) {
    const comments = fixture.issueComments?.[issueNumber] ?? [];
    out({ comments });
    process.exit(0);
  }
  out({});
  process.exit(0);
}

if (cmd === 'issue' && sub === 'list') {
  out((fixture.breachIssueNumbers ?? []).map((number) => ({ number })));
  process.exit(0);
}

if (cmd === 'issue' && sub === 'comment') {
  // Side-effect call (posting the run-marker / cooldown comment). Nothing to
  // print; the invocation is already logged above for assertions.
  process.exit(0);
}

process.stderr.write(`fake-gh: unhandled invocation: ${args.join(' ')}\n`);
process.exit(1);
