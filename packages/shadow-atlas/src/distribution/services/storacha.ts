/**
 * Storacha Pinning Service
 *
 * Implementation of IPinningService for Storacha (formerly web3.storage).
 * Uses the w3up-client for Filecoin-backed IPFS storage.
 *
 * STORACHA FEATURES:
 * - Filecoin deal tracking (provable storage)
 * - Content-addressed immutable storage
 * - Free tier: 5GB
 * - Hot cache + cold Filecoin archival
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { IPinningService } from '../regional-pinning-service.js';
import type {
  Region,
  PinningServiceType,
  PinResult,
} from '../types.js';
import { logger } from '../../core/utils/logger.js';

/**
 * Storacha client configuration
 */
export interface StorachaConfig {
  /** Storacha space DID (did:key:...) */
  readonly spaceDid: string;

  /** Agent private key for authentication */
  readonly agentPrivateKey: string;

  /** Optional: proof delegation chain */
  readonly proofChain?: readonly string[];

  /** Region for this service instance */
  readonly region: Region;

  /** Timeout in ms for upload operations */
  readonly timeoutMs?: number;
}

/**
 * Storacha Pinning Service
 *
 * Implements IPinningService using Storacha/web3.storage APIs.
 */
export class StorachaPinningService implements IPinningService {
  readonly type: PinningServiceType = 'storacha';
  readonly region: Region;

  private readonly config: StorachaConfig;
  private readonly timeoutMs: number;

  // Storacha client (lazy initialized)
  private client: unknown = null;

  constructor(config: StorachaConfig) {
    this.config = config;
    this.region = config.region;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /**
   * Initialize Storacha client
   *
   * Uses dynamic import to avoid bundling issues with w3up-client.
   */
  private async getClient(): Promise<{
    uploadBlob: (blob: Blob) => Promise<{ root: { toString: () => string } }>;
  }> {
    if (this.client) {
      return this.client as {
        uploadBlob: (blob: Blob) => Promise<{ root: { toString: () => string } }>;
      };
    }

    // Dynamic import to handle ESM/CJS compatibility
    // In production, would use @web3-storage/w3up-client
    // For now, create a minimal implementation using fetch to the HTTP API
    this.client = await this.createHttpClient();

    return this.client as {
      uploadBlob: (blob: Blob) => Promise<{ root: { toString: () => string } }>;
    };
  }

  /**
   * Create HTTP-based client for Storacha
   *
   * Falls back to HTTP API when w3up-client is not available.
   */
  private async createHttpClient(): Promise<{
    uploadBlob: (blob: Blob) => Promise<{ root: { toString: () => string } }>;
  }> {
    const apiEndpoint = 'https://up.web3.storage';

    return {
      uploadBlob: async (blob: Blob) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(`${apiEndpoint}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.config.agentPrivateKey}`,
              'X-Space-DID': this.config.spaceDid,
              'Content-Type': 'application/octet-stream',
            },
            body: blob,
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Storacha upload failed: ${response.status} ${errorText}`);
          }

          const result = await response.json() as { cid: string };

          return {
            root: {
              toString: () => result.cid,
            },
          };
        } finally {
          clearTimeout(timeoutId);
        }
      },
    };
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
      // Convert Uint8Array to Blob, handling ArrayBuffer/SharedArrayBuffer distinction
      let blob: Blob;
      if (content instanceof Blob) {
        blob = content;
      } else {
        // Create a copy as ArrayBuffer (not SharedArrayBuffer) for Blob compatibility
        const copy = new Uint8Array(content);
        blob = new Blob([copy], { type: 'application/octet-stream' });
      }

      const client = await this.getClient();
      const result = await client.uploadBlob(blob);
      const cid = result.root.toString();

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
   * Verify pin exists on Storacha
   */
  async verify(cid: string): Promise<boolean> {
    try {
      // Check via IPFS gateway
      const gatewayUrl = `https://w3s.link/ipfs/${cid}`;
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
    // Storacha uses CAR-based upload; unpin is handled via space management
    // For now, this is a no-op as content is immutable once uploaded
    logger.warn('Storacha unpin not fully implemented', { cid });
  }

  /**
   * Health check for Storacha
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check Storacha API availability
      const response = await fetch('https://up.web3.storage/version', {
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
 */
export function createStorachaPinningService(
  region: Region,
  options?: {
    readonly spaceDid?: string;
    readonly agentPrivateKey?: string;
    readonly timeoutMs?: number;
  }
): StorachaPinningService {
  const spaceDid = options?.spaceDid ?? process.env['STORACHA_SPACE_DID'] ?? '';
  const agentPrivateKey = options?.agentPrivateKey ?? process.env['STORACHA_AGENT_KEY'] ?? '';

  if (!spaceDid || !agentPrivateKey) {
    throw new Error(
      'Storacha configuration missing. Set STORACHA_SPACE_DID and STORACHA_AGENT_KEY environment variables.'
    );
  }

  return new StorachaPinningService({
    spaceDid,
    agentPrivateKey,
    region,
    timeoutMs: options?.timeoutMs,
  });
}
