/**
 * Vitest Configuration for Shadow Atlas
 *
 * 3-TIER TEST ARCHITECTURE:
 * - Unit: Fast, mocked, always run
 * - Integration: Medium speed, conditional real APIs, skip in CI by default
 * - E2E: Slow, real APIs, nightly only
 *
 * ENVIRONMENT VARIABLES:
 * - CI=true: Running in CI environment
 * - RUN_E2E=true: Enable E2E tests (nightly job)
 * - RUN_INTEGRATION=false: Skip integration tests (rarely needed)
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      'services/shadow-atlas/**/*.test.ts',
      'services/shadow-atlas/__tests__/**/*.test.ts',
    ],

    // Exclude E2E tests by default (run with RUN_E2E=true)
    exclude: [
      'node_modules/**',
      'dist/**',
      // E2E tests excluded unless RUN_E2E=true
      ...(process.env.RUN_E2E !== 'true' ? ['services/shadow-atlas/__tests__/e2e/**'] : []),
    ],

    // Global setup
    setupFiles: ['services/shadow-atlas/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded for deterministic WASM behavior

    // Timeouts
    testTimeout: 120_000, // 120 seconds (2 minutes) for large dataset tests
    hookTimeout: 30_000, // 30 seconds for beforeAll/afterAll hooks

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['services/shadow-atlas/**/*.ts'],
      exclude: [
        'services/shadow-atlas/**/*.test.ts',
        'services/shadow-atlas/__tests__/**',
        'services/shadow-atlas/scripts/**',
      ],
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json'] : ['verbose'],

    // Globals
    globals: true,
  },
});
