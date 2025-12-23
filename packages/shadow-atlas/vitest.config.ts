import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        name: 'shadow-atlas',
        include: ['src/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 30000,
        pool: 'forks',
        globals: true,
    },
    resolve: {
        alias: [
            // Order matters: More specific paths must come first
            {
                // Mock WASM module initialization (more specific - must be first)
                find: '@voter-protocol/crypto/circuits/voter_district_circuit.js',
                replacement: fileURLToPath(
                    new URL('./src/__mocks__/@voter-protocol-crypto-circuits-wasm.ts', import.meta.url)
                ),
            },
            {
                // Mock circuits package for testing (actual WASM circuits not built)
                find: '@voter-protocol/crypto/circuits',
                replacement: fileURLToPath(
                    new URL('./src/__mocks__/@voter-protocol-crypto-circuits.ts', import.meta.url)
                ),
            },
        ],
    },
});
