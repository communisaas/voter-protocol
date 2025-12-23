/**
 * SQLite Database Adapter
 *
 * CRITICAL TYPE SAFETY: This adapter implements the DatabaseAdapter interface
 * with zero-tolerance type strictness. Type errors here can corrupt the
 * event-sourced provenance log.
 *
 * LOCAL MVP: Uses better-sqlite3 for synchronous, high-performance SQLite.
 * PRODUCTION: Can swap to async pg adapter for PostgreSQL with zero business logic changes.
 */

import Database from 'better-sqlite3';
import type {
  DatabaseAdapter,
  Municipality,
  Source,
  Selection,
  Artifact,
  Head,
  Event,
  StatusView,
  CoverageView,
} from '../types';

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * Initialize database schema
   */
  async initialize(schemaSQL: string, viewsSQL: string): Promise<void> {
    this.db.exec(schemaSQL);
    this.db.exec(viewsSQL);
  }

  // ============================================================================
  // Municipalities
  // ============================================================================

  async insertMunicipality(muni: Omit<Municipality, 'created_at'>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO municipalities (id, name, state, fips_place, population, county_fips)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      muni.id,
      muni.name,
      muni.state,
      muni.fips_place,
      muni.population,
      muni.county_fips
    );
  }

  async batchInsertMunicipalities(munis: Omit<Municipality, 'created_at'>[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO municipalities (id, name, state, fips_place, population, county_fips)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Omit<Municipality, 'created_at'>[]) => {
      for (const muni of items) {
        stmt.run(
          muni.id,
          muni.name,
          muni.state,
          muni.fips_place,
          muni.population,
          muni.county_fips
        );
      }
    });

    insertMany(munis);
  }

  async getMunicipality(id: string): Promise<Municipality | null> {
    const stmt = this.db.prepare('SELECT * FROM municipalities WHERE id = ?');
    const row = stmt.get(id) as Municipality | undefined;
    return row || null;
  }

  async listMunicipalities(limit = 100, offset = 0): Promise<Municipality[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM municipalities
      ORDER BY population DESC NULLS LAST, name ASC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as Municipality[];
  }

  // ============================================================================
  // Sources
  // ============================================================================

  async insertSource(source: Omit<Source, 'id'>): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO sources (muni_id, kind, url, layer_hint, title, description, discovered_at, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      source.muni_id,
      source.kind,
      source.url,
      source.layer_hint,
      source.title,
      source.description,
      source.discovered_at,
      source.score
    );

    return result.lastInsertRowid as number;
  }

  async batchInsertSources(sources: Omit<Source, 'id'>[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO sources (muni_id, kind, url, layer_hint, title, description, discovered_at, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Omit<Source, 'id'>[]) => {
      for (const source of items) {
        stmt.run(
          source.muni_id,
          source.kind,
          source.url,
          source.layer_hint,
          source.title,
          source.description,
          source.discovered_at,
          source.score
        );
      }
    });

    insertMany(sources);
  }

  async getSourcesByMuni(muni_id: string): Promise<Source[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM sources WHERE muni_id = ? ORDER BY score DESC
    `);
    return stmt.all(muni_id) as Source[];
  }

  // ============================================================================
  // Selections
  // ============================================================================

  async insertSelection(sel: Selection): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO selections
      (muni_id, source_id, district_field, member_field, at_large, confidence, decided_by, decided_at, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sel.muni_id,
      sel.source_id,
      sel.district_field,
      sel.member_field,
      sel.at_large ? 1 : 0,
      sel.confidence,
      sel.decided_by,
      sel.decided_at,
      sel.model
    );
  }

  async getSelection(muni_id: string): Promise<Selection | null> {
    const stmt = this.db.prepare('SELECT * FROM selections WHERE muni_id = ?');
    const row = stmt.get(muni_id) as (Omit<Selection, 'at_large'> & { at_large: number }) | undefined;

    if (!row) return null;

    return {
      ...row,
      at_large: Boolean(row.at_large),
    };
  }

  // ============================================================================
  // Artifacts
  // ============================================================================

  async insertArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO artifacts
      (muni_id, content_sha256, record_count, bbox, etag, last_modified, last_edit_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      artifact.muni_id,
      artifact.content_sha256,
      artifact.record_count,
      artifact.bbox ? JSON.stringify(artifact.bbox) : null,
      artifact.etag,
      artifact.last_modified,
      artifact.last_edit_date
    );

    return result.lastInsertRowid as number;
  }

  async getArtifact(id: number): Promise<Artifact | null> {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE id = ?');
    const row = stmt.get(id) as (Omit<Artifact, 'bbox'> & { bbox: string | null }) | undefined;

    if (!row) return null;

    return {
      ...row,
      bbox: row.bbox ? JSON.parse(row.bbox) : null,
    };
  }

  async getArtifactBySha(sha: string): Promise<Artifact | null> {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE content_sha256 = ?');
    const row = stmt.get(sha) as (Omit<Artifact, 'bbox'> & { bbox: string | null }) | undefined;

    if (!row) return null;

    return {
      ...row,
      bbox: row.bbox ? JSON.parse(row.bbox) : null,
    };
  }

  // ============================================================================
  // Heads
  // ============================================================================

  async upsertHead(head: Omit<Head, 'updated_at'>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO heads (muni_id, artifact_id, updated_at)
      VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `);

    stmt.run(head.muni_id, head.artifact_id);
  }

  async getHead(muni_id: string): Promise<Head | null> {
    const stmt = this.db.prepare('SELECT * FROM heads WHERE muni_id = ?');
    const row = stmt.get(muni_id) as Head | undefined;
    return row || null;
  }

  // ============================================================================
  // Events
  // ============================================================================

  async insertEvent(event: Omit<Event, 'id' | 'ts'>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events (run_id, muni_id, kind, payload, model, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.run_id,
      event.muni_id,
      event.kind,
      JSON.stringify(event.payload),
      event.model,
      event.duration_ms,
      event.error
    );
  }

  async batchInsertEvents(events: Omit<Event, 'id' | 'ts'>[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events (run_id, muni_id, kind, payload, model, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Omit<Event, 'id' | 'ts'>[]) => {
      for (const event of items) {
        stmt.run(
          event.run_id,
          event.muni_id,
          event.kind,
          JSON.stringify(event.payload),
          event.model,
          event.duration_ms,
          event.error
        );
      }
    });

    insertMany(events);
  }

  async getEventsByMuni(muni_id: string, limit = 100): Promise<Event[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events WHERE muni_id = ? ORDER BY ts DESC LIMIT ?
    `);
    const rows = stmt.all(muni_id, limit) as (Omit<Event, 'payload'> & { payload: string })[];

    return rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  }

  async getEventsByRun(run_id: string): Promise<Event[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events WHERE run_id = ? ORDER BY ts ASC
    `);
    const rows = stmt.all(run_id) as (Omit<Event, 'payload'> & { payload: string })[];

    return rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  }

  // ============================================================================
  // Views
  // ============================================================================

  async getStatus(muni_id: string): Promise<StatusView | null> {
    const stmt = this.db.prepare('SELECT * FROM v_status WHERE muni_id = ?');
    const row = stmt.get(muni_id) as StatusView | undefined;
    return row || null;
  }

  async listStatus(limit = 100, offset = 0): Promise<StatusView[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM v_status ORDER BY population DESC NULLS LAST LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as StatusView[];
  }

  async getCoverage(): Promise<CoverageView[]> {
    const stmt = this.db.prepare('SELECT * FROM v_coverage');
    return stmt.all() as CoverageView[];
  }

  async getErrors(limit = 100): Promise<Event[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events WHERE kind = 'ERROR' ORDER BY ts DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as (Omit<Event, 'payload'> & { payload: string })[];

    return rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  }

  // ============================================================================
  // Utility
  // ============================================================================

  async close(): Promise<void> {
    this.db.close();
  }
}
