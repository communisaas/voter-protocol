/**
 * ServerSigner Tests
 *
 * Tests Ed25519 signing for verifiable solo operator integrity.
 * Covers: key generation, persistence, sign/verify, fingerprints, production guardrails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerSigner } from '../../../serving/signing.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// Unique temp directory per test
function tmpDir(): string {
  return join(tmpdir(), `signing-test-${randomBytes(8).toString('hex')}`);
}

describe('ServerSigner', () => {
  let testDir: string;
  let keyPath: string;

  beforeEach(async () => {
    testDir = tmpDir();
    await fs.mkdir(testDir, { recursive: true });
    keyPath = join(testDir, 'server-signing-key.pem');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch { /* ignore */ }
  });

  describe('init', () => {
    it('generates new key when keyPath does not exist', async () => {
      const signer = await ServerSigner.init(keyPath);
      
      expect(signer.info.publicKey).toBeTruthy();
      expect(signer.info.fingerprint).toHaveLength(16);
      expect(signer.info.loadedAt).toBeGreaterThan(0);
      
      // Verify file was created
      const stat = await fs.stat(keyPath);
      expect(stat.isFile()).toBe(true);
    });

    it('loads existing key when keyPath exists', async () => {
      // First: generate
      const signer1 = await ServerSigner.init(keyPath);
      const fingerprint1 = signer1.info.fingerprint;
      const publicKey1 = signer1.info.publicKey;

      // Second: load
      const signer2 = await ServerSigner.init(keyPath);
      const fingerprint2 = signer2.info.fingerprint;
      const publicKey2 = signer2.info.publicKey;

      // Should be identical
      expect(fingerprint2).toBe(fingerprint1);
      expect(publicKey2).toBe(publicKey1);
    });

    it('creates parent directories if missing', async () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'key.pem');
      const signer = await ServerSigner.init(nestedPath);
      
      expect(signer.info.fingerprint).toBeTruthy();
      const stat = await fs.stat(nestedPath);
      expect(stat.isFile()).toBe(true);
    });

    it('sets file permissions to 0o600 (owner read/write only)', async () => {
      const signer = await ServerSigner.init(keyPath);
      const stat = await fs.stat(keyPath);
      
      // mode & 0o777 extracts permission bits
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('throws in production when keyPath is undefined', async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      await expect(ServerSigner.init()).rejects.toThrow(
        'SIGNING_KEY_PATH must be set in production'
      );

      process.env.NODE_ENV = oldEnv;
    });

    it('generates ephemeral key when keyPath is undefined in non-production', async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const signer = await ServerSigner.init();
      expect(signer.info.publicKey).toBeTruthy();
      expect(signer.info.fingerprint).toHaveLength(16);

      process.env.NODE_ENV = oldEnv;
    });

    it('recovers from malformed PEM by generating new key', async () => {
      // Write garbage to keyPath
      await fs.writeFile(keyPath, 'NOT A VALID PEM FILE\n');

      // Should generate new key instead of crashing
      const signer = await ServerSigner.init(keyPath);
      expect(signer.info.publicKey).toBeTruthy();

      // Should have overwritten the corrupt file
      const content = await fs.readFile(keyPath, 'utf8');
      expect(content).toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('sign/verify', () => {
    it('signs and verifies data successfully', async () => {
      const signer = await ServerSigner.init(keyPath);
      const data = 'hello world';
      
      const sig = signer.sign(data);
      expect(sig).toBeTruthy();
      expect(sig).toHaveLength(128); // 64 bytes = 128 hex chars
      
      const valid = signer.verify(data, sig);
      expect(valid).toBe(true);
    });

    it('rejects signature from different key', async () => {
      const signer1 = await ServerSigner.init(keyPath);
      const signer2 = await ServerSigner.init(); // ephemeral key

      const data = 'test message';
      const sig = signer1.sign(data);

      // signer2 should reject signer1's signature
      const valid = signer2.verify(data, sig);
      expect(valid).toBe(false);
    });

    it('rejects signature with modified data', async () => {
      const signer = await ServerSigner.init(keyPath);
      const data = 'original message';
      const sig = signer.sign(data);

      const valid = signer.verify('modified message', sig);
      expect(valid).toBe(false);
    });

    it('rejects malformed signature hex', async () => {
      const signer = await ServerSigner.init(keyPath);
      const data = 'test';

      // Invalid hex
      expect(signer.verify(data, 'not-hex')).toBe(false);
      // Wrong length
      expect(signer.verify(data, 'aabbcc')).toBe(false);
      // Empty
      expect(signer.verify(data, '')).toBe(false);
    });

    it('produces deterministic signatures (Ed25519)', async () => {
      const signer = await ServerSigner.init(keyPath);
      const data = 'determinism test';

      const sig1 = signer.sign(data);
      const sig2 = signer.sign(data);
      const sig3 = signer.sign(data);

      // Ed25519 is deterministic — same key + data = same signature
      expect(sig1).toBe(sig2);
      expect(sig2).toBe(sig3);
    });

    it('produces different signatures for different data', async () => {
      const signer = await ServerSigner.init(keyPath);

      const sig1 = signer.sign('message A');
      const sig2 = signer.sign('message B');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('fingerprint', () => {
    it('produces consistent fingerprint across reloads', async () => {
      const signer1 = await ServerSigner.init(keyPath);
      const fp1 = signer1.info.fingerprint;

      const signer2 = await ServerSigner.init(keyPath);
      const fp2 = signer2.info.fingerprint;

      expect(fp2).toBe(fp1);
    });

    it('produces 16 hex character fingerprint', async () => {
      const signer = await ServerSigner.init(keyPath);
      const fp = signer.info.fingerprint;

      expect(fp).toHaveLength(16);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces different fingerprints for different keys', async () => {
      const signer1 = await ServerSigner.init(keyPath);
      const signer2 = await ServerSigner.init(); // ephemeral

      expect(signer1.info.fingerprint).not.toBe(signer2.info.fingerprint);
    });
  });

  describe('public key export', () => {
    it('exports public key as 64 hex characters', async () => {
      const signer = await ServerSigner.init(keyPath);
      const pubHex = signer.getPublicKeyHex();

      expect(pubHex).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(pubHex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('exports public key as valid PEM', async () => {
      const signer = await ServerSigner.init(keyPath);
      const pem = signer.getPublicKeyPem();

      expect(pem).toContain('BEGIN PUBLIC KEY');
      expect(pem).toContain('END PUBLIC KEY');
    });

    it('has consistent base64 and hex representations', async () => {
      const signer = await ServerSigner.init(keyPath);
      const b64 = signer.info.publicKey;
      const hex = signer.getPublicKeyHex();

      // Convert base64 -> hex and compare
      const b64ToHex = Buffer.from(b64, 'base64').toString('hex');
      expect(b64ToHex).toBe(hex);
    });

    it('can verify with exported public key', async () => {
      const signer = await ServerSigner.init(keyPath);
      const data = 'external verification test';
      const sig = signer.sign(data);

      // Re-import public key and verify
      const { createPublicKey, verify } = await import('crypto');
      const pem = signer.getPublicKeyPem();
      const pubKey = createPublicKey(pem);

      const sigBuf = Buffer.from(sig, 'hex');
      const valid = verify(null, Buffer.from(data, 'utf8'), pubKey, sigBuf);
      
      expect(valid).toBe(true);
    });
  });

  describe('key persistence round-trip', () => {
    it('survives save/load cycle with signature verification', async () => {
      // Generate and sign
      const signer1 = await ServerSigner.init(keyPath);
      const data = 'persistence test';
      const sig = signer1.sign(data);
      const fingerprint1 = signer1.info.fingerprint;

      // Load from disk
      const signer2 = await ServerSigner.init(keyPath);
      const fingerprint2 = signer2.info.fingerprint;

      // Verify key identity
      expect(fingerprint2).toBe(fingerprint1);
      
      // Verify original signature still valid
      const valid = signer2.verify(data, sig);
      expect(valid).toBe(true);

      // Verify new signatures also work
      const sig2 = signer2.sign(data);
      expect(signer1.verify(data, sig2)).toBe(true);
    });

    it('maintains PEM format integrity', async () => {
      await ServerSigner.init(keyPath);
      const pem = await fs.readFile(keyPath, 'utf8');

      // Check standard PEM structure
      expect(pem).toContain('-----BEGIN PRIVATE KEY-----');
      expect(pem).toContain('-----END PRIVATE KEY-----');
      
      // Base64 content between headers
      const lines = pem.split('\n').filter(l => !l.startsWith('-----'));
      const b64Content = lines.join('');
      expect(b64Content).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('SigningKeyInfo', () => {
    it('contains all required fields', async () => {
      const signer = await ServerSigner.init(keyPath);
      const info = signer.info;

      expect(info.publicKey).toBeTruthy();
      expect(info.fingerprint).toBeTruthy();
      expect(info.loadedAt).toBeGreaterThan(0);
    });

    it('has loadedAt timestamp close to now', async () => {
      const before = Date.now();
      const signer = await ServerSigner.init(keyPath);
      const after = Date.now();

      expect(signer.info.loadedAt).toBeGreaterThanOrEqual(before);
      expect(signer.info.loadedAt).toBeLessThanOrEqual(after);
    });

    it('exposes readonly semantics (TypeScript compile-time)', async () => {
      const signer = await ServerSigner.init(keyPath);
      
      // TypeScript enforces readonly at compile time.
      // At runtime, JavaScript objects are mutable, but the API contract
      // is that info fields should not be modified.
      expect(signer.info).toBeTruthy();
      expect(typeof signer.info.publicKey).toBe('string');
      expect(typeof signer.info.fingerprint).toBe('string');
      expect(typeof signer.info.loadedAt).toBe('number');
    });
  });
});
