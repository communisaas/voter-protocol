# Shadow Atlas API Documentation

**Free, cryptographically verifiable district lookup API for VOTER Protocol.**

## Table of Contents

1. [Quick Start](#quick-start)
2. [Authentication](#authentication)
3. [Rate Limits](#rate-limits)
4. [Endpoints](#endpoints)
5. [Error Handling](#error-handling)
6. [Cryptographic Verification](#cryptographic-verification)
7. [Code Examples](#code-examples)
8. [Best Practices](#best-practices)
9. [Support](#support)

---

## Quick Start

### Get district by coordinates (free, no API key):

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903"
```

Response:

```json
{
  "success": true,
  "data": {
    "district": {
      "id": "0809",
      "name": "Congressional District 9",
      "jurisdiction": "USA/Colorado/Congressional District 9",
      "districtType": "congressional",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[-105.0, 39.7], [-104.9, 39.7]]]
      }
    },
    "merkleProof": {
      "root": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
      "leaf": "0x50fa016cf737a511e83d8f8f99420aa1...",
      "siblings": ["0x7e25e38a34daf68780556839d53cfdc5..."],
      "pathIndices": [0, 1, 0, 1]
    },
    "latencyMs": 23.4,
    "cacheHit": false
  },
  "meta": {
    "requestId": "req_abc123def456",
    "latencyMs": 23.4,
    "cached": false,
    "version": "v1"
  }
}
```

### Get current snapshot (verify Merkle proofs):

```bash
curl "https://api.shadow-atlas.org/v1/snapshot"
```

Response:

```json
{
  "success": true,
  "data": {
    "snapshotId": "shadow-atlas-2025-Q1",
    "ipfsCID": "QmXyz789...",
    "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
    "timestamp": "2025-01-15T00:00:00Z",
    "districtCount": 10000,
    "version": "1.0.0",
    "coverage": {
      "countries": ["US", "CA", "GB"],
      "states": ["AL", "AK", "WI", ...]
    }
  },
  "meta": {
    "requestId": "req_def456ghi789",
    "latencyMs": 8.2,
    "cached": false,
    "version": "v1"
  }
}
```

---

## Authentication

### Free Tier (No Authentication)

Free tier requires **no API key**. Rate limited to 1000 requests/day per IP address.

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903"
```

### Premium Tier (Bearer Token)

Premium tier requires API key for higher rate limits (100,000 requests/day).

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Get Premium API Key**: Contact [api@voter-protocol.org](mailto:api@voter-protocol.org)

---

## Rate Limits

### Free Tier

- **Limit**: 1000 requests/day per IP address
- **Window**: Rolling 24-hour window
- **Cost**: $0 (free forever)

### Premium Tier

- **Limit**: 100,000 requests/day per API key
- **Window**: Rolling 24-hour window
- **Cost**: $10/month

### Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1734528000
```

### Rate Limit Exceeded Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": {
      "limit": 1000,
      "remaining": 0,
      "resetAt": "2025-12-19T00:00:00Z"
    }
  },
  "meta": {
    "requestId": "req_abc123",
    "latencyMs": 1.2,
    "cached": false,
    "version": "v1"
  }
}
```

**HTTP Status**: `429 Too Many Requests`

---

## Endpoints

### `GET /v1/lookup`

Lookup district by coordinates.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lat` | number | Yes | Latitude (-90 to 90) |
| `lng` | number | Yes | Longitude (-180 to 180) |
| `layers` | array | No | District layers to include |

**Example**:

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903"
```

**Response**: See [Quick Start](#quick-start)

---

### `GET /v1/districts/:id`

Direct district lookup by ID (no geocoding).

**Path Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | District ID (e.g., "5501") |

**Example**:

```bash
curl "https://api.shadow-atlas.org/v1/districts/5501"
```

**Response**:

```json
{
  "success": true,
  "data": {
    "districtId": "5501",
    "merkleProof": {
      "root": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
      "leaf": "0x50fa016cf737a511e83d8f8f99420aa1...",
      "siblings": ["0x7e25e38a34daf68780556839d53cfdc5..."],
      "pathIndices": [0, 1, 0, 1]
    }
  },
  "meta": {
    "requestId": "req_ghi789jkl012",
    "latencyMs": 8.2,
    "cached": true,
    "version": "v1"
  }
}
```

---

### `GET /v1/health`

Health check with comprehensive metrics.

**Example**:

```bash
curl "https://api.shadow-atlas.org/v1/health"
```

**Response**:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 3600,
    "queries": {
      "total": 10000,
      "successful": 9950,
      "failed": 50,
      "latencyP50": 18.2,
      "latencyP95": 42.1,
      "latencyP99": 87.3,
      "throughput": 2.78
    },
    "cache": {
      "size": 8234,
      "hits": 8500,
      "misses": 1500,
      "hitRate": 0.85,
      "evictions": 234
    },
    "snapshot": {
      "currentCid": "QmXyz789...",
      "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
      "districtCount": 10000,
      "ageSeconds": 86400,
      "nextCheckSeconds": 2700
    },
    "errors": {
      "last5m": 2,
      "last1h": 15,
      "last24h": 50,
      "recentErrors": []
    },
    "timestamp": 1700000000000
  },
  "meta": {
    "requestId": "req_jkl012mno345",
    "latencyMs": 2.1,
    "cached": false,
    "version": "v1"
  }
}
```

---

### `GET /v1/snapshot`

Get current snapshot metadata.

**Example**:

```bash
curl "https://api.shadow-atlas.org/v1/snapshot"
```

**Response**: See [Quick Start](#quick-start)

---

### `GET /v1/snapshots`

List all available snapshots.

**Example**:

```bash
curl "https://api.shadow-atlas.org/v1/snapshots"
```

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "snapshotId": "shadow-atlas-2025-Q1",
      "ipfsCID": "QmXyz789...",
      "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
      "timestamp": "2025-01-15T00:00:00Z"
    },
    {
      "snapshotId": "shadow-atlas-2024-Q4",
      "ipfsCID": "QmAbc123...",
      "merkleRoot": "0x7e25e38a34daf68780556839d53cfdc5...",
      "timestamp": "2024-10-15T00:00:00Z"
    }
  ],
  "meta": {
    "requestId": "req_mno345pqr678",
    "latencyMs": 5.3,
    "cached": false,
    "version": "v1"
  }
}
```

---

## Error Handling

All errors follow standardized format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      // Additional error context (optional)
    }
  },
  "meta": {
    "requestId": "req_abc123",
    "latencyMs": 2.1,
    "cached": false,
    "version": "v1"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_PARAMETERS` | 400 | Invalid request parameters |
| `INVALID_COORDINATES` | 400 | Invalid lat/lng values |
| `DISTRICT_NOT_FOUND` | 404 | No district at coordinates |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `SNAPSHOT_UNAVAILABLE` | 404 | No snapshot available |
| `UNSUPPORTED_VERSION` | 400 | API version not supported |
| `NOT_FOUND` | 404 | Endpoint not found |
| `INTERNAL_ERROR` | 500 | Internal server error |

### Error Examples

#### Invalid Coordinates

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=999&lng=-104.9903"
```

Response (`400 Bad Request`):

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMETERS",
    "message": "Invalid request parameters",
    "details": {
      "fieldErrors": {
        "lat": ["Latitude must be <= 90"]
      }
    }
  },
  "meta": {
    "requestId": "req_pqr678stu901",
    "latencyMs": 2.1,
    "cached": false,
    "version": "v1"
  }
}
```

#### District Not Found

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=0&lng=0"
```

Response (`404 Not Found`):

```json
{
  "success": false,
  "error": {
    "code": "DISTRICT_NOT_FOUND",
    "message": "No district found at coordinates",
    "details": {
      "lat": 0,
      "lng": 0
    }
  },
  "meta": {
    "requestId": "req_stu901vwx234",
    "latencyMs": 18.7,
    "cached": false,
    "version": "v1"
  }
}
```

---

## Cryptographic Verification

Every lookup response includes a Merkle proof for cryptographic verification.

### Why Verify?

- **Zero Trust**: Don't trust the API server, verify cryptographically
- **Tamper Detection**: Detect forged or manipulated district data
- **Audit Trail**: Verify against immutable IPFS snapshots

### Verification Steps

1. **Get current snapshot**:

```bash
curl "https://api.shadow-atlas.org/v1/snapshot"
```

Extract `merkleRoot` and `ipfsCID`.

2. **Perform lookup**:

```bash
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903"
```

Extract `merkleProof` from response.

3. **Verify proof locally** (see code examples below).

4. **Verify against IPFS** (optional, for full zero-trust):

```bash
curl "https://ipfs.io/ipfs/QmXyz789..."
```

Compare `merkleRoot` from IPFS snapshot to API response.

---

## Code Examples

### TypeScript

```typescript
import { ShadowAtlasClient } from '@voter-protocol/shadow-atlas-client';

// Initialize client
const client = new ShadowAtlasClient({
  baseUrl: 'https://api.shadow-atlas.org/v1',
  apiKey: 'YOUR_API_KEY', // Optional (premium tier)
});

// Lookup district by coordinates
const result = await client.lookup(39.7392, -104.9903);

console.log('District:', result.district.name);
console.log('Merkle Root:', result.merkleProof.root);

// Verify proof locally
const isValid = client.verifyProof(
  result.district.id,
  result.merkleProof
);

console.log('Proof Valid:', isValid);

// Get current snapshot
const snapshot = await client.getSnapshot();
console.log('IPFS CID:', snapshot.ipfsCID);

// Health check
const health = await client.health();
console.log('Status:', health.status);
console.log('Latency P95:', health.queries.latencyP95);
```

### Python

```python
import requests
from typing import Dict, Any

class ShadowAtlasClient:
    def __init__(self, base_url: str = "https://api.shadow-atlas.org/v1", api_key: str = None):
        self.base_url = base_url
        self.headers = {}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"

    def lookup(self, lat: float, lng: float) -> Dict[str, Any]:
        """Lookup district by coordinates"""
        url = f"{self.base_url}/lookup"
        params = {"lat": lat, "lng": lng}
        response = requests.get(url, params=params, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_snapshot(self) -> Dict[str, Any]:
        """Get current snapshot metadata"""
        url = f"{self.base_url}/snapshot"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def health(self) -> Dict[str, Any]:
        """Health check"""
        url = f"{self.base_url}/health"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

# Usage
client = ShadowAtlasClient(api_key="YOUR_API_KEY")

# Lookup district
result = client.lookup(39.7392, -104.9903)
print(f"District: {result['data']['district']['name']}")
print(f"Merkle Root: {result['data']['merkleProof']['root']}")

# Get snapshot
snapshot = client.get_snapshot()
print(f"IPFS CID: {snapshot['data']['ipfsCID']}")

# Health check
health = client.health()
print(f"Status: {health['data']['status']}")
print(f"Latency P95: {health['data']['queries']['latencyP95']}ms")
```

### curl

```bash
#!/bin/bash

# Set API key (optional for premium tier)
API_KEY="YOUR_API_KEY"

# Lookup district
curl "https://api.shadow-atlas.org/v1/lookup?lat=39.7392&lng=-104.9903" \
  -H "Authorization: Bearer $API_KEY" \
  | jq .

# Get snapshot
curl "https://api.shadow-atlas.org/v1/snapshot" \
  -H "Authorization: Bearer $API_KEY" \
  | jq .

# Health check
curl "https://api.shadow-atlas.org/v1/health" \
  -H "Authorization: Bearer $API_KEY" \
  | jq .

# Get district by ID
curl "https://api.shadow-atlas.org/v1/districts/5501" \
  -H "Authorization: Bearer $API_KEY" \
  | jq .

# List snapshots
curl "https://api.shadow-atlas.org/v1/snapshots" \
  -H "Authorization: Bearer $API_KEY" \
  | jq .
```

### JavaScript (Browser)

```javascript
class ShadowAtlasClient {
  constructor(baseUrl = 'https://api.shadow-atlas.org/v1', apiKey = null) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async lookup(lat, lng) {
    const url = new URL(`${this.baseUrl}/lookup`);
    url.searchParams.append('lat', lat);
    url.searchParams.append('lng', lng);

    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Lookup failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async getSnapshot() {
    const url = `${this.baseUrl}/snapshot`;
    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Snapshot fetch failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async health() {
    const url = `${this.baseUrl}/health`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return await response.json();
  }
}

// Usage
const client = new ShadowAtlasClient();

// Lookup district
const result = await client.lookup(39.7392, -104.9903);
console.log('District:', result.data.district.name);
console.log('Merkle Root:', result.data.merkleProof.root);

// Get snapshot
const snapshot = await client.getSnapshot();
console.log('IPFS CID:', snapshot.data.ipfsCID);

// Health check
const health = await client.health();
console.log('Status:', health.data.status);
```

---

## Best Practices

### 1. Cache Responses Client-Side

API responses include `Cache-Control` headers. Respect these to reduce API calls:

```typescript
// Cache lookup results for 1 hour (API default)
const cache = new Map();

async function cachedLookup(lat: number, lng: number) {
  const key = `${lat},${lng}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data;
  }

  const result = await client.lookup(lat, lng);
  cache.set(key, { data: result, timestamp: Date.now() });
  return result;
}
```

### 2. Handle Rate Limits Gracefully

Implement exponential backoff for rate limit errors:

```typescript
async function lookupWithRetry(lat: number, lng: number, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.lookup(lat, lng);
    } catch (error) {
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        const resetAt = new Date(error.details.resetAt);
        const waitMs = Math.max(0, resetAt.getTime() - Date.now());
        await sleep(waitMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 3. Verify Proofs for Critical Operations

For high-stakes operations (on-chain transactions), verify Merkle proofs:

```typescript
import { verifyMerkleProof } from '@voter-protocol/crypto';

const result = await client.lookup(lat, lng);

// Verify proof locally
const isValid = verifyMerkleProof(
  result.data.district.id,
  result.data.merkleProof,
  result.data.merkleProof.root
);

if (!isValid) {
  throw new Error('Invalid Merkle proof! Data may be forged.');
}

// Verify against IPFS snapshot (full zero-trust)
const snapshot = await client.getSnapshot();
const ipfsData = await fetch(`https://ipfs.io/ipfs/${snapshot.data.ipfsCID}`);
const ipfsSnapshot = await ipfsData.json();

if (ipfsSnapshot.merkleTree.root !== result.data.merkleProof.root) {
  throw new Error('Merkle root mismatch! API compromised.');
}
```

### 4. Monitor API Health

Poll `/health` endpoint for monitoring:

```typescript
setInterval(async () => {
  const health = await client.health();

  if (health.data.status !== 'healthy') {
    console.error('API unhealthy:', health.data.status);
    // Send alert to ops team
  }

  if (health.data.queries.latencyP95 > 100) {
    console.warn('High latency detected:', health.data.queries.latencyP95);
  }
}, 60000); // Check every minute
```

### 5. Use Request IDs for Debugging

Include request IDs in error reports:

```typescript
try {
  const result = await client.lookup(lat, lng);
} catch (error) {
  console.error('Lookup failed');
  console.error('Request ID:', error.meta.requestId);
  console.error('Error Code:', error.error.code);
  console.error('Details:', error.error.details);
  // Send error report with request ID for support team debugging
}
```

---

## Support

### Getting Help

- **Documentation**: [https://docs.shadow-atlas.org](https://docs.shadow-atlas.org)
- **API Reference**: [OpenAPI Spec](./openapi.yaml)
- **GitHub Issues**: [https://github.com/voter-protocol/voter-protocol/issues](https://github.com/voter-protocol/voter-protocol/issues)
- **Email**: [api@voter-protocol.org](mailto:api@voter-protocol.org)

### Premium API Keys

Contact [api@voter-protocol.org](mailto:api@voter-protocol.org) for premium API keys:

- 100,000 requests/day
- Priority support
- SLA guarantees
- Custom rate limits
- $10/month

### Reporting Bugs

When reporting bugs, include:

- Request ID (from `meta.requestId`)
- HTTP status code
- Error code
- Request parameters
- Expected vs. actual behavior

Example bug report:

```
Request ID: req_abc123def456
HTTP Status: 404
Error Code: DISTRICT_NOT_FOUND
Parameters: lat=39.7392, lng=-104.9903
Expected: Congressional District 9
Actual: No district found
```

---

## Appendix

### API Base URLs

- **Production**: `https://api.shadow-atlas.org/v1`
- **Testnet**: `https://testnet.shadow-atlas.org/v1`
- **Local**: `http://localhost:3000/v1`

### Response Headers

All responses include:

- `X-Request-ID`: Unique request identifier
- `X-API-Version`: API version
- `X-RateLimit-Limit`: Rate limit per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `X-Cache`: Cache status (HIT or MISS)
- `Cache-Control`: Cache directives

### Deprecation Policy

When API versions are deprecated:

1. **Announcement**: 90 days notice on GitHub + email to API key holders
2. **Headers**: `Deprecation: true`, `Sunset: <date>`, `Link: <migration-guide>`
3. **Documentation**: Migration guide published at deprecation announcement
4. **Grace Period**: 90 days from announcement to sunset date
5. **Sunset**: Deprecated version returns `410 Gone` after sunset date

### Changelog

API version history will be maintained in this document and GitHub releases.

---

**Shadow Atlas API**: Free, cryptographically verifiable district lookups for democracy infrastructure.

*Quality civic data pays. Data lock-in costs.*
