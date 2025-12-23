# IPFS/Storacha Unavailable Runbook

**Severity**: P1 (High)
**Symptoms**: Snapshot pinning failures, retrieval errors, gateway timeouts
**Impact**: Proof generation fails, quarterly snapshots unpublishable

---

## Critical Context

**IPFS is the source of truth for ZK proofs**. If users cannot retrieve Shadow Atlas snapshots from IPFS, proof generation fails completely.

**Failure modes**:
1. **Pinning failure**: New snapshots cannot be uploaded
2. **Retrieval failure**: Existing snapshots cannot be downloaded
3. **Gateway timeout**: IPFS gateways overloaded
4. **Storacha API down**: Upload service unavailable

---

## Detection

### Automated Alerts

```bash
# Check for IPFS pinning failures
sqlite3 .shadow-atlas/persistence.db "
SELECT id, merkle_root, ipfs_cid, created_at
FROM snapshots
WHERE ipfs_cid IS NULL OR ipfs_cid = ''
  AND created_at >= datetime('now', '-24 hours')
ORDER BY created_at DESC;
"

# Expected: 0 results
# Alert if any snapshots missing IPFS CID
```

### Manual Health Check

```bash
# Test Storacha upload
npx tsx -e "
import { StorachaClient } from '@storacha/client';

const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

try {
  // Test with small payload
  const testData = new Uint8Array([1, 2, 3, 4, 5]);
  const cid = await client.put(testData);
  console.log('✓ Storacha upload successful:', cid);
} catch (error) {
  console.error('✗ Storacha upload FAILED:', error);
}
"

# Test IPFS retrieval
CID="bafybeiabc123..." # Use known CID
curl -sf -m 10 "https://w3s.link/ipfs/$CID" && echo "✓ IPFS retrieval works" || echo "✗ IPFS retrieval FAILED"
```

---

## Diagnostic Decision Tree

```
IPFS error detected
  │
  ├─> Pinning failure (cannot upload)
  │     ├─> Storacha API down → Wait & Retry
  │     ├─> Auth error → Check credentials
  │     └─> Quota exceeded → Upgrade plan
  │
  ├─> Retrieval failure (cannot download)
  │     ├─> Gateway timeout → Try alternative gateway
  │     ├─> CID not found → Verify pinning status
  │     └─> Network issue → Check connectivity
  │
  └─> Performance degradation
        ├─> Large snapshot → Optimize data size
        └─> Gateway overloaded → Use alternative
```

---

## Recovery Procedures

### Case A: Snapshot Pinning Failure

**Symptoms**: Snapshot created but IPFS upload fails

**Step 1: Verify snapshot integrity locally**

```bash
# Ensure snapshot is valid before retry
export SNAPSHOT_ID="snapshot_abc123"

sqlite3 .shadow-atlas/persistence.db "
SELECT
  id,
  merkle_root,
  boundary_count,
  created_at,
  ipfs_cid
FROM snapshots
WHERE id = '${SNAPSHOT_ID}';
"

# Verify Merkle tree
npx tsx -e "
import { verifyMerkleTree } from './integration/state-batch-to-merkle.js';
const valid = await verifyMerkleTree('${SNAPSHOT_ID}');
console.log('Merkle tree valid:', valid);
"
```

**Step 2: Test Storacha connectivity**

```bash
# Check auth credentials
echo "DID: $STORACHA_DID"
echo "Proof: ${STORACHA_PROOF:0:50}..." # Don't expose full proof

# Test with minimal payload
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

const testData = new TextEncoder().encode('test');
const cid = await client.put(testData);
console.log('Test upload CID:', cid);
"
```

**Step 3: Retry snapshot upload**

```bash
# Retry with exponential backoff
npx tsx -e "
import { uploadSnapshotToIPFS } from './integration/ipfs-uploader.js';

const snapshotId = '${SNAPSHOT_ID}';
let attempt = 1;
const maxAttempts = 5;

while (attempt <= maxAttempts) {
  try {
    console.log(\`Attempt \${attempt}/\${maxAttempts}...\`);
    const cid = await uploadSnapshotToIPFS(snapshotId);
    console.log('✓ Upload successful:', cid);

    // Update database
    await updateSnapshotCID(snapshotId, cid);
    break;
  } catch (error) {
    console.error(\`Attempt \${attempt} failed:\`, error);
    attempt++;
    if (attempt <= maxAttempts) {
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
"
```

**Step 4: Update database with CID**

```bash
# After successful upload
export CID="bafybeiabc123..."

sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots
SET ipfs_cid = '${CID}',
    updated_at = datetime('now')
WHERE id = '${SNAPSHOT_ID}';
"

# Verify
sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid FROM snapshots WHERE id = '${SNAPSHOT_ID}';
"
```

---

### Case B: Storacha API Down

**Symptoms**: HTTP 503, timeouts, connection refused

**Step 1: Check Storacha status**

```bash
# Check status page
open "https://status.w3s.link/" # Or check manually

# Test API endpoint
curl -sf "https://api.w3s.link/status" || echo "✗ Storacha API unreachable"
```

**Step 2: Temporary local storage**

```bash
# Store snapshot locally until Storacha recovers
mkdir -p .shadow-atlas/pending-ipfs-uploads

npx tsx -e "
import { exportSnapshot } from './integration/snapshot-exporter.js';
const data = await exportSnapshot('${SNAPSHOT_ID}');
fs.writeFileSync('.shadow-atlas/pending-ipfs-uploads/${SNAPSHOT_ID}.json', JSON.stringify(data));
console.log('Snapshot stored locally for retry');
"
```

**Step 3: Set up retry job**

```bash
# Cron job to retry pending uploads
# Add to crontab: */30 * * * * /path/to/retry-ipfs-uploads.sh

cat > ops/scripts/retry-ipfs-uploads.sh << 'EOF'
#!/bin/bash
for snapshot in .shadow-atlas/pending-ipfs-uploads/*.json; do
  if [ -f "$snapshot" ]; then
    echo "Retrying upload for $snapshot..."
    npx tsx -e "
    import { uploadSnapshotToIPFS } from './integration/ipfs-uploader.js';
    const snapshotId = '$snapshot'.match(/snapshot_[^.]+/)[0];
    const cid = await uploadSnapshotToIPFS(snapshotId);
    console.log('Uploaded:', cid);
    " && rm "$snapshot"
  fi
done
EOF

chmod +x ops/scripts/retry-ipfs-uploads.sh
```

**Step 4: Monitor for recovery**

```bash
# Auto-retry script
while true; do
  if curl -sf "https://api.w3s.link/status" > /dev/null; then
    echo "✓ Storacha recovered at $(date)"
    # Trigger pending uploads
    ops/scripts/retry-ipfs-uploads.sh
    break
  fi
  echo "Storacha still down, next check in 10 minutes..."
  sleep 600
done
```

---

### Case C: IPFS Gateway Timeout

**Symptoms**: Snapshot uploaded but retrieval fails or very slow

**Step 1: Test multiple gateways**

```bash
# Common IPFS gateways
GATEWAYS=(
  "https://w3s.link/ipfs"
  "https://ipfs.io/ipfs"
  "https://dweb.link/ipfs"
  "https://cloudflare-ipfs.com/ipfs"
  "https://gateway.pinata.cloud/ipfs"
)

export CID="bafybeiabc123..."

for gateway in "${GATEWAYS[@]}"; do
  echo "Testing $gateway..."
  time curl -sf -m 10 "$gateway/$CID" > /dev/null
  if [ $? -eq 0 ]; then
    echo "✓ Gateway responsive: $gateway"
  else
    echo "✗ Gateway failed: $gateway"
  fi
done
```

**Step 2: Use fastest gateway**

```typescript
// Update client configuration to use alternative gateway
const config = {
  ipfsGateway: 'https://cloudflare-ipfs.com/ipfs', // Fastest from test
  timeout: 30000,
};
```

**Step 3: Implement gateway fallback**

```typescript
// Robust IPFS retrieval with fallback
async function fetchFromIPFS(cid: string): Promise<Uint8Array> {
  const gateways = [
    'https://w3s.link/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
    'https://ipfs.io/ipfs',
  ];

  for (const gateway of gateways) {
    try {
      const response = await fetch(`${gateway}/${cid}`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      console.warn(`Gateway ${gateway} failed, trying next...`);
    }
  }

  throw new Error(`All IPFS gateways failed for CID: ${cid}`);
}
```

---

### Case D: CID Not Found

**Symptoms**: HTTP 404, "CID not pinned" errors

**Step 1: Verify CID in database**

```bash
# Check snapshot record
sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid, created_at
FROM snapshots
WHERE ipfs_cid = '${CID}';
"

# Check if CID valid format
echo "$CID" | grep -q "^bafy" && echo "✓ Valid CIDv1" || echo "✗ Invalid CID"
```

**Step 2: Check pinning status**

```bash
# Query Storacha for pin status
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

const cid = '${CID}';
const status = await client.status(cid);
console.log('Pin status:', status);
"
```

**Step 3: Re-pin if unpinned**

```bash
# If unpinned, re-upload snapshot
npx tsx -e "
import { uploadSnapshotToIPFS } from './integration/ipfs-uploader.js';
const snapshotId = await getSnapshotIdByCID('${CID}');
const newCID = await uploadSnapshotToIPFS(snapshotId);
console.log('Re-pinned with CID:', newCID);

// Update database if CID changed
if (newCID !== '${CID}') {
  await updateSnapshotCID(snapshotId, newCID);
}
"
```

---

### Case E: Quota Exceeded

**Symptoms**: "Storage quota exceeded" or similar errors

**Step 1: Check current usage**

```bash
# Query Storacha account usage
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

const usage = await client.usage();
console.log('Storage used:', usage.used, '/', usage.limit);
console.log('Percentage:', (usage.used / usage.limit * 100).toFixed(1), '%');
"
```

**Step 2: Clean up old snapshots**

```bash
# Identify deprecated snapshots safe to unpin
sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid, created_at, deprecated_at
FROM snapshots
WHERE deprecated_at IS NOT NULL
  AND deprecated_at < datetime('now', '-90 days')
ORDER BY deprecated_at ASC;
"

# Unpin old snapshots (CAREFUL!)
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});

const oldCIDs = ['bafy...', 'bafy...']; // From query above
for (const cid of oldCIDs) {
  await client.unpin(cid);
  console.log('Unpinned:', cid);
}
"
```

**Step 3: Upgrade Storacha plan**

If quota legitimately needed:
1. Log into Storacha dashboard
2. Upgrade to higher tier
3. Verify new quota
4. Resume snapshot uploads

---

## Monitoring & Prevention

### Daily IPFS Health Check

```bash
# Add to cron: 0 9 * * * ops/scripts/ipfs-health-check.sh
#!/bin/bash

# Check latest snapshot retrievable
LATEST_CID=$(sqlite3 .shadow-atlas/persistence.db "
SELECT ipfs_cid FROM snapshots
WHERE deprecated_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
")

if curl -sf -m 30 "https://w3s.link/ipfs/$LATEST_CID" > /dev/null; then
  echo "✓ Latest snapshot retrievable from IPFS"
else
  echo "✗ IPFS retrieval FAILED for latest snapshot"
  # Send alert
fi

# Check Storacha quota
npx tsx -e "
import { StorachaClient } from '@storacha/client';
const client = new StorachaClient({
  principal: process.env.STORACHA_DID,
  proof: process.env.STORACHA_PROOF,
});
const usage = await client.usage();
const pct = (usage.used / usage.limit * 100).toFixed(1);
console.log(\`Storage usage: \${pct}%\`);
if (pct > 80) {
  console.warn('⚠ Storage usage >80%, consider cleanup or upgrade');
}
"
```

### Snapshot Retention Policy

```sql
-- Keep quarterly snapshots forever
-- Deprecate monthly test snapshots after 90 days
UPDATE snapshots
SET deprecated_at = datetime('now')
WHERE created_at < datetime('now', '-90 days')
  AND id NOT LIKE '%quarterly%'
  AND deprecated_at IS NULL;
```

### Backup to Multiple IPFS Services

```typescript
// Pin to multiple providers for redundancy
async function uploadWithRedundancy(snapshot: Snapshot) {
  const providers = [
    new StorachaClient({ ... }),      // Primary
    new PinataClient({ ... }),        // Backup 1
    new InfuraIPFSClient({ ... }),    // Backup 2
  ];

  const cids: string[] = [];
  for (const provider of providers) {
    const cid = await provider.put(snapshot);
    cids.push(cid);
  }

  // Verify all CIDs match (same content)
  if (new Set(cids).size !== 1) {
    throw new Error('CID mismatch across providers!');
  }

  return cids[0];
}
```

---

## Escalation Criteria

**Escalate to Tech Lead if**:
- Storacha down >4 hours
- All IPFS gateways failing
- Quota cannot be increased
- Quarterly snapshot cannot be pinned

**Escalation template**:
```markdown
@tech-lead - IPFS/Storacha outage P1

**Issue**: [Pinning failure / Retrieval failure / Quota exceeded]
**Duration**: [Hours]
**Impact**: [Snapshots affected]

**Status**:
- Storacha API: [Up / Down]
- IPFS gateways: [X/5 working]
- Latest snapshot: [Retrievable / Unretrievable]

**Workarounds Attempted**:
- [Retry with backoff]
- [Alternative gateways]
- [Local storage fallback]

**Blocker**: [Why escalating]
**Need**: [Alternative IPFS provider / Quota increase / Architecture review]
```

---

## Alternative IPFS Providers

If Storacha long-term unavailable:

**Pinata**:
```typescript
import { PinataClient } from '@pinata/sdk';
const pinata = new PinataClient({ apiKey, apiSecret });
const result = await pinata.pinByHash(cid);
```

**Infura**:
```typescript
const auth = 'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');
const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
  method: 'POST',
  headers: { authorization: auth },
  body: snapshotData,
});
```

**NFT.Storage** (Free):
```typescript
import { NFTStorage } from 'nft.storage';
const client = new NFTStorage({ token: apiKey });
const cid = await client.storeBlob(snapshotData);
```

---

## Success Criteria

- [ ] Latest snapshot pinned to IPFS
- [ ] CID retrievable from at least 2 gateways
- [ ] Retrieval time <10 seconds
- [ ] Storacha quota <80%
- [ ] All snapshots from last quarter accessible
- [ ] Database updated with correct CIDs

---

**Related Runbooks**:
- [Data Corruption](data-corruption.md)
- [Invalid Merkle Tree](data-corruption.md)
- [Quarterly Update](../maintenance/quarterly-update.md)

**Last Updated**: 2025-12-18
