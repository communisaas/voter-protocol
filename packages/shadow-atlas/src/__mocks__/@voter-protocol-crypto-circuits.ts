/**
 * Mock implementation of @voter-protocol/crypto/circuits for testing
 *
 * CONTEXT: Shadow-atlas tests import hash_pair/hash_single from '@voter-protocol/crypto/circuits',
 * but the actual WASM circuits package isn't built. This mock provides deterministic hash functions
 * for testing purposes.
 *
 * SECURITY: This is a TEST-ONLY mock using keccak256. Production code uses real Poseidon2 circuits.
 * DO NOT use this mock in production code.
 *
 * TYPE SAFETY: Nuclear-level strictness - explicit types, no any, proper validation.
 */

import { keccak256 } from 'ethers';

/**
 * Mock hash_pair function for testing
 *
 * Uses keccak256 for deterministic hashing in tests.
 * Real implementation uses Poseidon2 from Noir circuits.
 *
 * @param left - Left input as hex string (0x-prefixed)
 * @param right - Right input as hex string (0x-prefixed)
 * @returns Hash as hex string (0x-prefixed)
 */
export function hash_pair(left: string, right: string): string {
  validateHexString(left, 'left');
  validateHexString(right, 'right');

  // Normalize to 64-char hex (32 bytes)
  const leftNorm = normalizeHex(left);
  const rightNorm = normalizeHex(right);

  // Concatenate and hash
  const combined = leftNorm + rightNorm.slice(2); // Remove 0x from right
  return keccak256(combined);
}

/**
 * Mock hash_single function for testing
 *
 * Uses keccak256 for deterministic hashing in tests.
 * Real implementation uses Poseidon2 from Noir circuits.
 *
 * @param value - Input as hex string (0x-prefixed)
 * @returns Hash as hex string (0x-prefixed)
 */
export function hash_single(value: string): string {
  validateHexString(value, 'value');

  const normalized = normalizeHex(value);
  return keccak256(normalized);
}

/**
 * Validate hex string format
 *
 * @param value - Hex string to validate
 * @param paramName - Parameter name for error messages
 * @throws Error if invalid hex string
 */
function validateHexString(value: string, paramName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${paramName} must be a string, got ${typeof value}`);
  }

  if (!value.startsWith('0x')) {
    throw new Error(`${paramName} must be 0x-prefixed hex string, got ${value.slice(0, 10)}...`);
  }

  const hexPart = value.slice(2);
  if (hexPart.length === 0) {
    throw new Error(`${paramName} cannot be empty (0x only)`);
  }

  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(`${paramName} contains invalid hex characters: ${value.slice(0, 10)}...`);
  }
}

/**
 * Normalize hex string to 64-char (32 bytes) format
 *
 * @param value - Hex string to normalize
 * @returns 0x-prefixed 64-char hex string
 */
function normalizeHex(value: string): string {
  const hexPart = value.slice(2);
  const padded = hexPart.padStart(64, '0');
  return '0x' + padded;
}
