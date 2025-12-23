/**
 * Vitest Configuration for Performance Tests
 *
 * SCOPE: Performance benchmarks, load tests, memory profiling
 *
 * TARGET: Validate performance budgets
 *
 * USAGE: npm run test:performance
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns - performance tests only
    include: ['src/__tests__/performance/**/*.test.ts'],

    // Exclude all other tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/unit/**',
      'src/__tests__/integration/**',
      'src/__tests__/e2e/**',
    ],

    // Global setup
    setupFiles: ['src/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded for accurate performance measurement
    isolate: true, // Isolate each test to prevent interference
    pool: 'forks', // Use process forking for memory isolation

    // Timeouts (very generous for performance tests)
    testTimeout: 300_000, // 5 minutes per test
    hookTimeout: 60_000, // 1 minute for hooks

    // Coverage (not applicable for performance tests)
    coverage: {
      enabled: false,
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json'] : ['verbose'],
    outputFile: {
      json: './test-results/performance-results.json',
    },

    // Globals
    globals: true,

    // Environment
    environment: 'node',

    // No retries for performance tests (deterministic)
    retry: 0,

    // Benchmark configuration
    benchmark: {
      include: ['src/__tests__/performance/**/*.bench.ts'],
      reporters: ['verbose'],
      outputFile: './test-results/benchmark-results.json',
    },
  },
});
