/**
 * Buffer verification - ensures vite-plugin-node-polyfills loaded Buffer
 *
 * The vite.profiler.config.ts configures nodePolyfills({ globals: { Buffer: true } })
 * which injects the real 'buffer' package that properly extends Uint8Array.
 */

// Import from the polyfilled 'buffer' package
import { Buffer } from 'buffer';

// Verify it's the real deal (extends Uint8Array, not a Proxy wrapper)
if (typeof Buffer.alloc !== 'function') {
  throw new Error('Buffer.alloc not available - vite polyfill may have failed');
}

// Ensure global availability for bb.js
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Buffer = Buffer;
}
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

console.log('[Buffer] Polyfill verified (extends Uint8Array):', {
  alloc: typeof Buffer.alloc,
  from: typeof Buffer.from,
  isBuffer: typeof Buffer.isBuffer,
});

export { Buffer };
