/**
 * Lighthouse Pinning Service
 *
 * Implementation of IPinningService for Lighthouse (lighthouse.storage).
 * Uses the Lighthouse HTTP API for Filecoin-backed IPFS storage.
 *
 * LIGHTHOUSE FEATURES:
 * - Perpetual storage via Filecoin endowment pool
 * - One-time payment model ($20 for perpetual)
 * - Content-addressed immutable storage
 * - Built-in encryption support (not used here — logs are public)
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

// ============================================================================
// Configuration
// ============================================================================

/** Lighthouse client configuration */
export interface LighthouseConfig {
  /** Lighthouse API key (from lighthouse.storage dashboard) */
  readonly apiKey: string;

  /** Region for this service instance */
  readonly region: Region;

  /** Timeout in ms for upload operations */
  readonly timeoutMs?: number;
}

// ============================================================================
// Lighthouse Pinning Service
// ============================================================================

/**
 * Lighthouse Pinning Service
 *
 * Implements IPinningService using the Lighthouse HTTP API.
 * Provides perpetual storage via Filecoin's endowment pool.
 */
export class LighthousePinningService implements IPinningService {
  readonly type: PinningServiceType = 'lighthouse';
  readonly region: Region;

  private readonly config: LighthouseConfig;
  private readonly timeoutMs: number;
  private readonly apiEndpoint = 'https://node.lighthouse.storage';

  constructor(config: LighthouseConfig) {
    this.config = config;
    this.region = config.region;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /**
   * Pin content to Lighthouse
   *
   * Uses the /api/v0/add endpoint (multipart form upload).
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
      let blob: Blob;
      if (content instanceof Blob) {
        blob = content;
      } else {
        const copy = new Uint8Array(content);
        blob = new Blob([copy], { type: 'application/octet-stream' });
      }

      const formData = new FormData();
      const filename = options?.name ?? 'insertion-log.ndjson';
      formData.append('file', blob, filename);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.apiEndpoint}/api/v0/add`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Lighthouse upload failed: ${response.status} ${errorText}`);
        }

        const result = await response.json() as { Hash: string; Size: string };
        const cid = result.Hash;
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
      } finally {
        clearTimeout(timeoutId);
      }
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
   * Verify pin exists on Lighthouse via IPFS gateway
   */
  async verify(cid: string): Promise<boolean> {
    try {
      const gatewayUrl = `https://gateway.lighthouse.storage/ipfs/${cid}`;
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
   * Unpin content from Lighthouse
   *
   * Note: Lighthouse perpetual storage means content persists
   * even after removal from the user's space.
   */
  async unpin(cid: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiEndpoint}/api/v0/pin/rm?arg=${cid}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        logger.warn('Lighthouse unpin returned non-OK status', {
          cid,
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn('Lighthouse unpin failed', {
        cid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Health check for Lighthouse API
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/v0/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create Lighthouse pinning service from environment variables
 */
export function createLighthousePinningService(
  region: Region,
  options?: {
    readonly apiKey?: string;
    readonly timeoutMs?: number;
  }
): LighthousePinningService {
  const apiKey = options?.apiKey ?? process.env['LIGHTHOUSE_API_KEY'] ?? '';

  if (!apiKey) {
    throw new Error(
      'Lighthouse configuration missing. Set LIGHTHOUSE_API_KEY environment variable.'
    );
  }

  return new LighthousePinningService({
    apiKey,
    region,
    timeoutMs: options?.timeoutMs,
  });
}
