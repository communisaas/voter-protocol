/**
 * Shadow Atlas Core Exports
 *
 * Provides core functionality for Shadow Atlas:
 * - Poseidon2 hashing and Merkle trees (cryptographic primitives)
 * - HTTP client with retry/backoff (unified network layer)
 *
 * NOTE: Poseidon2 hasher now lives in @voter-protocol/crypto package.
 * This file re-exports for backwards compatibility.
 */

// Cryptographic primitives
export {
  Poseidon2Hasher,
  getHasher,
  hashPair,
  hashSingle,
  hashString,
} from '@voter-protocol/crypto/poseidon2';

// HTTP client
export {
  HTTPClient,
  HTTPError,
  HTTPTimeoutError,
  HTTPNetworkError,
  HTTPRetryExhaustedError,
  HTTPJSONParseError,
  getHTTPClient,
  fetchJSON,
  fetchGeoJSON,
  createHTTPClient,
  type HTTPClientConfig,
  type FetchOptions,
} from './http-client.js';

// Redistricting tracker (dual-validity for boundary transitions)
export {
  RedistrictingTracker,
  InMemoryRedistrictingStorage,
  getRedistrictingTracker,
  resetRedistrictingTracker,
  type RedistrictingEvent,
  type RedistrictingConfig,
  type RedistrictingStorage,
  type RedistrictingSource,
  type RootValidationResult,
} from './redistricting-tracker.js';

// Redistricting notifications
export {
  createRedistrictingNotification,
  formatRedistrictingMessage,
  formatRedistrictingTitle,
  isNotificationActive,
  daysRemainingInDualValidity,
  type RedistrictingNotification,
} from './redistricting-notifications.js';
