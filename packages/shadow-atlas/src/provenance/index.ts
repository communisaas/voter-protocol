/**
 * Shadow Atlas Provenance System
 *
 * Unified data provenance layer for tracking boundary data sources,
 * authority hierarchies, and conflict resolution.
 *
 * ARCHITECTURE:
 * - SourceRegistry: Manages canonical sources (authority vs aggregator)
 * - ConflictResolver: Resolves disagreements between sources
 * - ProvenanceWriter: Logs all discovery attempts with reasoning
 *
 * KEY PRINCIPLES:
 * 1. Authority and freshness are orthogonal
 * 2. Primary sources (legal authorities) > aggregators (Census)
 * 3. Among same tier, freshest wins
 * 4. Every decision logged for audit trail
 */

// Source Registry
export { SourceRegistry } from './source-registry.js';
export type {
  AuthoritySource,
  AggregatorSource,
  SourceConfig,
  FreshnessCheck,
  SelectedSource,
} from './source-registry.js';

// Conflict Resolver
export { ConflictResolver } from './conflict-resolver.js';
export type {
  SourceClaim,
  ResolutionDecision,
  ResolutionResult,
} from './conflict-resolver.js';

// Provenance Writer
export { ProvenanceWriter, provenanceWriter } from './provenance-writer.js';
export type {
  ProvenanceRecord,
  CompactDiscoveryEntry,
  ProvenanceFilter,
} from './provenance-writer.js';

// Primary Source Comparator (WP-FRESHNESS-3)
export { PrimarySourceComparator, primaryComparator } from './primary-comparator.js';
export type {
  BoundaryType,
  SourceFreshness,
  TigerComparison,
} from './primary-comparator.js';
