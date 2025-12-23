# Shadow Atlas Architecture

## Implementation Status

| Location | Runtime | Status | Purpose |
|----------|---------|--------|---------|
| `packages/crypto/services/shadow-atlas/` | Node.js | **Active** | Core library for boundary discovery, validation, Merkle trees |
| `workers/shadow-atlas/` | Cloudflare Workers | **Planned** | Edge deployment for production serving |

## Current Structure (Active)

`packages/crypto/services/shadow-atlas/` is the canonical implementation:

```
shadow-atlas/
├── core/           # ShadowAtlasService, config, factory
├── providers/      # TIGER, UK, Canada boundary sources
├── registry/       # State GIS portals, known portals
├── services/       # Business logic, orchestration
├── validators/     # Deterministic validation
├── serving/        # HTTP API, proof generation
├── persistence/    # SQLite storage
├── observability/  # Metrics, logging
└── ...
```

## Future Deployment (Planned)

`workers/shadow-atlas/` is prepared for Cloudflare edge deployment:
- D1 database bindings
- R2 storage bindings
- Durable Objects for long-running operations
- Cron triggers for scheduled updates

**Not yet deployed.** Will share core logic with packages implementation in the future.

## Usage

### Node.js (Current)
```typescript
import { createShadowAtlasService } from '@voter-protocol/crypto/shadow-atlas/core';

const atlas = createShadowAtlasService();
const result = await atlas.extract({ type: 'state', states: ['WI'] });
```

### Cloudflare Workers (Future)
```
wrangler dev  # Local development
wrangler deploy  # Production deployment
```
