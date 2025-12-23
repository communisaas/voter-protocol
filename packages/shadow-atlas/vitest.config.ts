import { defineConfig } from 'vitest/config';

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
        alias: {
            '@voter-protocol/crypto/circuits': './node_modules/@voter-protocol/crypto/circuits/pkg/index.js',
        },
    },
});
