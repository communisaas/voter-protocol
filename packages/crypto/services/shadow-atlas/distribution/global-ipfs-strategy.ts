/**
 * Global IPFS Distribution Strategy
 *
 * Production-ready configuration for globally distributed Shadow Atlas Merkle trees.
 * Balances cost, latency, and reliability across three major regions.
 *
 * PERFORMANCE TARGETS:
 * - <100ms lookup latency from any region
 * - 99.9% availability (three-nines SLA)
 * - Graceful degradation on regional failures
 *
 * COST STRUCTURE:
 * - Free tier: Storacha (5GB storage, sufficient for quarterly snapshots)
 * - Paid tier: Pinata ($0.15/GB, for high-traffic scenarios)
 * - Public gateways: Cloudflare, IPFS.io (free retrieval, no SLA)
 */

import type {
  GlobalDistributionConfig,
  RegionConfig,
  PinningServiceConfig,
  RolloutConfig,
  Region,
  PinningServiceType,
} from './types.js';

export type { RegionConfig };

// ============================================================================
// Default Global Distribution Configuration
// ============================================================================

/**
 * Default region configurations
 *
 * Three-tier gateway strategy per region:
 * 1. Regional dedicated gateway (lowest latency)
 * 2. Regional public gateway (medium latency)
 * 3. Global public gateway (fallback)
 */
export const DEFAULT_REGIONS: readonly RegionConfig[] = [
  // Americas - East Coast (Primary for US East, South America)
  {
    region: 'americas-east',
    gateways: [
      'https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.storacha.link/',
      'https://cloudflare-ipfs.com/ipfs/',
      'https://ipfs.io/ipfs/',
    ],
    pinningServices: ['storacha', 'pinata'],
    priority: 0,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc', // IPFS logo
  },

  // Americas - West Coast (Primary for US West, APAC overflow)
  {
    region: 'americas-west',
    gateways: [
      'https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.storacha.link/',
      'https://dweb.link/ipfs/',
      'https://ipfs.io/ipfs/',
    ],
    pinningServices: ['storacha', 'fleek'],
    priority: 0,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc',
  },

  // Europe - Western Europe (Primary for EU, UK, Africa)
  {
    region: 'europe-west',
    gateways: [
      'https://gateway.pinata.cloud/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
      'https://ipfs.io/ipfs/',
    ],
    pinningServices: ['pinata', 'web3storage'],
    priority: 0,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc',
  },

  // Asia-Pacific - East Asia (Primary for China, Japan, Korea)
  {
    region: 'asia-east',
    gateways: [
      'https://dweb.link/ipfs/',
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
    ],
    pinningServices: ['fleek', 'web3storage'],
    priority: 0,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc',
  },

  // Asia-Pacific - Southeast Asia (Primary for Singapore, Indonesia, Thailand)
  {
    region: 'asia-southeast',
    gateways: [
      'https://dweb.link/ipfs/',
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
    ],
    pinningServices: ['fleek', 'storacha'],
    priority: 1,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc',
  },

  // Oceania - Australia/New Zealand
  {
    region: 'oceania',
    gateways: [
      'https://dweb.link/ipfs/',
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
    ],
    pinningServices: ['fleek', 'storacha'],
    priority: 1,
    healthCheckUrl: 'https://ipfs.io/ipfs/QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc',
  },
] as const;

/**
 * Default pinning service configurations
 *
 * Priority order:
 * 1. Storacha (free tier, Filecoin-backed)
 * 2. Pinata (paid, high reliability)
 * 3. Fleek (free/paid, good APAC coverage)
 * 4. web3.storage (free tier, Web3-native)
 */
export const DEFAULT_PINNING_SERVICES: readonly PinningServiceConfig[] = [
  {
    type: 'storacha',
    name: 'Storacha (Web3.Storage)',
    apiEndpoint: 'https://api.storacha.network',
    regions: ['americas-east', 'americas-west', 'europe-west', 'asia-southeast'],
    priority: 0,
    costPerGB: 0, // Free tier: 5GB storage, 5GB egress
    freeTierGB: 5,
  },
  {
    type: 'pinata',
    name: 'Pinata IPFS',
    apiEndpoint: 'https://api.pinata.cloud',
    regions: ['americas-east', 'europe-west'],
    priority: 1,
    costPerGB: 0.15, // $0.15/GB storage + egress
    freeTierGB: 1,
  },
  {
    type: 'fleek',
    name: 'Fleek Storage',
    apiEndpoint: 'https://api.fleek.co',
    regions: ['americas-west', 'asia-east', 'asia-southeast', 'oceania'],
    priority: 2,
    costPerGB: 0.02, // $0.02/GB storage, competitive APAC pricing
    freeTierGB: 10,
  },
  {
    type: 'web3storage',
    name: 'Web3.Storage (Legacy)',
    apiEndpoint: 'https://api.web3.storage',
    regions: ['americas-east', 'europe-west'],
    priority: 3,
    costPerGB: 0, // Free tier (transitioning to Storacha)
    freeTierGB: 5,
  },
] as const;

/**
 * Default rollout configuration
 *
 * Staged rollout strategy:
 * 1. Phase 1 (Americas): Deploy to primary US users first
 * 2. Phase 2 (Europe): Deploy to EU/UK users after validation
 * 3. Phase 3 (Asia-Pacific): Deploy globally after full validation
 *
 * Each phase includes verification before proceeding to next phase.
 */
export const DEFAULT_ROLLOUT: RolloutConfig = {
  strategy: 'quarterly',
  phases: [
    {
      phase: 1,
      regions: ['americas-east', 'americas-west'],
      delayMs: 0, // Start immediately
      verifyReplication: true,
    },
    {
      phase: 2,
      regions: ['europe-west'],
      delayMs: 300_000, // 5 minutes after Phase 1
      verifyReplication: true,
    },
    {
      phase: 3,
      regions: ['asia-east', 'asia-southeast', 'oceania'],
      delayMs: 600_000, // 10 minutes after Phase 1
      verifyReplication: true,
    },
  ],
  rollbackOnFailure: true,
  maxFailuresPerPhase: 1, // Rollback if any phase fails
};

/**
 * Default global distribution configuration
 *
 * Production-ready settings:
 * - 3x replication factor (99.9% availability)
 * - Quarterly update strategy (aligned with Shadow Atlas refresh cycle)
 * - Health checks every 5 minutes
 * - Aggressive latency targets (<100ms)
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalDistributionConfig = {
  regions: DEFAULT_REGIONS,
  pinningServices: DEFAULT_PINNING_SERVICES,
  replicationFactor: 3, // 3 copies per region minimum
  updateStrategy: 'quarterly',
  rollout: DEFAULT_ROLLOUT,
  healthCheck: {
    intervalMs: 300_000, // 5 minutes
    timeoutMs: 10_000, // 10 seconds
    retries: 3,
  },
  monitoring: {
    enabled: true,
    alertThresholds: {
      availabilityPercent: 99.9, // Alert if availability drops below 99.9%
      latencyMs: 100, // Alert if p95 latency exceeds 100ms
      failureRate: 0.01, // Alert if failure rate exceeds 1%
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get region by geographic location
 *
 * Simple geo-mapping based on ISO 3166-1 country codes.
 * Used for gateway selection optimization.
 */
export function getRegionForCountry(countryCode: string): Region {
  const countryToRegion: Record<string, Region> = {
    // Americas - East
    US: 'americas-east',
    CA: 'americas-east',
    MX: 'americas-east',
    BR: 'americas-east',
    AR: 'americas-east',
    CL: 'americas-east',

    // Europe - West
    GB: 'europe-west',
    FR: 'europe-west',
    DE: 'europe-west',
    IT: 'europe-west',
    ES: 'europe-west',
    NL: 'europe-west',
    SE: 'europe-west',
    NO: 'europe-west',
    DK: 'europe-west',
    FI: 'europe-west',
    IE: 'europe-west',
    PT: 'europe-west',
    CH: 'europe-west',
    AT: 'europe-west',
    BE: 'europe-west',

    // Asia - East
    CN: 'asia-east',
    JP: 'asia-east',
    KR: 'asia-east',
    TW: 'asia-east',
    HK: 'asia-east',

    // Asia - Southeast
    SG: 'asia-southeast',
    MY: 'asia-southeast',
    ID: 'asia-southeast',
    TH: 'asia-southeast',
    VN: 'asia-southeast',
    PH: 'asia-southeast',

    // Oceania
    AU: 'oceania',
    NZ: 'oceania',
  };

  return countryToRegion[countryCode.toUpperCase()] ?? 'americas-east'; // Default to Americas
}

/**
 * Get optimal gateway for region
 *
 * Returns fastest gateway for a given region based on priority and health.
 */
export function getOptimalGateway(region: Region): string {
  const regionConfig = DEFAULT_REGIONS.find(r => r.region === region);
  if (!regionConfig) {
    // Fallback to global gateway
    return 'https://ipfs.io/ipfs/';
  }

  // Return first gateway (highest priority)
  return regionConfig.gateways[0];
}

/**
 * Get pinning services for region
 *
 * Returns all pinning services available in a region, sorted by priority.
 */
export function getPinningServicesForRegion(region: Region): readonly PinningServiceConfig[] {
  return DEFAULT_PINNING_SERVICES
    .filter(service => service.regions.includes(region))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Estimate monthly cost for global distribution
 *
 * @param snapshotSizeMB - Size of quarterly snapshot in MB
 * @param monthlyRequests - Estimated monthly requests per snapshot
 * @param replicationFactor - Number of replicas per region
 * @returns Estimated monthly cost in USD
 */
export function estimateMonthlyCost(
  snapshotSizeMB: number,
  monthlyRequests: number,
  replicationFactor: number
): {
  readonly storageCost: number;
  readonly egressCost: number;
  readonly totalCost: number;
  readonly breakdown: ReadonlyMap<PinningServiceType, number>;
} {
  const snapshotSizeGB = snapshotSizeMB / 1024;
  const monthlyEgressGB = (snapshotSizeMB * monthlyRequests) / 1024;

  let storageCost = 0;
  let egressCost = 0;
  const breakdown = new Map<PinningServiceType, number>();

  // Calculate per-service costs (simplified: assume even distribution)
  const serviceCount = DEFAULT_PINNING_SERVICES.length;
  const storagePerService = (snapshotSizeGB * replicationFactor) / serviceCount;
  const egressPerService = monthlyEgressGB / serviceCount;

  for (const service of DEFAULT_PINNING_SERVICES) {
    // Calculate storage cost
    const storageOverage = Math.max(0, storagePerService - service.freeTierGB);
    const serviceCost = storageOverage * service.costPerGB;

    // Add egress cost (assuming same rate as storage for simplicity)
    const egressOverage = Math.max(0, egressPerService - service.freeTierGB);
    const serviceEgressCost = egressOverage * service.costPerGB;

    const totalServiceCost = serviceCost + serviceEgressCost;
    breakdown.set(service.type, totalServiceCost);

    storageCost += serviceCost;
    egressCost += serviceEgressCost;
  }

  return {
    storageCost,
    egressCost,
    totalCost: storageCost + egressCost,
    breakdown,
  };
}

/**
 * Validate configuration
 *
 * Ensures global distribution configuration meets minimum requirements.
 */
export function validateConfig(config: GlobalDistributionConfig): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  // Check replication factor
  if (config.replicationFactor < 2) {
    errors.push('Replication factor must be at least 2 for fault tolerance');
  }

  // Check regions
  if (config.regions.length === 0) {
    errors.push('At least one region must be configured');
  }

  // Check pinning services
  if (config.pinningServices.length === 0) {
    errors.push('At least one pinning service must be configured');
  }

  // Check rollout phases
  if (config.rollout.phases.length === 0) {
    errors.push('At least one rollout phase must be configured');
  }

  // Check monitoring thresholds
  if (config.monitoring.enabled) {
    if (config.monitoring.alertThresholds.availabilityPercent < 90) {
      errors.push('Availability threshold should be at least 90%');
    }
    if (config.monitoring.alertThresholds.latencyMs > 1000) {
      errors.push('Latency threshold should be at most 1000ms');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
