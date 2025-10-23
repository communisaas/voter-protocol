/**
 * Key Derivation Functions for VOTER Protocol
 *
 * Provides wallet-compatible and password-based key derivation:
 * - HKDF from NEAR wallet signatures (primary method)
 * - PBKDF2 from passwords (fallback for non-wallet users)
 */

import { hkdf } from '@noble/hashes/hkdf';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

// OWASP 2023 recommendation: 600,000 iterations for PBKDF2-SHA256
const PBKDF2_ITERATIONS = 600_000;

// Purpose strings for domain separation
const PURPOSES = {
  SOVEREIGN_KEY: 'voter-protocol-sovereign-key-v1',
  ACCOUNT_KEY: 'voter-protocol-account-key-v1',
} as const;

export interface WalletKeyDerivation {
  signature: Uint8Array;  // 64 bytes (NEAR ed25519 signature)
  accountId: string;      // NEAR account ID (64-char hex for implicit accounts)
  purpose: string;        // Domain separation string
}

export interface PasswordKeyDerivation {
  password: string;
  accountId: string;
  salt?: Uint8Array;      // Optional custom salt (32 bytes recommended)
  purpose: string;
}

/**
 * Derive sovereign key from NEAR wallet signature using HKDF
 *
 * This is the PRIMARY key derivation method. Uses high-entropy wallet
 * signatures instead of passwords.
 *
 * @param params - Wallet signature and account binding
 * @returns 32-byte sovereign encryption key
 *
 * @example
 * ```typescript
 * const signature = await nearWallet.signMessage('voter-protocol-kdf');
 * const sovereignKey = deriveKeyFromWallet({
 *   signature: new Uint8Array(signature),
 *   accountId: 'a96ad3cb539b...ee1c58d3',
 *   purpose: 'voter-protocol-sovereign-key-v1'
 * });
 * ```
 */
export function deriveKeyFromWallet(params: WalletKeyDerivation): Uint8Array {
  const { signature, accountId, purpose } = params;

  // Validate inputs
  if (signature.length !== 64) {
    throw new Error('NEAR ed25519 signature must be 64 bytes');
  }
  if (!accountId || accountId.length === 0) {
    throw new Error('Account ID is required for key derivation');
  }

  // Info: purpose + accountId for domain separation
  const info = new TextEncoder().encode(`${purpose}:${accountId}`);

  // HKDF-SHA256: signature as input key material, no salt (signature is high-entropy)
  const derivedKey = hkdf(sha256, signature, undefined, info, 32);

  return derivedKey;
}

/**
 * Derive sovereign key from NEAR wallet for encryption (convenience wrapper)
 *
 * @param signature - NEAR ed25519 signature (64 bytes)
 * @param accountId - NEAR implicit account ID
 * @returns 32-byte sovereign key for XChaCha20-Poly1305
 */
export function deriveSovereignKey(signature: Uint8Array, accountId: string): Uint8Array {
  return deriveKeyFromWallet({
    signature,
    accountId,
    purpose: PURPOSES.SOVEREIGN_KEY,
  });
}

/**
 * Derive account key from NEAR wallet for AES-GCM sovereign key encryption
 *
 * @param signature - NEAR ed25519 signature (64 bytes)
 * @param accountId - NEAR implicit account ID
 * @returns 32-byte account key for AES-256-GCM
 */
export function deriveAccountKey(signature: Uint8Array, accountId: string): Uint8Array {
  return deriveKeyFromWallet({
    signature,
    accountId,
    purpose: PURPOSES.ACCOUNT_KEY,
  });
}

/**
 * Derive key from password using PBKDF2 (FALLBACK METHOD)
 *
 * Use this ONLY when wallet signatures are not available.
 * PBKDF2 with 600k iterations provides reasonable security but is
 * slower and less entropy than wallet signatures.
 *
 * @param params - Password and account binding
 * @returns 32-byte encryption key
 *
 * @example
 * ```typescript
 * const sovereignKey = deriveKeyFromPassword({
 *   password: 'user-provided-strong-password',
 *   accountId: 'a96ad3cb539b...ee1c58d3',
 *   purpose: 'voter-protocol-sovereign-key-v1'
 * });
 * ```
 */
export function deriveKeyFromPassword(params: PasswordKeyDerivation): Uint8Array {
  const { password, accountId, salt, purpose } = params;

  // Validate inputs
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (!accountId || accountId.length === 0) {
    throw new Error('Account ID is required for key derivation');
  }

  // Use custom salt or derive from accountId + purpose
  const derivedSalt = salt || sha256(new TextEncoder().encode(`${purpose}:${accountId}`));

  // PBKDF2-SHA256 with 600k iterations (OWASP 2023)
  const derivedKey = pbkdf2(sha256, password, derivedSalt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });

  return derivedKey;
}

/**
 * Securely wipe a key from memory
 *
 * @param key - Key to wipe (will be zeroed out)
 */
export function wipeKey(key: Uint8Array): void {
  key.fill(0);
}
