# BAF / TIGER Vintage Notes

**Status:** H7 cleanup doc (2026-05-04). Companion to `scripts/measure-boundary-population.ts`.

## What this doc is

A short field guide for ops + integrators to know when the G3 boundary-population
measurement is reliable for a given state, when it is not, and why. The G3
script ships with hard-fail behavior on per-state fallback rates >1% (see
`FALLBACK_HARD_FAIL_RATIO` and the inline notes in
`measure-boundary-population.ts`); this doc explains the failure modes that
cause those hard-fails so you can triage the right input rather than fight the
script.

## Inputs

The script joins two Census products:

1. **BAF** — Block Assignment Files (`BlockAssign_ST{FIPS}_CD.txt`). Gives
   `BLOCK GEOID → CD number` per state. Vintage: pinned to 2020 BAF in this
   pipeline, since that is what the redistricting cycle's CD numbers were
   assigned against.
2. **TIGER tract centroids** (TIGER 2024 line files). Used as the lookup
   geometry to attach lat/lng to BAF blocks via tract aggregation. Vintage:
   `EXPECTED_TIGER_VINTAGE = 'TIGER2024'`.

The join is **block (BAF) → tract (TIGER)**: we walk BAF rows, slice the first
11 digits of the BLOCK GEOID to get the tract GEOID, and look up the tract's
centroid. Block-level centroids would be more precise but cost ~2 GB of
additional download; tract is the launch-defensible compromise.

## What can go wrong: vintage drift between BAF and TIGER

If BAF and TIGER reference structurally different geographies for the same
GEOID prefix, the join silently produces wrong centroids — or no centroids at
all. The script catches the latter (no-centroid blocks fall through to the
fallback bucket; >1% fallback hard-fails the state). The former (wrong
centroid) slips through unless the topology is also broken.

### CT 2022 county dissolution (the canonical failure)

Connecticut dissolved its eight counties in 2022 and replaced them with nine
new "Planning Regions" as the official county-equivalent unit. The 2020 BAF
still references the old counties (because BAF is the block-assignment of the
2020 redistricting cycle); TIGER 2024 references the new Planning Regions.
The county FIPS codes do not overlap.

Result: every CT block in BAF lookups to a tract GEOID whose first five digits
(state + county) reference a county that no longer exists in TIGER. The tract
join fails for every block, the fallback ratio hits 100%, and the script
correctly exits with code 2.

Triage: this is a vintage mismatch, not a script bug. Two paths forward:

1. Wait for BAF to refresh against the 2030-cycle redistricting (the BAF
   lifecycle re-pegs to TIGER then). Earliest expected is post-2030 census.
2. Build a CT-specific shim: re-derive 2020 BAF block→Planning-Region
   assignments from the FIPS crosswalk Census published with the dissolution
   notice. Out of scope for H-phase; tracked as a Phase 2 follow-up.

For H-phase launch, CA is the launch state and is unaffected (the CA boundary
of 16.4% boundary-cell rate is the number that goes in the H2 banner copy).
CT G3 measurement remains hard-failed by design until the shim lands.

### Pinning vintages

`EXPECTED_TIGER_VINTAGE = 'TIGER2024'` is a hard-coded constant in
`measure-boundary-population.ts`. Update it ONLY when:

- The build pipeline's TIGER source has been updated to the new vintage AND
- The BAF source has been re-validated against that vintage (re-run with
  `--state ALL`, confirm fallback rates stay <1% across states known good).

Out-of-cycle Census releases (e.g., a post-redistricting refresh between
decennial cycles) are the most common trigger for an update. Bump the
constant in the same PR that bumps the data-pipeline source URL.

## Acceptance criterion (G3-honest)

A state is "G3-measured" only when the script exits with code 0 for that
state. Anything else is "G3-pending" and must be labelled as such on any
public surface — H2 banner copy in particular MUST cite a measured number,
not a pre-measurement guess. The H6 launch decision in
`commons/specs/H-PHASE-SCOPE.md` §6 enumerates this gate.
