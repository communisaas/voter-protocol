import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable global setup - each test file initializes WASM independently in beforeAll()
    // This avoids race conditions between module loading and WAS init
    // setupFiles: ['./vitest.setup.ts'],

    // Use single-threaded execution for deterministic WASM behavior
    threads: false,

    // Increase timeout for tests that load large datasets (e.g., Census TIGER/Line GeoJSON)
    // First load: ~30-60s to parse 213MB GeoJSON
    // Union computation: ~10-50s per multi-county city (Turf.js processing)
    testTimeout: 120000, // 120 seconds (2 minutes)
  },
});
