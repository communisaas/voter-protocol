/**
 * Vitest Configuration for Unit Tests
 *
 * SCOPE: Fast unit tests with all external dependencies mocked
 *
 * TARGET: deterministic CI lane that avoids live network and production-depth
 * cryptographic fixtures.
 *
 * USAGE: npm run test:unit
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns - unit tests only
    // Legacy co-located tests under src/** are not all unit-safe yet; keep this
    // lane scoped to curated unit tests until those files are triaged.
    include: [
      'src/__tests__/unit/**/*.test.ts',
    ],

    // Exclude integration and E2E tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/integration/**',
      'src/__tests__/e2e/**',
      'src/__tests__/performance/**',
      'src/__tests__/manual/**',
      'src/__tests__/regression/**',
      'src/__tests__/unit/integration/**',
      'src/__tests__/unit/providers/cross-validation.test.ts',
      'src/__tests__/unit/providers/state-batch-extractor.test.ts',
      'src/__tests__/unit/root/merkle-tree.test.ts',
      // Exclude files with "integration" or "e2e" in name
      '**/*.integration.test.ts',
      '**/*.e2e.test.ts',
    ],

    // Global setup
    setupFiles: ['src/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded for deterministic behavior
    isolate: true, // Isolate each test file

    // Timeouts (short for unit tests)
    testTimeout: 30_000,
    hookTimeout: 10_000,

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/scripts/**',
        'src/**/*.types.ts',
      ],
      // Strict coverage thresholds for unit tests
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json', 'junit'] : ['verbose'],
    outputFile: {
      json: './test-results/unit-results.json',
      junit: './test-results/unit-results.xml',
    },

    // Globals
    globals: true,

    // Environment
    environment: 'node',

    // Retry flaky tests (unit tests should NOT be flaky)
    retry: 0, // No retries for unit tests - they must be deterministic
  },
});
