/**
 * Pinata Pinning Service
 *
 * Implementation of IPinningService for Pinata Cloud.
 * Industry-standard IPFS pinning with global CDN.
 *
 * PINATA FEATURES:
 * - Dedicated IPFS gateway with CDN
 * - Pin by CID or upload content
 * - Submarine (private) pinning support
 * - Free tier: 1GB, 500 uploads/day
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
 * Pinata client configuration
 */
export interface PinataConfig {
  /** Pinata JWT (preferred) or API key */
  readonly jwt?: string;

  /** Legacy API key (if JWT not provided) */
  readonly apiKey?: string;

  /** Legacy API secret (if JWT not provided) */
  readonly apiSecret?: string;

  /** Region for this service instance */
  readonly region: Region;

  /** Custom gateway URL (optional) */
  readonly gatewayUrl?: string;

  /** Timeout in ms for upload operations */
  readonly timeoutMs?: number;
}

/**
 * Pinata API response types
 */
interface PinataUploadResponse {
  readonly IpfsHash: string;
  readonly PinSize: number;
  readonly Timestamp: string;
}

interface PinataPinListResponse {
  readonly rows: readonly {
    readonly ipfs_pin_hash: string;
    readonly date_pinned: string;
  }[];
}

/**
 * Pinata Pinning Service
 *
 * Implements IPinningService using Pinata REST API.
 */
export class PinataPinningService implements IPinningService {
  readonly type: PinningServiceType = 'pinata';
  readonly region: Region;

  private readonly config: PinataConfig;
  private readonly apiEndpoint = 'https://api.pinata.cloud';
  private readonly timeoutMs: number;
  private readonly gatewayUrl: string;

  constructor(config: PinataConfig) {
    this.config = config;
    this.region = config.region;
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.gatewayUrl = config.gatewayUrl ?? 'https://gateway.pinata.cloud';
  }

  /**
   * Get authorization headers for Pinata API
   */
  private getAuthHeaders(): Record<string, string> {
    if (this.config.jwt) {
      return {
        'Authorization': `Bearer ${this.config.jwt}`,
      };
    }

    if (this.config.apiKey && this.config.apiSecret) {
      return {
        'pinata_api_key': this.config.apiKey,
        'pinata_secret_api_key': this.config.apiSecret,
      };
    }

    throw new Error('Pinata authentication not configured. Provide JWT or API key/secret.');
  }

  /**
   * Pin content to Pinata
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

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', blob, options?.name ?? 'shadow-atlas.json');

      // Add pinata metadata if provided
      if (options?.metadata || options?.name) {
        const pinataMetadata = {
          name: options?.name ?? 'shadow-atlas',
          keyvalues: options?.metadata ?? {},
        };
        formData.append('pinataMetadata', JSON.stringify(pinataMetadata));
      }

      // Add pinata options
      const pinataOptions = {
        cidVersion: 1, // Use CIDv1 for better compatibility
      };
      formData.append('pinataOptions', JSON.stringify(pinataOptions));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.apiEndpoint}/pinning/pinFileToIPFS`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Pinata upload failed: ${response.status} ${errorText}`);
        }

        const result = await response.json() as PinataUploadResponse;
        const durationMs = Date.now() - startTime;

        return {
          success: true,
          cid: result.IpfsHash,
          service: this.type,
          region: this.region,
          pinnedAt: new Date(result.Timestamp),
          sizeBytes: result.PinSize,
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
   * Verify pin exists on Pinata
   */
  async verify(cid: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiEndpoint}/data/pinList?hashContains=${cid}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        return false;
      }

      const result = await response.json() as PinataPinListResponse;
      return result.rows.some(row => row.ipfs_pin_hash === cid);
    } catch {
      return false;
    }
  }

  /**
   * Unpin content from Pinata
   */
  async unpin(cid: string): Promise<void> {
    const response = await fetch(
      `${this.apiEndpoint}/pinning/unpin/${cid}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata unpin failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * Health check for Pinata
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiEndpoint}/data/testAuthentication`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
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
 * Create Pinata pinning service from environment variables
 */
export function createPinataPinningService(
  region: Region,
  options?: {
    readonly jwt?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly gatewayUrl?: string;
    readonly timeoutMs?: number;
  }
): PinataPinningService {
  const jwt = options?.jwt ?? process.env['PINATA_JWT'];
  const apiKey = options?.apiKey ?? process.env['PINATA_API_KEY'];
  const apiSecret = options?.apiSecret ?? process.env['PINATA_API_SECRET'];

  if (!jwt && (!apiKey || !apiSecret)) {
    throw new Error(
      'Pinata configuration missing. Set PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET environment variables.'
    );
  }

  return new PinataPinningService({
    jwt,
    apiKey,
    apiSecret,
    region,
    gatewayUrl: options?.gatewayUrl,
    timeoutMs: options?.timeoutMs,
  });
}
