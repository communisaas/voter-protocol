/**
 * Backward-compatibility shim.
 *
 * The core tree builder has been renamed from dual-tree-builder to tree-builder
 * to reflect that Trees 1 and 2 are shared by both the two-tree and three-tree
 * proof pipelines. New code should import from './tree-builder.js'.
 *
 * @deprecated Import from './tree-builder.js' instead.
 */
export * from './tree-builder.js';
