/**
 * Relay Write Functions — Extracted from Shadow Atlas for CF Worker relay
 *
 * These are the core write operations that bedrock's CF Worker relay needs.
 * Each function is storage-agnostic: it takes a StorageAdapter and performs
 * validation + mutation through that adapter.
 *
 * ARCHITECTURE:
 * - CF Worker relay handles: HTTP routing, auth, rate limiting, validation, storage
 * - Shadow Atlas (or successor) handles: Merkle tree computation, proof generation
 * - The relay writes validated data to D1/Postgres, then notifies the tree service
 *   to update its in-memory tree and return proofs.
 *
 * WHY THIS SPLIT:
 * Poseidon2 hashing requires WASM (barretenberg), which is heavy for CF Workers.
 * The tree service is a lightweight sidecar that maintains in-memory Merkle trees
 * and generates proofs on demand. The relay handles everything else.
 *
 * SPEC REFERENCE: TWO-TREE-ARCHITECTURE-SPEC.md Section 2
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/** BN254 scalar field modulus — all leaf values must be in [1, p-1] */
const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Idempotency cache TTL: 1 hour */
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;

/** Max idempotency key length to prevent storage amplification. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

// ============================================================================
// Validation Schemas (Zod) — Direct port from api.ts
// ============================================================================

export const registerSchema = z.object({
  leaf: z.string()
    .min(3, 'Leaf hash is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'Leaf must be a hex-encoded field element')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS;
      } catch { return false; }
    }, 'Leaf must be a valid BN254 field element (0 < leaf < p)'),
  attestationHash: z.string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'attestationHash must be 32-byte hex (SHA-256)')
    .transform(s => s.startsWith('0x') ? s : '0x' + s)
    .optional(),
});

export const registerReplaceSchema = z.object({
  newLeaf: z.string()
    .min(3, 'Leaf hash is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'newLeaf must be a hex-encoded field element')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS;
      } catch { return false; }
    }, 'newLeaf must be a valid BN254 field element (0 < leaf < p)'),
  oldLeafIndex: z.number().int().nonnegative('oldLeafIndex must be a non-negative integer'),
  attestationHash: z.string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'attestationHash must be 32-byte hex (SHA-256)')
    .transform(s => s.startsWith('0x') ? s : '0x' + s)
    .optional(),
});

export const engagementRegisterSchema = z.object({
  signerAddress: z.string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'signerAddress must be a valid Ethereum address'),
  identityCommitment: z.string()
    .min(3, 'identityCommitment is required')
    .regex(/^(0x)?[0-9a-fA-F]+$/, 'identityCommitment must be hex-encoded')
    .refine((val) => {
      try {
        const n = BigInt(val.startsWith('0x') ? val : '0x' + val);
        return n > 0n && n < BN254_MODULUS;
      } catch { return false; }
    }, 'identityCommitment must be a valid BN254 field element (0 < v < p)'),
});

// ============================================================================
// Storage Adapter Interface
// ============================================================================

/**
 * Storage adapter for the relay. Bedrock implements this against D1 or Postgres.
 *
 * All methods are async to support both D1 (Cloudflare) and Postgres (Hyperdrive).
 * The relay never touches the Merkle tree directly — it writes to storage and
 * delegates tree operations to the tree service.
 */
export interface RelayStorageAdapter {
  // --- Registration (Tree 1) ---

  /** Check if a leaf hash already exists in the tree. Returns leaf index if found, null otherwise. */
  findLeaf(leafHex: string): Promise<number | null>;

  /** Get current tree size (next available leaf index). */
  getTreeSize(): Promise<number>;

  /** Get tree capacity (2^depth). */
  getTreeCapacity(): Promise<number>;

  /**
   * Insert a new leaf into storage.
   * Called AFTER validation passes. The relay writes the WAL entry + leaf record.
   * Returns the assigned leaf index.
   */
  insertLeaf(leafHex: string, attestationHash?: string): Promise<number>;

  /**
   * Replace an existing leaf.
   * Zeros the old leaf position and inserts a new one at the next index.
   * Returns the new leaf index.
   */
  replaceLeaf(oldLeafIndex: number, newLeafHex: string, attestationHash?: string): Promise<number>;

  /**
   * Get a leaf value by index.
   * Returns { leaf: hex, isEmpty: boolean } or null if index out of range.
   */
  getLeafAt(index: number): Promise<{ leaf: string; isEmpty: boolean } | null>;

  // --- Idempotency ---

  /** Get cached result for an idempotency key. Returns null if not found or expired. */
  getIdempotencyResult(key: string): Promise<unknown | null>;

  /** Cache a result by idempotency key with TTL. */
  setIdempotencyResult(key: string, result: unknown, ttlMs?: number): Promise<void>;

  // --- Engagement (Tree 3) ---

  /** Check if an identity commitment is already registered. */
  isIdentityRegistered(identityCommitmentHex: string): Promise<boolean>;

  /** Check if a signer address is already registered. */
  isSignerRegistered(signerAddress: string): Promise<boolean>;

  /**
   * Register an identity for engagement tracking.
   * Creates a tier-0 record in storage.
   * Returns the assigned leaf index.
   */
  registerEngagementIdentity(
    signerAddress: string,
    identityCommitmentHex: string,
  ): Promise<number>;

  /** Get engagement metrics by identity commitment. */
  getEngagementMetrics(identityCommitmentHex: string): Promise<EngagementRecord | null>;

  /** Get engagement metrics by signer address. */
  getEngagementMetricsBySigner(signerAddress: string): Promise<EngagementRecord | null>;

  /** Get detailed engagement breakdown. */
  getEngagementBreakdown(identityCommitmentHex: string): Promise<EngagementBreakdownResult | null>;
}

/**
 * Tree service client — proxy to the sidecar that manages Merkle trees.
 *
 * The relay calls this AFTER writing to storage to get Merkle proofs.
 * This could be shadow-atlas running in sidecar mode, or a minimal
 * Poseidon2 tree service.
 */
export interface TreeServiceClient {
  /** Get Merkle proof for a leaf at the given index in Tree 1. */
  getRegistrationProof(leafIndex: number): Promise<RegistrationProofResult>;

  /** Get current Tree 1 root and metadata. */
  getTreeInfo(): Promise<TreeInfoResult>;

  /**
   * Notify the tree service that a new leaf was inserted.
   * The tree service rebuilds its in-memory tree from the WAL.
   */
  notifyInsertion(leafIndex: number, leafHex: string): Promise<void>;

  /**
   * Notify the tree service that a leaf was replaced.
   * The tree service zeros the old position and inserts at the new index.
   */
  notifyReplacement(oldLeafIndex: number, newLeafIndex: number, newLeafHex: string): Promise<void>;

  /** Get Merkle proof for a leaf in Tree 3 (engagement). */
  getEngagementProof(leafIndex: number): Promise<EngagementProofResult>;

  /** Get Tree 3 root and metadata. */
  getEngagementInfo(): Promise<EngagementInfoResult>;

  /** Notify Tree 3 of a new identity registration. */
  notifyEngagementRegistration(leafIndex: number, identityCommitmentHex: string): Promise<void>;
}

// ============================================================================
// Result Types
// ============================================================================

export interface RegistrationProofResult {
  leafIndex: number;
  userRoot: string;
  userPath: string[];
  pathIndices: number[];
}

/** Runtime type guard for idempotency cache hit validation. */
function isRegistrationProofResult(value: unknown): value is RegistrationProofResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.leafIndex === 'number' &&
    typeof v.userRoot === 'string' &&
    Array.isArray(v.userPath) &&
    Array.isArray(v.pathIndices)
  );
}

export interface TreeInfoResult {
  treeSize: number;
  root: string;
  depth: number;
  capacity: number;
}

export interface EngagementRecord {
  identityCommitment: string;
  signerAddress: string;
  leafIndex: number;
  tier: 0 | 1 | 2 | 3 | 4;
  actionCount: number;
  diversityScore: number;
  tenureMonths: number;
  registeredAt: number;
}

export interface EngagementProofResult {
  leafIndex: number;
  engagementRoot: string;
  engagementPath: string[];
  pathIndices: number[];
  tier: number;
  actionCount: number;
  diversityScore: number;
}

export interface EngagementInfoResult {
  available: boolean;
  root: string;
  depth: number;
  leafCount: number;
}

export interface EngagementBreakdownResult {
  identityCommitment: string;
  currentTier: 0 | 1 | 2 | 3 | 4;
  compositeScore: number;
  metrics: {
    actionCount: number;
    diversityScore: number;
    shannonH: number;
    tenureMonths: number;
    adoptionCount: number;
  };
  factors: {
    action: number;
    diversity: number;
    tenure: number;
    adoption: number;
  };
  tierBoundaries: readonly {
    tier: 0 | 1 | 2 | 3 | 4;
    label: string;
    minScore: number;
  }[];
  leafIndex: number;
}

// ============================================================================
// Write Functions
// ============================================================================

/**
 * Register a new leaf in Tree 1.
 *
 * Flow:
 * 1. Validate input (Zod schema)
 * 2. Check idempotency cache
 * 3. Check for duplicate leaf (natural idempotency)
 * 4. Check tree capacity
 * 5. Write to storage (WAL + leaf record)
 * 6. Notify tree service for proof generation
 * 7. Cache result by idempotency key
 * 8. Return proof
 *
 * @returns Registration result with Merkle proof, or cached result
 */
export async function registerLeaf(
  input: z.infer<typeof registerSchema>,
  idempotencyKey: string | undefined,
  storage: RelayStorageAdapter,
  treeService: TreeServiceClient,
): Promise<{ result: RegistrationProofResult & { alreadyRegistered?: boolean }; cached: boolean }> {
  // Validate idempotency key length.
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RelayError('INVALID_PARAMETERS', `Idempotency key exceeds ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`, 400);
  }

  // Step 1: Check idempotency cache
  if (idempotencyKey) {
    const cached = await storage.getIdempotencyResult(idempotencyKey);
    // Validate cached result structure before returning.
    if (cached !== null && isRegistrationProofResult(cached)) {
      return { result: cached, cached: true };
    }
  }

  // Step 2: Check for duplicate (natural idempotency — return existing proof)
  const existingIndex = await storage.findLeaf(input.leaf);
  if (existingIndex !== null) {
    const proof = await treeService.getRegistrationProof(existingIndex);
    const result = { ...proof, alreadyRegistered: true };

    if (idempotencyKey) {
      await storage.setIdempotencyResult(idempotencyKey, result, IDEMPOTENCY_TTL_MS);
    }

    return { result, cached: false };
  }

  // Step 3: Check capacity
  const [treeSize, capacity] = await Promise.all([
    storage.getTreeSize(),
    storage.getTreeCapacity(),
  ]);
  if (treeSize >= capacity) {
    throw new RelayError('TREE_FULL', 'Registration tree is at capacity', 503);
  }

  // Step 4: Write to storage
  const leafIndex = await storage.insertLeaf(input.leaf, input.attestationHash);

  // Step 5: Notify tree service
  await treeService.notifyInsertion(leafIndex, input.leaf);

  // Step 6: Get proof from tree service
  const proof = await treeService.getRegistrationProof(leafIndex);

  // Step 7: Cache result
  if (idempotencyKey) {
    await storage.setIdempotencyResult(idempotencyKey, proof, IDEMPOTENCY_TTL_MS);
  }

  return { result: proof, cached: false };
}

/**
 * Replace an existing leaf in Tree 1.
 *
 * Flow:
 * 1. Check idempotency cache
 * 2. Validate old leaf exists and is not empty
 * 3. Check new leaf is not duplicate
 * 4. Check capacity
 * 5. Write replacement to storage
 * 6. Notify tree service
 * 7. Return proof for new leaf
 */
export async function replaceLeaf(
  input: z.infer<typeof registerReplaceSchema>,
  idempotencyKey: string | undefined,
  storage: RelayStorageAdapter,
  treeService: TreeServiceClient,
): Promise<{ result: RegistrationProofResult; cached: boolean }> {
  // Validate idempotency key length.
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RelayError('INVALID_PARAMETERS', `Idempotency key exceeds ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`, 400);
  }

  // Step 1: Check idempotency cache
  if (idempotencyKey) {
    const cached = await storage.getIdempotencyResult(idempotencyKey);
    // Validate cached result structure before returning.
    if (cached !== null && isRegistrationProofResult(cached)) {
      return { result: cached, cached: true };
    }
  }

  // Step 2: Validate old leaf
  const oldLeaf = await storage.getLeafAt(input.oldLeafIndex);
  if (!oldLeaf) {
    throw new RelayError('INVALID_PARAMETERS', 'Invalid replacement parameters', 400);
  }
  if (oldLeaf.isEmpty) {
    throw new RelayError('INVALID_PARAMETERS', 'Invalid replacement parameters', 400);
  }

  // Step 3: Check new leaf not duplicate
  const existingIndex = await storage.findLeaf(input.newLeaf);
  if (existingIndex !== null) {
    throw new RelayError('INVALID_PARAMETERS', 'Invalid replacement parameters', 400);
  }

  // Step 4: Check capacity
  const [treeSize, capacity] = await Promise.all([
    storage.getTreeSize(),
    storage.getTreeCapacity(),
  ]);
  if (treeSize >= capacity) {
    throw new RelayError('TREE_FULL', 'Registration tree is at capacity', 503);
  }

  // Step 5: Write to storage
  const newLeafIndex = await storage.replaceLeaf(
    input.oldLeafIndex,
    input.newLeaf,
    input.attestationHash,
  );

  // Step 6: Notify tree service
  await treeService.notifyReplacement(input.oldLeafIndex, newLeafIndex, input.newLeaf);

  // Step 7: Get proof
  const proof = await treeService.getRegistrationProof(newLeafIndex);

  // Step 8: Cache result
  if (idempotencyKey) {
    await storage.setIdempotencyResult(idempotencyKey, proof, IDEMPOTENCY_TTL_MS);
  }

  return { result: proof, cached: false };
}

/**
 * Register an identity for engagement tracking (Tree 3).
 *
 * Flow:
 * 1. Check identity not already registered
 * 2. Check signer not already registered
 * 3. Write to storage (tier-0 record)
 * 4. Notify tree service
 * 5. Return leaf index + root
 */
export async function registerEngagementIdentity(
  input: z.infer<typeof engagementRegisterSchema>,
  storage: RelayStorageAdapter,
  treeService: TreeServiceClient,
): Promise<{ leafIndex: number; engagementRoot: string }> {
  const icHex = input.identityCommitment.startsWith('0x')
    ? input.identityCommitment.slice(2)
    : input.identityCommitment;
  const signerLower = input.signerAddress.toLowerCase();

  // Step 1: Check duplicates (oracle-resistant — same error for both)
  const [identityExists, signerExists] = await Promise.all([
    storage.isIdentityRegistered(icHex),
    storage.isSignerRegistered(signerLower),
  ]);
  if (identityExists || signerExists) {
    throw new RelayError('INVALID_PARAMETERS', 'Invalid registration parameters', 400);
  }

  // Step 2: Write to storage
  const leafIndex = await storage.registerEngagementIdentity(signerLower, icHex);

  // Step 3: Notify tree service
  await treeService.notifyEngagementRegistration(leafIndex, icHex);

  // Step 4: Get root from tree service
  const info = await treeService.getEngagementInfo();

  return { leafIndex, engagementRoot: info.root };
}

// ============================================================================
// Read Functions (Engagement Queries)
// ============================================================================

/**
 * Get engagement metrics for an identity by commitment hex.
 */
export async function getEngagementMetrics(
  identityCommitmentHex: string,
  storage: RelayStorageAdapter,
): Promise<EngagementRecord> {
  const icHex = identityCommitmentHex.startsWith('0x')
    ? identityCommitmentHex.slice(2)
    : identityCommitmentHex;

  const record = await storage.getEngagementMetrics(icHex);
  if (!record) {
    throw new RelayError('IDENTITY_NOT_FOUND', 'Identity not registered', 404);
  }
  return record;
}

/**
 * Get engagement Merkle proof for a leaf index.
 */
export async function getEngagementProof(
  leafIndex: number,
  treeService: TreeServiceClient,
): Promise<EngagementProofResult> {
  return treeService.getEngagementProof(leafIndex);
}

/**
 * Get detailed engagement breakdown (composite score, factors, tier boundaries).
 */
export async function getEngagementBreakdown(
  identityCommitmentHex: string,
  storage: RelayStorageAdapter,
): Promise<EngagementBreakdownResult> {
  const icHex = identityCommitmentHex.startsWith('0x')
    ? identityCommitmentHex.slice(2)
    : identityCommitmentHex;

  const breakdown = await storage.getEngagementBreakdown(icHex);
  if (!breakdown) {
    throw new RelayError('IDENTITY_NOT_FOUND', 'Identity not registered', 404);
  }
  return breakdown;
}

/**
 * Get Tree 1 info (size, root, depth, capacity).
 */
export async function getTreeInfo(
  treeService: TreeServiceClient,
): Promise<TreeInfoResult> {
  return treeService.getTreeInfo();
}

/**
 * Get Tree 3 info (root, depth, leafCount).
 */
export async function getEngagementInfo(
  treeService: TreeServiceClient,
): Promise<EngagementInfoResult> {
  return treeService.getEngagementInfo();
}

// ============================================================================
// Error Type
// ============================================================================

/**
 * Relay error with HTTP status code.
 * The relay maps these to HTTP responses.
 */
export class RelayError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'RelayError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ============================================================================
// Tier Computation (portable — no Poseidon2 dependency)
// ============================================================================

/** Tier boundary thresholds (composite score E) */
export const TIER_BOUNDARIES = [
  { tier: 0 as const, label: 'New',         minScore: 0 },
  { tier: 1 as const, label: 'Active',      minScore: 0.001 },
  { tier: 2 as const, label: 'Established', minScore: 5.0 },
  { tier: 3 as const, label: 'Veteran',     minScore: 12.0 },
  { tier: 4 as const, label: 'Pillar',      minScore: 25.0 },
] as const;

/**
 * Derive tier from engagement metrics.
 * Pure function — no crypto dependency.
 */
export function deriveTier(
  actionCount: number,
  diversityScore: number,
  tenureMonths: number,
): 0 | 1 | 2 | 3 | 4 {
  const shannonH = diversityScore / 1000;
  const score = computeCompositeScore(actionCount, shannonH, tenureMonths, 0);

  for (let i = TIER_BOUNDARIES.length - 1; i >= 0; i--) {
    if (score >= TIER_BOUNDARIES[i].minScore) {
      return TIER_BOUNDARIES[i].tier;
    }
  }
  return 0;
}

/**
 * Compute composite engagement score.
 * E = log2(1 + A) * (1 + H) * (1 + sqrt(T/12)) * (1 + log2(1 + P)/4)
 */
export function computeCompositeScore(
  actionCount: number,
  shannonH: number,
  tenureMonths: number,
  adoptionCount: number,
): number {
  if (actionCount === 0) return 0;
  const actionFactor = Math.log2(1 + actionCount);
  const diversityFactor = 1 + shannonH;
  const tenureFactor = 1 + Math.sqrt(tenureMonths / 12);
  const adoptionFactor = 1 + Math.log2(1 + adoptionCount) / 4;
  return actionFactor * diversityFactor * tenureFactor * adoptionFactor;
}
