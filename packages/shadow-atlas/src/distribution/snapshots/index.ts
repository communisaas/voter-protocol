/**
 * Snapshot Versioning - Reproducible Atlas Build Management
 *
 * @packageDocumentation
 */

export { SnapshotManager } from './snapshot-manager.js';

export type {
  Snapshot,
  SnapshotMetadata,
  SnapshotDiff,
  SnapshotListEntry,
} from './types.js';

export {
  SerializedSnapshotSchema,
  SnapshotMetadataSchema,
  ProofTemplateSchema,
  ProofTemplateStoreSchema,
  IPFSSnapshotSchema,
} from './snapshot-schema.js';
