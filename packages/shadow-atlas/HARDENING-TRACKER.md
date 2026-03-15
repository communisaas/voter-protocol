# Shadow Atlas Hardening Tracker
> Brutalist review 2026-03-14. All findings tracked to resolution.

## Legend
- **Status**: `OPEN` | `IN_PROGRESS` | `DONE` | `WONTFIX`
- **Wave**: Implementation wave (1=critical, 2=high, 3=medium)
- **Assignee**: Agent name in team

---

## Wave 1 — Critical (ZK Integrity + Supply Chain)

| ID   | Severity | Finding | File(s) | Status | Assignee |
|------|----------|---------|---------|--------|----------|
| C-1  | CRITICAL | No BN254 field modulus validation on `encodeCellId()` output — silent wrap in Poseidon2 | `jurisdiction.ts` (5 functions) | DONE | w1-impl |
| C-2  | CRITICAL | No SHA-256 integrity verification on concordance CSV downloads | `concordance-loader.ts:174-194` | DONE | w1-impl |
| C-3  | CRITICAL | Zip-slip path traversal in ZIP extraction (JSZip) | `baf-downloader.ts`, `bef-overlay.ts`, `tract-centroid-index.ts` | DONE | w1-impl |
| C-4  | CRITICAL | Cache-forever with no TTL/revalidation on concordance + BAF files | `concordance-loader.ts:222`, `baf-downloader.ts:113-118` | DONE | w1-impl |

## Wave 2 — High (Data Integrity)

| ID   | Severity | Finding | File(s) | Status | Assignee |
|------|----------|---------|---------|--------|----------|
| H-1  | HIGH | 80% Layer 2 threshold too permissive for ZK cell map path | `country-provider.ts:528-531` | OPEN | — |
| H-2  | HIGH | No roundtrip verification after cell map tree construction | All 5 providers' `buildCellMap()` | OPEN | — |
| H-3  | HIGH | Custom CSV parser doesn't handle embedded newlines in quoted fields | `concordance-loader.ts:60-92` | OPEN | — |
| H-4  | HIGH | Boundary index Map uses `name` key — last-write-wins on duplicates | `hydrate-country.ts:187-189` | OPEN | — |
| H-5  | HIGH | BEF delimiter auto-detection from first line only | `bef-overlay.ts:147` | OPEN | — |
| H-6  | HIGH | Snapshot root verification is self-referential (not compared to on-chain) | `snapshot-loader.ts` | OPEN | — |

## Wave 3 — Medium (Operational Resilience)

| ID   | Severity | Finding | File(s) | Status | Assignee |
|------|----------|---------|---------|--------|----------|
| M-1  | MEDIUM | Non-deterministic tree roots — CSV row order + order-dependent dedup | UK/CA/AU/NZ `buildCellMap()` | OPEN | — |
| M-2  | MEDIUM | Freshness monitoring tracks pipeline run time, not data vintage | `freshness-monitor.ts` | OPEN | — |
| M-3  | MEDIUM | Smoke tests can't distinguish "API down" vs "data changed" | `smoke-test.ts` | OPEN | — |
| M-4  | MEDIUM | Empty boundary codes encode as `0n` — indistinguishable from unused slots | `concordance-loader.ts:258-275` | OPEN | — |
| M-5  | MEDIUM | Nominatim response not schema-validated (`parseFloat(undefined)` → NaN) | `pip-wiring.ts:63-84` | OPEN | — |
| M-6  | MEDIUM | No response size limits on `fetch()` calls — memory exhaustion risk | Multiple files | OPEN | — |

## New Findings (discovered during W1 review)

| ID   | Severity | Finding | File(s) | Status | Assignee |
|------|----------|---------|---------|--------|----------|
| N-1  | LOW | C-2 TOCTOU: SHA-256 verified by re-reading from disk after write — not exploitable in single-process pipeline but hash-before-write is stronger | `concordance-loader.ts:201-213` | OPEN | — |
| N-2  | LOW | C-3: 3 additional JSZip sites lack `safeZipEntryPath()` but are memory-only (no disk writes) — add comments noting intentional exemption | `tract-centroid-index.ts`, `ingestion.ts`, `shapefile-to-geojson.ts` | OPEN | — |
| N-3  | LOW | C-2 placeholder: `sources-manifest.ts` SOURCE_HASHES is empty — SHA-256 verification wired but no hashes populated yet | `hydration/sources-manifest.ts` | OPEN | — |
| N-4  | INFO | C-4 stale-then-fail: if re-download fails for stale concordance, pipeline hard-fails. Correct fail-safe behavior (stale cache survives on disk) | `concordance-loader.ts:266-270` | WONTFIX | — |

---

## Wave Execution Log

| Wave | Started | Impl Complete | Review Complete | New Findings |
|------|---------|---------------|-----------------|--------------|
| 1    | 2026-03-14 | 2026-03-14 (f632e25) | 2026-03-14 (W1 review) | N-1, N-2, N-3, N-4 |
| 2    | —       | —             | —               | —            |
| 3    | —       | —             | —               | —            |
