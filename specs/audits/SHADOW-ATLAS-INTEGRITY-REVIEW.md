# Shadow Atlas Data Integrity Security Review

**Reviewer:** Data Integrity Specialist
**Date:** 2026-02-01
**Status:** COMPLETE
**Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

This review analyzes the Shadow Atlas pipeline for data poisoning, manipulation, and corruption vulnerabilities across the data acquisition, transformation, persistence, and serving layers. The codebase demonstrates strong security awareness with comprehensive input validation, SSRF protections, and cryptographic verification. However, several gaps exist that could be exploited by sophisticated attackers.

**Overall Risk Assessment: MEDIUM**

The system has robust defenses but contains exploitable weaknesses in:
- TIGER checksum validation timing
- Rate limiter bypass scenarios
- Persisted state deserialization
- IPFS sync service (currently stubbed)

---

## Attack Vector Analysis

### 1. Data Poisoning via Malicious Shapefiles

**Risk Level: MEDIUM**

#### Current Defenses (STRONG)
The system implements comprehensive GeoJSON validation in `/src/security/input-validator.ts`:

```typescript
// Coordinate validation - rejects NaN, Infinity, out-of-range values
CoordinateSchema = z.object({
  lat: z.number()
    .min(-90).max(90)
    .refine((val) => !isNaN(val) && isFinite(val))
    .refine((val) => decimals <= 8) // Precision limit
});

// Polygon structure validation
GeoJSONPolygonCoordinatesSchema = z.array(GeoJSONLinearRingSchema)
  .min(1).max(100); // Ring count limit

// Feature count limit
GeoJSONFeatureCollectionSchema.features.max(50000);
```

The `PostDownloadValidator` in `/src/acquisition/post-download-validator.ts` adds semantic validation:
- Rejects >100 features (likely precincts, not districts)
- Detects precinct/parcel/voting properties as red flags
- Validates ring closure and vertex counts
- Checks WGS84 bounds

#### Identified Vulnerabilities

**V1.1: Winding Order Exploitation (MEDIUM)**
Location: `/src/security/integrity-checker.ts` lines 297-314

The topology validator checks RFC 7946 winding order but only logs errors - it doesn't reject malformed geometry. An attacker could submit polygons with incorrect winding order that pass validation but cause point-in-polygon tests to produce inverted results.

```typescript
// Current: Logs error but valid=false doesn't prevent processing
if (isExterior && area > 0) {
  errors.push(`Ring ${ringIndex} has incorrect winding order...`);
  valid = false; // But what happens after?
}
```

**Recommendation:** Ensure winding order failures abort the ingestion pipeline entirely.

**V1.2: No Self-Intersection Detection (LOW)**
The topology validator checks for duplicate consecutive points but does NOT detect:
- Self-intersecting polygons
- Overlapping ring boundaries
- Zero-area polygons

Self-intersecting geometry can cause undefined behavior in spatial indexes.

**V1.3: Overlapping District Registration (MEDIUM)**
Location: `/src/serving/district-service.ts`

No validation prevents registering districts with overlapping boundaries. An attacker who compromises an upstream data source could register:
- A district that fully contains another (voter in inner district gets wrong assignment)
- Two partially overlapping districts (ambiguous voter assignment)

**Recommendation:** Implement overlap detection using R-tree spatial queries before committing new boundaries.

---

### 2. TIGER Checksum Manipulation

**Risk Level: HIGH**

#### Current Defenses (INCOMPLETE)
Location: `/src/providers/tiger-verifier.ts`

```typescript
export function verifyTIGERBuffer(data: Buffer, expectedHash: string): VerificationResult {
  const actualHash = computeSHA256(data);
  const valid = actualHash.toLowerCase() === expectedHash.toLowerCase();
  return { valid, expectedHash, actualHash, fileSize: data.length, ... };
}
```

The checksum verification is cryptographically sound but has critical timing issues:

#### Identified Vulnerabilities

**V2.1: Verification AFTER Download - TOCTOU Race (HIGH)**
Location: `/src/providers/tiger-verifier.ts` line 269-321

The `downloadAndVerifyTIGER()` function:
1. Downloads the entire file into memory
2. THEN verifies the checksum
3. Only throws AFTER corrupted data is in memory

This creates a window where corrupted data exists in-process. If an exception handler doesn't properly clean up, or if another thread accesses the buffer, corrupted data could leak.

```typescript
// VULNERABLE PATTERN:
const data = Buffer.from(await response.arrayBuffer()); // Corrupted data now in memory
const result = verifyTIGERBuffer(data, expectedHash);   // Verification happens here
if (!result.valid) {
  throw new TIGERIntegrityError(url, result, url);     // But data already loaded
}
```

**Recommendation:** Stream-verify downloads by computing hash incrementally during download. Reject before the full payload is in memory.

**V2.2: Empty Checksums in Manifest (HIGH)**
Location: `/src/providers/tiger-manifest.ts` lines 103-183

**ALL checksums in the manifest are empty strings:**

```typescript
cd119: {
  sha256: '', // TODO: Generate from Census Bureau download
  ...
},
county: {
  sha256: '', // TODO: Generate from Census Bureau download
  ...
}
```

The `getTIGERChecksum()` function returns `null` for empty strings:
```typescript
return entry.sha256 || null; // Returns null for empty string
```

This means `verifyTIGERFileFromManifest()` with `strictMode = false` (or `allowEmptyChecksums = true`) will SKIP VERIFICATION ENTIRELY.

**Impact:** A MITM attacker could replace Census TIGER downloads with malicious shapefiles and they would be accepted without verification.

**Recommendation:**
1. Populate all manifest checksums immediately
2. NEVER allow `strictMode = false` in production
3. Add CI check that fails if any manifest checksum is empty

**V2.3: Checksum Downgrade Attack (MEDIUM)**
If an attacker can modify environment variables or configuration, they could:
- Set `strictMode: false`
- Set `allowEmptyChecksums: true`

Both options exist and are documented, making social engineering easier.

**Recommendation:** Remove these options in production builds. Use compile-time constants.

---

### 3. Persisted State Tampering

**Risk Level: MEDIUM-HIGH**

#### Current Defenses (GOOD)
Location: `/src/security/input-validator.ts` lines 991-1069

The system implements Zod schema validation for deserializing persisted state:

```typescript
export const CheckpointStateSchema = z.object({
  id: z.string().uuid(),
  completedStates: z.array(z.string().regex(/^\d{2}$/)),
  failedStates: z.array(z.string().regex(/^\d{2}$/)),
  ...
});

export function parseCheckpointState(json: string): ValidatedCheckpointState {
  const parsed = JSON.parse(json) as unknown;
  return CheckpointStateSchema.parse(parsed); // Throws on invalid
}
```

#### Identified Vulnerabilities

**V3.1: Fallback to Unvalidated Parse (HIGH)**
Location: `/src/acquisition/tiger-ingestion-orchestrator.ts` lines 656-683

```typescript
private async loadCheckpoint(id: string, checkpointDir: string): Promise<CheckpointState | null> {
  try {
    return parseCheckpointState(content); // Schema validation
  } catch (validationError) {
    // FALLBACK: Logs warning but proceeds with unvalidated data!
    logger.warn('Checkpoint validation failed, using unvalidated parse');
    return JSON.parse(content) as CheckpointState; // DANGEROUS
  }
}
```

An attacker who can write to the checkpoint directory can:
1. Create a malformed checkpoint file
2. The schema validation fails
3. The fallback `JSON.parse()` accepts it anyway
4. Malicious data is processed

**Attack Scenario:**
```json
{
  "id": "ckpt_1234",
  "completedStates": ["01", "../../etc/passwd", "06"],
  "options": { "checkpointDir": "/etc/shadow-atlas/owned" }
}
```

**Recommendation:** Remove the fallback entirely. Fail-secure, not fail-open.

**V3.2: Job State File Path Injection (MEDIUM)**
Location: `/src/persistence/sqlite-adapter.ts`

The job ID format is validated:
```typescript
jobId: z.string().regex(/^job-[a-z0-9]+-[a-f0-9]+$/);
```

But checkpoint files use unvalidated IDs:
```typescript
const filePath = join(checkpointDir, `${id}.json`); // id not validated
```

An attacker could craft an ID like `../../other-dir/evil` to write outside the checkpoint directory.

**Recommendation:** Validate checkpoint IDs match the expected format before filesystem operations.

**V3.3: SQLite WAL Mode Corruption (LOW)**
The SQLite adapter enables WAL mode for concurrent reads:
```typescript
this.db.pragma('journal_mode = WAL');
```

If an attacker can corrupt the WAL file (`*-wal`), they could inject malicious data that appears to have been committed. This requires filesystem access.

---

### 4. Rate Limiter Bypass

**Risk Level: MEDIUM**

#### Current Defenses (STRONG)
Location: `/src/security/rate-limiter.ts`

The `MultiTierRateLimiter` implements three tiers:
- Global: 10,000 req/min (protects against distributed attacks)
- API Key: 1,000 req/min (authenticated users)
- IP: 60 req/min (unauthenticated)

Anti-bypass logic (lines 146-154):
```typescript
const ipBucketUsed = ipBucket.getRemaining() < this.ipConfig.maxRequests;

// If API key present AND IP bucket is fresh, use API key limits
if (client.apiKey && !ipBucketUsed) {
  // Higher limits
}
// Otherwise, enforce IP limit
```

#### Identified Vulnerabilities

**V4.1: Bucket Cleanup Race Condition (MEDIUM)**
Location: Lines 337-355

```typescript
private cleanup(): void {
  for (const [ip, bucket] of this.ipBuckets.entries()) {
    // If bucket is full, it hasn't been used recently
    if (bucket.getRemaining() === this.ipConfig.maxRequests) {
      this.ipBuckets.delete(ip);
    }
  }
}
```

Race condition: If cleanup runs between a request exhausting the bucket and the next token refill:
1. Attacker exhausts IP bucket (0 tokens)
2. Tokens refill to max (60 tokens)
3. Cleanup sees full bucket, deletes it
4. Attacker's next request gets fresh bucket with full tokens
5. Attacker gets double the rate limit

**Timing Attack:**
An attacker who knows the 5-minute cleanup interval could synchronize requests to exploit this.

**Recommendation:** Track `lastAccessedAt` timestamp instead of checking if bucket is full.

**V4.2: IPv6 Fragmentation Attack (LOW)**
The `normalizeIP()` function handles IPv4-mapped addresses but doesn't normalize IPv6 properly:

```typescript
export function normalizeIP(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip.toLowerCase();
}
```

An attacker could use different representations of the same IPv6 address to get multiple rate limit buckets:
- `2001:db8::1`
- `2001:0db8:0000:0000:0000:0000:0000:0001`
- `2001:db8::0:1`

**Recommendation:** Fully normalize IPv6 addresses to a canonical form.

**V4.3: X-Forwarded-For Spoofing (MEDIUM)**
Location: Lines 393-407

```typescript
export function getClientIdentifier(req: IncomingMessage, trustProxy = false): ClientIdentifier {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      ip = forwarded.split(',')[0]?.trim() ?? ip;
    }
  }
}
```

If `trustProxy` is enabled but the proxy doesn't strip client-supplied headers, an attacker can spoof any IP:
```
X-Forwarded-For: 1.2.3.4, attacker-ip
```

The rate limiter will use `1.2.3.4`, giving the attacker unlimited IPs.

**Recommendation:** Document that operators MUST configure their proxy to overwrite (not append to) X-Forwarded-For.

---

### 5. SSRF via Discovery URLs

**Risk Level: LOW (Well Protected)**

#### Current Defenses (EXCELLENT)
Location: `/src/security/input-validator.ts` lines 199-420

**Domain Allowlist:**
```typescript
const ALLOWED_DOMAINS = [
  'tigerweb.geo.census.gov',
  'www2.census.gov',
  'services.arcgis.com',
  // ... 50+ vetted domains
];
```

**Private IP Rejection:**
```typescript
const privateIPRegex = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/;
if (privateIPRegex.test(hostname)) return false;

if (hostname === 'localhost' || hostname === '::1') return false;
if (hostname.startsWith('169.254.')) return false; // Link-local
```

**HTTPS Enforcement:**
```typescript
if (parsed.protocol !== 'https:') return false;
```

#### Identified Vulnerabilities

**V5.1: DNS Rebinding Window (LOW)**
The URL is validated once, but DNS resolution happens later at fetch time. An attacker controlling a domain could:
1. Return a public IP during validation
2. TTL=0 DNS record
3. Return `127.0.0.1` during actual fetch

**Mitigation:** The allowlist prevents attacker-controlled domains from being used at all, making this attack impractical.

**V5.2: Allowlist Bypass via `bypassAllowlist` Option (MEDIUM)**
Location: `/src/security/secure-fetch.ts` lines 42-49

```typescript
export interface SecureFetchOptions {
  readonly bypassAllowlist?: boolean;
  readonly bypassReason?: string;
}
```

This option exists for "operator-configured sources" but:
1. There's no authentication on who can set this flag
2. The bypass reason is just logged, not verified
3. Code that incorrectly passes `bypassAllowlist: true` creates SSRF

**Recommendation:** Require a cryptographic signature or admin API key to enable bypass mode.

---

### 6. Cache Poisoning

**Risk Level: MEDIUM**

#### Current Defenses
Location: `/src/serving/performance/regional-cache.ts`

The three-tier cache (L1/L2/L3) implements:
- TTL-based expiration
- LRU eviction with priority weighting
- IPFS content-addressed storage (immutable by design)

#### Identified Vulnerabilities

**V6.1: No Cache Key Validation (MEDIUM)**
```typescript
set(districtId: string, district: DistrictBoundary, priority = CachePriority.LOW): void {
  // districtId is used directly as cache key without validation
  this.l1Cache.set(districtId, entry);
}
```

If an attacker can influence `districtId`, they could:
- Use very long strings to exhaust memory
- Use specially-crafted strings that collide with other keys
- Inject cache entries that shadow legitimate districts

**V6.2: IPFS Gateway Trust (MEDIUM)**
Location: Lines 703-718

```typescript
const gateways = [
  primaryGateway,
  'https://w3s.link',
  'https://dweb.link',
  'https://ipfs.io',
];
```

If ANY gateway in the fallback chain is compromised, they could serve malicious snapshot data. IPFS CIDs are content-addressed, but the response JSON could be malformed or contain malicious geometry.

**V6.3: L3 Cache Writes Unvalidated Data (MEDIUM)**
Location: Lines 769-789

```typescript
private async saveSnapshotToCache(cid: string, snapshot: SnapshotData, cacheDir: string): Promise<void> {
  await atomicWriteJSON(cachePath, snapshot); // snapshot not validated
}
```

Data fetched from IPFS is written to local filesystem cache without validation. An attacker who compromises an IPFS gateway could persist malicious data locally.

**Recommendation:** Validate fetched IPFS data against the `SnapshotData` schema before caching.

---

### 7. Sync Service Vulnerabilities

**Risk Level: HIGH (Currently Stubbed)**

Location: `/src/serving/sync-service.ts`

**Current State:** The entire IPFS sync service is STUBBED:
```typescript
private async resolveIPNS(name: string): Promise<string> {
  logger.warn('SA-008: IPFS sync is stubbed - returning mock CID');
  return `QmMock${Date.now()}`; // MOCK DATA
}

private async validateSnapshot(dbPath: string, metadata: SnapshotMetadata): Promise<boolean> {
  logger.warn('SA-008: Snapshot validation is stubbed - returning true');
  return true; // NO VALIDATION
}
```

**V7.1: CRITICAL - No Snapshot Validation**
When implemented, this service will:
1. Resolve IPNS to get latest CID
2. Download snapshot from IPFS
3. Validate (currently stubbed to always true)
4. Swap the serving database

An attacker who can:
- Compromise IPNS resolution
- Compromise any IPFS gateway
- Poison DNS for the gateway
...could inject a malicious snapshot database.

**V7.2: No CID-to-Merkle-Root Verification**
The `validateSnapshot` TODO mentions:
```typescript
// - Validate CID matches on-chain registered roots
```

This is critical for security. The Merkle root published on-chain is the source of truth. Downloaded snapshots MUST have their Merkle root verified against the on-chain value.

**Recommendation:** Block production deployment until SA-008 is complete with:
- IPNS resolution with fallback
- Snapshot schema validation
- Merkle root verification against on-chain root
- Database integrity checks before swap

---

## Summary of Findings

| ID | Vulnerability | Severity | Status |
|----|--------------|----------|--------|
| V1.1 | Winding order errors not fatal | MEDIUM | Open |
| V1.2 | No self-intersection detection | LOW | Open |
| V1.3 | Overlapping district registration | MEDIUM | Open |
| V2.1 | Checksum after download (TOCTOU) | HIGH | Open |
| V2.2 | Empty checksums in manifest | HIGH | **CRITICAL** |
| V2.3 | Checksum strictMode bypass | MEDIUM | Open |
| V3.1 | Checkpoint validation fallback | HIGH | Open |
| V3.2 | Job ID path injection | MEDIUM | Open |
| V3.3 | SQLite WAL corruption | LOW | Open |
| V4.1 | Rate limiter cleanup race | MEDIUM | Open |
| V4.2 | IPv6 normalization | LOW | Open |
| V4.3 | X-Forwarded-For spoofing | MEDIUM | Open |
| V5.1 | DNS rebinding | LOW | Mitigated |
| V5.2 | bypassAllowlist option | MEDIUM | Open |
| V6.1 | Cache key validation | MEDIUM | Open |
| V6.2 | IPFS gateway trust | MEDIUM | Open |
| V6.3 | Unvalidated L3 cache writes | MEDIUM | Open |
| V7.1 | Stubbed snapshot validation | HIGH | Blocked on SA-008 |
| V7.2 | No CID-to-Merkle verification | HIGH | Blocked on SA-008 |

---

## Recommended Hardening Actions

### Immediate (Before Production)

1. **Populate TIGER manifest checksums** - V2.2 is critical
2. **Remove checkpoint validation fallback** - V3.1 allows arbitrary code paths
3. **Block `strictMode: false` in production builds** - V2.3

### Short-Term (Next Sprint)

4. **Implement streaming hash verification** for TIGER downloads
5. **Add overlap detection** before registering new districts
6. **Validate IPFS data** before writing to L3 cache
7. **Normalize IPv6 addresses** fully in rate limiter

### Medium-Term (Before GA)

8. **Complete SA-008** with full snapshot validation
9. **Add self-intersection detection** in geometry validation
10. **Implement cryptographic signing** for `bypassAllowlist` option
11. **Document proxy configuration requirements** for X-Forwarded-For

---

## Answers to Specific Questions

### Q1: What happens if a shapefile contains invalid GeoJSON coordinates?

**Answer:** The system rejects them with comprehensive validation:
- Coordinates outside WGS84 bounds (-90/90 lat, -180/180 lon) are rejected
- NaN, Infinity, and non-numeric values are rejected
- Precision >8 decimal places is rejected (DoS protection)
- However, winding order violations only log errors, they don't block ingestion

### Q2: Can an attacker register a district with overlapping boundaries?

**Answer:** Yes. There is no spatial overlap detection before committing new boundaries. Two districts can be registered that overlap, causing ambiguous voter assignments.

### Q3: Are TIGER checksums validated before or after decompression?

**Answer:** The checksums are validated against the **compressed** ZIP file, before decompression. This is correct for detecting MITM attacks on the download. However:
1. ALL checksums are currently empty (no validation happening)
2. Validation happens after the full file is in memory (TOCTOU window)

### Q4: Can the sync service accept data from non-IPFS sources?

**Answer:** Currently, the sync service is stubbed and accepts mock data. When implemented (SA-008), it should ONLY accept data from IPFS gateways. However, the fallback gateway chain includes multiple external services, any of which could be compromised.

### Q5: Is there input validation on all REST API endpoints?

**Answer:** Yes, comprehensive Zod validation in `/src/serving/api.ts`:
- Coordinates validated against range
- District IDs validated as non-empty strings
- Pagination parameters validated (limit 1-1000, offset >= 0)
- Query parameters type-coerced and validated

Rate limiting is applied before validation, protecting against DoS via malformed requests.

---

## Conclusion

The Shadow Atlas pipeline demonstrates security-conscious design with defense-in-depth. The most critical issues are:

1. **Empty TIGER checksums** - Effectively no integrity verification
2. **Stubbed IPFS sync** - Critical path not implemented
3. **Checkpoint validation fallback** - Fail-open design

These should be addressed before any production deployment involving real voter data.

---

*Report generated: 2026-02-01*
