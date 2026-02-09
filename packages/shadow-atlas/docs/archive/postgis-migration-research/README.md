# PostGIS Migration Research Archive

These documents were produced during a January 2026 evaluation of migrating shadow-atlas from SQLite to PostgreSQL + PostGIS.

## Decision Summary

**The migration was rejected in favor of retaining SQLite** for the following reasons:

- **Simplicity**: SQLite requires zero external dependencies and runs in-process
- **R-tree adequacy**: SQLite's built-in R-tree spatial indexing is sufficient for US-only deployment scope
- **Operational overhead**: PostgreSQL + PostGIS would add deployment complexity without material performance benefits at current scale
- **Zero-dependency operation**: SQLite aligns with the project's emphasis on minimal infrastructure

## Current Implementation

shadow-atlas uses **SQLite via better-sqlite3** with R-tree spatial indexes for geospatial queries. See the main shadow-atlas documentation for current database architecture.

## Archived Documents

1. **DATABASE-ARCHITECTURE-DECISIONS.md** - Full evaluation criteria and decision rationale
2. **DATABASE-MIGRATION-PLAN.md** - Proposed migration steps (never executed)
3. **MIGRATION-DECISION-MATRIX.md** - Comparative analysis of SQLite vs PostgreSQL
4. **POSTGIS-MIGRATION-README.md** - Migration overview and timeline
5. **POSTGIS-QUERY-COOKBOOK.md** - PostGIS query patterns (research only)
6. **API_IMPLEMENTATION_GUIDE.md** - Full-stack PostgreSQL + PostGIS + Redis architecture (never implemented)

These documents are preserved for historical reference and may inform future scalability decisions if deployment scope changes significantly (e.g., international expansion requiring advanced geospatial operations).
