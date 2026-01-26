# Shadow Atlas CLI Specification

> **STATUS**: Implementation Plan
> **VERSION**: 1.0.0
> **CREATED**: 2026-01-25
> **PURPOSE**: Replace 87 ad-hoc scripts with unified CLI tooling

## Executive Summary

The Shadow Atlas package currently contains 87 scripts handling data validation, ingestion, registry management, discovery, migration, and diagnostics. This specification defines a unified CLI (`shadow-atlas`) that consolidates all script functionality into a production-grade tool with proper observability, audit logging, and error handling.

---

## 1. Problem Statement

### 1.1 Current State

Scripts are scattered across multiple directories with inconsistent interfaces:
- `packages/shadow-atlas/scripts/` - 45+ operational scripts
- `packages/shadow-atlas/src/scripts/` - 20+ validation scripts
- `packages/shadow-atlas/src/services/bulk-district-discovery.ts` - embedded discovery logic
- Various one-off migration and forensic scripts

### 1.2 Architectural Gaps Identified

| Gap | Current Workaround | Scripts Count |
|-----|-------------------|---------------|
| No Data Validation Layer | Ad-hoc validation scripts | 23 |
| No Observability/Metrics | Console logging | 15 |
| No ETL Pipeline | One-off ingestion scripts | 18 |
| No Admin Tooling/CLI | Direct script execution | 12 |
| No Migration Framework | Manual data transforms | 8 |
| No Provenance/Audit System | Git history only | 6 |
| No Continuous Validation | CI-only checks | 5 |

### 1.3 Target State

Single CLI binary providing:
- Unified command interface for all operations
- Built-in validation pipeline with tiered execution
- Audit logging for all mutations
- Metrics and observability hooks
- Reproducible data transformations

---

## 2. CLI Architecture

### 2.1 Command Hierarchy

```
shadow-atlas
├── registry         # Registry CRUD operations
│   ├── list         # List entries with filters
│   ├── get          # Get single entry by FIPS
│   ├── add          # Add new entry
│   ├── update       # Update entry fields
│   ├── delete       # Soft-delete to quarantine
│   ├── stats        # Registry statistics
│   └── diff         # Show registry drift
│
├── validate         # Validation pipeline
│   ├── council      # Council district tessellation
│   ├── geoids       # GEOID format/coverage
│   ├── boundaries   # Boundary download validation
│   ├── registry     # Registry health checks
│   ├── comprehensive # Full validation suite
│   └── production-ready # Pre-deploy checks
│
├── quarantine       # Quarantine workflow
│   ├── add          # Move entry to quarantine
│   ├── list         # List quarantined entries
│   ├── resolve      # Attempt automated resolution
│   ├── restore      # Restore to known-portals
│   └── promote      # Promote to at-large
│
├── discover         # Discovery operations
│   ├── search       # Search for new portals
│   ├── import       # Bulk import discoveries
│   ├── validate     # Validate discovered URLs
│   └── wave         # Wave management
│
├── ingest           # Data ingestion pipeline
│   ├── arcgis       # ArcGIS REST services
│   ├── socrata      # Socrata open data
│   ├── tiger        # Census TIGER
│   ├── webmap       # ArcGIS webmap extraction
│   └── geojson      # Direct GeoJSON
│
├── codegen          # Code generation
│   ├── generate     # NDJSON → TypeScript
│   ├── extract      # TypeScript → NDJSON
│   ├── verify       # Round-trip verification
│   └── sync         # Full sync workflow
│
├── migrate          # Data migrations
│   ├── apply        # Apply migration
│   ├── rollback     # Rollback migration
│   ├── status       # Migration status
│   └── snapshot     # Create snapshot
│
├── diagnose         # Diagnostics & debugging
│   ├── containment  # Containment analysis
│   ├── coverage     # Coverage analysis
│   ├── overlap      # Overlap detection
│   └── health       # System health check
│
└── audit            # Audit & provenance
    ├── log          # View audit log
    ├── export       # Export for compliance
    └── verify       # Verify data integrity
```

### 2.2 Global Options

```bash
shadow-atlas [command] [options]

Global Options:
  --verbose, -v     Enable verbose output
  --json            Output as JSON (machine-readable)
  --dry-run         Show what would happen without executing
  --config <path>   Path to config file (default: .shadow-atlasrc)
  --no-audit        Skip audit logging (use sparingly)
  --timeout <ms>    Operation timeout (default: 30000)
  --concurrency <n> Parallel operations (default: 5)
```

---

## 3. Command Specifications

### 3.1 Registry Commands

#### `shadow-atlas registry list`

List registry entries with filtering and pagination.

```bash
shadow-atlas registry list [options]

Options:
  --registry <name>   Registry: known-portals|quarantined|at-large (default: known-portals)
  --state <code>      Filter by state (e.g., CA, TX)
  --portal-type <t>   Filter by portal type (arcgis, socrata, etc.)
  --confidence <n>    Minimum confidence score (0-100)
  --stale <days>      Show entries not verified in N days
  --limit <n>         Max results (default: 50)
  --offset <n>        Pagination offset
  --format <fmt>      Output format: table|json|ndjson|csv

Examples:
  shadow-atlas registry list --state CA --confidence 70
  shadow-atlas registry list --stale 90 --format json
```

**Implementation**: Replaces `count-registry.ts`, `analyze-registry.ts`

---

#### `shadow-atlas registry get <fips>`

Get detailed information about a single entry.

```bash
shadow-atlas registry get <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --registry <name>   Which registry to search (default: auto-detect)
  --include-history   Show modification history from audit log
  --validate          Run validation checks on entry

Examples:
  shadow-atlas registry get 0666000
  shadow-atlas registry get 0666000 --include-history --validate
```

**Implementation**: New functionality (currently requires reading generated files)

---

#### `shadow-atlas registry add`

Add a new entry to the registry.

```bash
shadow-atlas registry add [options]

Options:
  --fips <code>       7-digit Census PLACE FIPS (required)
  --city <name>       City name (required)
  --state <code>      State code (required)
  --url <url>         Download URL (required)
  --portal-type <t>   Portal type (required)
  --count <n>         Feature count (required)
  --confidence <n>    Confidence score (default: 60)
  --discovered-by <s> Discovery attribution (default: manual)
  --notes <text>      Optional notes
  --skip-validation   Skip URL validation (not recommended)

Examples:
  shadow-atlas registry add \
    --fips 0601234 \
    --city "Example City" \
    --state CA \
    --url "https://..." \
    --portal-type arcgis \
    --count 7
```

**Implementation**: Replaces `add-missing-cities.ts`

---

#### `shadow-atlas registry update <fips>`

Update fields on an existing entry.

```bash
shadow-atlas registry update <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --url <url>         Update download URL
  --count <n>         Update feature count
  --confidence <n>    Update confidence score
  --notes <text>      Update notes (append with --append-notes)
  --last-verified     Update lastVerified to now
  --reason <text>     Audit log reason (required for significant changes)

Examples:
  shadow-atlas registry update 0666000 --url "https://new-url/..." --reason "URL migration"
  shadow-atlas registry update 0666000 --last-verified --count 9
```

**Implementation**: New functionality

---

#### `shadow-atlas registry delete <fips>`

Soft-delete an entry by moving to quarantine.

```bash
shadow-atlas registry delete <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --reason <text>     Deletion reason (required)
  --pattern <code>    Quarantine pattern code
  --hard              Hard delete (remove completely, requires --force)
  --force             Confirm hard delete

Examples:
  shadow-atlas registry delete 0666000 --reason "City confirmed at-large"
  shadow-atlas registry delete 0666000 --pattern at_large_confirmed
```

**Implementation**: Replaces `remove-county-entries.ts`, `quarantine-*.ts`

---

### 3.2 Validation Commands

#### `shadow-atlas validate council`

Run council district tessellation validation.

```bash
shadow-atlas validate council [options]

Options:
  --fips <code>       Validate single city by FIPS
  --url <url>         Override download URL
  --tier <level>      Validation tier: structure|sanity|full (default: full)
  --batch <file>      Batch validation from JSON file
  --limit <n>         Max cities to validate (batch mode)
  --expected <n>      Expected district count (overrides registry)
  --tolerance <pct>   Coverage tolerance override

Validation Tiers:
  structure  - HTTP fetch + GeoJSON structure (~1-2s)
  sanity     - + Centroid proximity + count ratio (~10ms additional)
  full       - + Tessellation proof (4 axioms) (~500-2000ms additional)

Tessellation Axioms:
  1. Exclusivity: Districts cannot overlap (< 150,000 sq m)
  2. Exhaustivity: Coverage 85-115% (200% for coastal)
  3. Containment: Max 15% outside boundary
  4. Cardinality: Count matches expected

Examples:
  shadow-atlas validate council --fips 0666000
  shadow-atlas validate council --batch top50.json --tier sanity
  shadow-atlas validate council --fips 0666000 --tier structure --verbose
```

**Implementation**: Replaces `run-tessellation-validation.ts`, `run-city-validation.ts`

---

#### `shadow-atlas validate geoids`

Validate GEOID format and coverage across layers.

```bash
shadow-atlas validate geoids [options]

Options:
  --layer <type>      Layer: cd|sldu|sldl|county|unsd|elsd|scsd|vtd
  --state <code>      State FIPS (2-digit)
  --cross-validate    Compare TIGER vs state GIS
  --include-counts    Validate against expected counts

Validation Checks:
  - Format validation (GEOID regex patterns)
  - Coverage validation (all states covered)
  - Count validation (actual vs expected)
  - Duplicate detection
  - State prefix validation

Examples:
  shadow-atlas validate geoids
  shadow-atlas validate geoids --layer cd --state 06
  shadow-atlas validate geoids --cross-validate --layer sldu
```

**Implementation**: Replaces `validate-all-geoids.ts`, `validate-tiger-geoids.ts`, `cross-validate.ts`

---

#### `shadow-atlas validate registry`

Validate registry health and coverage.

```bash
shadow-atlas validate registry [options]

Options:
  --coverage <set>    Coverage set: top50|top100|all
  --check-urls        Validate URL liveness (HEAD requests)
  --check-downloads   Full download validation
  --stale-threshold <days>  Flag entries older than N days (default: 90)

Examples:
  shadow-atlas validate registry --coverage top50
  shadow-atlas validate registry --check-urls --stale-threshold 60
```

**Implementation**: Replaces `validate-registry-coverage.ts`, `validate-boundary-downloads.ts`

---

#### `shadow-atlas validate comprehensive`

Run full validation suite with production readiness report.

```bash
shadow-atlas validate comprehensive [options]

Options:
  --include-cross     Include TIGER cross-validation
  --include-freshness Include freshness monitoring
  --include-vtd       Include VTD coverage checks
  --output <file>     Write report to file

Output Sections:
  - Basic GEOID validation
  - TIGER cross-validation
  - Freshness monitoring
  - VTD coverage
  - Production readiness assessment

Examples:
  shadow-atlas validate comprehensive --json > report.json
  shadow-atlas validate comprehensive --include-cross --output report.md
```

**Implementation**: Replaces validation suite in `geoid/validation-suite.ts`

---

### 3.3 Quarantine Commands

#### `shadow-atlas quarantine add <fips>`

Move an entry to quarantine with documented reason.

```bash
shadow-atlas quarantine add <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --reason <text>     Detailed quarantine reason (required)
  --pattern <code>    Pattern code for categorization

Pattern Codes:
  cvra_gis_unavailable     - CVRA transition without public GIS
  hybrid_gis_unavailable   - Hybrid system without boundaries
  containment_failure      - Districts outside city boundary
  single_feature           - Only 1 feature (likely at-large)
  ward_gis_unavailable     - Ward system without GIS
  wrong_data               - URL returns wrong dataset

Examples:
  shadow-atlas quarantine add 0614218 \
    --reason "CVRA transition - no public GIS for new districts" \
    --pattern cvra_gis_unavailable
```

**Implementation**: Replaces `quarantine-suspicious-entries.ts`, `quarantine-single-feature-entries.ts`

---

#### `shadow-atlas quarantine list`

List quarantined entries with filtering.

```bash
shadow-atlas quarantine list [options]

Options:
  --pattern <code>    Filter by pattern code
  --state <code>      Filter by state
  --resolvable        Show only entries with potential resolution
  --age <days>        Filter by quarantine age

Examples:
  shadow-atlas quarantine list --pattern cvra_gis_unavailable
  shadow-atlas quarantine list --resolvable --json
```

**Implementation**: Replaces `resolve-quarantined-entries.ts` (listing mode)

---

#### `shadow-atlas quarantine resolve <fips>`

Attempt automated resolution of quarantined entry.

```bash
shadow-atlas quarantine resolve <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --search-strategy <s>  Resolution strategy: arcgis|socrata|manual
  --replacement-url <u>  Provide replacement URL directly
  --validate             Validate replacement before applying

Resolution Strategies:
  1. Search ArcGIS Hub for alternative layer
  2. Search regional aggregators
  3. Check state GIS portals
  4. Contact city (manual prompt)

Examples:
  shadow-atlas quarantine resolve 0614218
  shadow-atlas quarantine resolve 0614218 --replacement-url "https://..."
```

**Implementation**: Replaces resolution logic in `resolve-quarantined-entries.ts`

---

#### `shadow-atlas quarantine restore <fips>`

Restore quarantined entry to known-portals.

```bash
shadow-atlas quarantine restore <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --url <url>         New URL (if original was bad)
  --validate          Validate before restoring
  --reason <text>     Audit log reason

Examples:
  shadow-atlas quarantine restore 0614218 --url "https://new-url/..." --validate
```

**Implementation**: New functionality

---

#### `shadow-atlas quarantine promote <fips>`

Promote quarantined entry to at-large registry (terminal state).

```bash
shadow-atlas quarantine promote <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --council-size <n>  Number of council seats (required)
  --election-method <m>  Election method: at-large|proportional
  --source <text>     Verification source (required)
  --notes <text>      Additional notes

Examples:
  shadow-atlas quarantine promote 0632548 \
    --council-size 5 \
    --election-method at-large \
    --source "City of Hawthorne Municipal Code, Chapter 2"
```

**Implementation**: Replaces manual at-large registry additions

---

### 3.4 Discovery Commands

#### `shadow-atlas discover search`

Search for new municipal GIS portals.

```bash
shadow-atlas discover search [options]

Options:
  --source <type>     Source: arcgis-hub|socrata|regional|all
  --state <code>      Limit to state
  --city <name>       Search specific city
  --population-min <n> Minimum population threshold
  --keywords <list>   Search keywords (comma-separated)

Examples:
  shadow-atlas discover search --source arcgis-hub --state CA
  shadow-atlas discover search --city "San Diego" --keywords "council,district"
```

**Implementation**: Replaces discovery logic in `bulk-district-discovery.ts`

---

#### `shadow-atlas discover import`

Bulk import discoveries from external sources.

```bash
shadow-atlas discover import <file> [options]

Arguments:
  file                JSON/CSV file with discoveries

Options:
  --format <fmt>      File format: json|csv|ndjson
  --validate          Validate each entry before import
  --merge-strategy <s> Merge: skip-existing|update-existing|error-on-conflict
  --batch-size <n>    Entries per batch (default: 50)

Examples:
  shadow-atlas discover import discoveries.json --validate
  shadow-atlas discover import wave-n.csv --format csv --merge-strategy skip-existing
```

**Implementation**: Replaces `add-missing-cities.ts` and wave import scripts

---

#### `shadow-atlas discover wave`

Manage discovery waves.

```bash
shadow-atlas discover wave <action> [options]

Actions:
  list               List all waves with status
  create <name>      Create new wave
  status <wave>      Show wave status
  finalize <wave>    Finalize wave (lock entries)

Options:
  --wave <id>        Wave identifier
  --target <n>       Target portal count
  --notes <text>     Wave notes

Examples:
  shadow-atlas discover wave list
  shadow-atlas discover wave create "Wave-O" --target 50 --notes "Regional specialists focus"
  shadow-atlas discover wave status Wave-N
```

**Implementation**: Replaces wave management scripts

---

### 3.5 Ingestion Commands

#### `shadow-atlas ingest arcgis`

Ingest data from ArcGIS REST services.

```bash
shadow-atlas ingest arcgis <url> [options]

Arguments:
  url                 ArcGIS FeatureServer or MapServer URL

Options:
  --layer <n>         Layer index (default: 0)
  --where <expr>      SQL WHERE clause filter
  --fields <list>     Fields to include (comma-separated)
  --output <file>     Output file path
  --format <fmt>      Output format: geojson|ndjson

Examples:
  shadow-atlas ingest arcgis "https://services.arcgis.com/.../FeatureServer/0"
  shadow-atlas ingest arcgis "https://..." --where "DISTRICT_ID IS NOT NULL" --output data.geojson
```

**Implementation**: Replaces ArcGIS ingestion patterns across scripts

---

#### `shadow-atlas ingest tiger`

Ingest Census TIGER boundary data.

```bash
shadow-atlas ingest tiger [options]

Options:
  --layer <type>      Layer: place|county|cd|sldu|sldl|vtd
  --state <code>      State FIPS (required for state layers)
  --vintage <year>    TIGER vintage (default: 2024)
  --cache-dir <path>  Cache directory
  --force-refresh     Bypass cache

Examples:
  shadow-atlas ingest tiger --layer place --state 06
  shadow-atlas ingest tiger --layer cd --vintage 2024
```

**Implementation**: Replaces TIGER cache management scripts

---

#### `shadow-atlas ingest webmap`

Extract layers from ArcGIS webmap.

```bash
shadow-atlas ingest webmap <webmap-id> [options]

Arguments:
  webmap-id           ArcGIS webmap ID

Options:
  --portal <url>      Portal URL (default: arcgis.com)
  --layer-name <name> Target layer name
  --output <file>     Output file path

Examples:
  shadow-atlas ingest webmap abc123def456 --layer-name "Council Districts"
```

**Implementation**: Replaces webmap extraction patterns

---

### 3.6 Codegen Commands

#### `shadow-atlas codegen generate`

Generate TypeScript from NDJSON source files.

```bash
shadow-atlas codegen generate [options]

Options:
  --registry <name>   Specific registry (default: all)
  --verify            Verify round-trip after generation
  --check-only        Check if regeneration needed, don't write

Examples:
  shadow-atlas codegen generate
  shadow-atlas codegen generate --registry known-portals --verify
  shadow-atlas codegen generate --check-only  # For CI
```

**Implementation**: Replaces `generate-registries-from-ndjson.ts`

---

#### `shadow-atlas codegen extract`

Extract NDJSON from TypeScript source files.

```bash
shadow-atlas codegen extract [options]

Options:
  --registry <name>   Specific registry (default: all)
  --output-dir <path> Output directory

Examples:
  shadow-atlas codegen extract
  shadow-atlas codegen extract --registry known-portals --output-dir ./backup
```

**Implementation**: Replaces `extract-registries-to-ndjson.ts`

---

#### `shadow-atlas codegen verify`

Verify round-trip fidelity between NDJSON and TypeScript.

```bash
shadow-atlas codegen verify [options]

Options:
  --registry <name>   Specific registry (default: all)
  --strict            Fail on any difference (no tolerance)

Examples:
  shadow-atlas codegen verify
  shadow-atlas codegen verify --registry known-portals --strict
```

**Implementation**: Replaces `verify-registry-roundtrip.ts`, `ci-check-generated-files.ts`

---

### 3.7 Migration Commands

#### `shadow-atlas migrate apply <migration>`

Apply a data migration.

```bash
shadow-atlas migrate apply <migration> [options]

Arguments:
  migration           Migration name or file path

Options:
  --dry-run           Show changes without applying
  --force             Apply even if validation warns
  --snapshot          Create snapshot before applying

Examples:
  shadow-atlas migrate apply 2026-01-25-remove-county-entries
  shadow-atlas migrate apply ./migrations/fix-fips-codes.ts --dry-run
```

**Implementation**: Replaces one-off migration scripts

---

#### `shadow-atlas migrate rollback`

Rollback to a previous snapshot.

```bash
shadow-atlas migrate rollback [options]

Options:
  --to <snapshot>     Rollback to specific snapshot
  --steps <n>         Rollback N migrations (default: 1)
  --list              List available snapshots

Examples:
  shadow-atlas migrate rollback --steps 1
  shadow-atlas migrate rollback --to 2026-01-24T12:00:00Z
```

**Implementation**: Replaces manual rollback procedures

---

### 3.8 Diagnostic Commands

#### `shadow-atlas diagnose containment`

Analyze containment failures for a city.

```bash
shadow-atlas diagnose containment <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --url <url>         Override download URL
  --boundary-source <s> Boundary source: tiger|authoritative
  --output <file>     Write detailed report

Analysis Output:
  - Outside area breakdown by district
  - Boundary comparison visualization
  - Suggested remediation steps

Examples:
  shadow-atlas diagnose containment 0666000
  shadow-atlas diagnose containment 0666000 --output report.md
```

**Implementation**: Replaces containment analysis scripts

---

#### `shadow-atlas diagnose coverage`

Analyze coverage metrics for a city.

```bash
shadow-atlas diagnose coverage <fips> [options]

Arguments:
  fips                7-digit Census PLACE FIPS

Options:
  --include-water     Include water area analysis
  --vintage-compare   Compare across TIGER vintages

Examples:
  shadow-atlas diagnose coverage 0666000 --include-water
```

**Implementation**: Replaces coverage analysis scripts

---

#### `shadow-atlas diagnose health`

Run system health checks.

```bash
shadow-atlas diagnose health [options]

Options:
  --component <name>  Check specific component
  --quick             Fast checks only (skip network)

Health Checks:
  - Registry integrity (counts, format)
  - NDJSON/TypeScript sync status
  - External service connectivity
  - Cache freshness
  - Quarantine queue size

Examples:
  shadow-atlas diagnose health
  shadow-atlas diagnose health --quick
```

**Implementation**: Replaces various health check scripts

---

### 3.9 Audit Commands

#### `shadow-atlas audit log`

View audit log entries.

```bash
shadow-atlas audit log [options]

Options:
  --fips <code>       Filter by FIPS
  --action <type>     Filter by action (add|update|delete|quarantine|restore)
  --since <date>      Entries since date
  --limit <n>         Max entries (default: 100)
  --format <fmt>      Output format: table|json

Examples:
  shadow-atlas audit log --fips 0666000
  shadow-atlas audit log --action delete --since 2026-01-01
```

**Implementation**: New functionality

---

#### `shadow-atlas audit export`

Export audit log for compliance.

```bash
shadow-atlas audit export <output> [options]

Arguments:
  output              Output file path

Options:
  --since <date>      Export from date
  --until <date>      Export to date
  --format <fmt>      Format: json|csv|parquet

Examples:
  shadow-atlas audit export audit-2026-q1.json --since 2026-01-01 --until 2026-03-31
```

**Implementation**: New functionality

---

## 4. Data Schemas

### 4.1 NDJSON Registry Format

#### Header (Line 1)
```typescript
interface NdjsonHeader {
  _schema: "v1";
  _type: "KnownPortal" | "QuarantinedPortal" | "AtLargeCity";
  _count: number;
  _extracted: string;  // ISO 8601
  _description: string;
}
```

#### KnownPortal Entry
```typescript
interface KnownPortalEntry {
  _fips: string;           // 7-digit FIPS (key)
  cityFips: string;        // Duplicate for round-trip
  cityName: string;
  state: string;           // 2-letter code
  portalType: PortalType;
  downloadUrl: string;
  featureCount: number;
  lastVerified: string;    // ISO 8601
  confidence: number;      // 0-100
  discoveredBy: string;
  notes?: string;
  webmapLayerName?: string;
  authoritativeSource?: string;
}

type PortalType =
  | 'arcgis' | 'municipal-gis' | 'regional-gis' | 'county-gis'
  | 'state-gis' | 'socrata' | 'geojson' | 'webmap-embedded'
  | 'curated-data' | 'shapefile' | 'kml' | 'golden-vector';
```

#### QuarantinedPortal Entry
```typescript
interface QuarantinedPortalEntry extends KnownPortalEntry {
  quarantineReason: string;
  matchedPattern: QuarantinePattern;
  quarantinedAt: string;  // ISO 8601
}

type QuarantinePattern =
  | 'cvra_gis_unavailable'
  | 'hybrid_gis_unavailable'
  | 'containment_failure'
  | 'single_feature'
  | 'ward_gis_unavailable'
  | 'wrong_data';
```

#### AtLargeCity Entry
```typescript
interface AtLargeCityEntry {
  _fips: string;
  cityName: string;
  state: string;
  councilSize: number;
  electionMethod: 'at-large' | 'proportional';
  source: string;
  notes?: string;
}
```

### 4.2 Audit Log Format

```typescript
interface AuditEntry {
  id: string;           // UUID
  timestamp: string;    // ISO 8601
  action: AuditAction;
  registry: RegistryName;
  fips: string;
  actor: string;        // CLI user or "automated"
  reason?: string;
  before?: object;      // Previous state
  after?: object;       // New state
  metadata?: {
    cliVersion: string;
    command: string;
    duration_ms: number;
  };
}

type AuditAction =
  | 'add' | 'update' | 'delete'
  | 'quarantine' | 'restore' | 'promote'
  | 'migrate' | 'rollback';
```

### 4.3 Validation Report Format

```typescript
interface ValidationReport {
  timestamp: string;
  validator: string;
  tier: 'structure' | 'sanity' | 'full';
  config: Record<string, unknown>;
  results: {
    summary: {
      total: number;
      passed: number;
      failed: number;
      warnings: number;
    };
    entries: ValidationResult[];
  };
  diagnostics?: Record<string, unknown>;
}

interface ValidationResult {
  fips: string;
  status: 'pass' | 'fail' | 'warn';
  tier: string;
  axioms?: {
    exclusivity: AxiomResult;
    exhaustivity: AxiomResult;
    containment: AxiomResult;
    cardinality: AxiomResult;
  };
  errors?: string[];
  warnings?: string[];
}
```

---

## 5. Validation Pipeline

### 5.1 Tiered Validation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VALIDATION PIPELINE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  TIER 0: Registry Checks (instant)                          │
│  ├─ Quarantine check                                        │
│  ├─ At-large check                                          │
│  └─ FIPS format validation                                  │
│                                                              │
│  TIER 1: Structure (~1-2s)                                  │
│  ├─ HTTP fetch (30s timeout)                                │
│  ├─ GeoJSON structure validation                            │
│  ├─ Feature count check (0 < n ≤ 100)                       │
│  └─ Geometry presence check                                 │
│                                                              │
│  TIER 2: Sanity (~10ms additional)                          │
│  ├─ Municipal boundary resolution                           │
│  ├─ Centroid proximity (≤50km)                              │
│  └─ Feature count ratio (1/3 to 3x expected)                │
│                                                              │
│  TIER 3: Full (~500-2000ms additional)                      │
│  └─ Tessellation proof                                      │
│      ├─ Axiom 1: Exclusivity (no overlaps)                  │
│      ├─ Axiom 2: Exhaustivity (85-115% coverage)            │
│      ├─ Axiom 3: Containment (≤15% outside)                 │
│      └─ Axiom 4: Cardinality (count matches)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Validation Thresholds

```typescript
const VALIDATION_THRESHOLDS = {
  // Structure tier
  HTTP_TIMEOUT_MS: 30000,
  MAX_FEATURE_COUNT: 100,

  // Sanity tier
  CENTROID_MAX_DISTANCE_KM: 50,
  COUNT_RATIO_MIN: 0.33,
  COUNT_RATIO_MAX: 3.0,

  // Tessellation tier
  OVERLAP_EPSILON_SQM: 150000,
  GAP_EPSILON_SQM: 10000,
  COVERAGE_MIN: 0.85,
  COVERAGE_MAX_INLAND: 1.15,
  COVERAGE_MAX_COASTAL: 2.0,
  OUTSIDE_RATIO_MAX: 0.15,

  // Special cases
  COVERAGE_EXCEPTIONS: {
    '4159000': { min: 0.65 },  // Portland
    '3651000': { min: 0.50 },  // NYC
    '0667000': { max: 3.50 },  // San Francisco
  },
};
```

### 5.3 GEOID Validation Rules

| Layer | Format | Regex | Example |
|-------|--------|-------|---------|
| CD | SSDD | `^\d{4}$` | 0601 |
| SLDU | SSDDD | `^\d{5}$` | 06001 |
| SLDL | SS[A-Z0-9-]{3,4} | `^\d{2}[A-Z0-9-]{3,4}$` | 06001, 06AD1 |
| COUNTY | SSCCC | `^\d{5}$` | 06001 |
| UNSD | SSGGGGG | `^\d{7}$` | 0600001 |

---

## 6. Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

- [ ] **P1.1** CLI framework setup (Commander.js or oclif)
- [ ] **P1.2** Configuration management (.shadow-atlasrc)
- [ ] **P1.3** Logging infrastructure (structured JSON logs)
- [ ] **P1.4** Audit log system (append-only NDJSON)
- [ ] **P1.5** Error handling and exit codes
- [ ] **P1.6** Output formatting (table/json/ndjson/csv)

### Phase 2: Registry Commands (Week 2-3)

- [ ] **P2.1** `registry list` with filtering
- [ ] **P2.2** `registry get` with validation option
- [ ] **P2.3** `registry add` with pre-validation
- [ ] **P2.4** `registry update` with audit logging
- [ ] **P2.5** `registry delete` (soft-delete to quarantine)
- [ ] **P2.6** `registry stats` and `registry diff`

### Phase 3: Validation Commands (Week 3-4)

- [ ] **P3.1** Tiered validation pipeline refactor
- [ ] **P3.2** `validate council` (tessellation)
- [ ] **P3.3** `validate geoids` (format/coverage)
- [ ] **P3.4** `validate registry` (health checks)
- [ ] **P3.5** `validate boundaries` (downloads)
- [ ] **P3.6** `validate comprehensive` (full suite)

### Phase 4: Quarantine Workflow (Week 4-5)

- [ ] **P4.1** `quarantine add` with pattern classification
- [ ] **P4.2** `quarantine list` with filters
- [ ] **P4.3** `quarantine resolve` (automated resolution)
- [ ] **P4.4** `quarantine restore` with validation
- [ ] **P4.5** `quarantine promote` to at-large

### Phase 5: Discovery & Ingestion (Week 5-6)

- [ ] **P5.1** `discover search` (multi-source)
- [ ] **P5.2** `discover import` (bulk)
- [ ] **P5.3** `discover wave` management
- [ ] **P5.4** `ingest arcgis` adapter
- [ ] **P5.5** `ingest tiger` adapter
- [ ] **P5.6** `ingest webmap` extraction

### Phase 6: Codegen & Migration (Week 6-7)

- [ ] **P6.1** `codegen generate` (NDJSON → TS)
- [ ] **P6.2** `codegen extract` (TS → NDJSON)
- [ ] **P6.3** `codegen verify` (round-trip)
- [ ] **P6.4** `migrate apply` with snapshots
- [ ] **P6.5** `migrate rollback` capability

### Phase 7: Diagnostics & Audit (Week 7-8)

- [ ] **P7.1** `diagnose containment` analysis
- [ ] **P7.2** `diagnose coverage` analysis
- [ ] **P7.3** `diagnose health` checks
- [ ] **P7.4** `audit log` viewer
- [ ] **P7.5** `audit export` for compliance

### Phase 8: Script Deprecation (Week 8-9)

- [ ] **P8.1** Create migration guide from scripts to CLI
- [ ] **P8.2** Update CI/CD to use CLI commands
- [ ] **P8.3** Add deprecation warnings to old scripts
- [ ] **P8.4** Remove deprecated scripts
- [ ] **P8.5** Update documentation

---

## 7. Script Migration Mapping

### 7.1 Direct Replacements

| Old Script | New Command | Notes |
|------------|-------------|-------|
| `count-registry.ts` | `registry stats` | |
| `analyze-registry.ts` | `registry stats --detailed` | |
| `generate-registries-from-ndjson.ts` | `codegen generate` | |
| `extract-registries-to-ndjson.ts` | `codegen extract` | |
| `verify-registry-roundtrip.ts` | `codegen verify` | |
| `ci-check-generated-files.ts` | `codegen verify --strict` | |
| `diff-registry.ts` | `registry diff` | |
| `quarantine-suspicious-entries.ts` | `quarantine add --pattern wrong_data` | |
| `quarantine-single-feature-entries.ts` | `quarantine add --pattern single_feature` | |
| `resolve-quarantined-entries.ts` | `quarantine resolve` | |
| `remove-county-entries.ts` | `registry delete --reason "County entry"` | |
| `add-missing-cities.ts` | `discover import` | |
| `run-tessellation-validation.ts` | `validate council` | |
| `run-city-validation.ts` | `validate council --batch` | |
| `validate-registry-coverage.ts` | `validate registry --coverage` | |
| `validate-boundary-downloads.ts` | `validate boundaries` | |
| `validate-all-geoids.ts` | `validate geoids` | |
| `validate-tiger-geoids.ts` | `validate geoids --cross-validate` | |
| `cross-validate.ts` | `validate geoids --cross-validate` | |
| `validate-golden-vectors.ts` | `validate boundaries --source golden` | |

### 7.2 Consolidated Scripts

| Old Scripts | New Command |
|-------------|-------------|
| Multiple wave-* scripts | `discover wave` subcommands |
| Multiple bulk-* ingestion scripts | `ingest` subcommands |
| Multiple forensic-* scripts | `diagnose` subcommands |

---

## 8. Configuration

### 8.1 Configuration File (.shadow-atlasrc)

```yaml
# Shadow Atlas CLI Configuration
version: 1

# Paths
paths:
  data: ./data/registries
  generated: ./src/core/registry
  cache: ./data/cache
  audit: ./data/audit

# Defaults
defaults:
  timeout: 30000
  concurrency: 5
  validation:
    tier: full
    coverage: top50

# External services
services:
  tiger:
    baseUrl: https://tigerweb.geo.census.gov/arcgis/rest/services
    vintage: 2024
  arcgis:
    defaultPortal: https://www.arcgis.com

# Audit settings
audit:
  enabled: true
  retention_days: 365
```

### 8.2 Environment Variables

```bash
SHADOW_ATLAS_CONFIG=/path/to/.shadow-atlasrc
SHADOW_ATLAS_VERBOSE=true
SHADOW_ATLAS_NO_AUDIT=false
SHADOW_ATLAS_CACHE_DIR=/path/to/cache
```

---

## 9. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation warnings (non-blocking) |
| 2 | Validation errors (blocking) |
| 3 | Configuration error |
| 4 | Network/service error |
| 5 | Data integrity error |
| 10 | User cancelled |
| 127 | Unknown command |

---

## 10. Observability

### 10.1 Structured Logging

All operations emit structured JSON logs:

```typescript
{
  "timestamp": "2026-01-25T12:00:00.000Z",
  "level": "info",
  "command": "validate council",
  "fips": "0666000",
  "duration_ms": 1234,
  "result": "pass",
  "details": { ... }
}
```

### 10.2 Metrics

Exposed via `diagnose health --metrics`:

- `registry_entry_count{registry="known-portals"}`
- `validation_duration_seconds{tier="full"}`
- `quarantine_queue_size`
- `audit_log_size_bytes`
- `cache_hit_ratio`

---

## Appendix A: File Locations

```
packages/shadow-atlas/
├── bin/
│   └── shadow-atlas.ts          # CLI entry point
├── src/
│   └── cli/
│       ├── commands/            # Command implementations
│       │   ├── registry/
│       │   ├── validate/
│       │   ├── quarantine/
│       │   ├── discover/
│       │   ├── ingest/
│       │   ├── codegen/
│       │   ├── migrate/
│       │   ├── diagnose/
│       │   └── audit/
│       ├── lib/                 # Shared CLI utilities
│       │   ├── config.ts
│       │   ├── logger.ts
│       │   ├── output.ts
│       │   └── audit.ts
│       └── index.ts
├── data/
│   ├── registries/              # NDJSON source of truth
│   ├── cache/                   # TIGER and other caches
│   └── audit/                   # Audit logs
└── .shadow-atlasrc              # Configuration
```

---

## Appendix B: Related Specifications

- [SHADOW-ATLAS-SPEC.md](./SHADOW-ATLAS-SPEC.md) - Core architecture
- [DATA-PROVENANCE-SPEC.md](./DATA-PROVENANCE-SPEC.md) - Provenance model
- [REGISTRY-MAINTENANCE.md](../docs/REGISTRY-MAINTENANCE.md) - Current maintenance procedures

---

*End of specification*
