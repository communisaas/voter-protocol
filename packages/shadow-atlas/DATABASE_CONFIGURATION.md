# Shadow Atlas Database Configuration

This document describes how to configure database adapters for the Shadow Atlas system.

## Overview

Shadow Atlas uses **two separate database systems**:

1. **Legacy Event-Sourced System** (`src/db/`) - Used by incremental orchestrator
   - Simpler schema for municipalities, sources, and events
   - Currently supports SQLite only
   - Used by: `IncrementalOrchestrator`

2. **New Persistence Layer** (`src/persistence/`) - Used by batch orchestrator
   - Complex job state management with repository pattern
   - Supports both SQLite and PostgreSQL
   - Used by: `BatchOrchestrator`, `ShadowAtlasService`

## Configuration via Environment Variables

### DATABASE_URL Format

Set the `DATABASE_URL` environment variable to configure the database adapter:

```bash
# SQLite (default if not set)
export DATABASE_URL="sqlite:///.shadow-atlas/shadow-atlas.db"

# PostgreSQL (new persistence layer only)
export DATABASE_URL="postgresql://user:password@localhost:5432/shadow_atlas"
```

### SQLite URL Format

```
sqlite:///path/to/database.db
```

- Absolute path: `sqlite:////absolute/path/to/db.sqlite`
- Relative path: `sqlite:///relative/path/to/db.sqlite`
- If `DATABASE_URL` is not set, defaults to `.shadow-atlas/shadow-atlas.db`

### PostgreSQL URL Format (New Persistence Layer Only)

```
postgresql://username:password@host:port/database
```

Options:
- `?ssl=true` - Enable SSL connection

## Usage Examples

### Incremental Orchestrator (Legacy System)

The incremental orchestrator automatically initializes the database adapter from environment:

```typescript
import { createDatabaseAdapter } from './db/factory.js';

// Reads DATABASE_URL or defaults to SQLite
const db = await createDatabaseAdapter();

// Use the adapter
const munis = await db.listMunicipalities(100, 0);

// Always close when done
await db.close();
```

**CLI Usage:**

```bash
# Use default SQLite
node dist/acquisition/incremental-orchestrator.js incremental

# Use custom SQLite database
export DATABASE_URL="sqlite:///custom/path/db.sqlite"
node dist/acquisition/incremental-orchestrator.js full

# Force check all sources
node dist/acquisition/incremental-orchestrator.js force
```

### New Persistence Layer (Repository Pattern)

The new persistence layer supports both SQLite and PostgreSQL:

```typescript
import { createDatabaseAdapter } from './persistence/adapters/factory.js';
import { ShadowAtlasRepository } from './persistence/repository.js';

// Create adapter (auto-detects from DATABASE_URL)
const adapter = await createDatabaseAdapter();

// Create repository
const repo = new ShadowAtlasRepository(adapter);

// Use repository methods
const job = await repo.createJob({
  id: 'job-123' as JobId,
  scope_states: JSON.stringify(['CA', 'NY']),
  scope_layers: JSON.stringify(['congressional']),
  status: 'pending',
  // ...
});
```

## Adapter Selection Logic

### Legacy System (src/db/)

1. Check `DATABASE_URL` environment variable
2. If set and protocol is `sqlite:`, use SQLite adapter
3. If set and protocol is not `sqlite:`, throw error (only SQLite supported)
4. If not set, default to SQLite at `.shadow-atlas/shadow-atlas.db`

### New Persistence Layer (src/persistence/)

1. Check `DATABASE_URL` environment variable
2. If set and protocol is `sqlite:`, use SQLite adapter
3. If set and protocol is `postgresql:` or `postgres:`, use PostgreSQL adapter
4. If not set, default to SQLite at `.shadow-atlas/shadow-atlas.db`

## Schema Management

Both systems automatically initialize database schemas on first connection:

- **Legacy System**: Runs `schema.sql` and `views.sql` from `src/db/`
- **New Persistence Layer**: Runs `schema.sql` from `src/persistence/`

Schema files must be in the same directory as the compiled adapter code.

## Production Deployment

### Recommended Configuration

**Development:**
```bash
export DATABASE_URL="sqlite:///.shadow-atlas/dev.db"
```

**Production (Single Server):**
```bash
export DATABASE_URL="sqlite:////var/lib/shadow-atlas/production.db"
```

**Production (Multi-Server):**
```bash
export DATABASE_URL="postgresql://shadow_atlas:${DB_PASSWORD}@db.example.com:5432/shadow_atlas?ssl=true"
```

### Migration from SQLite to PostgreSQL

The new persistence layer supports seamless migration:

1. Export data from SQLite
2. Set `DATABASE_URL` to PostgreSQL connection string
3. Adapter will automatically initialize PostgreSQL schema
4. Import data using repository methods

## Troubleshooting

### Schema Not Found

If you see "ENOENT: no such file or directory" for schema.sql:

1. Ensure schema files are copied to dist/ during build
2. Or provide explicit schema directory:
   ```typescript
   const db = await createDatabaseAdapter('/path/to/schema/dir');
   ```

### Connection Errors

**SQLite:**
- Check file permissions on database directory
- Ensure parent directory exists

**PostgreSQL:**
- Verify connection string format
- Check network connectivity to database server
- Confirm credentials are correct

### Type Errors

Both systems use strongly typed interfaces. If you see type errors:

1. Ensure you're using the correct adapter for your use case:
   - `src/db/factory.js` for incremental orchestrator
   - `src/persistence/adapters/factory.js` for batch orchestrator

2. Check that your types match the expected interfaces:
   - Legacy: `DatabaseAdapter` from `src/core/types.ts`
   - New: `DatabaseAdapter` from `src/persistence/repository.ts`

## Future Enhancements

- PostgreSQL support for legacy system (requires implementing legacy DatabaseAdapter interface)
- Connection pooling configuration
- Read replica support
- Automatic schema migrations
- Database backup/restore utilities
