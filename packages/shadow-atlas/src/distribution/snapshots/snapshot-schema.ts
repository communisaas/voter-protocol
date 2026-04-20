/**
 * Snapshot Zod Schemas — R31 hardening
 *
 * Replaces bare `as` casts on deserialized snapshot JSON with strict
 * runtime validation. Invalid snapshots fail loudly at ingestion rather
 * than silently corrupting downstream Merkle proofs.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// BN254 field modulus — shared constant for range checks
// ---------------------------------------------------------------------------
const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ---------------------------------------------------------------------------
// Snapshot metadata (provenance / build context)
// ---------------------------------------------------------------------------
export const SnapshotMetadataSchema = z.object({
  tigerVintage: z.number().default(0),
  statesIncluded: z.array(z.string()).default([]),
  layersIncluded: z.array(z.string()).default([]),
  buildDurationMs: z.number().default(0),
  sourceChecksums: z.record(z.string(), z.string()).default({}),
  jobId: z.string().optional(),
  previousVersion: z.number().optional(),
  notes: z.string().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Serialized snapshot (on-disk / JSON format)
// ---------------------------------------------------------------------------
export const SerializedSnapshotSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** Hex-encoded merkle root — parsed to bigint after validation */
  merkleRoot: z.string().min(1).refine(
    (val) => {
      try {
        const n = BigInt(val);
        return n >= 0n && n < BN254_FIELD_MODULUS;
      } catch {
        return false;
      }
    },
    { message: 'merkleRoot must be a hex integer within BN254 field range' },
  ),
  timestamp: z.string().refine(
    (val) => !isNaN(new Date(val).getTime()),
    { message: 'timestamp must be a valid ISO 8601 date string' },
  ),
  ipfsCid: z.string().optional(),
  layerCounts: z.record(z.string(), z.number().nonnegative()).default({}),
  metadata: SnapshotMetadataSchema.optional().default({
    tigerVintage: 0,
    statesIncluded: [],
    layersIncluded: [],
    buildDurationMs: 0,
    sourceChecksums: {},
  }),
}).passthrough();

// ---------------------------------------------------------------------------
// ProofTemplate & ProofTemplateStore
// ---------------------------------------------------------------------------
export const ProofTemplateSchema = z.object({
  districtId: z.string(),
  merkleRoot: z.string(),
  siblings: z.array(z.string()),
  pathIndices: z.array(z.number()),
  leafHash: z.string(),
  boundaryType: z.string(),
  authority: z.number(),
  leafIndex: z.number(),
}).passthrough();

export const ProofTemplateStoreSchema = z.object({
  merkleRoot: z.string(),
  treeDepth: z.number().int().nonnegative(),
  templateCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
  templates: z.record(z.string(), ProofTemplateSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// IPFS gateway snapshot (the shape returned by gateways — looser than file snapshots)
// ---------------------------------------------------------------------------
export const IPFSSnapshotSchema = z.object({
  merkleRoot: z.string().min(1),
  leaves: z.array(z.string()).min(1),
  districts: z.array(z.unknown()).optional(),
  metadata: z.object({
    id: z.string(),
    boundaryCount: z.number(),
    createdAt: z.string(),
    regions: z.array(z.string()),
  }).optional(),
}).passthrough();
