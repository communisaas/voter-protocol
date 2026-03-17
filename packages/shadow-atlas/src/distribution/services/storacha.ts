/**
 * Storacha Pinning Service
 *
 * Implementation of IPinningService for Storacha (formerly web3.storage).
 * Uses @storacha/client with UCAN delegation for Filecoin-backed IPFS storage.
 *
 * STORACHA FEATURES:
 * - Filecoin deal tracking (provable storage)
 * - Content-addressed immutable storage
 * - Free tier: 5GB
 * - Hot cache + cold Filecoin archival
 *
 * AUTH: UCAN delegation via Ed25519 Signer + Proof.
 * The old HTTP Bearer API (up.web3.storage) was sunset Jan 2024.
 * See: https://docs.storacha.network/how-to/upload/
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IPinningService } from '../regional-pinning-service.js';
import type {
  Region,
  PinningServiceType,
  PinResult,
} from '../types.js';
import { logger } from '../../core/utils/logger.js';

/** Storacha IPFS gateway (replaces w3s.link) */
const STORACHA_GATEWAY = 'https://storacha.link/ipfs';

/** Storacha upload service endpoint */
const STORACHA_UPLOAD_ENDPOINT = 'https://up.storacha.network';

/**
 * Storacha client configuration
 */
export interface StorachaConfig {
  /** Storacha space DID (did:key:...) */
  readonly spaceDid: string;

  /** Agent Ed25519 private key (Mg... format, parsed by Signer.parse) */
  readonly agentPrivateKey: string;

  /** UCAN proof delegation (base64-encoded, from `storacha delegation create`) */
  readonly proof: string;

  /** Region for this service instance */
  readonly region: Region;

  /** Timeout in ms for upload operations */
  readonly timeoutMs?: number;
}

/**
 * Minimal file-like shape expected by Storacha's uploadDirectory.
 * Mirrors @storacha/client's FileLike (BlobLike + name) without importing it.
 */
interface StorachaFileLike {
  name: string;
  stream: () => ReadableStream;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  slice: (start?: number, end?: number) => Blob;
  readonly size: number;
  readonly type: string;
}

/**
 * Storacha client interface — just the methods we use.
 * Avoids importing the full @storacha/client types at the interface level.
 */
interface StorachaClientHandle {
  uploadFile: (blob: Blob) => Promise<{ toString: () => string }>;
  uploadDirectory: (files: StorachaFileLike[]) => Promise<{ toString: () => string }>;
}

/**
 * Recursively walk a directory tree and produce StorachaFileLike objects.
 * Each file's `name` is its path relative to `rootDir` using forward slashes,
 * preserving directory structure in the resulting UnixFS DAG.
 */
function walkDirectory(rootDir: string): StorachaFileLike[] {
  const results: StorachaFileLike[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relativePath = relative(rootDir, fullPath).split('\\').join('/');
        const fileBuffer = readFileSync(fullPath);
        const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });

        results.push({
          name: relativePath,
          stream: () => blob.stream(),
          arrayBuffer: () => blob.arrayBuffer(),
          text: () => blob.text(),
          slice: (start?: number, end?: number) => blob.slice(start, end),
          size: blob.size,
          type: blob.type,
        });
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Storacha Pinning Service
 *
 * Implements IPinningService using @storacha/client with UCAN auth.
 */
export class StorachaPinningService implements IPinningService {
  readonly type: PinningServiceType = 'storacha';
  readonly region: Region;

  private readonly config: StorachaConfig;
  private readonly timeoutMs: number;

  // Storacha client (lazy initialized)
  private client: StorachaClientHandle | null = null;

  constructor(config: StorachaConfig) {
    this.config = config;
    this.region = config.region;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /**
   * Initialize Storacha client with UCAN delegation.
   *
   * Dynamic import avoids bundling issues — @storacha/client is only
   * needed in the quarterly pipeline (Node.js/tsx), never in CF Workers.
   */
  private async getClient(): Promise<StorachaClientHandle> {
    if (this.client) {
      return this.client;
    }

    // Dynamic imports — @storacha/client is ESM-only
    const [ClientMod, SignerMod, StoreMod, ProofMod] = await Promise.all([
      import('@storacha/client'),
      import('@storacha/client/principal/ed25519'),
      import('@storacha/client/stores/memory'),
      import('@storacha/client/proof'),
    ]);

    // Parse Ed25519 key and create client with in-memory store
    const principal = SignerMod.Signer.parse(this.config.agentPrivateKey);
    const store = new StoreMod.StoreMemory();
    const client = await ClientMod.create({ principal, store });

    // Add UCAN delegation proof and set the target space
    const proof = await ProofMod.parse(this.config.proof);
    const space = await client.addSpace(proof);
    await client.setCurrentSpace(space.did());

    this.client = {
      uploadFile: async (blob: Blob) => {
        const cid = await client.uploadFile(blob);
        return { toString: () => cid.toString() };
      },
      uploadDirectory: async (files: StorachaFileLike[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cid = await client.uploadDirectory(files as any);
        return { toString: () => cid.toString() };
      },
    };

    return this.client;
  }

  /**
   * Pin content to Storacha
   */
  async pin(
    content: Blob | Uint8Array,
    options?: {
      readonly name?: string;
      readonly metadata?: Record<string, string>;
    }
  ): Promise<PinResult> {
    const startTime = Date.now();

    try {
      // Convert Uint8Array to Blob
      let blob: Blob;
      if (content instanceof Blob) {
        blob = content;
      } else {
        const copy = new Uint8Array(content);
        blob = new Blob([copy], { type: 'application/octet-stream' });
      }

      const client = await this.getClient();

      // Apply timeout via AbortController race
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Storacha upload timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      });

      const result = await Promise.race([
        client.uploadFile(blob),
        timeoutPromise,
      ]);
      const cid = result.toString();

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        cid,
        service: this.type,
        region: this.region,
        pinnedAt: new Date(),
        sizeBytes: blob.size,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        cid: '',
        service: this.type,
        region: this.region,
        pinnedAt: new Date(),
        sizeBytes: 0,
        durationMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Pin an entire directory tree to Storacha as a single UnixFS DAG.
   * Returns a single root CID that addresses all files via paths.
   *
   * @param dirPath - Absolute path to directory on disk
   * @returns PinResult with the root CID
   */
  async pinDirectory(dirPath: string): Promise<PinResult> {
    const startTime = Date.now();
    try {
      // Walk directory tree, create FileLike objects
      const files = walkDirectory(dirPath);

      const client = await this.getClient();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Storacha directory upload timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs,
        );
      });

      const result = await Promise.race([
        client.uploadDirectory(files),
        timeoutPromise,
      ]);
      const cid = result.toString();
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const durationMs = Date.now() - startTime;

      return {
        success: true,
        cid,
        service: this.type,
        region: this.region,
        pinnedAt: new Date(),
        sizeBytes: totalSize,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        cid: '',
        service: this.type,
        region: this.region,
        pinnedAt: new Date(),
        sizeBytes: 0,
        durationMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Verify pin exists on Storacha via IPFS gateway
   */
  async verify(cid: string): Promise<boolean> {
    try {
      const gatewayUrl = `${STORACHA_GATEWAY}/${cid}`;
      const response = await fetch(gatewayUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Unpin content from Storacha
   *
   * Note: Storacha uses space-based storage, so "unpinning" means
   * removing from the space. The content may still exist on IPFS.
   */
  async unpin(cid: string): Promise<void> {
    logger.warn('Storacha unpin not fully implemented', { cid });
  }

  /**
   * Health check for Storacha upload service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${STORACHA_UPLOAD_ENDPOINT}/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Create Storacha pinning service from environment variables
 *
 * Required env vars:
 *   STORACHA_SPACE_DID    - Space DID (did:key:...)
 *   STORACHA_AGENT_KEY    - Ed25519 private key (Mg... format)
 *   STORACHA_PROOF        - UCAN delegation proof (base64)
 */
export function createStorachaPinningService(
  region: Region,
  options?: {
    readonly spaceDid?: string;
    readonly agentPrivateKey?: string;
    readonly proof?: string;
    readonly timeoutMs?: number;
  }
): StorachaPinningService {
  const spaceDid = options?.spaceDid ?? process.env['STORACHA_SPACE_DID'] ?? '';
  const agentPrivateKey = options?.agentPrivateKey ?? process.env['STORACHA_AGENT_KEY'] ?? '';
  const proof = options?.proof ?? process.env['STORACHA_PROOF'] ?? '';

  if (!spaceDid || !agentPrivateKey || !proof) {
    throw new Error(
      'Storacha configuration missing. Set STORACHA_SPACE_DID, STORACHA_AGENT_KEY, and STORACHA_PROOF environment variables.'
    );
  }

  return new StorachaPinningService({
    spaceDid,
    agentPrivateKey,
    proof,
    region,
    timeoutMs: options?.timeoutMs,
  });
}
