/**
 * Cross-Origin Isolation Test
 * 
 * This script tests if the browser environment has the required headers
 * for SharedArrayBuffer (required by bb.js threaded WASM).
 * 
 * Required Headers:
 * - Cross-Origin-Opener-Policy: same-origin
 * - Cross-Origin-Embedder-Policy: require-corp (or credentialless)
 * 
 * Usage:
 * 1. Include this script in your HTML
 * 2. Check console for isolation status
 * 3. Call window.checkCrossOriginIsolation() for programmatic check
 */

export function checkCrossOriginIsolation(): {
    isolated: boolean;
    sharedArrayBufferAvailable: boolean;
    headers: {
        coop: string | null;
        coep: string | null;
    };
    message: string;
} {
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const sharedArrayBufferAvailable = typeof SharedArrayBuffer !== 'undefined';

    // Try to detect headers (only works in some contexts)
    let coop: string | null = null;
    let coep: string | null = null;

    // These are set by the server, we can't directly read them in JS
    // But we can infer from crossOriginIsolated

    let message: string;

    if (isolated && sharedArrayBufferAvailable) {
        message = '✅ Cross-origin isolated. Ready for ZK proving.';
    } else if (!sharedArrayBufferAvailable) {
        message = '❌ SharedArrayBuffer not available. ZK proving will fail.';
    } else {
        message = '⚠️ Not cross-origin isolated. Need COOP/COEP headers.';
    }

    return {
        isolated,
        sharedArrayBufferAvailable,
        headers: { coop, coep },
        message,
    };
}

/**
 * Verify headers and fail fast if not isolated.
 * Call this before initializing NoirProver.
 */
export function requireCrossOriginIsolation(): void {
    const result = checkCrossOriginIsolation();

    if (!result.isolated) {
        console.error(`
╔═══════════════════════════════════════════════════════════════════════╗
║                    CROSS-ORIGIN ISOLATION REQUIRED                    ║
╠═══════════════════════════════════════════════════════════════════════╣
║ ZK proving requires SharedArrayBuffer which needs:                    ║
║                                                                       ║
║   Cross-Origin-Opener-Policy: same-origin                            ║
║   Cross-Origin-Embedder-Policy: require-corp                         ║
║                                                                       ║
║ Add these headers to your server response.                           ║
║                                                                       ║
║ For development:                                                      ║
║   - Vite: Use vite-plugin-cross-origin-isolation                     ║
║   - Next.js: Add headers in next.config.js                          ║
║   - Express: app.use((req, res, next) => { ... })                   ║
╚═══════════════════════════════════════════════════════════════════════╝
        `);
        throw new Error('Cross-origin isolation required for ZK proving');
    }

    console.log(result.message);
}

// Auto-check on module load if in browser
if (typeof window !== 'undefined') {
    const result = checkCrossOriginIsolation();
    console.log('[CrossOriginIsolation]', result.message);

    // Expose globally for debugging
    (window as any).checkCrossOriginIsolation = checkCrossOriginIsolation;
}
