/**
 * Ed25519 Server Signing — Verifiable Solo Operator (Wave 39b)
 *
 * Provides Ed25519 signing for insertion log entries and registration receipts.
 * Uses Node.js built-in crypto (no external dependencies).
 *
 * Key management:
 * - Server generates or loads an Ed25519 keypair at startup
 * - Private key stored at SIGNING_KEY_PATH (PEM format)
 * - Public key exported via GET /v1/signing-key for independent verification
 *
 * Anyone can verify that:
 * 1. Every insertion log entry was signed by this server
 * 2. Registration receipts are authentic (anti-censorship)
 * 3. The log hasn't been tampered with (hash chain + signatures)
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync, KeyObject } from 'crypto';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/** Serializable signing key metadata */
export interface SigningKeyInfo {
  /** Ed25519 public key in base64 (raw 32 bytes) */
  readonly publicKey: string;
  /** Key fingerprint: first 8 hex chars of SHA-256(publicKey) */
  readonly fingerprint: string;
  /** When the key was created/loaded */
  readonly loadedAt: number;
}

/** A signed payload with its Ed25519 signature */
export interface SignedPayload {
  /** The canonical JSON that was signed */
  readonly data: string;
  /** Ed25519 signature in hex */
  readonly sig: string;
}

// ============================================================================
// ServerSigner
// ============================================================================

/**
 * Ed25519 server signer for insertion log integrity and registration receipts.
 *
 * Stateless after initialization — safe to use concurrently.
 */
export class ServerSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly publicKeyRaw: Buffer;
  readonly info: SigningKeyInfo;

  private constructor(privateKey: KeyObject, publicKey: KeyObject) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // Export raw 32-byte public key
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    // Ed25519 SPKI is 44 bytes: 12-byte header + 32-byte key
    this.publicKeyRaw = spki.subarray(spki.length - 32);

    // Compute fingerprint
    const fingerprint = createHash('sha256').update(this.publicKeyRaw).digest('hex').slice(0, 16);

    this.info = {
      publicKey: this.publicKeyRaw.toString('base64'),
      fingerprint,
      loadedAt: Date.now(),
    };
  }

  /**
   * Load or generate an Ed25519 signing keypair.
   *
   * If `keyPath` is provided and exists, loads from PEM file.
   * If `keyPath` is provided but missing, generates a new key and saves it.
   * If `keyPath` is not provided, generates an ephemeral key (lost on restart).
   */
  static async init(keyPath?: string): Promise<ServerSigner> {
    let privateKey: KeyObject;

    if (keyPath) {
      try {
        const pem = await fs.readFile(keyPath, 'utf8');
        privateKey = createPrivateKey(pem);
        logger.info('ServerSigner: loaded existing Ed25519 key', { keyPath });
      } catch {
        // Generate new key and save
        const pair = generateKeyPairSync('ed25519');
        privateKey = pair.privateKey;

        await fs.mkdir(dirname(keyPath), { recursive: true });
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
        await fs.writeFile(keyPath, pem, { mode: 0o600 });

        logger.info('ServerSigner: generated new Ed25519 key', { keyPath });
      }
    } else {
      // W40-004: Fail closed in production — ephemeral keys destroy the integrity chain on restart.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'SIGNING_KEY_PATH must be set in production. ' +
          'Ephemeral signing keys make log signatures unverifiable after restart.',
        );
      }
      const pair = generateKeyPairSync('ed25519');
      privateKey = pair.privateKey;
      logger.warn('ServerSigner: using ephemeral key (no SIGNING_KEY_PATH set)');
    }

    const publicKey = createPublicKey(privateKey);
    const signer = new ServerSigner(privateKey, publicKey);

    logger.info('ServerSigner initialized', {
      fingerprint: signer.info.fingerprint,
      publicKey: signer.info.publicKey,
    });

    return signer;
  }

  /**
   * Sign arbitrary data with Ed25519.
   *
   * @param data - The canonical string to sign (typically JSON)
   * @returns Hex-encoded Ed25519 signature (128 hex chars = 64 bytes)
   */
  sign(data: string): string {
    const signature = sign(null, Buffer.from(data, 'utf8'), this.privateKey);
    return signature.toString('hex');
  }

  /**
   * Verify an Ed25519 signature.
   *
   * @param data - The canonical string that was signed
   * @param sigHex - Hex-encoded signature
   * @returns true if valid
   */
  verify(data: string, sigHex: string): boolean {
    try {
      const signature = Buffer.from(sigHex, 'hex');
      return verify(null, Buffer.from(data, 'utf8'), this.publicKey, signature);
    } catch {
      return false;
    }
  }

  /**
   * Get the public key in PEM format (for /v1/signing-key endpoint).
   */
  getPublicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  }

  /**
   * Get the raw 32-byte public key as hex.
   */
  getPublicKeyHex(): string {
    return this.publicKeyRaw.toString('hex');
  }
}
