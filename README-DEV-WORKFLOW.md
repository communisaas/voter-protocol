# VOTER Protocol - Development Workflow

Complete guide for local development and production deployment.

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Build Shadow Atlas (mock data, fast)
npm run atlas:dev

# 3. Verify Atlas integrity
npm run atlas:verify

# 4. Start local Atlas server (in separate terminal)
npm run atlas:serve

# 5. Use in your app
# See examples/local-development.ts
```

## Development vs Production

### Development (Mock Data)
- **Fast:** Builds in ~1-2 seconds
- **Mock Districts:** Representative data for all 535 districts
- **No External APIs:** No Census API calls
- **Local Server:** Serves Atlas via HTTP (mimics IPFS)
- **Best for:** Client development, testing, iteration

### Production (Real Census Data)
- **Slow:** Requires downloading + processing shapefiles (~5-10 min)
- **Real Districts:** Actual congressional district boundaries
- **Census API:** Downloads TIGER/Line shapefiles
- **IPFS:** Published to decentralized storage
- **Best for:** Deployment, actual proof generation

## npm Scripts

| Command | Description | Use Case |
|---------|-------------|----------|
| `npm run atlas:dev` | Build mock Shadow Atlas | Local development |
| `npm run atlas:prod` | Build production Atlas (Census data) | Production deployment |
| `npm run atlas:verify` | Verify Atlas integrity | Testing, CI/CD |
| `npm run atlas:serve` | Start local HTTP server | Development |

## File Structure

```
voter-protocol/
├── shadow-atlas-us.json          # Generated Atlas (gitignored)
├── .env                           # Environment config
├── scripts/
│   ├── build-shadow-atlas.ts     # Atlas builder
│   ├── serve-atlas.ts            # Development server
│   └── verify-atlas.ts           # Integrity checker
├── examples/
│   └── local-development.ts      # Usage example
└── docs/
    └── shadow-atlas-hydration.md # Production strategy
```

## Development Workflow

### Step 1: Build Atlas (Development Mode)

```bash
npm run atlas:dev
```

**Output:**
```
=== Shadow Atlas Build Pipeline ===

Generating Congressional Districts dataset...
NOTE: Using representative data. Production should use Census shapefiles.
Generated 435 House districts
Adding Senate districts (2 per state)...
Added 100 Senate districts
Total districts: 535 (expected 535)
Converting districts to Merkle leaves...
Building Merkle tree with Poseidon hashing...
Merkle root: 0x24fbb...

✅ Shadow Atlas built successfully!
   Output: /Users/you/voter-protocol/shadow-atlas-us.json
   Districts: 535
   Merkle Root: 0x24fbb8669f430c88a6fefa469d5966e88bf38858927b8c3d2629d555a3bc5212
   File size: 222KB
```

### Step 2: Verify Atlas

```bash
npm run atlas:verify
```

**Checks:**
- ✅ Metadata structure
- ✅ District count (535 total, 435 House, 100 Senate)
- ✅ District field validation
- ✅ Merkle root computation
- ✅ Proof generation for sample districts

### Step 3: Serve Atlas Locally

```bash
npm run atlas:serve
```

**Endpoints:**
- `http://localhost:8080/atlas` - Full Atlas JSON
- `http://localhost:8080/atlas/metadata` - Metadata only
- `http://localhost:8080/atlas/root` - Merkle root (mimics on-chain read)
- `http://localhost:8080/health` - Server health check

**CORS:** Enabled for browser access

### Step 4: Use in Client Code

```typescript
import { VOTERClient } from '@voter-protocol/client';
import { createStreetAddress } from '@voter-protocol/client';

// Development configuration
const client = new VOTERClient({
  network: 'scroll-sepolia',
  nearNetwork: 'testnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',

  // USE LOCAL SERVER instead of IPFS
  shadowAtlasUrl: 'http://localhost:8080/atlas',

  // Skip NEAR for faster testing
  skipNEAR: true,

  // Minimal caching for development
  cacheStrategy: 'minimal'
});

await client.ready();

// Generate proof (when contracts are deployed)
const proof = await client.zk.proveDistrict({
  address: '1600 Pennsylvania Ave NW, Washington, DC 20500'
});
```

## Production Workflow

### Prerequisites

1. **Census Shapefiles:**
   - Download: `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_5m.zip`
   - Extract to `.atlas-cache/shapefiles/`

2. **IPFS Pinning Service:**
   - Pinata API key (free tier: 1GB)
   - OR Infura IPFS project

3. **Deployed Contracts:**
   - DistrictGate contract on Scroll
   - Governance multi-sig configured

### Step 1: Build Production Atlas

```bash
npm run atlas:prod
```

**Process:**
1. Downloads Census TIGER/Line shapefiles
2. Parses district geometries
3. Computes bounding boxes
4. Builds Merkle tree with Poseidon hashing
5. Outputs production-ready Atlas

**Output:** `shadow-atlas-us.json` (~5-10MB with full geometries)

### Step 2: Publish to IPFS

```typescript
import { create } from 'ipfs-http-client';
import * as fs from 'fs/promises';

const client = create({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: `Bearer ${process.env.PINATA_API_KEY}`
  }
});

const atlasData = await fs.readFile('shadow-atlas-us.json');
const { cid } = await client.add(atlasData);

console.log(`Atlas CID: ${cid}`);
// Output: QmXxx...
```

### Step 3: Update On-Chain CID

```solidity
// DistrictGate contract (Scroll mainnet)
function updateAtlas(
  string memory newCID,
  bytes32 newRoot
) external onlyGovernance {
  currentAtlasCID = newCID;
  currentMerkleRoot = newRoot;
  lastUpdated = block.timestamp;

  emit AtlasUpdated(newCID, newRoot, block.timestamp);
}
```

```typescript
// Call via governance multi-sig
const tx = await districtGate.updateAtlas(
  'QmXxx...', // New IPFS CID
  '0x24fbb...' // New Merkle root
);
```

### Step 4: Deploy Client

```typescript
// Production client configuration
const client = new VOTERClient({
  network: 'scroll-mainnet',
  nearNetwork: 'mainnet',
  districtGateAddress: '0x...', // Deployed contract
  reputationRegistryAddress: '0x...',
  shadowAtlasUrl: 'https://gateway.pinata.cloud/ipfs', // Production IPFS
  cacheStrategy: 'aggressive' // Cache for offline access
});
```

## Environment Variables

Create `.env` file:

```bash
# Environment (development | production)
NODE_ENV=development

# IPFS Configuration (Production)
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret

# Scroll RPC (Development = Sepolia, Production = Mainnet)
SCROLL_RPC_URL=https://sepolia-rpc.scroll.io

# DistrictGate Contract Address (deployed to Scroll)
DISTRICT_GATE_ADDRESS=0x0000000000000000000000000000000000000000

# Shadow Atlas CID (IPFS)
SHADOW_ATLAS_CID=

# Build Configuration
ATLAS_MODE=mock # mock | census | full
ATLAS_CACHE_DIR=.atlas-cache
```

## Troubleshooting

### Atlas Build Fails

**Problem:** Census API returns 500 error
**Solution:** Use local shapefiles instead (download manually)

**Problem:** WASM Poseidon module not found
**Solution:** Ensure `@voter-protocol/crypto` package is built: `cd packages/crypto/circuits && cargo build --release --target wasm32-unknown-unknown`

### Verification Fails

**Problem:** Merkle root mismatch
**Solution:** Rebuild Atlas (data corruption)

**Problem:** Invalid district structure
**Solution:** Check Atlas file format (must match interface)

### Local Server Not Responding

**Problem:** Port 8080 already in use
**Solution:** Change PORT in `scripts/serve-atlas.ts`

**Problem:** CORS errors in browser
**Solution:** Server includes CORS headers, check browser console

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Shadow Atlas CI

on: [push, pull_request]

jobs:
  verify-atlas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: npm install
      - run: npm run atlas:dev
      - run: npm run atlas:verify

      # Cache Atlas for faster subsequent builds
      - uses: actions/cache@v3
        with:
          path: shadow-atlas-us.json
          key: atlas-${{ hashFiles('scripts/build-shadow-atlas.ts') }}
```

## Next Steps

1. **Deploy Contracts:** Deploy DistrictGate to Scroll Sepolia
2. **Test Proofs:** Generate end-to-end proof with local Atlas
3. **Production Atlas:** Build with real Census shapefiles
4. **IPFS Publish:** Upload to Pinata/Infura
5. **On-Chain Update:** Update CID via governance multi-sig

## Resources

- **Shadow Atlas Spec:** `docs/shadow-atlas-hydration.md`
- **Client Package:** `packages/client/README.md`
- **Example Code:** `examples/local-development.ts`
- **Census Data:** https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **IPFS Pinning:** https://pinata.cloud/ | https://infura.io/product/ipfs

---

**Status:** ✅ Development workflow complete | Ready for production deployment
