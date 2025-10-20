/**
 * Authenticated Encryption for VOTER Protocol
 *
 * Provides client-side encryption with AAD binding:
 * - XChaCha20-Poly1305 for PII (AEAD with 24-byte nonce)
 * - AES-256-GCM for sovereign keys (with explicit IV/tag storage)
 * - Poseidon commitments for ZK integrity
 */

import sodium from 'libsodium-wrappers';
import { poseidon } from 'circomlibjs';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Additional Authenticated Data for envelope binding
 */
export interface EncryptionAAD {
  accountId: string;      // NEAR account ID (prevents reuse across accounts)
  timestamp?: number;     // Optional: Unix timestamp (ms)
  version?: string;       // Optional: Protocol version
}

/**
 * Encrypted PII envelope
 */
export interface EncryptedPII {
  ciphertext: Uint8Array;  // Encrypted + authenticated data
  nonce: Uint8Array;       // 24 bytes (XChaCha20)
  commitment: string;      // Poseidon hash (64 hex chars)
  aad: EncryptionAAD;      // Additional authenticated data
}

/**
 * Encrypted sovereign key envelope (for contract storage)
 */
export interface EncryptedSovereignKey {
  ciphertext: Uint8Array;  // AES-256-GCM encrypted key
  iv: Uint8Array;          // 12 bytes (GCM IV)
  tag: Uint8Array;         // 16 bytes (GCM auth tag)
}

/**
 * Initialize libsodium (call once before using encryption functions)
 */
export async function initCrypto(): Promise<void> {
  await sodium.ready;
}

/**
 * Encrypt PII data with XChaCha20-Poly1305 and AAD binding
 *
 * Uses authenticated encryption with additional data (AEAD) to bind
 * ciphertext to account ID, preventing reuse across accounts.
 *
 * @param data - Compressed PII data (should be compressed first)
 * @param sovereignKey - 32-byte encryption key
 * @param aad - Additional authenticated data for binding
 * @returns Encrypted envelope with nonce and commitment
 *
 * @example
 * ```typescript
 * await initCrypto();
 * const compressed = await compressPII(pii);
 * const sovereignKey = deriveSovereignKey(signature, accountId);
 *
 * const encrypted = await encryptPII(compressed, sovereignKey, {
 *   accountId: 'a96ad3cb539b...ee1c58d3',
 *   timestamp: Date.now(),
 *   version: 'voter-protocol-v1'
 * });
 * ```
 */
export async function encryptPII(
  data: Uint8Array,
  sovereignKey: Uint8Array,
  aad: EncryptionAAD
): Promise<EncryptedPII> {
  await initCrypto();

  // Validate inputs
  if (sovereignKey.length !== 32) {
    throw new Error('Sovereign key must be 32 bytes');
  }
  if (!aad.accountId || aad.accountId.length === 0) {
    throw new Error('Account ID is required in AAD');
  }

  // Generate random nonce (24 bytes for XChaCha20)
  const nonce = sodium.randombytes_buf(24);

  // Encode AAD for authentication
  const aadBytes = new TextEncoder().encode(
    JSON.stringify({
      accountId: aad.accountId,
      ...(aad.timestamp && { timestamp: aad.timestamp }),
      ...(aad.version && { version: aad.version })
    })
  );

  // XChaCha20-Poly1305 encryption with AAD
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    data,
    aadBytes,
    null,  // No secret nonce
    nonce,
    sovereignKey
  );

  // Generate Poseidon commitment for ZK proofs
  const commitment = await generateCommitment(data, nonce, aad.accountId);

  return {
    ciphertext,
    nonce,
    commitment,
    aad
  };
}

/**
 * Decrypt PII data with XChaCha20-Poly1305 and AAD verification
 *
 * Verifies AAD binding and authenticates ciphertext before decryption.
 *
 * @param envelope - Encrypted PII envelope
 * @param sovereignKey - 32-byte decryption key
 * @returns Decompressed PII data
 *
 * @throws Error if authentication fails or AAD doesn't match
 *
 * @example
 * ```typescript
 * const decrypted = await decryptPII(encrypted, sovereignKey);
 * const pii = await decompressPII(decrypted);
 * ```
 */
export async function decryptPII(
  envelope: EncryptedPII,
  sovereignKey: Uint8Array
): Promise<Uint8Array> {
  await initCrypto();

  // Validate inputs
  if (sovereignKey.length !== 32) {
    throw new Error('Sovereign key must be 32 bytes');
  }
  if (envelope.nonce.length !== 24) {
    throw new Error('Nonce must be 24 bytes for XChaCha20');
  }

  // Encode AAD for verification
  const aadBytes = new TextEncoder().encode(
    JSON.stringify({
      accountId: envelope.aad.accountId,
      ...(envelope.aad.timestamp && { timestamp: envelope.aad.timestamp }),
      ...(envelope.aad.version && { version: envelope.aad.version })
    })
  );

  // XChaCha20-Poly1305 decryption with AAD verification
  try {
    const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,  // No secret nonce
      envelope.ciphertext,
      aadBytes,
      envelope.nonce,
      sovereignKey
    );

    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed: invalid key, AAD, or corrupted ciphertext');
  }
}

/**
 * Encrypt sovereign key with AES-256-GCM for contract storage
 *
 * Uses explicit IV and tag storage (Day 2 security fix).
 * The account key should be derived from wallet signature.
 *
 * @param sovereignKey - 32-byte sovereign key to encrypt
 * @param accountKey - 32-byte account key (derived from wallet)
 * @returns Encrypted key with IV and tag
 *
 * @example
 * ```typescript
 * const accountKey = deriveAccountKey(signature, accountId);
 * const encrypted = await encryptSovereignKey(sovereignKey, accountKey);
 * // Store encrypted.ciphertext, encrypted.iv, encrypted.tag in contract
 * ```
 */
export async function encryptSovereignKey(
  sovereignKey: Uint8Array,
  accountKey: Uint8Array
): Promise<EncryptedSovereignKey> {
  await initCrypto();

  // Validate inputs
  if (sovereignKey.length !== 32) {
    throw new Error('Sovereign key must be 32 bytes');
  }
  if (accountKey.length !== 32) {
    throw new Error('Account key must be 32 bytes');
  }

  // Generate random IV (12 bytes for GCM)
  const iv = sodium.randombytes_buf(12);

  // AES-256-GCM encryption (libsodium uses detached tag)
  const result = sodium.crypto_aead_aes256gcm_encrypt_detached(
    sovereignKey,
    null,  // No AAD for sovereign key encryption
    null,  // No secret nonce
    iv,
    accountKey
  );

  return {
    ciphertext: result.ciphertext,
    iv,
    tag: result.mac  // Authentication tag (16 bytes)
  };
}

/**
 * Decrypt sovereign key with AES-256-GCM
 *
 * @param encrypted - Encrypted sovereign key envelope
 * @param accountKey - 32-byte account key (derived from wallet)
 * @returns Decrypted 32-byte sovereign key
 *
 * @throws Error if authentication fails
 *
 * @example
 * ```typescript
 * const accountKey = deriveAccountKey(signature, accountId);
 * const sovereignKey = await decryptSovereignKey(encrypted, accountKey);
 * ```
 */
export async function decryptSovereignKey(
  encrypted: EncryptedSovereignKey,
  accountKey: Uint8Array
): Promise<Uint8Array> {
  await initCrypto();

  // Validate inputs
  if (accountKey.length !== 32) {
    throw new Error('Account key must be 32 bytes');
  }
  if (encrypted.iv.length !== 12) {
    throw new Error('IV must be 12 bytes for AES-256-GCM');
  }
  if (encrypted.tag.length !== 16) {
    throw new Error('Tag must be 16 bytes for AES-256-GCM');
  }

  // AES-256-GCM decryption with tag verification
  try {
    const decrypted = sodium.crypto_aead_aes256gcm_decrypt_detached(
      null,  // No secret nonce
      encrypted.ciphertext,
      encrypted.tag,
      null,  // No AAD
      encrypted.iv,
      accountKey
    );

    return decrypted;
  } catch (error) {
    throw new Error('Sovereign key decryption failed: invalid account key or corrupted data');
  }
}

/**
 * Generate Poseidon commitment for ZK-SNARK integrity
 *
 * Creates a cryptographic commitment to the encrypted data for use
 * in zero-knowledge proofs. NOT a ZK-SNARK itself, just a ZK-friendly hash.
 *
 * @param data - Original (unencrypted) data
 * @param nonce - Encryption nonce
 * @param accountId - NEAR account ID
 * @returns 64-character hex string (32 bytes)
 *
 * @example
 * ```typescript
 * const commitment = await generateCommitment(compressedPII, nonce, accountId);
 * // Store commitment in contract for ZK proof verification
 * ```
 */
export async function generateCommitment(
  data: Uint8Array,
  nonce: Uint8Array,
  accountId: string
): Promise<string> {
  // Hash inputs for Poseidon (requires field elements)
  const dataHash = sha256(data);
  const nonceHash = sha256(nonce);
  const accountHash = sha256(new TextEncoder().encode(accountId));

  // Convert to BigInt field elements for Poseidon
  const dataField = BigInt('0x' + Buffer.from(dataHash).toString('hex'));
  const nonceField = BigInt('0x' + Buffer.from(nonceHash).toString('hex'));
  const accountField = BigInt('0x' + Buffer.from(accountHash).toString('hex'));

  // Poseidon hash (ZK-friendly)
  const commitment = poseidon([dataField, nonceField, accountField]);

  // Convert to 64-char hex string (32 bytes)
  return commitment.toString(16).padStart(64, '0');
}

/**
 * Generate random 32-byte sovereign key
 *
 * @returns Cryptographically secure random 32 bytes
 *
 * @example
 * ```typescript
 * const sovereignKey = await generateSovereignKey();
 * // Use for PII encryption
 * ```
 */
export async function generateSovereignKey(): Promise<Uint8Array> {
  await initCrypto();
  return sodium.randombytes_buf(32);
}

/**
 * Securely wipe sensitive data from memory
 *
 * @param data - Sensitive data to wipe (will be zeroed out)
 */
export function wipeMemory(data: Uint8Array): void {
  data.fill(0);
}
