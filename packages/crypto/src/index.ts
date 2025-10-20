/**
 * VOTER Protocol Crypto SDK
 *
 * Client-side cryptography library providing:
 * - Multi-stage compression (90% cost reduction)
 * - Authenticated encryption (XChaCha20-Poly1305 + AES-256-GCM)
 * - Wallet-compatible key derivation (HKDF + PBKDF2)
 * - ZK-friendly commitments (Poseidon)
 *
 * @packageDocumentation
 */

// Key Derivation Functions
export {
  deriveKeyFromWallet,
  deriveSovereignKey,
  deriveAccountKey,
  deriveKeyFromPassword,
  wipeKey,
  type WalletKeyDerivation,
  type PasswordKeyDerivation,
} from './kdf.js';

// Compression
export {
  compressPII,
  decompressPII,
  trainPIIDictionary,
  loadDictionary,
  compressionRatio,
  calculateSavings,
  type PIIData,
} from './compression.js';

// Encryption
export {
  initCrypto,
  encryptPII,
  decryptPII,
  encryptSovereignKey,
  decryptSovereignKey,
  generateCommitment,
  generateSovereignKey,
  wipeMemory,
  type EncryptionAAD,
  type EncryptedPII,
  type EncryptedSovereignKey,
} from './encryption.js';

/**
 * Complete envelope creation flow
 *
 * Combines compression + encryption for storage-ready envelope.
 *
 * @param pii - PII data to encrypt
 * @param sovereignKey - 32-byte encryption key
 * @param accountId - NEAR account ID for AAD binding
 * @returns Encrypted envelope ready for contract storage
 *
 * @example
 * ```typescript
 * import { createEnvelope, deriveSovereignKey } from '@voter-protocol/crypto';
 *
 * // 1. Derive sovereign key from wallet
 * const signature = await nearWallet.signMessage('voter-protocol-kdf');
 * const sovereignKey = deriveSovereignKey(signature, accountId);
 *
 * // 2. Create encrypted envelope
 * const envelope = await createEnvelope(piiData, sovereignKey, accountId);
 *
 * // 3. Store in contract (envelope is ~500 bytes)
 * await contract.store_envelope({
 *   encrypted_data: Array.from(envelope.ciphertext),
 *   nonce: Array.from(envelope.nonce),
 *   poseidon_commit: envelope.commitment,
 *   // ... sovereign key encryption handled separately
 * });
 * ```
 */
export async function createEnvelope(
  pii: import('./compression.js').PIIData,
  sovereignKey: Uint8Array,
  accountId: string
): Promise<import('./encryption.js').EncryptedPII> {
  const { compressPII } = await import('./compression.js');
  const { encryptPII } = await import('./encryption.js');

  // Stage 1: Compress (2300B → 180B, 92% reduction)
  const compressed = await compressPII(pii);

  // Stage 2: Encrypt with AAD binding (~500B final envelope)
  const encrypted = await encryptPII(compressed, sovereignKey, {
    accountId,
    timestamp: Date.now(),
    version: 'voter-protocol-v1'
  });

  return encrypted;
}

/**
 * Complete envelope opening flow
 *
 * Combines decryption + decompression to retrieve original PII.
 *
 * @param envelope - Encrypted envelope from contract
 * @param sovereignKey - 32-byte decryption key
 * @returns Original PII data
 *
 * @example
 * ```typescript
 * import { openEnvelope, deriveSovereignKey } from '@voter-protocol/crypto';
 *
 * // 1. Derive sovereign key from wallet
 * const signature = await nearWallet.signMessage('voter-protocol-kdf');
 * const sovereignKey = deriveSovereignKey(signature, accountId);
 *
 * // 2. Fetch envelope from contract
 * const envelope = await contract.get_envelope({ owner: accountId });
 *
 * // 3. Decrypt and decompress
 * const pii = await openEnvelope(envelope, sovereignKey);
 * ```
 */
export async function openEnvelope(
  envelope: import('./encryption.js').EncryptedPII,
  sovereignKey: Uint8Array
): Promise<import('./compression.js').PIIData> {
  const { decryptPII } = await import('./encryption.js');
  const { decompressPII } = await import('./compression.js');

  // Stage 1: Decrypt (verifies AAD)
  const compressed = await decryptPII(envelope, sovereignKey);

  // Stage 2: Decompress (180B → 2300B original)
  const pii = await decompressPII(compressed);

  return pii;
}
