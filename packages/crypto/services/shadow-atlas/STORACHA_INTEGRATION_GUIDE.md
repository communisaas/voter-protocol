# Storacha Integration Guide for Shadow Atlas

**Research Date:** 2025-12-18
**Target Use Case:** Decentralized IPFS pinning for quarterly Merkle tree snapshots

---

## Executive Summary

Storacha (formerly web3.storage) provides decentralized hot storage backed by Filecoin, ideal for Shadow Atlas quarterly Merkle tree snapshots (~1-5MB per snapshot). The free tier (5GB storage, 5GB egress) is sufficient for Shadow Atlas use cases.

**Key Integration Points:**
- **Upload**: Quarterly Merkle tree snapshots after state boundary extraction
- **Retrieval**: Browser-native proof verification via IPFS gateways
- **Fallback**: Local SQLite persistence when Storacha unavailable
- **Cost**: $0/month for Shadow Atlas scale (free tier coverage)

---

## 1. SDK Installation & Setup

### Package Selection

**Use `@storacha/client` (NOT `@web3-storage/w3up-client`)**

```bash
cd packages/crypto
npm install @storacha/client files-from-path
```

**Rationale:**
- `@storacha/client` is the actively developed package (v1.8.12 as of 2025-12-18)
- `@web3-storage/w3up-client` is legacy, maintained for backwards compatibility only
- Identical API, same underlying w3up protocol

### TypeScript Configuration

Add to `packages/crypto/tsconfig.json`:

```json
{
  "compilerOptions": {
    "moduleResolution": "node16",
    "module": "node16"
  }
}
```

**Required:** Storacha is ESM-only. Node.js 18+ with native ESM support required.

---

## 2. UCAN Authentication & Space Management

### Authentication Flow Overview

Storacha uses **UCAN (User Controlled Authorization Networks)** for auth:
1. **Agent**: Local keypair (DID) manages authentication
2. **Space**: Storage namespace (DID) for uploaded content
3. **Delegation**: UCAN tokens grant capabilities (upload, list, etc.)

### Two Authentication Strategies

#### **Strategy A: Email-Based (Development/Interactive)**

```typescript
import * as Client from '@storacha/client';

// 1. Create client (auto-generates agent)
const client = await Client.create();

// 2. Login via email (sends verification link)
await client.login('your-email@example.com');
// User clicks email link to verify

// 3. Create and register space
const space = await client.createSpace('shadow-atlas-prod');
await client.setCurrentSpace(space.did());

// 4. Save agent for reuse
const agent = client.agent();
console.log('Agent DID:', agent.did());
console.log('Space DID:', space.did());
```

**Use Case:** Initial setup, local development, manual testing.

---

#### **Strategy B: Delegated Keys (Production/CI)**

**For serverless/CI environments where email verification is impossible:**

```bash
# 1. Create delegation keys (run once locally with Storacha CLI)
npm install -g @storacha/cli
storacha key create
# Output: Mg... (private key) + did:key:z6Mk... (DID)

# 2. Create delegation with limited permissions
storacha space use shadow-atlas-prod
storacha delegation create did:key:z6Mk... \
  --can space/blob/add \
  --can space/index/add \
  --can filecoin/offer \
  --can upload/add \
  --base64

# 3. Store outputs as environment variables
export STORACHA_AGENT_KEY="Mg..."         # Agent private key
export STORACHA_PROOF="uOqJlcm9vdHOB..."  # Base64 delegation
```

**Decode delegation in code:**

```typescript
import * as Client from '@storacha/client';
import { CarReader } from '@ipld/car';
import * as DID from '@ipld/dag-ucan/did';

async function createProductionClient(): Promise<Client.Client> {
  const agentKey = process.env.STORACHA_AGENT_KEY;
  const proofBase64 = process.env.STORACHA_PROOF;

  if (!agentKey || !proofBase64) {
    throw new Error('Missing STORACHA_AGENT_KEY or STORACHA_PROOF env vars');
  }

  // Parse agent private key
  const principal = await DID.parse(agentKey);

  // Decode delegation proof (base64 → Uint8Array)
  const proofBytes = Buffer.from(proofBase64, 'base64');

  // Extract delegation from CAR format
  const reader = await CarReader.fromBytes(proofBytes);
  const blocks = [];
  for await (const block of reader.blocks()) {
    blocks.push(block);
  }

  // Create client with delegated proof
  const client = await Client.create({ principal });

  // Add proof to agent
  await client.addProof(proofBytes);

  return client;
}
```

**Use Case:** Production deployments, CI/CD pipelines, serverless functions.

---

## 3. Upload Implementation

### Core Upload Pattern

```typescript
import * as Client from '@storacha/client';
import type { MerkleTree, SnapshotMetadata } from './core/types.js';

/**
 * Upload Merkle tree snapshot to Storacha
 *
 * @param client - Authenticated Storacha client
 * @param merkleTree - Shadow Atlas Merkle tree
 * @param metadata - Snapshot metadata
 * @returns IPFS CID for snapshot
 */
async function uploadMerkleSnapshot(
  client: Client.Client,
  merkleTree: MerkleTree,
  metadata: SnapshotMetadata
): Promise<string> {
  // 1. Serialize snapshot to JSON
  const snapshot = {
    metadata: {
      id: metadata.id,
      merkleRoot: metadata.merkleRoot,
      boundaryCount: metadata.boundaryCount,
      createdAt: metadata.createdAt.toISOString(),
      regions: metadata.regions,
    },
    merkleTree: {
      root: merkleTree.root,
      leaves: merkleTree.leaves,
      tree: merkleTree.tree,
      // IMPORTANT: Districts contain full geometry - large!
      // For production, consider storing geometry separately
      districtCount: merkleTree.districts.length,
    },
    // Optional: Include full district data for complete snapshot
    // districts: merkleTree.districts,
  };

  const jsonData = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([jsonData], { type: 'application/json' });

  // 2. Upload to Storacha
  const cid = await client.uploadFile(blob, {
    retries: 3,
    dedupe: true, // Skip if already uploaded
  });

  console.log(`[Storacha] Uploaded snapshot ${metadata.id}`);
  console.log(`[Storacha] IPFS CID: ${cid}`);
  console.log(`[Storacha] Gateway URL: https://${cid}.ipfs.storacha.link/`);

  return cid.toString();
}
```

### Error Handling & Retry

```typescript
interface UploadResult {
  readonly success: boolean;
  readonly cid?: string;
  readonly error?: string;
  readonly retries: number;
}

async function uploadWithRetry(
  client: Client.Client,
  merkleTree: MerkleTree,
  metadata: SnapshotMetadata,
  maxRetries = 3
): Promise<UploadResult> {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const cid = await uploadMerkleSnapshot(client, merkleTree, metadata);
      return { success: true, cid, retries };
    } catch (error) {
      retries++;
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.error(`[Storacha] Upload attempt ${retries}/${maxRetries} failed:`, errorMsg);

      if (retries >= maxRetries) {
        return { success: false, error: errorMsg, retries };
      }

      // Exponential backoff: 2s, 4s, 8s
      const delayMs = Math.pow(2, retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { success: false, error: 'Max retries exceeded', retries };
}
```

---

## 4. Retrieval via IPFS Gateways

### Gateway URL Construction

```typescript
/**
 * Get IPFS gateway URLs for CID
 *
 * @param cid - IPFS CID (bafy... format)
 * @returns Gateway URLs (primary + fallback)
 */
function getGatewayUrls(cid: string): {
  primary: string;
  fallbacks: readonly string[];
} {
  return {
    primary: `https://${cid}.ipfs.storacha.link/`,
    fallbacks: [
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    ],
  };
}

/**
 * Fetch Merkle tree snapshot from IPFS
 *
 * @param cid - IPFS CID
 * @returns Merkle tree snapshot or null if unavailable
 */
async function fetchMerkleSnapshot(
  cid: string
): Promise<{ metadata: SnapshotMetadata; merkleTree: MerkleTree } | null> {
  const urls = getGatewayUrls(cid);

  // Try primary gateway first
  try {
    const response = await fetch(urls.primary, {
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (response.ok) {
      const data = await response.json();
      return data as { metadata: SnapshotMetadata; merkleTree: MerkleTree };
    }
  } catch (error) {
    console.warn(`[IPFS] Primary gateway failed (${cid}):`, error);
  }

  // Try fallback gateways
  for (const url of urls.fallbacks) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000) // 15s timeout for fallbacks
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[IPFS] Retrieved from fallback: ${url}`);
        return data as { metadata: SnapshotMetadata; merkleTree: MerkleTree };
      }
    } catch {
      continue; // Try next fallback
    }
  }

  console.error(`[IPFS] All gateways failed for CID: ${cid}`);
  return null;
}
```

### Rate Limiting Considerations

**Storacha Gateway Limits:**
- **200 requests/minute/IP** (primary gateway)
- Fallback to public gateways if rate-limited

```typescript
/**
 * Gateway rate limiter (simple token bucket)
 */
class GatewayRateLimiter {
  private tokens: number;
  private readonly maxTokens = 200;
  private readonly refillRate = 200 / 60000; // 200/min → tokens/ms

  private lastRefill = Date.now();

  async acquire(): Promise<void> {
    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;

    // Wait if no tokens available
    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.tokens = 1;
    }

    this.tokens -= 1;
  }
}

const rateLimiter = new GatewayRateLimiter();

async function rateLimitedFetch(cid: string): Promise<Response> {
  await rateLimiter.acquire();
  return fetch(`https://${cid}.ipfs.storacha.link/`);
}
```

---

## 5. Integration Architecture

### Where Storacha Fits in Shadow Atlas

```
┌──────────────────────────────────────────────────────────────┐
│ Shadow Atlas Pipeline                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Extract State Boundaries                                │
│     StateBatchExtractor → StateExtractionResult             │
│                                                              │
│  2. Validate & Normalize                                    │
│     DeterministicValidationPipeline → NormalizedDistrict[]  │
│                                                              │
│  3. Build Merkle Tree                                       │
│     MerkleTreeBuilder → MerkleTree                          │
│                                                              │
│  4. Persist Snapshot                                        │
│     ├─ SQLite (local persistence)   ✓ EXISTING             │
│     └─ Storacha (IPFS pinning)      ← NEW INTEGRATION      │
│                                                              │
│  5. Quarterly IPFS Update                                   │
│     - Upload new Merkle root to Storacha                    │
│     - Publish CID for browser verification                  │
│     - Maintain SQLite as fallback                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Integration Point in `ShadowAtlasService`

**Modify `/packages/crypto/services/shadow-atlas/core/shadow-atlas-service.ts`:**

```typescript
import * as Client from '@storacha/client';

export class ShadowAtlasService {
  private readonly storachaClient: Client.Client | null;

  constructor(config: ShadowAtlasConfig = DEFAULT_CONFIG) {
    // ... existing initialization ...

    // Initialize Storacha client if enabled
    if (config.ipfs.enabled) {
      this.storachaClient = await this.initStorachaClient(config.ipfs);
    } else {
      this.storachaClient = null;
    }
  }

  private async initStorachaClient(
    ipfsConfig: IPFSConfig
  ): Promise<Client.Client | null> {
    try {
      // Production: Use delegated keys
      if (process.env.STORACHA_AGENT_KEY && process.env.STORACHA_PROOF) {
        return await createProductionClient();
      }

      // Development: Use email login (interactive)
      if (ipfsConfig.email) {
        const client = await Client.create();
        await client.login(ipfsConfig.email);
        return client;
      }

      console.warn('[Storacha] No credentials configured, IPFS disabled');
      return null;
    } catch (error) {
      console.error('[Storacha] Failed to initialize client:', error);
      return null;
    }
  }

  private async commitToMerkleTree(
    stateResults: readonly StateExtractionResult[],
    jobId: string
  ): Promise<CommitmentResult> {
    const integration = integrateMultipleStates(stateResults, {
      applyAuthorityResolution: true,
    });

    const snapshotId = randomUUID();
    const metadata: SnapshotMetadata = {
      id: snapshotId,
      merkleRoot: integration.merkleTree.root,
      ipfsCID: '', // Will be set after Storacha upload
      boundaryCount: integration.merkleTree.districts.length,
      createdAt: new Date(),
      regions: stateResults.map(sr => sr.state),
    };

    // 1. Store in SQLite (local persistence)
    this.snapshots.set(snapshotId, {
      tree: integration.merkleTree,
      metadata,
    });

    // 2. Upload to Storacha (IPFS pinning)
    let ipfsCID = '';
    if (this.storachaClient) {
      const uploadResult = await uploadWithRetry(
        this.storachaClient,
        integration.merkleTree,
        metadata
      );

      if (uploadResult.success && uploadResult.cid) {
        ipfsCID = uploadResult.cid;
        metadata.ipfsCID = ipfsCID;

        this.log.info('Storacha upload successful', {
          snapshotId,
          ipfsCID,
          retries: uploadResult.retries,
        });
      } else {
        this.log.error('Storacha upload failed', {
          snapshotId,
          error: uploadResult.error,
          retries: uploadResult.retries,
        });
      }
    }

    return {
      snapshotId,
      merkleRoot: integration.merkleTree.root,
      ipfsCID,
      includedBoundaries: integration.stats.includedBoundaries,
      excludedBoundaries: integration.stats.deduplicatedBoundaries,
    };
  }
}
```

---

## 6. Configuration

### Add IPFS Config to `ShadowAtlasConfig`

**Modify `/packages/crypto/services/shadow-atlas/core/config.ts`:**

```typescript
export interface IPFSConfig {
  /** Enable IPFS uploads to Storacha */
  enabled: boolean;

  /** Email for interactive login (development only) */
  email?: string;

  /** Upload retry attempts */
  retryAttempts: number;

  /** Upload timeout (milliseconds) */
  timeoutMs: number;
}

export interface ShadowAtlasConfig {
  // ... existing config ...

  /** IPFS pinning configuration */
  ipfs: IPFSConfig;
}

export const DEFAULT_CONFIG: ShadowAtlasConfig = {
  // ... existing defaults ...

  ipfs: {
    enabled: false, // Disabled by default
    retryAttempts: 3,
    timeoutMs: 30000, // 30s
  },
};
```

### Environment Variables

```bash
# Production (CI/CD)
STORACHA_AGENT_KEY="Mg..."
STORACHA_PROOF="uOqJlcm9vdHOB..."

# Development (Interactive)
STORACHA_EMAIL="your-email@example.com"
```

---

## 7. Fallback Strategy

### Hybrid Persistence Model

```typescript
/**
 * Hybrid persistence: SQLite (primary) + Storacha (IPFS backup)
 *
 * STRATEGY:
 * - SQLite: Immediate local availability (fast)
 * - Storacha: Decentralized backup + browser verification
 * - Fallback: SQLite → IPFS gateway (if SQLite corrupted)
 */
async function loadSnapshot(
  snapshotId: string
): Promise<{ tree: MerkleTree; metadata: SnapshotMetadata } | null> {
  // 1. Try SQLite (fastest)
  const local = this.snapshots.get(snapshotId);
  if (local) {
    return local;
  }

  // 2. Try persistence adapter (SQLite DB)
  if (this.persistenceAdapter) {
    const metadata = await this.persistenceAdapter.getSnapshot(snapshotId);
    if (metadata && metadata.ipfsCID) {
      // SQLite has metadata, try IPFS for full tree
      const ipfsData = await fetchMerkleSnapshot(metadata.ipfsCID);
      if (ipfsData) {
        return ipfsData;
      }
    }
  }

  // 3. Fallback: Query IPFS directly (if CID known)
  // This requires external CID tracking or discovery mechanism
  return null;
}
```

---

## 8. Production Checklist

### Pre-Deployment

- [ ] **Create Storacha account** (free tier at https://storacha.network)
- [ ] **Generate delegation keys** (via `@storacha/cli`)
- [ ] **Configure environment variables** (`STORACHA_AGENT_KEY`, `STORACHA_PROOF`)
- [ ] **Test upload in staging** (verify CID accessibility)
- [ ] **Document CID publication strategy** (where do users find quarterly CIDs?)

### Monitoring

```typescript
interface StorachaMetrics {
  uploadsAttempted: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  totalBytesUploaded: number;
  averageUploadDurationMs: number;
  lastUploadCID: string;
  lastUploadTimestamp: Date;
}

class StorachaMetricsCollector {
  private metrics: StorachaMetrics = {
    uploadsAttempted: 0,
    uploadsSucceeded: 0,
    uploadsFailed: 0,
    totalBytesUploaded: 0,
    averageUploadDurationMs: 0,
    lastUploadCID: '',
    lastUploadTimestamp: new Date(0),
  };

  recordUpload(
    success: boolean,
    durationMs: number,
    sizeBytes: number,
    cid?: string
  ): void {
    this.metrics.uploadsAttempted++;

    if (success && cid) {
      this.metrics.uploadsSucceeded++;
      this.metrics.totalBytesUploaded += sizeBytes;
      this.metrics.lastUploadCID = cid;
      this.metrics.lastUploadTimestamp = new Date();

      // Update rolling average
      const totalDuration =
        this.metrics.averageUploadDurationMs * (this.metrics.uploadsSucceeded - 1) +
        durationMs;
      this.metrics.averageUploadDurationMs =
        totalDuration / this.metrics.uploadsSucceeded;
    } else {
      this.metrics.uploadsFailed++;
    }
  }

  getMetrics(): Readonly<StorachaMetrics> {
    return { ...this.metrics };
  }
}
```

---

## 9. Browser Verification Flow

### Client-Side Proof Verification

```typescript
/**
 * Browser-native Merkle proof verification
 *
 * USER FLOW:
 * 1. User provides address
 * 2. Browser fetches quarterly Merkle tree from IPFS (CID known)
 * 3. Browser generates ZK proof of district membership
 * 4. Smart contract verifies proof against on-chain Merkle root
 *
 * IPFS ROLE: Provide Merkle tree data without server dependency
 */

// Example: Fetch latest quarterly snapshot CID
const QUARTERLY_CIDS = {
  '2025-Q1': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  '2025-Q2': 'bafybeif...',
  // Updated quarterly via governance or automated pipeline
};

async function browserProofGeneration(
  userAddress: string,
  quarter: keyof typeof QUARTERLY_CIDS
): Promise<Uint8Array> {
  // 1. Fetch Merkle tree from IPFS
  const cid = QUARTERLY_CIDS[quarter];
  const snapshot = await fetchMerkleSnapshot(cid);

  if (!snapshot) {
    throw new Error('Failed to fetch Merkle tree from IPFS');
  }

  // 2. Find user's district via point-in-polygon
  const district = findDistrictForAddress(userAddress, snapshot.merkleTree);

  // 3. Generate Merkle proof
  const proof = generateMerkleProof(district, snapshot.merkleTree);

  // 4. Generate ZK proof (Noir circuit)
  const zkProof = await generateNoirProof({
    address: userAddress,
    district: district.id,
    merkleProof: proof,
  });

  return zkProof;
}
```

---

## 10. Cost Analysis

### Free Tier Coverage

**Shadow Atlas Quarterly Snapshot Size:**
- Merkle tree metadata: ~10 KB
- Merkle tree structure: ~50 KB
- Full district geometry: ~1-5 MB (depending on state count)
- **Estimated per-snapshot:** 1-5 MB

**Free Tier (Storacha):**
- **Storage:** 5 GB
- **Egress:** 5 GB/month

**Yearly Usage (4 quarterly snapshots):**
- **Storage:** 4 snapshots × 5 MB = 20 MB (0.4% of free tier)
- **Egress (assumed 1000 users/quarter):** 4 quarters × 1000 users × 5 MB = 20 GB
  - Exceeds free tier (5 GB/month = 60 GB/year if evenly distributed)

**Mitigation:**
1. **Dedupe:** Storacha skips re-uploading identical CIDs (saves storage)
2. **Compression:** gzip JSON before upload (reduces to ~500 KB/snapshot)
3. **Tiered strategy:** Free tier for snapshots, public gateways for retrieval
4. **Paid tier (if needed):** $0.15/GB storage, $0.15/GB egress (still cheap)

**Verdict:** Free tier sufficient for Shadow Atlas MVP. Paid tier ($2-5/month) if high traffic.

---

## 11. Example Integration Tests

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import * as Client from '@storacha/client';
import { ShadowAtlasService } from './core/shadow-atlas-service.js';

describe('Storacha Integration', () => {
  let client: Client.Client;
  let atlas: ShadowAtlasService;

  beforeAll(async () => {
    // Skip if no Storacha credentials
    if (!process.env.STORACHA_AGENT_KEY) {
      console.warn('Skipping Storacha tests (no credentials)');
      return;
    }

    client = await createProductionClient();
    atlas = new ShadowAtlasService({
      ipfs: { enabled: true, retryAttempts: 3, timeoutMs: 30000 },
    });
    await atlas.initialize();
  });

  it('should upload Merkle snapshot to Storacha', async () => {
    // 1. Extract Wisconsin boundaries
    const result = await atlas.extract({
      type: 'state',
      states: ['WI'],
    });

    expect(result.status).toBe('committed');
    expect(result.commitment?.ipfsCID).toBeTruthy();

    const cid = result.commitment!.ipfsCID;
    console.log(`Uploaded to IPFS: ${cid}`);

    // 2. Verify retrieval from IPFS gateway
    const snapshot = await fetchMerkleSnapshot(cid);
    expect(snapshot).toBeTruthy();
    expect(snapshot!.metadata.merkleRoot).toBe(result.commitment!.merkleRoot);
  });

  it('should handle upload failures gracefully', async () => {
    // Simulate network failure by using invalid client
    const invalidClient = await Client.create();
    // Don't login → no space → upload fails

    const result = await uploadWithRetry(
      invalidClient,
      { root: 'test', leaves: [], tree: [], districts: [] },
      {
        id: 'test',
        merkleRoot: 'test',
        ipfsCID: '',
        boundaryCount: 0,
        createdAt: new Date(),
        regions: [],
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
```

---

## 12. Security Considerations

### IPFS Content Addressing

**Threat Model:**
- ✅ **Content tampering:** Impossible (CID = hash of content)
- ✅ **MITM attacks:** Gateway HTTPS prevents injection
- ❌ **Availability attacks:** Gateway downtime (mitigated by fallbacks)
- ❌ **Data privacy:** ALL data public (acceptable for Shadow Atlas)

**Mitigations:**
1. **CID pinning:** Storacha guarantees availability via Filecoin deals
2. **Multiple gateways:** Fallback to Cloudflare, Pinata, ipfs.io
3. **On-chain verification:** Smart contract verifies Merkle root, not IPFS data
4. **SQLite fallback:** Local persistence when IPFS unavailable

### UCAN Delegation Security

**Threat Model:**
- ✅ **Key theft:** Agent keys stored as env vars (server-side only)
- ✅ **Capability escalation:** Delegations limit to upload-only
- ❌ **Key leakage:** If `STORACHA_AGENT_KEY` exposed, attacker uploads to your space

**Mitigations:**
1. **Minimal capabilities:** Only grant `space/blob/add`, `upload/add`
2. **Rotation:** Regenerate delegations quarterly
3. **Monitoring:** Track upload metrics for anomalies
4. **Isolation:** Separate spaces for dev/staging/prod

---

## 13. Migration Path

### Phase 1: Dual Storage (Current)

```
SQLite (primary) + Storacha (backup)
- All snapshots go to both
- Reads prefer SQLite (faster)
- Storacha CID logged for future use
```

### Phase 2: IPFS-First (Future)

```
Storacha (primary) + SQLite (cache)
- New snapshots upload to Storacha only
- SQLite caches IPFS data for performance
- Smart contract references IPFS CID
```

### Phase 3: Decentralized Only (Vision)

```
IPFS + Smart Contract (no centralized DB)
- Quarterly CIDs published on-chain
- Browsers fetch Merkle trees from IPFS directly
- Zero server infrastructure for proof generation
```

---

## 14. References & Resources

### Official Documentation
- [Storacha Quickstart](https://docs.storacha.network/quickstart/)
- [JavaScript Client Guide](https://docs.storacha.network/js-client/)
- [UCAN Concepts](https://docs.storacha.network/concepts/ucan/)
- [IPFS Gateway Retrieval](https://docs.storacha.network/how-to/retrieve/)

### NPM Packages
- [@storacha/client](https://www.npmjs.com/package/@storacha/client) - Official JS client (v1.8.12)
- [@storacha/cli](https://www.npmjs.com/package/@storacha/cli) - CLI for delegation creation

### Community Resources
- [GitHub: storacha/w3up](https://github.com/storacha/w3up) - Protocol implementation
- [UCAN Delegation Guide](https://blog.web3.storage/posts/ucan-delegation-with-w3up)
- [IPFS Gateway Docs](https://docs.ipfs.tech/concepts/ipfs-gateway/)

### IPFS Gateways
- Primary: `https://<CID>.ipfs.storacha.link/`
- Fallbacks:
  - `https://ipfs.io/ipfs/<CID>`
  - `https://cloudflare-ipfs.com/ipfs/<CID>`
  - `https://gateway.pinata.cloud/ipfs/<CID>`

---

## 15. Next Steps

1. **Install dependencies:** `npm install @storacha/client files-from-path`
2. **Create Storacha account:** https://storacha.network (free tier)
3. **Generate delegation keys:** Use `@storacha/cli` to create agent + delegation
4. **Test upload:** Run integration test with Wisconsin boundaries
5. **Implement `uploadMerkleSnapshot()`:** Add to `ShadowAtlasService.commitToMerkleTree()`
6. **Update config:** Add `ipfs` section to `ShadowAtlasConfig`
7. **Document CID discovery:** How do users find quarterly CIDs? (smart contract event? public registry?)
8. **Monitor usage:** Track uploads, failures, gateway latency

---

**Author:** Claude (Anthropic)
**License:** Same as Shadow Atlas (voter-protocol repository)
**Last Updated:** 2025-12-18
