/**
 * Global IPFS Distribution - Public API
 *
 * Export all distribution services for integration with ShadowAtlasService.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// Type exports
export type {
  Region,
  RegionConfig,
  PinningServiceType,
  PinningServiceConfig,
  PinResult,
  UpdateStrategy,
  RolloutPhase,
  RolloutConfig,
  GlobalDistributionConfig,
  GatewayHealth,
  GatewaySelectionCriteria,
  GatewaySelectionResult,
  GlobalPublishOptions,
  RegionalPublishStatus,
  GlobalPublishResult,
  GlobalAvailabilityMetrics,
  ReplicationStatus,
  DistributionError,
  DistributionErrorType,
  FallbackStrategy,
  FallbackResolutionResult,
} from './types.js';

// Service exports
export {
  RegionalPinningService,
  createRegionalPinningService,
} from './regional-pinning-service.js';
export type {
  IPinningService,
  RegionalServiceConfig,
} from './regional-pinning-service.js';
export { UpdateCoordinator } from './update-coordinator.js';
export { AvailabilityMonitor } from './availability-monitor.js';
export { FallbackResolver } from './fallback-resolver.js';

// Concrete pinning service implementations
export {
  StorachaPinningService,
  createStorachaPinningService,
  PinataPinningService,
  createPinataPinningService,
  FleekPinningService,
  createFleekPinningService,
  createPinningService,
  createConfiguredServices,
} from './services/index.js';
export type {
  StorachaConfig,
  PinataConfig,
  FleekConfig,
  ServiceFactoryOptions,
} from './services/index.js';

// Configuration exports
export {
  DEFAULT_REGIONS,
  DEFAULT_PINNING_SERVICES,
  DEFAULT_ROLLOUT,
  DEFAULT_GLOBAL_CONFIG,
  getRegionForCountry,
  getOptimalGateway,
  getPinningServicesForRegion,
  estimateMonthlyCost,
  validateConfig,
} from './global-ipfs-strategy.js';
