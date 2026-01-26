/**
 * Global polyfills for browser
 * Injected into esbuild pre-bundling via optimizeDeps.esbuildOptions.inject
 */

import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;
globalThis.process = globalThis.process || { env: {} };
