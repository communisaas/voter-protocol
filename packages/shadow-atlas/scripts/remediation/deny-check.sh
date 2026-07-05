#!/usr/bin/env bash
# Shadow Atlas remediation diff-deny check.
#
# Self-healing data ops §Guardrails: "Edit surface allowlist:
# packages/shadow-atlas/src/{acquisition,providers,hydration,config,scripts}
# + their tests. Explicit denies: .github/workflows/** ... distribution
# signing / manifest / pin code, any published artifact path. Enforced
# twice: in --allowedTools scoping AND as a diff-check step."
#
# Round-1 implemented the "suspenders" half as a bare substring blacklist
# (`manifest|signing|trust-pin|publish|output/|dist/`), which:
#   - FALSE-POSITIVE DENIED packages/shadow-atlas/src/providers/tiger-manifest.ts
#     — the declared configSite / edit target for 9+ SOURCE_REGISTRY rows,
#     INSIDE the allowed edit surface (providers/) — because "manifest" is a
#     bare substring match with no path anchoring.
#   - Never positively confined edits to the five allowed directories at
#     all (distribution/services/pinata.ts, src/serving/signing.ts, and
#     other paths outside the edit surface would all PASS the blacklist).
#
# Fixed here: this is an ALLOWLIST-FIRST check. Every changed path must
# match the edit-surface allowlist (the five directories + their test
# mirrors); ANY path outside it fails the job, no exceptions — this also
# subsumes the workflows/output/dist/signing/publish denials structurally,
# since none of those paths can ever be inside
# packages/shadow-atlas/src/{acquisition,providers,hydration,config,scripts}.
# A second, independent denylist pass is kept as true belt-and-suspenders
# for defense in depth (catches an allowlist regex bug), anchored to real
# path segments rather than bare substrings so it does not miscatch
# provider filenames that merely contain a sensitive-sounding word.
#
# Usage: deny-check.sh <changed-paths-file>
#   <changed-paths-file> is a newline-separated list of repo-relative paths
#   (the caller produces this via `git diff --name-only`; kept as a file
#   argument rather than this script owning git plumbing, so it is
#   trivially unit-testable with a fixture file and zero git/network
#   dependency).
# Exit 0 + "diff-guard-ok" if every path is inside the allowed edit surface
#   and none matches the secondary denylist.
# Exit 1 + the offending paths (one per line, prefixed "DENIED:") otherwise.
# Exit 0 + "no-changes" if the input file is empty (nothing to check).
set -euo pipefail

CHANGED_FILE="${1:?path to a file of changed paths required}"

if [ ! -s "$CHANGED_FILE" ]; then
  echo "no-changes"
  exit 0
fi

# Allowed edit surface: the five acquisition-adjacent directories and their
# test mirrors under src/__tests__/unit/**, anchored to
# packages/shadow-atlas/ so a same-named directory elsewhere in the repo
# cannot accidentally qualify.
ALLOW_PATTERN='^packages/shadow-atlas/(src/(acquisition|providers|hydration|config|scripts)/|scripts/|src/__tests__/unit/(acquisition|providers|hydration|config|scripts|remediation)/)'

# Secondary denylist, anchored to real protected path segments (not bare
# substrings) so legitimate provider filenames like tiger-manifest.ts never
# match. This is defense-in-depth ONLY — the allowlist above is the primary
# gate and already excludes every path this list names.
DENY_PATTERN='(^|/)\.github/workflows/|(^|/)output/|(^|/)dist/|src/serving/signing|src/distribution/(services/pinata|regional-pinning-service)|trust-pin|chunkmanifest'

bad_not_allowed=""
bad_denied=""

while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! echo "$path" | grep -Eq "$ALLOW_PATTERN"; then
    bad_not_allowed="${bad_not_allowed}${path}\n"
  fi
  if echo "$path" | grep -Eq "$DENY_PATTERN"; then
    bad_denied="${bad_denied}${path}\n"
  fi
done < "$CHANGED_FILE"

if [ -n "$bad_not_allowed" ] || [ -n "$bad_denied" ]; then
  echo "DENIED paths in diff:"
  if [ -n "$bad_not_allowed" ]; then
    printf "%b" "$bad_not_allowed" | sed 's/^/DENIED:outside-edit-surface:/'
  fi
  if [ -n "$bad_denied" ]; then
    printf "%b" "$bad_denied" | sed 's/^/DENIED:protected-path:/'
  fi
  exit 1
fi

echo "diff-guard-ok"
