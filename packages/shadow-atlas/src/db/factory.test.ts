/**
 * Database Adapter Factory Tests
 *
 * Validates database adapter initialization from environment configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseAdapter, createSQLiteAdapter } from './factory.js';
import { unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Database Adapter Factory', () => {
  const testDbPath1 = '.shadow-atlas/test-factory-1.db';
  const testDbPath2 = '.shadow-atlas/test-factory-2.db';
  const testDbPath3 = '.shadow-atlas/test-factory-3.db';
  const testDbPath4 = '.shadow-atlas/test-factory-4.db';
  const testDbPath5 = '.shadow-atlas/test-factory-5.db';
  const defaultDbPath = '.shadow-atlas/shadow-atlas.db';

  afterEach(async () => {
    // Clean up all test databases
    const paths = [testDbPath1, testDbPath2, testDbPath3, testDbPath4, testDbPath5, defaultDbPath];
    for (const path of paths) {
      try {
        await unlink(path);
      } catch {
        // Ignore if file doesn't exist
      }
    }
  });

  describe('createDatabaseAdapter', () => {
    it('should create SQLite adapter with default path when DATABASE_URL is not set', async () => {
      // Save original env
      const originalDatabaseUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        // Schema directory is in the same directory as this test file
        const schemaDir = __dirname;
        const adapter = await createDatabaseAdapter(schemaDir);

        expect(adapter).toBeDefined();
        expect(typeof adapter.close).toBe('function');
        expect(typeof adapter.listMunicipalities).toBe('function');

        await adapter.close();
      } finally {
        // Restore original env
        if (originalDatabaseUrl !== undefined) {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }
    });

    it('should create SQLite adapter when DATABASE_URL is sqlite://', async () => {
      // Save original env
      const originalDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = `sqlite:///${testDbPath2}`;

      try {
        const schemaDir = __dirname;
        const adapter = await createDatabaseAdapter(schemaDir);

        expect(adapter).toBeDefined();
        await adapter.close();
      } finally {
        // Restore original env
        if (originalDatabaseUrl !== undefined) {
          process.env.DATABASE_URL = originalDatabaseUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it('should throw error for unsupported database protocol', async () => {
      // Save original env
      const originalDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://localhost/test';

      try {
        const schemaDir = __dirname;
        await expect(
          createDatabaseAdapter(schemaDir)
        ).rejects.toThrow();
      } finally {
        // Restore original env
        if (originalDatabaseUrl !== undefined) {
          process.env.DATABASE_URL = originalDatabaseUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });
  });

  describe('createSQLiteAdapter', () => {
    it('should create SQLite adapter with custom path', async () => {
      const schemaDir = __dirname;
      const adapter = await createSQLiteAdapter(testDbPath4, schemaDir);

      expect(adapter).toBeDefined();

      // Test basic database operations
      const munis = await adapter.listMunicipalities(10, 0);
      expect(Array.isArray(munis)).toBe(true);

      await adapter.close();
    });

    it('should initialize schema on creation', async () => {
      const schemaDir = __dirname;
      const adapter = await createSQLiteAdapter(testDbPath5, schemaDir);

      // Schema should be initialized - test by inserting a municipality
      await adapter.insertMunicipality({
        id: 'test-city',
        name: 'Test City',
        state: 'TS',
        fips_place: '12345',
        population: 100000,
        county_fips: '67890',
      });

      const muni = await adapter.getMunicipality('test-city');
      expect(muni).toBeDefined();
      expect(muni?.name).toBe('Test City');

      await adapter.close();
    });
  });
});
