# Shadow Atlas Hardening Tracker
> Brutalist review 2026-03-14. All findings tracked to resolution.

## Legend
- **Status**: `OPEN` | `IN_PROGRESS` | `DONE` | `WONTFIX`
- **Wave**: Implementation wave (1=critical, 2=high, 3=medium)

---

## Wave 1 — Critical (ZK Integrity + Supply Chain)

| ID   | Severity | Finding | File(s) | Status |
|------|----------|---------|---------|--------|
| C-1  | CRITICAL | No BN254 field modulus validation on `encodeCellId()` — silent wrap in Poseidon2 | `jurisdiction.ts` (5 functions) | DONE |
| C-2  | CRITICAL | No SHA-256 integrity verification on concordance CSV downloads | `concordance-loader.ts` | DONE |
| C-3  | CRITICAL | Zip-slip path traversal in ZIP extraction (JSZip) | `baf-downloader.ts`, `bef-overlay.ts` | DONE |
| C-4  | CRITICAL | Cache-forever with no TTL/revalidation on concordance + BAF files | `concordance-loader.ts`, `baf-downloader.ts` | DONE |

**W1 Review**: 4/4 PASS. No bypasses found. 50 tests.

## Wave 2 — High (Data Integrity)

| ID   | Severity | Finding | File(s) | Status |
|------|----------|---------|---------|--------|
| H-1  | HIGH | 80% Layer 2 threshold too permissive for ZK cell map path | `hydrate-country.ts` | DONE |
| H-2  | HIGH | No roundtrip verification after cell map tree construction | `tree-builder.ts` | DONE |
| H-3  | HIGH | Custom CSV parser doesn't handle embedded newlines in quoted fields | `concordance-loader.ts` | DONE |
| H-4  | HIGH | Boundary index Map uses `name` key — last-write-wins on duplicates | `hydrate-country.ts` | DONE |
| H-5  | HIGH | BEF delimiter auto-detection from first line only | `bef-overlay.ts` | DONE |
| H-6  | HIGH | Snapshot root verification is self-referential (not compared to on-chain) | `snapshot-loader.ts` | DONE |

**W2 Review**: 6/6 PASS. No bypasses found. 133 tests.

## Wave 3 — Medium (Operational Resilience)

| ID   | Severity | Finding | File(s) | Status |
|------|----------|---------|---------|--------|
| M-1  | MEDIUM | Non-deterministic tree roots — CSV row order + order-dependent dedup | `concordance-loader.ts` | DONE |
| M-2  | MEDIUM | Freshness monitoring tracks pipeline run time, not data vintage | `freshness-monitor.ts`, `db-writer.ts` | DONE |
| M-3  | MEDIUM | Smoke tests can't distinguish "API down" vs "data changed" | `smoke-test.ts` | DONE |
| M-4  | MEDIUM | Empty boundary codes encode as `0n` — indistinguishable from unused slots | `concordance-loader.ts`, `jurisdiction.ts` | DONE |
| M-5  | MEDIUM | Nominatim response not schema-validated (`parseFloat(undefined)` → NaN) | `pip-wiring.ts` | DONE |
| M-6  | MEDIUM | No response size limits on `fetch()` calls — memory exhaustion risk | `fetch-with-size-limit.ts` (new) | DONE |

**W3 Review**: PENDING

## New Findings (discovered during reviews)

| ID   | Severity | Finding | Status |
|------|----------|---------|--------|
| N-1  | LOW | SHA-256 verified by re-reading from disk after write (TOCTOU) — not exploitable in single-process | OPEN |
| N-2  | LOW | 3 JSZip sites lack `safeZipEntryPath()` but are memory-only — add exemption comments | OPEN |
| N-3  | LOW | `sources-manifest.ts` SOURCE_HASHES empty — SHA-256 wired but no hashes populated | OPEN |
| N-4  | INFO | Stale-then-fail: re-download failure hard-fails. Correct fail-safe behavior | WONTFIX |
| N-5  | LOW | `buildBoundaryIndex` original name key retains first entry on collision | OPEN |
| N-6  | LOW | `verifyCellMapSample` fixed sample of 15 — 0.0075% coverage for 200K cells | OPEN |
| N-7  | INFO | BEF delimiter JSDoc says "Default: '|'" but runtime default is auto-detect | OPEN |

---

## Wave Execution Log

| Wave | Started | Impl Complete | Review Complete | New Findings |
|------|---------|---------------|-----------------|--------------|
| 1    | 2026-03-14 | f632e25 | 4/4 PASS | N-1, N-2, N-3, N-4 |
| 2    | 2026-03-14 | 53a9b8f | 6/6 PASS | N-5, N-6, N-7 |
| 3    | 2026-03-14 | 60a82c9, 25ac977 | PENDING | — |

## Commit History

| Commit | Wave | Content |
|--------|------|---------|
| f632e25 | W1 | BN254 guard, SHA-256 verification, zip-slip, cache TTL |
| 53a9b8f | W2 | Threshold gate, roundtrip verify, CSV fix, collision detect, BEF delimiter, snapshot root |
| 60a82c9 | W3b | Vintage tracking, error categorization, fetch size limits |
| 25ac977 | W3a | Deterministic roots, empty code guard, Nominatim validation |

## Test Coverage

**370 tests passing across 20 test files. 0 failures.**

New test files added during hardening:
- `jurisdiction.test.ts` (25 tests) — BN254 modulus, encoding, empty code guards
- `safe-extract.test.ts` (7 tests) — zip-slip prevention
- `hydrate-country.test.ts` (16 tests) — threshold gate, boundary collision
- `cell-map-verification.test.ts` (7 tests) — roundtrip SMT verification
- `bef-overlay.test.ts` (4 tests) — explicit delimiter
- `smoke-test.test.ts` (20 tests) — error categorization, exit codes
- `fetch-with-size-limit.test.ts` (9 tests) — response size limits
