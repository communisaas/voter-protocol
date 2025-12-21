# Shadow Atlas Security Module

Production-grade security infrastructure for geographic boundary data in the VOTER Protocol. Compromised boundaries could enable fraudulent ZK proofs, making security **critical**.

---

## Architecture Overview

**Defense-in-Depth Security:**

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Input Validation (Reject malicious inputs)   │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Rate Limiting (Prevent DoS attacks)          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Integrity Verification (Detect tampering)    │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Audit Logging (Security monitoring)          │
└─────────────────────────────────────────────────────────┘
```

**Threat Model:**
- **SSRF Attacks:** Malicious endpoint URLs could expose internal networks
- **Data Poisoning:** Compromised GIS portals serving fraudulent boundaries
- **DoS Attacks:** Resource exhaustion via rate limit bypass or malformed inputs
- **Injection Attacks:** SQL/command injection via state codes or FIPS codes
- **Merkle Proof Forgery:** Invalid proofs accepted as valid
- **Information Disclosure:** Error messages leaking internal state

---

## Modules

### 1. Input Validator (`input-validator.ts`)

Strict validation for all external inputs using Zod schemas.

**Features:**
- ✅ Geographic coordinate validation (WGS84 bounds)
- ✅ State code/FIPS code validation (injection prevention)
- ✅ URL allowlisting (SSRF protection)
- ✅ GeoJSON structure validation
- ✅ Response size limits (DoS protection)
- ✅ Precision limits (floating point complexity attacks)

**Usage:**
```typescript
import { validateCoordinates, validateURL } from './security';

// Validate user-provided coordinates
const result = validateCoordinates('43.0731', '-89.4012');
if (!result.success) {
  return res.status(400).json({ error: result.error });
}

const { lat, lon } = result.data;

// Validate upstream URL
const urlResult = validateURL(endpoint);
if (!urlResult.success) {
  throw new Error('Invalid upstream URL');
}
```

**Key Functions:**
- `validateCoordinates(lat, lon)` - Validate lat/lon coordinates
- `validateStateCode(code)` - Validate US state abbreviation
- `validateStateFips(fips)` - Validate FIPS code
- `validateURL(url)` - Validate upstream endpoint URL
- `validateJobID(id)` - Validate UUID job ID
- `validateGeoJSON(data)` - Validate GeoJSON structure
- `sanitizeErrorMessage(error)` - Remove sensitive data from errors

---

### 2. Rate Limiter (`rate-limiter.ts`)

Multi-tier rate limiting with token bucket algorithm.

**Features:**
- ✅ IP-based rate limiting (60 req/min default)
- ✅ API key-based rate limiting (1000 req/min default)
- ✅ Global rate limiting (10k req/min total)
- ✅ Cost multipliers for expensive endpoints
- ✅ Token bucket algorithm (smooth bursts)
- ✅ Automatic cleanup of stale buckets

**Usage:**
```typescript
import { defaultRateLimiter, getClientIdentifier, getEndpointCost } from './security';

// Extract client info from request
const client = getClientIdentifier(req, trustProxy);

// Get endpoint cost
const cost = getEndpointCost(url.pathname);

// Check rate limit
const result = defaultRateLimiter.check(client, cost);

if (!result.allowed) {
  res.writeHead(429, {
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': '0',
    'Retry-After': result.retryAfter?.toString(),
  });
  res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
  return;
}
```

**Endpoint Costs:**
- `/lookup`: 1 token (fast, cached lookup)
- `/snapshots`: 2 tokens (moderate DB query)
- `/snapshot`: 5 tokens (expensive, large response)
- `/extract`: 10 tokens (very expensive extraction)
- `/validate`: 5 tokens (expensive TIGER validation)

**Rate Limits (Production):**
- **IP-based:** 60 requests/minute (1 per second average)
- **API key:** 1000 requests/minute (16.7 per second average)
- **Global:** 10,000 requests/minute (166.7 per second total)

---

### 3. Integrity Checker (`integrity-checker.ts`)

Cryptographic verification of data integrity.

**Features:**
- ✅ Merkle proof verification
- ✅ GeoJSON geometry validation
- ✅ Boundary count verification
- ✅ Cross-source validation
- ✅ Content hash verification
- ✅ Snapshot integrity checks

**Usage:**
```typescript
import { verifyMerkleProof, verifyGeometryIntegrity, verifyBoundaryCount } from './security';

// Verify Merkle proof before returning to client
const isValid = verifyMerkleProof(
  proof.leaf,
  proof.siblings,
  proof.pathIndices,
  proof.root
);

if (!isValid) {
  throw new Error('Invalid Merkle proof generated');
}

// Validate geometry structure
const geometryCheck = verifyGeometryIntegrity(boundary.geometry);
if (!geometryCheck.geometryValid) {
  console.error('Invalid geometry:', geometryCheck.errors);
}

// Verify boundary count matches expected
const countCheck = verifyBoundaryCount('US-congressional', boundaries.length);
if (!countCheck.valid) {
  console.warn('Boundary count mismatch:', countCheck.error);
}
```

**Expected Boundary Counts:**
- `US-congressional`: 441 (435 voting + 6 territories)
- `US-state-senate`: 1,972
- `US-state-house`: 5,411
- `US-county`: 3,143
- `GB-parliamentary`: 650
- `CA-federal`: 338

---

### 4. Audit Logger (`audit-logger.ts`)

Tamper-evident security event logging with hash chains.

**Features:**
- ✅ Structured JSON logging (machine-readable)
- ✅ Hash chain for tamper detection
- ✅ Automatic log rotation (100 MB max)
- ✅ Correlation IDs for request tracing
- ✅ PII sanitization (GDPR/CCPA compliance)
- ✅ Configurable severity filtering

**Usage:**
```typescript
import { defaultSecurityLogger, generateCorrelationId } from './security';

const correlationId = generateCorrelationId();

// Log authentication attempt
await defaultSecurityLogger.logAuthentication({
  success: true,
  client: { ip: '192.168.1.1', apiKeyHash: hashAPIKey(apiKey) },
  request: { method: 'GET', path: '/lookup', query: { lat: '43', lon: '-89' } },
  apiKeyProvided: true,
  correlationId,
});

// Log validation failure
await defaultSecurityLogger.logValidationFailure({
  client: { ip: '192.168.1.1' },
  request: { method: 'GET', path: '/lookup', query: { lat: '999', lon: '0' } },
  validationType: 'coordinates',
  validationError: 'Latitude out of range',
  correlationId,
});

// Log integrity violation (CRITICAL)
await defaultSecurityLogger.logIntegrityViolation({
  client: { ip: '192.168.1.1' },
  request: { method: 'GET', path: '/lookup' },
  violationType: 'merkle_proof_mismatch',
  details: 'Proof verification failed for boundary WI-01',
  affectedData: 'boundary-WI-01',
  correlationId,
});
```

**Event Categories:**
- `authentication` - Authentication attempts (API keys, IP-based)
- `authorization` - Access control checks
- `validation` - Input validation failures
- `rate_limit` - Rate limit violations
- `integrity` - Data integrity violations
- `data_access` - Boundary data access (read/write/delete)
- `system` - Suspicious activity, system events

**Severity Levels:**
- `critical` - Immediate response required (integrity violations)
- `high` - Security incidents (auth failures, suspicious activity)
- `medium` - Policy violations (rate limits, validation failures)
- `low` - Minor anomalies
- `info` - Normal security events (successful auth, data access)

---

## Security Testing

Comprehensive test suite covering:

### Input Fuzzing (`__tests__/input-validator.test.ts`)
- ✅ Coordinate boundary testing (NaN, Infinity, out-of-range)
- ✅ Injection attack prevention (SQL, command, path traversal)
- ✅ DoS protection (excessive precision, oversized inputs)
- ✅ URL validation (SSRF, private IPs, allowlist enforcement)

### Rate Limit Testing (`__tests__/rate-limiter.test.ts`)
- ✅ Correct limit enforcement (IP, API key, global)
- ✅ Bypass prevention (IP rotation, header spoofing)
- ✅ Token bucket behavior (burst traffic, refill over time)
- ✅ Cost multiplier enforcement
- ✅ Memory management (stale bucket cleanup)

### Integrity Testing (`__tests__/integrity-checker.test.ts`)
- ✅ Merkle proof verification (valid/invalid proofs)
- ✅ Geometry validation (coordinates, topology, winding order)
- ✅ Boundary count verification
- ✅ Cross-source validation (detect discrepancies)
- ✅ Content hash verification (tamper detection)

**Run Tests:**
```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas
npm test security/__tests__/
```

---

## Integration Example

Complete security middleware integration:

```typescript
import { createServer } from 'http';
import {
  validateCoordinates,
  defaultRateLimiter,
  getClientIdentifier,
  getEndpointCost,
  verifyMerkleProof,
  defaultSecurityLogger,
  generateCorrelationId,
} from './security';

const server = createServer(async (req, res) => {
  const correlationId = generateCorrelationId();
  const client = getClientIdentifier(req, false); // trustProxy = false

  try {
    // Layer 1: Rate Limiting
    const cost = getEndpointCost(new URL(req.url!, 'http://localhost').pathname);
    const rateLimitResult = defaultRateLimiter.check(client, cost);

    if (!rateLimitResult.allowed) {
      await defaultSecurityLogger.logRateLimitViolation({
        client,
        request: extractRequestInfo(req),
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt,
        correlationId,
      });

      res.writeHead(429, { 'Retry-After': rateLimitResult.retryAfter?.toString() });
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    // Layer 2: Input Validation
    const url = new URL(req.url!, 'http://localhost');
    const latStr = url.searchParams.get('lat');
    const lonStr = url.searchParams.get('lon');

    const coordResult = validateCoordinates(latStr, lonStr);
    if (!coordResult.success) {
      await defaultSecurityLogger.logValidationFailure({
        client,
        request: extractRequestInfo(req),
        validationType: 'coordinates',
        validationError: coordResult.error,
        correlationId,
      });

      res.writeHead(400);
      res.end(JSON.stringify({ error: coordResult.error }));
      return;
    }

    const { lat, lon } = coordResult.data;

    // Perform lookup
    const boundary = await lookupService.lookup(lat, lon);

    // Layer 3: Integrity Verification
    const merkleProof = proofService.generateProof(boundary.id);
    const isValid = verifyMerkleProof(
      merkleProof.leaf,
      merkleProof.siblings,
      merkleProof.pathIndices,
      merkleProof.root
    );

    if (!isValid) {
      await defaultSecurityLogger.logIntegrityViolation({
        client,
        request: extractRequestInfo(req),
        violationType: 'invalid_merkle_proof',
        details: `Proof verification failed for boundary ${boundary.id}`,
        affectedData: boundary.id,
        correlationId,
      });

      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Proof verification failed' }));
      return;
    }

    // Layer 4: Audit Logging
    await defaultSecurityLogger.logDataAccess({
      client,
      request: extractRequestInfo(req),
      resourceType: 'boundary',
      resourceId: boundary.id,
      action: 'read',
      correlationId,
    });

    // Success
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ boundary, merkleProof }));
  } catch (error) {
    console.error('Request error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(3000);
```

---

## Security Audit

**Complete security audit:** `/packages/crypto/services/shadow-atlas/SECURITY_AUDIT.md`

**Key Findings:**
- 6 High-Severity vulnerabilities identified
- Comprehensive remediation roadmap provided
- Threat model documented
- Incident response procedures defined

**Critical Vulnerabilities Fixed:**
- ✅ H-1: URL Injection in `buildQueryUrl()` (SSRF risk)
- ✅ H-2: X-Forwarded-For spoofing (rate limit bypass)
- ✅ H-3: Input validation gaps (coordinate injection)
- ✅ H-4: No Merkle proof verification (integrity gap)
- ✅ H-5: CORS wildcard (malicious origins)
- ✅ H-6: Unvalidated FIPS codes (command injection)

---

## Production Deployment

### Environment Variables

```bash
# Rate limiting
RATE_LIMIT_IP=60              # Requests per minute per IP
RATE_LIMIT_API_KEY=1000       # Requests per minute per API key
RATE_LIMIT_GLOBAL=10000       # Total requests per minute

# Audit logging
AUDIT_LOG_DIR=./logs/security # Log directory
AUDIT_LOG_MIN_SEVERITY=info   # Minimum severity to log
AUDIT_LOG_RETENTION_DAYS=90   # Log retention period

# Trust proxy (only set if behind authenticated reverse proxy)
TRUST_PROXY=false             # Trust X-Forwarded-For header
```

### Security Checklist

**Before Production Deployment:**
- [ ] Run full security test suite (`npm test security/`)
- [ ] Review and customize URL allowlist for your environment
- [ ] Configure rate limits based on expected traffic
- [ ] Set up log aggregation (e.g., Elasticsearch, CloudWatch)
- [ ] Enable alerting for critical security events
- [ ] Test incident response procedures
- [ ] Document API key generation and rotation process
- [ ] Configure CORS allowlist (remove wildcard)
- [ ] Enable HTTPS/TLS for all endpoints
- [ ] Review audit log retention and compliance requirements

**Monitoring Alerts:**
- **P0 (Immediate):** >10% Merkle proof verification failures
- **P0 (Immediate):** >50% traffic increase in 5 minutes (DDoS indicator)
- **P1 (1 hour):** >5% error rate sustained for 5+ minutes
- **P1 (1 hour):** >100 rate limit violations from single IP in 1 minute

---

## Security Contacts

**Report Security Vulnerabilities:**
- Email: security@voter-protocol.org
- PGP Key: [To be published]

**Responsible Disclosure:**
- We request 90 days for remediation before public disclosure
- Bug bounty program: https://voter-protocol.org/security

---

## License

MIT License - See LICENSE file for details

---

## Related Documentation

- **[SECURITY_AUDIT.md](../SECURITY_AUDIT.md)** - Complete security audit report
- **[ARCHITECTURE_ACTUAL.md](../ARCHITECTURE_ACTUAL.md)** - Shadow Atlas architecture
- **[TECHNICAL.md](/TECHNICAL.md)** - VOTER Protocol technical documentation
- **[SECURITY.md](/SECURITY.md)** - VOTER Protocol security model
