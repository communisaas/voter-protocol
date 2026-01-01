/**
 * Shadow Atlas Core Types
 *
 * Consolidated type definitions for the Shadow Atlas geospatial Merkle tree system.
 * Single source of truth for all type definitions.
 *
 * CRITICAL TYPE SAFETY: These types define the contract for event-sourced,
 * content-addressed municipal boundary data. Type errors here can brick
 * the entire discovery pipeline.
 *
 * ARCHITECTURE: This file provides backward compatibility by re-exporting
 * from the modular type definitions in ./types/. All types are now organized
 * into focused modules by domain for better maintainability.
 *
 * For new code, prefer importing directly from ./types/ modules.
 */

// Re-export everything from the modular types
export * from './types/index.js';
