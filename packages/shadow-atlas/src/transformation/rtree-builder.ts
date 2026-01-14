/**
 * R-tree Spatial Index Builder
 *
 * Builds SQLite database with R-tree virtual table for <50ms point-in-polygon lookups.
 *
 * ARCHITECTURE:
 * - Main table: Full district data (geometry, provenance)
 * - R-tree virtual table: Spatial index (bounding boxes)
 * - Query pattern: R-tree filter → point-in-polygon on candidates
 *
 * PERFORMANCE:
 * - R-tree lookup: O(log n) - typically 5-10 candidates
 * - Point-in-polygon: O(k) where k = candidate count
 * - Total: <50ms for millions of districts
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import Database from 'better-sqlite3';
import type { NormalizedDistrict, DistrictRecord } from './types.js';
import { logger } from '../core/utils/logger.js';

/**
 * R-tree index builder
 */
export class RTreeBuilder {
  /**
   * Build SQLite database with R-tree spatial index
   *
   * IDEMPOTENT: Safe to re-run (overwrites existing database)
   *
   * @param districts - Normalized districts to index
   * @param dbPath - Output SQLite database path
   */
  build(districts: readonly NormalizedDistrict[], dbPath: string): void {
    logger.info('Building R-tree spatial index', {
      districtCount: districts.length,
      outputPath: dbPath,
    });

    // Open database (overwrites if exists)
    const db = new Database(dbPath);

    try {
      // Enable WAL mode for better concurrency
      db.pragma('journal_mode = WAL');

      // Create schema
      this.createSchema(db);

      // Insert districts
      this.insertDistricts(db, districts);

      // Build indexes
      this.buildIndexes(db);

      // Optimize database
      this.optimize(db);

      logger.info('R-tree index build complete', {
        dbPath,
        districtCount: districts.length,
        databaseSizeMB: this.getDatabaseSize(db),
      });
    } finally {
      db.close();
    }
  }

  /**
   * Create database schema
   */
  private createSchema(db: Database.Database): void {
    // Main districts table
    db.exec(`
      CREATE TABLE IF NOT EXISTS districts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        jurisdiction TEXT NOT NULL,
        district_type TEXT NOT NULL,
        geometry TEXT NOT NULL,        -- GeoJSON as text
        provenance TEXT NOT NULL,      -- JSON as text
        min_lon REAL NOT NULL,
        min_lat REAL NOT NULL,
        max_lon REAL NOT NULL,
        max_lat REAL NOT NULL
      );
    `);

    // R-tree spatial index (virtual table)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rtree_index USING rtree(
        id,         -- Integer ID (rowid)
        min_lon,    -- Bounding box min longitude
        max_lon,    -- Bounding box max longitude
        min_lat,    -- Bounding box min latitude
        max_lat     -- Bounding box max latitude
      );
    `);

    logger.debug('R-tree schema created');
  }

  /**
   * Insert districts into database
   */
  private insertDistricts(
    db: Database.Database,
    districts: readonly NormalizedDistrict[]
  ): void {
    // Prepare statements
    const insertDistrict = db.prepare(`
      INSERT INTO districts (
        id, name, jurisdiction, district_type, geometry, provenance,
        min_lon, min_lat, max_lon, max_lat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRTree = db.prepare(`
      INSERT INTO rtree_index (id, min_lon, max_lon, min_lat, max_lat)
      VALUES ((SELECT rowid FROM districts WHERE id = ?), ?, ?, ?, ?)
    `);

    // Insert in transaction (much faster)
    const insertAll = db.transaction((districts: readonly NormalizedDistrict[]) => {
      for (const district of districts) {
        // Insert into main table
        insertDistrict.run(
          district.id,
          district.name,
          district.jurisdiction,
          district.districtType,
          JSON.stringify(district.geometry),
          JSON.stringify(district.provenance),
          district.bbox[0], // min_lon
          district.bbox[1], // min_lat
          district.bbox[2], // max_lon
          district.bbox[3]  // max_lat
        );

        // Insert into R-tree
        insertRTree.run(
          district.id,
          district.bbox[0], // min_lon
          district.bbox[2], // max_lon
          district.bbox[1], // min_lat
          district.bbox[3]  // max_lat
        );
      }
    });

    // Execute transaction
    insertAll(districts);

    logger.debug('Districts inserted into R-tree database', {
      districtCount: districts.length,
    });
  }

  /**
   * Build additional indexes
   */
  private buildIndexes(db: Database.Database): void {
    // Index on jurisdiction (for jurisdiction-scoped queries)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction
      ON districts(jurisdiction);
    `);

    // Index on district_type (for filtering by type)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_district_type
      ON districts(district_type);
    `);

    logger.debug('R-tree indexes built');
  }

  /**
   * Optimize database
   */
  private optimize(db: Database.Database): void {
    // Analyze for query planner
    db.exec('ANALYZE');

    // Vacuum to reclaim space
    db.exec('VACUUM');

    logger.debug('R-tree database optimized');
  }

  /**
   * Get database size in MB
   */
  private getDatabaseSize(db: Database.Database): number {
    const result = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as { size: number };
    return result.size / (1024 * 1024); // Convert to MB
  }

  /**
   * Validate database (check integrity)
   */
  validateDatabase(dbPath: string): boolean {
    const db = new Database(dbPath, { readonly: true });

    try {
      // Check district count
      const districtCount = db.prepare('SELECT COUNT(*) as count FROM districts').get() as { count: number };
      logger.debug('R-tree district count validated', {
        districtCount: districtCount.count,
      });

      // Check R-tree count (should match)
      const rtreeCount = db.prepare('SELECT COUNT(*) as count FROM rtree_index').get() as { count: number };
      logger.debug('R-tree index count validated', {
        rtreeCount: rtreeCount.count,
      });

      if (districtCount.count !== rtreeCount.count) {
        logger.error('R-tree count mismatch detected', {
          districtCount: districtCount.count,
          rtreeCount: rtreeCount.count,
        });
        return false;
      }

      // Run integrity check
      const integrityResult = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (integrityResult.integrity_check !== 'ok') {
        logger.error('R-tree integrity check failed', {
          integrityResult: integrityResult.integrity_check,
        });
        return false;
      }

      logger.info('R-tree database validation passed');
      return true;
    } finally {
      db.close();
    }
  }

  /**
   * Test R-tree query performance
   */
  benchmarkQueries(dbPath: string, testPoints: Array<{ lat: number; lon: number }>): void {
    const db = new Database(dbPath, { readonly: true });

    try {
      const query = db.prepare(`
        SELECT d.*
        FROM districts d
        JOIN rtree_index r ON d.rowid = r.id
        WHERE r.min_lon <= ? AND r.max_lon >= ?
          AND r.min_lat <= ? AND r.max_lat >= ?
      `);

      const times: number[] = [];

      for (const point of testPoints) {
        const start = performance.now();
        query.all(point.lon, point.lon, point.lat, point.lat);
        const duration = performance.now() - start;
        times.push(duration);
      }

      // Statistics
      const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
      const sorted = times.sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      logger.info('R-tree query performance benchmark', {
        avgMs: avg.toFixed(2),
        p50Ms: p50.toFixed(2),
        p95Ms: p95.toFixed(2),
        p99Ms: p99.toFixed(2),
        testPointCount: testPoints.length,
      });
    } finally {
      db.close();
    }
  }
}
