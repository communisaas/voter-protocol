/**
 * Relay Module — Write functions for CF Worker relay
 *
 * Extracted from Shadow Atlas for bedrock's thin write relay.
 * See write-functions.ts for architecture notes.
 */

export {
  // Validation schemas
  registerSchema,
  registerReplaceSchema,
  engagementRegisterSchema,

  // Write functions
  registerLeaf,
  replaceLeaf,
  registerEngagementIdentity,

  // Read functions (engagement queries)
  getEngagementMetrics,
  getEngagementProof,
  getEngagementBreakdown,
  getTreeInfo,
  getEngagementInfo,

  // Tier computation (portable)
  deriveTier,
  computeCompositeScore,
  TIER_BOUNDARIES,

  // Error type
  RelayError,

  // Types
  type RelayStorageAdapter,
  type TreeServiceClient,
  type RegistrationProofResult,
  type TreeInfoResult,
  type EngagementRecord,
  type EngagementProofResult,
  type EngagementInfoResult,
  type EngagementBreakdownResult,
} from './write-functions.js';
