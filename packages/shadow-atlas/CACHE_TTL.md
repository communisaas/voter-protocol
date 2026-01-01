# TIGER Cache TTL Implementation

## Overview

Automatic cache expiration based on TIGER release schedule prevents serving stale geographic boundary data.

**Problem Solved**: Cache files persisted indefinitely, risking delivery of outdated 2024 boundaries in 2025+ without manual intervention.

**Solution**: Time-based expiration aligned with TIGER's September 1st annual release schedule.

## Implementation

### Core Logic

```typescript
// TIGER releases September 1st of year following data year
// 2024 data → Released Sept 1, 2025 → Expires Oct 1, 2025 (30-day grace)

const releaseDateMs = Date.UTC(this.year + 1, 8, 1); // September 1st (UTC)
const expirationMs = releaseDateMs + gracePeriodDays * 24 * 60 * 60 * 1000;

// Cache is stale if:
// 1. Current time > expiration date (release + grace)
// 2. Cache file created before release date (old vintage)
const isStale = now > expirationDate && cacheDate < releaseDate;
```

### Configuration

**ShadowAtlasConfig**:
```typescript
{
  tigerCache: {
    autoExpire: true,        // Enable automatic expiration (default: true)
    gracePeriodDays: 30,     // Days after release before expiring (default: 30)
  }
}
```

**TIGERBoundaryProvider**:
```typescript
const provider = new TIGERBoundaryProvider({
  year: 2024,
  autoExpireCache: true,     // Enable automatic expiration
  gracePeriodDays: 30,       // 30-day grace period
});
```

### Behavior

**Automatic Download on Stale Cache**:
- Cache hit → Check staleness before using
- Stale cache → Log message, download fresh data
- Fresh cache → Use cached file
- `forceRefresh=true` → Bypass cache entirely

**Example Timeline**:
```
January 15, 2025  → Cache file created (2024 data)
September 1, 2025 → TIGER 2025 data released
October 1, 2025   → Cache expires (30-day grace period)
October 2, 2025+  → Fresh downloads triggered automatically
```

## Usage Examples

### Default Configuration (Recommended)

```typescript
import { TIGERBoundaryProvider } from './providers/tiger-boundary-provider.js';

const provider = new TIGERBoundaryProvider({
  year: 2024,
  // Auto-expire defaults to true with 30-day grace period
});

// Downloads will automatically refresh after October 1, 2025
const boundaries = await provider.download({
  level: 'district',
  region: 'US',
});
```

### Production: Extended Grace Period

```typescript
const provider = new TIGERBoundaryProvider({
  year: 2024,
  autoExpireCache: true,
  gracePeriodDays: 60,  // 60 days for TIGER data stabilization
});
```

### Testing: Disable Expiration

```typescript
const provider = new TIGERBoundaryProvider({
  year: 2024,
  autoExpireCache: false,  // Cache never expires
});
```

### Monitoring Cache Health

```typescript
const status = await provider.getCacheStatus();

console.log(`TIGER Year: ${status.tigerYear}`);
console.log(`Auto-Expire: ${status.autoExpireEnabled}`);
console.log(`Grace Period: ${status.gracePeriodDays} days`);
console.log(`Next Expiration: ${status.nextExpiration.toISOString()}`);
console.log(`Cache Directory: ${status.cacheDir}`);
```

## Technical Details

### File Timestamp Logic

Uses filesystem modification time (`fs.statSync(cachePath).mtime`) to determine cache age:

```typescript
const stats = statSync(cachePath);
const cacheDate = new Date(stats.mtime);

// Cache created AFTER release date is always fresh
// (e.g., downloading 2024 data in September 2025 after release)
if (cacheDate >= releaseDate) {
  return false; // Fresh
}

// Cache created BEFORE release date expires after grace period
if (now > expirationDate) {
  return true; // Stale
}
```

### UTC Date Handling

All date calculations use UTC to avoid timezone inconsistencies:

```typescript
const releaseDateMs = Date.UTC(this.year + 1, 8, 1); // September 1st UTC
const expirationMs = releaseDateMs + gracePeriodDays * 24 * 60 * 60 * 1000;
```

### Integration Points

**Modified Methods**:
1. `downloadNationalFile()` - Checks staleness before using cache
2. `downloadStateFile()` - Checks staleness before using cache

**New Methods**:
1. `isCacheStale(cachePath)` - Private method returning boolean
2. `getCacheStatus()` - Public method for monitoring

**Console Logging**:
```
⏰ Cache stale (past TIGER 2025 release + grace period), downloading fresh data...
```

## Testing

Comprehensive test suite in `src/__tests__/unit/providers/tiger-cache-expiration.test.ts`:

### Test Coverage

- ✅ Cache fresh before expiration date
- ✅ Cache stale after expiration date
- ✅ Cache fresh if created after release date
- ✅ Respect `autoExpireCache=false` configuration
- ✅ Respect custom grace period
- ✅ Handle missing cache files gracefully
- ✅ `getCacheStatus()` returns correct values
- ✅ Date calculations use UTC correctly

### Run Tests

```bash
npm test -- tiger-cache-expiration.test.ts
```

### Demo Script

```bash
npx tsx examples/cache-expiration-demo.ts
```

## Grace Period Rationale

**30-day default**: Allows TIGER data to stabilize across all FTP mirrors after September 1st release.

**Why grace period matters**:
1. TIGER files may not be immediately available on all mirrors
2. Census Bureau may issue corrections in first few weeks
3. Downstream systems need time to validate new vintages
4. Prevents premature cache invalidation

**Production recommendations**:
- **High-traffic systems**: 60 days (more conservative)
- **Development/testing**: 30 days (default)
- **CI/CD pipelines**: 0-15 days (aggressive updates)

## Migration Path

**Existing deployments with old cache**:

1. Cache files created before implementation have no expiration metadata
2. Staleness check uses file modification time (backward compatible)
3. No manual cleanup required - automatic download on next request after expiration

**Manual cleanup (optional)**:

```bash
# Remove all cached GeoJSON files older than October 1, 2025
find packages/crypto/data/tiger-cache -name "*.geojson" -mtime +365 -delete
```

## Performance Impact

**Negligible overhead**:
- `fs.statSync()` is synchronous but extremely fast (microseconds)
- Single system call per cache check
- Comparison operations are simple date arithmetic
- No network I/O unless cache is stale

**Cache hit scenario**:
```
Before: access() → readFile() → parse JSON
After:  access() → statSync() → date comparison → readFile() → parse JSON
        +0.1ms overhead (statSync + comparison)
```

## Security Considerations

**No automatic deletion**:
- Stale cache files remain on disk
- Fresh downloads overwrite old files
- Manual cleanup prevents accidental data loss

**Filesystem integrity**:
- `try/catch` around `statSync()` prevents crashes
- Missing files treated as cache miss (not stale)
- Corrupted timestamps default to safe behavior

**Clock manipulation**:
- System clock changes affect expiration calculations
- NTP drift handled gracefully (UTC timestamps)
- Intentional clock manipulation detectable via monitoring

## Future Enhancements

**P1 - Production Readiness**:
- [ ] Add Prometheus metrics for cache hit/miss/stale rates
- [ ] Log structured events (JSON) for centralized monitoring
- [ ] Add circuit breaker for repeated download failures

**P2 - Operational Features**:
- [ ] Admin API endpoint to force cache refresh
- [ ] Batch cache validation across all layers
- [ ] Pre-download upcoming TIGER release before expiration

**P3 - Advanced Features**:
- [ ] Predictive refresh (download new data 7 days before expiration)
- [ ] Multi-version cache (keep both old and new during transition)
- [ ] Differential updates (only changed boundaries)

## References

- **TIGER Release Schedule**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **Implementation PR**: (link to PR when merged)
- **Test Suite**: `src/__tests__/unit/providers/tiger-cache-expiration.test.ts`
- **Demo Script**: `examples/cache-expiration-demo.ts`
