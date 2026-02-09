# Distribution Architecture

> [!WARNING]
> **PHASE 2 — NOT YET IMPLEMENTED (SA-008 Deferred)**
>
> IPFS distribution is architecturally planned but not yet functional.
> `sync-service.ts` returns mock CIDs. No live IPFS connectivity exists.

## Current State

- **Storage:** Local SQLite database only (no remote distribution)
- **Sync service:** Stubbed — returns mock CIDs, no actual IPFS pinning
- **Status:** Deferred to Phase 2 pending SA-008 resolution

## Planned Architecture (Phase 2)

The distribution layer is designed to sync shadow-atlas Merkle tree snapshots to IPFS for
decentralized availability. The planned architecture includes:

- IPFS content-addressed snapshots of tree state
- IPNS mutable pointers for latest state resolution
- Multi-provider pinning (Storacha, Pinata) for redundancy

## Directory Structure

- `sync-service.ts` — Sync orchestrator (currently returns mock CIDs)
- `ipfs-client.ts` — IPFS client wrapper (stubbed)
- `snapshot-manager.ts` — Tree snapshot serialization

See `specs/IMPLEMENTATION-GAP-ANALYSIS.md` for tracking of SA-008.
