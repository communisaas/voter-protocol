# Shadow Atlas Investigation Archive

This directory contains completed investigation artifacts from the shadow-atlas portal discovery and remediation efforts (2025-2026).

## Archive Structure

### `/investigation-reports/` (18 files)
Completed investigation findings and remediation summaries:

**Wave-F Extraction Campaign**:
- `WAVE-F-EXTRACTION-COMPLETE.md` - Final extraction results
- `WAVE-F-EXTRACTION-RESULTS.md` - Detailed findings
- `WAVE-F-KNOWN-PORTALS-ENTRIES.ts` - Portal registry entries (merged to production)
- `WAVE-F-QUICK-REFERENCE.md` - Quick reference guide
- `WAVE-F-VALIDATION.md` - Validation results

**Workstream 2 (WS-2) - Feature Count Investigations**:
- `WS-2-COMPLETE.md` - Final workstream summary
- `WS-2-FILES.md` - File inventory
- `WS-2-INVESTIGATION-COMPLETE.md` - Investigation findings
- `WS-2-SINGLE-FEATURE-QUARANTINE.md` - Single feature handling

**Workstream 3 (WS-3) - Containment Failures**:
- `WS-3-OTHER-STATES-REMEDIATION-COMPLETE.md` - Multi-state remediation
- `WS-3-REMEDIATION-MANIFEST.json` - Structured remediation data

**California Cities Investigations**:
- `BLOCKED-CA-CITIES-INVESTIGATION.md` - Investigation details
- `BLOCKED-CA-CITIES-SUMMARY.md` - Summary findings

**Wave-E Remediation**:
- `WAVE-E-REMEDIATION-STRATEGY.md` - Remediation approach

**Technical Investigations**:
- `CENTROID-DISTANCE-FINDINGS.md` - Centroid distance analysis results
- `REMEDIATION-SUMMARY.md` - Overall remediation summary
- `SANITY_CHECKS_IMPLEMENTATION.md` - Pre-validation check implementation
- `SINGLE-FEATURE-MISMATCH-INVESTIGATION.md` - Feature count mismatch analysis
- `INVESTIGATION-COMPLETE.md` - General investigation completion

### `/wave-discovery-reports/` (76 files)
Progressive wave discovery campaign results (Waves A-S):

**File Types**:
- `aggregator-*.json` - Regional aggregator extraction results
- `aggregator-*.ndjson` - Portal data in NDJSON format
- `aggregator-*-SUMMARY.md` - Extraction summaries
- `wave-*-*.json` - Wave-specific discovery results
- `wave-*-*.ndjson` - Wave-specific portal data
- `*.md` - Documentation and verification notes
- `*.sh` - Verification scripts

**Key Reports**:
- Regional aggregator discoveries (PA, FL, TX, OH, OR, WA, etc.)
- Hub discovery candidates
- Multi-state wave extractions
- State-specific portal verifications

**Example Files**:
- `aggregator-pasda-pa-results.json` - Pennsylvania aggregator results
- `aggregator-florida-portals.ndjson` - Florida portal data
- `wave-q-mi-va-results.json` - Michigan/Virginia wave results
- `hub-triage-results.json` - Hub portal triage

### `/code-examples/` (3 files)
Reusable code examples and technical specifications:

- `WEBMAP-EXTRACTOR-CODE-EXAMPLES.ts` - ArcGIS webmap extraction patterns
- `WEBMAP-EXTRACTOR-QUICKSTART.md` - Quick start guide for webmap extraction
- `WEBMAP-EXTRACTOR-SPEC.md` - Technical specification for webmap extractors

## Current Production Status

As of archival (2026-01-25):
- **716 verified portals** in production registry
- **138 at-large cities** (city-council-based, no districts)
- Wave discoveries A-S complete and integrated
- All investigation artifacts resolved

## Archive Policy

Files in this archive:
- Are historical records of completed work
- Should NOT be modified (read-only reference)
- May be referenced for future similar investigations
- Document the evolution of the shadow-atlas registry

## Related Active Documentation

Current operational docs remain in:
- `/docs/` - Active architecture, API specs, production readiness
- `/src/core/registry/` - Live portal registries
- `/examples/` - Current code examples

## Timeline

- **2025-12** - Initial Wave A-D discoveries
- **2026-01** - Waves E-S, intensive investigation campaigns
- **2026-01-16** - WS-3 remediation complete
- **2026-01-18** - Wave-F extraction complete
- **2026-01-23** - Wave-N parallel swarm (registry consolidation)
- **2026-01-25** - Archive created, artifacts organized
