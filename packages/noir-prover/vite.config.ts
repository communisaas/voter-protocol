import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
    plugins: [
        wasm(),
        dts({ insertTypesEntry: true }),
    ],
    define: {
        // Inject Buffer polyfill globally
        'global': 'globalThis',
    },
    resolve: {
        alias: {
            buffer: 'buffer/',
        }
    },
    build: {
        lib: {
            entry: './src/index.ts',
            name: 'NoirProver',
            formats: ['es', 'cjs'],
            fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
        },
        rollupOptions: {
            // Externalize peer dependencies - consumers must provide them
            external: ['@aztec/bb.js', '@noir-lang/noir_js', 'pako'],
        },
        target: 'esnext',
        minify: false,
    },
});
