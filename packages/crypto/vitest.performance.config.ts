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
    include: ['services/shadow-atlas/__tests__/performance/**/*.test.ts'],

    // Exclude all other tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'services/shadow-atlas/__tests__/unit/**',
      'services/shadow-atlas/__tests__/integration/**',
      'services/shadow-atlas/__tests__/e2e/**',
    ],

    // Global setup
    setupFiles: ['services/shadow-atlas/__tests__/setup.ts'],

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
      include: ['services/shadow-atlas/__tests__/performance/**/*.bench.ts'],
      reporters: ['verbose'],
      outputFile: './test-results/benchmark-results.json',
    },
  },
});
