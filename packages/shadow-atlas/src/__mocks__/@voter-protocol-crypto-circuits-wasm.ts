/**
 * Mock implementation of @voter-protocol/crypto/circuits/voter_district_circuit.js
 *
 * CONTEXT: Shadow-atlas tests import `init` from the WASM module for initialization,
 * but the actual WASM module isn't built. This mock provides a no-op init function.
 *
 * SECURITY: This is a TEST-ONLY mock. Production code uses real WASM circuits.
 * DO NOT use this mock in production code.
 *
 * TYPE SAFETY: Nuclear-level strictness - explicit types, no any.
 */

/**
 * Mock WASM initialization function
 *
 * In production, this initializes the WASM module.
 * In tests, this is a no-op that returns a resolved promise.
 *
 * @param options - Optional initialization options (ignored in mock)
 * @returns Promise that resolves immediately
 */
export default async function init(
  _options?: { module_or_path?: BufferSource | string }
): Promise<void> {
  // No-op for testing - WASM initialization not needed
  return Promise.resolve();
}
