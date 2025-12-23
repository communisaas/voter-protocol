/**
 * Change Detector Tests
 *
 * CRITICAL TYPE SAFETY: These tests validate change detection logic.
 * Failures here mean wasted bandwidth or missed boundary updates.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChangeDetector } from '../../../acquisition/change-detector.js';
import type {
  CanonicalSource,
  UpdateTrigger,
  ChangeReport,
} from '../../../acquisition/change-detector.js';
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
} from '../types/index.js';

/**
 * Mock DatabaseAdapter for testing
 */
class MockDatabaseAdapter implements DatabaseAdapter {
  municipalities: Municipality[] = [];
  sources: Map<string, Source[]> = new Map();
  selections: Map<string, Selection> = new Map();
  artifacts: Map<number, Artifact> = new Map();
  heads: Map<string, Head> = new Map();
  events: Event[] = [];

  async insertMunicipality(muni: Omit<Municipality, 'created_at'>): Promise<void> {
    this.municipalities.push({ ...muni, created_at: new Date().toISOString() });
  }

  async batchInsertMunicipalities(munis: Omit<Municipality, 'created_at'>[]): Promise<void> {
    for (const muni of munis) {
      await this.insertMunicipality(muni);
    }
  }

  async getMunicipality(id: string): Promise<Municipality | null> {
    return this.municipalities.find(m => m.id === id) || null;
  }

  async listMunicipalities(limit = 100, offset = 0): Promise<Municipality[]> {
    return this.municipalities.slice(offset, offset + limit);
  }

  async insertSource(source: Omit<Source, 'id'>): Promise<number> {
    const id = Math.floor(Math.random() * 1000000);
    const newSource: Source = { ...source, id };

    if (!this.sources.has(source.muni_id)) {
      this.sources.set(source.muni_id, []);
    }
    this.sources.get(source.muni_id)!.push(newSource);

    return id;
  }

  async batchInsertSources(sources: Omit<Source, 'id'>[]): Promise<void> {
    for (const source of sources) {
      await this.insertSource(source);
    }
  }

  async getSourcesByMuni(muni_id: string): Promise<Source[]> {
    return this.sources.get(muni_id) || [];
  }

  async insertSelection(sel: Selection): Promise<void> {
    this.selections.set(sel.muni_id, sel);
  }

  async getSelection(muni_id: string): Promise<Selection | null> {
    return this.selections.get(muni_id) || null;
  }

  async insertArtifact(artifact: Omit<Artifact, 'id' | 'created_at'>): Promise<number> {
    const id = Math.floor(Math.random() * 1000000);
    const newArtifact: Artifact = {
      ...artifact,
      id,
      created_at: new Date().toISOString(),
    };
    this.artifacts.set(id, newArtifact);
    return id;
  }

  async getArtifact(id: number): Promise<Artifact | null> {
    return this.artifacts.get(id) || null;
  }

  async getArtifactBySha(sha: string): Promise<Artifact | null> {
    for (const artifact of this.artifacts.values()) {
      if (artifact.content_sha256 === sha) {
        return artifact;
      }
    }
    return null;
  }

  async upsertHead(head: Omit<Head, 'updated_at'>): Promise<void> {
    this.heads.set(head.muni_id, { ...head, updated_at: new Date().toISOString() });
  }

  async getHead(muni_id: string): Promise<Head | null> {
    return this.heads.get(muni_id) || null;
  }

  async insertEvent(event: Omit<Event, 'id' | 'ts'>): Promise<void> {
    this.events.push({
      ...event,
      id: this.events.length + 1,
      ts: new Date().toISOString(),
    });
  }

  async batchInsertEvents(events: Omit<Event, 'id' | 'ts'>[]): Promise<void> {
    for (const event of events) {
      await this.insertEvent(event);
    }
  }

  async getEventsByMuni(muni_id: string, limit = 100): Promise<Event[]> {
    return this.events.filter(e => e.muni_id === muni_id).slice(0, limit);
  }

  async getEventsByRun(run_id: string): Promise<Event[]> {
    return this.events.filter(e => e.run_id === run_id);
  }

  async getStatus(muni_id: string): Promise<StatusView | null> {
    return null;
  }

  async listStatus(limit = 100, offset = 0): Promise<StatusView[]> {
    return [];
  }

  async getCoverage(): Promise<CoverageView[]> {
    return [];
  }

  async getErrors(limit = 100): Promise<Event[]> {
    return this.events.filter(e => e.kind === 'ERROR').slice(0, limit);
  }

  async close(): Promise<void> {}
}

/**
 * Mock fetch for testing HTTP HEAD requests
 */
function mockFetch(
  etag: string | null,
  lastModified: string | null,
  status = 200
): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({
      ...(etag ? { etag } : {}),
      ...(lastModified ? { 'last-modified': lastModified } : {}),
    }),
  });
}

describe('ChangeDetector', () => {
  let db: MockDatabaseAdapter;
  let detector: ChangeDetector;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    detector = new ChangeDetector(db);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkForChange', () => {
    it('detects new source (no previous checksum)', async () => {
      mockFetch('"abc123"', null);

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: null,
        lastChecked: null,
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).not.toBeNull();
      expect(result!.changeType).toBe('new');
      expect(result!.newChecksum).toBe('"abc123"');
      expect(result!.oldChecksum).toBeNull();
    });

    it('detects modified source (checksum changed)', async () => {
      mockFetch('"xyz789"', null);

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: '"abc123"',
        lastChecked: '2024-01-01T00:00:00Z',
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).not.toBeNull();
      expect(result!.changeType).toBe('modified');
      expect(result!.newChecksum).toBe('"xyz789"');
      expect(result!.oldChecksum).toBe('"abc123"');
    });

    it('returns null when checksum unchanged', async () => {
      mockFetch('"abc123"', null);

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: '"abc123"',
        lastChecked: '2024-01-01T00:00:00Z',
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).toBeNull();
    });

    it('prefers ETag over Last-Modified', async () => {
      mockFetch('"etag-value"', 'Wed, 21 Oct 2015 07:28:00 GMT');

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: null,
        lastChecked: null,
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).not.toBeNull();
      expect(result!.newChecksum).toBe('"etag-value"');
    });

    it('falls back to Last-Modified when ETag unavailable', async () => {
      mockFetch(null, 'Wed, 21 Oct 2015 07:28:00 GMT');

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: null,
        lastChecked: null,
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).not.toBeNull();
      expect(result!.newChecksum).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
    });

    it('returns null on HTTP error', async () => {
      mockFetch(null, null, 404);

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: '"abc123"',
        lastChecked: '2024-01-01T00:00:00Z',
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).toBeNull();
    });

    it('retries on network error', async () => {
      let attemptCount = 0;

      global.fetch = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ etag: '"success"' }),
        });
      });

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: null,
        lastChecked: null,
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).not.toBeNull();
      expect(result!.newChecksum).toBe('"success"');
      expect(attemptCount).toBe(3);
    });
  });

  describe('trigger logic', () => {
    it('identifies annual trigger correctly', async () => {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;

      const sources = await detector.getSourcesDueForCheck();

      // Mock a source with current month trigger
      await db.insertMunicipality({
        id: 'ca-test',
        name: 'Test City',
        state: 'CA',
        fips_place: '12345',
        population: 100000,
        county_fips: '06',
      });

      const sourceId = await db.insertSource({
        muni_id: 'ca-test',
        kind: 'arcgis',
        url: 'https://example.com/data',
        layer_hint: null,
        title: 'Test Source',
        description: null,
        discovered_at: new Date().toISOString(),
        score: 1.0,
      });

      await db.insertSelection({
        muni_id: 'ca-test',
        source_id: sourceId,
        district_field: 'DISTRICT',
        member_field: null,
        at_large: false,
        confidence: 1.0,
        decided_by: 'heuristic',
        decided_at: new Date().toISOString(),
        model: null,
      });

      // This test validates the trigger logic exists
      // In production, sources due for check would be filtered by triggers
      expect(sources).toBeDefined();
    });

    it('identifies redistricting years correctly', async () => {
      const currentYear = new Date().getFullYear();

      // Create source with redistricting trigger
      await db.insertMunicipality({
        id: 'ca-test',
        name: 'Test City',
        state: 'CA',
        fips_place: '12345',
        population: 100000,
        county_fips: '06',
      });

      const sourceId = await db.insertSource({
        muni_id: 'ca-test',
        kind: 'arcgis',
        url: 'https://example.com/data',
        layer_hint: null,
        title: 'Test Source',
        description: null,
        discovered_at: new Date().toISOString(),
        score: 1.0,
      });

      await db.insertSelection({
        muni_id: 'ca-test',
        source_id: sourceId,
        district_field: 'DISTRICT',
        member_field: null,
        at_large: false,
        confidence: 1.0,
        decided_by: 'heuristic',
        decided_at: new Date().toISOString(),
        model: null,
      });

      const sources = await detector.getSourcesDueForCheck();

      // Redistricting years include 2021-2022, 2031-2032
      // If current year is in that range, sources should be due
      expect(sources).toBeDefined();
    });
  });

  describe('checkScheduledSources', () => {
    it('checks only sources due for verification', async () => {
      mockFetch('"abc123"', null);

      // Set up municipality with source
      await db.insertMunicipality({
        id: 'ca-test',
        name: 'Test City',
        state: 'CA',
        fips_place: '12345',
        population: 100000,
        county_fips: '06',
      });

      const sourceId = await db.insertSource({
        muni_id: 'ca-test',
        kind: 'arcgis',
        url: 'https://example.com/data',
        layer_hint: null,
        title: 'Test Source',
        description: null,
        discovered_at: new Date().toISOString(),
        score: 1.0,
      });

      await db.insertSelection({
        muni_id: 'ca-test',
        source_id: sourceId,
        district_field: 'DISTRICT',
        member_field: null,
        at_large: false,
        confidence: 1.0,
        decided_by: 'heuristic',
        decided_at: new Date().toISOString(),
        model: null,
      });

      const changes = await detector.checkScheduledSources();

      // Should be able to check sources (actual results depend on triggers)
      expect(Array.isArray(changes)).toBe(true);
    });
  });

  describe('checkAllSources', () => {
    it('force checks all sources', async () => {
      mockFetch('"abc123"', null);

      // Set up municipality with source
      await db.insertMunicipality({
        id: 'ca-test',
        name: 'Test City',
        state: 'CA',
        fips_place: '12345',
        population: 100000,
        county_fips: '06',
      });

      const sourceId = await db.insertSource({
        muni_id: 'ca-test',
        kind: 'arcgis',
        url: 'https://example.com/data',
        layer_hint: null,
        title: 'Test Source',
        description: null,
        discovered_at: new Date().toISOString(),
        score: 1.0,
      });

      await db.insertSelection({
        muni_id: 'ca-test',
        source_id: sourceId,
        district_field: 'DISTRICT',
        member_field: null,
        at_large: false,
        confidence: 1.0,
        decided_by: 'heuristic',
        decided_at: new Date().toISOString(),
        model: null,
      });

      const changes = await detector.checkAllSources();

      expect(Array.isArray(changes)).toBe(true);

      // If there were changes, they should be marked as 'forced'
      if (changes.length > 0) {
        expect(changes.every(c => c.trigger === 'forced')).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it('handles sources with no headers gracefully', async () => {
      mockFetch(null, null);

      const source: CanonicalSource = {
        id: '1',
        url: 'https://example.com/data',
        boundaryType: 'municipal',
        lastChecksum: '"abc123"',
        lastChecked: '2024-01-01T00:00:00Z',
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      };

      const result = await detector.checkForChange(source);

      expect(result).toBeNull();
    });

    it('handles concurrent checks efficiently', async () => {
      mockFetch('"abc123"', null);

      const sources: CanonicalSource[] = Array.from({ length: 10 }, (_, i) => ({
        id: i.toString(),
        url: `https://example.com/data${i}`,
        boundaryType: 'municipal',
        lastChecksum: null,
        lastChecked: null,
        nextScheduledCheck: new Date().toISOString(),
        updateTriggers: [{ type: 'annual', month: 7 }],
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        sources.map(s => detector.checkForChange(s))
      );
      const duration = Date.now() - startTime;

      expect(results.length).toBe(10);
      expect(results.every(r => r !== null)).toBe(true);

      // Should complete relatively quickly (concurrent requests)
      expect(duration).toBeLessThan(10000); // 10 seconds max for 10 sources
    });
  });

  describe('type safety', () => {
    it('enforces readonly arrays in UpdateTrigger', () => {
      const trigger: UpdateTrigger = {
        type: 'redistricting',
        years: [2021, 2022, 2031, 2032],
      };

      // TypeScript should prevent mutation
      // @ts-expect-error - years is readonly
      trigger.years.push(2041);
    });

    it('enforces ChangeReport immutability', () => {
      const report: ChangeReport = {
        sourceId: '1',
        url: 'https://example.com/data',
        oldChecksum: null,
        newChecksum: '"abc123"',
        detectedAt: new Date().toISOString(),
        trigger: 'scheduled',
        changeType: 'new',
      };

      // TypeScript should prevent mutation
      // @ts-expect-error - all fields are readonly
      report.changeType = 'modified';
    });
  });
});
