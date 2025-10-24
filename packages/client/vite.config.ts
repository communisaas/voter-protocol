import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm(),
    dts({
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VoterClient',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        'ethers',
        'near-api-js',
        '@near-js/accounts',
        '@near-js/biometric-ed25519',
        '@near-js/crypto',
        '@near-js/keystores-browser',
        '@axiom-crypto/halo2-js',
        '@axiom-crypto/halo2-wasm',
        'idb',
        'libsodium-wrappers'
      ]
    },
    target: 'es2022',
    sourcemap: true
  },
  optimizeDeps: {
    exclude: ['@axiom-crypto/halo2-wasm']
  },
  worker: {
    format: 'es'
  }
});
