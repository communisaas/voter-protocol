/**
 * IPFS Pinning Service Implementations
 *
 * Concrete implementations of IPinningService for major providers:
 * - Pinata - Industry standard CDN
 * - Fleek - IPFS + edge caching
 * - Lighthouse - Filecoin-backed retrieval
 *
 * Each service provides:
 * - pin() - Upload content to IPFS
 * - verify() - Check if CID is pinned
 * - unpin() - Remove pin
 * - healthCheck() - Verify service availability
 *
 * NOTE: IPFS pinning is paused as of 2026-05-02 — R2 carries the production
 * read path. These implementations are preserved for reactivation when IPFS
 * matures. Storacha was removed when its hosted service sunset.
 */

export {
  PinataPinningService,
  createPinataPinningService,
  type PinataConfig,
} from './pinata.js';

export {
  FleekPinningService,
  createFleekPinningService,
  type FleekConfig,
} from './fleek.js';

export {
  LighthousePinningService,
  createLighthousePinningService,
  type LighthouseConfig,
} from './lighthouse.js';

import type { IPinningService } from '../regional-pinning-service.js';
import type { Region, PinningServiceType } from '../types.js';
import { createPinataPinningService } from './pinata.js';
import { createFleekPinningService } from './fleek.js';
import { createLighthousePinningService } from './lighthouse.js';

/**
 * Service factory options
 */
export interface ServiceFactoryOptions {
  readonly pinata?: {
    readonly jwt?: string;
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly fleek?: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly lighthouse?: {
    readonly apiKey?: string;
  };
  readonly timeoutMs?: number;
}

/**
 * Create pinning service by type
 *
 * Factory function to instantiate the appropriate service implementation.
 *
 * @param type - Service type (pinata, fleek, lighthouse)
 * @param region - Geographic region
 * @param options - Service-specific configuration
 * @returns IPinningService instance
 * @throws Error if configuration is missing
 */
export function createPinningService(
  type: PinningServiceType,
  region: Region,
  options: ServiceFactoryOptions = {}
): IPinningService {
  switch (type) {
    case 'pinata':
      return createPinataPinningService(region, {
        jwt: options.pinata?.jwt,
        apiKey: options.pinata?.apiKey,
        apiSecret: options.pinata?.apiSecret,
        timeoutMs: options.timeoutMs,
      });

    case 'fleek':
      return createFleekPinningService(region, {
        apiKey: options.fleek?.apiKey,
        apiSecret: options.fleek?.apiSecret,
        timeoutMs: options.timeoutMs,
      });

    case 'lighthouse':
      return createLighthousePinningService(region, {
        apiKey: options.lighthouse?.apiKey,
        timeoutMs: options.timeoutMs,
      });

    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown pinning service type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Create all configured pinning services for a region
 *
 * Iterates through available configurations and creates services.
 * Skips services without proper configuration (fails gracefully).
 *
 * @param region - Geographic region
 * @param options - Service configurations
 * @returns Array of configured IPinningService instances
 */
export function createConfiguredServices(
  region: Region,
  options: ServiceFactoryOptions = {}
): readonly IPinningService[] {
  const services: IPinningService[] = [];

  // Try to create each service, skip if not configured
  const serviceTypes: PinningServiceType[] = ['lighthouse', 'pinata', 'fleek'];

  for (const type of serviceTypes) {
    try {
      const service = createPinningService(type, region, options);
      services.push(service);
    } catch {
      // Skip services without proper configuration
      // This is expected behavior - not all services will be configured
    }
  }

  return services;
}
