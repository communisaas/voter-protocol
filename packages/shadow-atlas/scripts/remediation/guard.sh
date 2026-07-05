#!/usr/bin/env bash
# Shadow Atlas remediation pre-flight guard.
#
# Self-healing data ops §Failure modes ("Loop storm" + "Runner quota / cost").
# Committed, unit-testable script — both jobs in
# .github/workflows/shadow-atlas-remediate.yml source THIS file (no
# duplicated heredocs). Round-1 wrote this guard twice as inline heredocs
# and misused `gh --jq --arg` (gh's --jq flag does not accept jq's --arg —
# verified: "unknown arguments" exit 1); the error was silently swallowed by
# a `2>/dev/null || echo 0` fallback, permanently zeroing guard conditions
# (a) and (d). Fixed here by piping `gh ... --json` output to a real `jq`
# binary, which does accept --arg.
#
# Exits 0 and prints exactly one line, "proceed=true" or
# "proceed=false:<reason>", unless one of four no-op conditions holds:
#   (a) an open PR already exists whose head ref matches
#       remediate/<source_id>/*
#   (b) the breach issue already carries label atlas-needs-human
#   (c) a cooldown marker comment newer than 72h exists on the issue
#   (d) >= 3 dated run-marker comments already posted today across any open
#       atlas-slo-breach issue (global cap, tracked via issue comments so no
#       `actions:` token scope is ever needed — gh run list would require
#       actions:read, which the no-actions invariant forbids)
#
# On proceed=true, stamps a dated run-marker comment on the issue so
# subsequent guard evaluations today see it (side effect, real GH state).
#
# Usage: guard.sh <source_id> <issue_number>
# Requires: gh CLI authenticated (GH_TOKEN env), jq, date -u.
# Env: BRANCH_PREFIX (default "remediate"), GUARD_SKIP_MARKER=1 to skip the
#      run-marker side effect (used by unit tests against a fixture "gh").
set -euo pipefail

SOURCE_ID="${1:?source_id required}"
ISSUE_NUMBER="${2:?issue_number required}"
PREFIX="${BRANCH_PREFIX:-remediate}"

# (a) one-open-PR-per-source dedupe.
existing_pr=$(gh pr list --state open --json headRefName \
  | jq --arg p "${PREFIX}/${SOURCE_ID}/" '[.[] | select(.headRefName | startswith($p))] | length')
if [ "${existing_pr:-0}" -gt 0 ]; then
  echo "proceed=false:open PR already exists for ${PREFIX}/${SOURCE_ID}/*"
  exit 0
fi

# (b) already escalated — human must remove the label to re-arm.
has_needs_human=$(gh issue view "$ISSUE_NUMBER" --json labels \
  | jq '[.labels[].name] | index("atlas-needs-human") != null')
if [ "$has_needs_human" = "true" ]; then
  echo "proceed=false:issue #${ISSUE_NUMBER} already carries atlas-needs-human"
  exit 0
fi

# (c) 72h cooldown marker on this issue.
cutoff=$(date -u -d '72 hours ago' +%s 2>/dev/null || date -u -v-72H +%s)
latest_marker=$(gh issue view "$ISSUE_NUMBER" --json comments \
  | jq -r '[.comments[] | select(.body | test("<!-- remediate-cooldown-marker -->")) | .createdAt] | sort | last // empty')
if [ -n "$latest_marker" ]; then
  # GNU `date -d` (Linux runners — the real CI path) parses ISO-8601 with or
  # without fractional seconds natively. The BSD `date -jf` fallback (macOS,
  # local dev only) needs an exact format match and has no fractional-second
  # specifier, so strip a trailing `.NNNZ` down to `Z` before that path —
  # GitHub's REST API never emits fractional seconds, but test fixtures built
  # from JS `Date.prototype.toISOString()` do, and this must parse both.
  marker_epoch=$(date -u -d "$latest_marker" +%s 2>/dev/null \
    || date -u -jf '%Y-%m-%dT%H:%M:%SZ' "$(echo "$latest_marker" | sed -E 's/\.[0-9]+Z$/Z/')" +%s)
  if [ "$marker_epoch" -gt "$cutoff" ]; then
    echo "proceed=false:cooldown marker newer than 72h on issue #${ISSUE_NUMBER}"
    exit 0
  fi
fi

# (d) global cap: 3 remediate-run markers/day across all open
# atlas-slo-breach issues. No `actions:` permission is used — this counts
# <!-- remediate-run-marker:YYYY-MM-DD --> comments instead of querying the
# Actions run log.
today=$(date -u +%Y-%m-%d)
runs_today=0
issue_numbers=$(gh issue list --label atlas-slo-breach --state all --json number | jq -r '.[].number')
for n in $issue_numbers; do
  c=$(gh issue view "$n" --json comments \
    | jq --arg d "$today" '[.comments[] | select(.body | test("<!-- remediate-run-marker:" + $d))] | length')
  runs_today=$((runs_today + c))
done
if [ "$runs_today" -ge 3 ]; then
  echo "proceed=false:global cap of 3 remediate runs/day already reached (${runs_today} today)"
  exit 0
fi

# Record this run so subsequent guard evaluations today see it. Skippable
# for unit tests that only want the decision, not the GH side effect.
if [ "${GUARD_SKIP_MARKER:-0}" != "1" ]; then
  run_marker_file="$(mktemp)"
  {
    echo "<!-- remediate-run-marker:${today} -->"
    echo "Remediation run started for \`${SOURCE_ID}\` (run ${GITHUB_RUN_ID:-unknown})."
  } > "$run_marker_file"
  gh issue comment "$ISSUE_NUMBER" --body-file "$run_marker_file" >/dev/null
  rm -f "$run_marker_file"
fi

echo "proceed=true"
