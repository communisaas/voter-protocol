/**
 * Fleek Pinning Service
 *
 * Implementation of IPinningService for Fleek.co.
 * IPFS + Filecoin storage with global CDN edge caching.
 *
 * FLEEK FEATURES:
 * - IPFS with Filecoin backing
 * - Global edge CDN
 * - Dedicated gateways
 * - Free tier: 3GB, 50k gateway requests/day
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { IPinningService } from '../regional-pinning-service.js';
import type {
  Region,
  PinningServiceType,
  PinResult,
} from '../types.js';

/**
 * Fleek client configuration
 */
export interface FleekConfig {
  /** Fleek Storage API key */
  readonly apiKey: string;

  /** Fleek Storage API secret */
  readonly apiSecret: string;

  /** Region for this service instance */
  readonly region: Region;

  /** Custom gateway URL (optional, uses Fleek gateway by default) */
  readonly gatewayUrl?: string;

  /** Timeout in ms for upload operations */
  readonly timeoutMs?: number;

  /** Bucket name for storage (optional) */
  readonly bucket?: string;
}

/**
 * Fleek API response types
 */
interface FleekUploadResponse {
  readonly hash: string;
  readonly hashV0: string;
  readonly key: string;
  readonly publicUrl: string;
  readonly size: number;
}

/**
 * Fleek Pinning Service
 *
 * Implements IPinningService using Fleek Storage API.
 */
export class FleekPinningService implements IPinningService {
  readonly type: PinningServiceType = 'fleek';
  readonly region: Region;

  private readonly config: FleekConfig;
  private readonly apiEndpoint = 'https://api.fleek.co';
  private readonly timeoutMs: number;
  private readonly gatewayUrl: string;

  constructor(config: FleekConfig) {
    this.config = config;
    this.region = config.region;
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.gatewayUrl = config.gatewayUrl ?? 'https://ipfs.fleek.co';
  }

  /**
   * Get authorization headers for Fleek API
   */
  private getAuthHeaders(): Record<string, string> {
    // Fleek uses Basic auth with apiKey:apiSecret
    const credentials = Buffer.from(
      `${this.config.apiKey}:${this.config.apiSecret}`
    ).toString('base64');

    return {
      'Authorization': `Basic ${credentials}`,
    };
  }

  /**
   * Pin content to Fleek
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
      // Convert to Blob, handling ArrayBuffer/SharedArrayBuffer distinction
      let blob: Blob;
      if (content instanceof Blob) {
        blob = content;
      } else {
        // Create a copy as ArrayBuffer (not SharedArrayBuffer) for Blob compatibility
        const copy = new Uint8Array(content);
        blob = new Blob([copy], { type: 'application/octet-stream' });
      }

      // Fleek uses a different upload endpoint
      const formData = new FormData();
      const filename = options?.name ?? `shadow-atlas-${Date.now()}.json`;
      formData.append('file', blob, filename);

      // Add bucket if configured
      if (this.config.bucket) {
        formData.append('bucket', this.config.bucket);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.apiEndpoint}/storage/upload`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Fleek upload failed: ${response.status} ${errorText}`);
        }

        const result = await response.json() as FleekUploadResponse;
        const durationMs = Date.now() - startTime;

        return {
          success: true,
          cid: result.hash, // CIDv1
          service: this.type,
          region: this.region,
          pinnedAt: new Date(),
          sizeBytes: result.size,
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
   * Verify pin exists on Fleek
   *
   * Checks via the Fleek gateway.
   */
  async verify(cid: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.gatewayUrl}/ipfs/${cid}`,
        {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Unpin content from Fleek
   */
  async unpin(cid: string): Promise<void> {
    const response = await fetch(
      `${this.apiEndpoint}/storage/pin/${cid}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fleek unpin failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * Health check for Fleek
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check Fleek API availability
      const response = await fetch(
        `${this.apiEndpoint}/status`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    return `${this.gatewayUrl}/ipfs/${cid}`;
  }
}

/**
 * Create Fleek pinning service from environment variables
 */
export function createFleekPinningService(
  region: Region,
  options?: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly gatewayUrl?: string;
    readonly bucket?: string;
    readonly timeoutMs?: number;
  }
): FleekPinningService {
  const apiKey = options?.apiKey ?? process.env['FLEEK_API_KEY'] ?? '';
  const apiSecret = options?.apiSecret ?? process.env['FLEEK_API_SECRET'] ?? '';

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Fleek configuration missing. Set FLEEK_API_KEY and FLEEK_API_SECRET environment variables.'
    );
  }

  return new FleekPinningService({
    apiKey,
    apiSecret,
    region,
    gatewayUrl: options?.gatewayUrl,
    bucket: options?.bucket,
    timeoutMs: options?.timeoutMs,
  });
}
