# Cloudflare Workers Research Archive

Cloudflare Workers + R2 was evaluated as a deployment target for shadow-atlas but never implemented.

## Decision Summary

**The Cloudflare Workers architecture was researched but not adopted.** The current deployment uses:

- **Runtime**: Node.js HTTP server
- **Deployment**: Kubernetes + Docker
- **Database**: SQLite (in-process)
- **Storage**: Local filesystem with planned IPFS integration (currently stubbed)

## Why Workers Was Not Implemented

While Cloudflare Workers offers attractive edge computing benefits, the implementation was deferred due to:

- **SQLite compatibility**: Workers runtime limitations with native SQLite bindings
- **Deployment simplicity**: Kubernetes provides sufficient scalability for current needs
- **Development velocity**: Node.js HTTP server allows rapid iteration without Workers-specific constraints

## Archived Documents

1. **CLOUDFLARE_README.md** - Proposed Cloudflare Workers + R2 deployment architecture

These documents are preserved for future reference if edge computing deployment becomes a priority (e.g., international expansion requiring global edge presence).

## Current Deployment

See `packages/shadow-atlas/docs/deployment/` for current Kubernetes deployment documentation.
