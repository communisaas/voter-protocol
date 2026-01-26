/**
 * Vite config for running the profiler in dev mode
 *
 * Usage: npm run profile
 *
 * WASM handling:
 * - @aztec/bb.js: Barretenberg WASM for proof generation
 * - @noir-lang/*: Noir WASM for witness generation and ABI encoding
 *
 * These packages use WASM modules that need special handling:
 * 1. Excluded from optimizeDeps to prevent pre-bundling issues
 * 2. vite-plugin-wasm handles async WASM loading
 * 3. top-level-await required for WASM module initialization
 */

import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        process: true,
      },
      // Use full implementations, not browser stubs
      protocolImports: true,
    }),
    wasm(),
    topLevelAwait(),
  ],

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    host: true,
    port: 3333,
  },

  resolve: {
    alias: {
      pino: resolve(__dirname, 'shims/pino.js'),
      // Force Noir packages to use web (browser) builds
      '@noir-lang/acvm_js': '@noir-lang/acvm_js/web/acvm_js.js',
      '@noir-lang/noirc_abi': '@noir-lang/noirc_abi/web/noirc_abi_wasm.js',
    },
  },

  optimizeDeps: {
    // Exclude WASM-heavy packages from pre-bundling
    exclude: [
      '@aztec/bb.js',
      '@noir-lang/noir_js',
      '@noir-lang/acvm_js',
      '@noir-lang/noirc_abi',
    ],
  },

  // Worker configuration for hash.worker.ts
  worker: {
    format: 'es',
    plugins: () => [
      wasm(),
      topLevelAwait(),
    ],
  },

  build: {
    target: 'esnext',
  },
});
