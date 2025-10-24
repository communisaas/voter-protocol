# Shadow Atlas Hydration Strategy

## Overview

The Shadow Atlas is a global Merkle tree of electoral districts that enables zero-knowledge proof of district residency without revealing the user's address. This document outlines the complete hydration strategy for US Congressional districts (Phase 1).

## Current Implementation Status ✅

**Completed (Phase 1 - Representative Data):**
- ✅ Build pipeline script (`scripts/build-shadow-atlas.ts`)
- ✅ Poseidon-based Merkle tree construction
- ✅ 535 districts (435 House + 100 Senate)
- ✅ Proper SNARK-friendly hashing (circomlibjs)
- ✅ Metadata structure with versioning
- ✅ 222KB output file size

**Output:** `/shadow-atlas-us.json`
- Merkle Root: `0x24fbb8669f430c88a6fefa469d5966e88bf38858927b8c3d2629d555a3bc5212`
- 535 districts with unique Poseidon hashes
- Sorted by district ID for consistent ordering

## Production Requirements (Phase 2)

### 1. Accurate Geographic Boundaries

**Data Source:** Census Bureau TIGER/Line Shapefiles
- **Download URL:** `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_5m.zip`
- **Format:** ESRI Shapefile (.shp, .shx, .dbf, .prj)
- **Scale:** 1:5,000,000 (2MB compressed)
- **Fields:** GEOID, STATE, CD119, CENTLAT, CENTLON, geometry

**Alternative Sources:**
- High-resolution (1:500k): `cb_2024_us_cd119_500k.zip` (6.7MB)
- Low-resolution (1:20m): `cb_2024_us_cd119_20m.zip` (395KB)

### 2. Address-to-District Mapping

**The Core Challenge:**
How do we map `StreetAddress → Congressional District` while preserving privacy?

**Approach: Census Geocoding API + Point-in-Polygon**

```typescript
/**
 * Geocode address to lat/lon coordinates
 * FREE API - unlimited usage for non-commercial use
 */
async function geocodeAddress(address: StreetAddress): Promise<{ lat: number; lon: number }> {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
  const params = new URLSearchParams({
    address: address,
    benchmark: 'Public_AR_Current',
    format: 'json'
  });

  const response = await fetch(`${url}?${params}`);
  const data = await response.json();

  if (data.result.addressMatches.length > 0) {
    const match = data.result.addressMatches[0];
    return {
      lat: match.coordinates.y,
      lon: match.coordinates.x
    };
  }

  throw new Error('Address not found');
}

/**
 * Check if point is inside congressional district polygon
 * Uses ray-casting algorithm for point-in-polygon test
 */
function pointInPolygon(
  point: { lat: number; lon: number },
  polygon: number[][][]
): boolean {
  // Implement ray-casting algorithm
  // https://en.wikipedia.org/wiki/Point_in_polygon
}

/**
 * Find congressional district for an address
 */
async function findDistrictForAddress(
  address: StreetAddress,
  districts: DistrictGeometry[]
): Promise<string> {
  const coords = await geocodeAddress(address);

  for (const district of districts) {
    if (pointInPolygon(coords, district.geometry.rings)) {
      return district.geoid;
    }
  }

  throw new Error('Address not in any congressional district');
}
```

### 3. Privacy-Preserving Storage

**Current Approach (Placeholder):**
```json
{
  "addressRangeStart": "0x0000...0000",
  "addressRangeEnd": "0xffff...ffff"
}
```

**Production Approach:**

Instead of storing raw addresses, store **hashed address ranges** for efficient lookup:

```typescript
interface DistrictLeaf {
  districtId: string;
  districtType: 'house' | 'senate';
  hash: string; // Poseidon hash of district metadata

  // NEW: For client-side proof generation
  boundingBox: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };

  // Geometry stored separately in IPFS
  geometryIPFS: string; // CID for district polygon
}
```

**Client-Side Proof Flow:**

1. User enters address in browser
2. Client geocodes address → (lat, lon)
3. Client filters districts by bounding box
4. Client downloads polygon from IPFS for candidates
5. Client performs point-in-polygon test
6. Client generates Merkle proof for matching district
7. **Address never leaves browser**

### 4. Shapefile Processing Pipeline

**Libraries Required:**

```bash
npm install shapefile @turf/turf
```

**Processing Script:**

```typescript
import shapefile from 'shapefile';
import * as turf from '@turf/turf';
import { buildPoseidon } from 'circomlibjs';

async function processShapefile(shpPath: string) {
  const source = await shapefile.open(shpPath);
  const districts: DistrictGeometry[] = [];

  let result = await source.read();
  while (!result.done) {
    const feature = result.value;

    // Extract properties
    const geoid = feature.properties.GEOID;
    const state = feature.properties.STATE;
    const cd119 = feature.properties.CD119;

    // Calculate bounding box using Turf.js
    const bbox = turf.bbox(feature);
    const [minLon, minLat, maxLon, maxLat] = bbox;

    // Calculate centroid
    const centroid = turf.centroid(feature);
    const [lon, lat] = centroid.geometry.coordinates;

    districts.push({
      geoid,
      state,
      cd119,
      districtType: 'house',
      geometry: feature.geometry,
      centroid: { lat, lon },
      boundingBox: { minLat, maxLat, minLon, maxLon }
    });

    result = await source.read();
  }

  return districts;
}
```

### 5. IPFS Publishing

**Publishing Strategy:**

```typescript
import { create } from 'ipfs-http-client';

async function publishToIPFS(atlasData: AtlasData): Promise<string> {
  // Use Pinata or Infura for production IPFS pinning
  const client = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: {
      authorization: 'Bearer YOUR_PROJECT_SECRET'
    }
  });

  // Upload Atlas data
  const { cid } = await client.add(JSON.stringify(atlasData));

  // Pin to ensure persistence
  await client.pin.add(cid);

  console.log(`Published to IPFS: ${cid}`);
  return cid.toString();
}
```

**Quarterly Update Process:**

1. Download latest Census shapefiles (quarterly releases)
2. Process shapefiles → generate Atlas
3. Build Merkle tree with Poseidon hashing
4. Publish to IPFS → get new CID
5. Update on-chain CID in DistrictGate contract
6. Emit `AtlasUpdated(newCID, newRoot)` event

### 6. On-Chain Integration

**DistrictGate Contract Updates:**

```solidity
contract DistrictGate {
    // Current Atlas state
    string public currentAtlasCID;
    bytes32 public currentMerkleRoot;
    uint256 public lastUpdated;

    // Governance multi-sig
    address public governance;

    event AtlasUpdated(
        string indexed newCID,
        bytes32 indexed newRoot,
        uint256 timestamp
    );

    /**
     * Update Shadow Atlas (quarterly)
     * Can only be called by governance multi-sig
     */
    function updateAtlas(
        string memory newCID,
        bytes32 newRoot
    ) external {
        require(msg.sender == governance, "Only governance");
        require(newRoot != bytes32(0), "Invalid root");

        currentAtlasCID = newCID;
        currentMerkleRoot = newRoot;
        lastUpdated = block.timestamp;

        emit AtlasUpdated(newCID, newRoot, block.timestamp);
    }

    /**
     * Verify district proof using current Merkle root
     */
    function verifyDistrictProof(
        bytes32 leafHash,
        bytes32[] memory proof,
        uint256[] memory pathIndices
    ) public view returns (bool) {
        bytes32 computedHash = leafHash;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (pathIndices[i] == 0) {
                // Current node is left child
                computedHash = keccak256(
                    abi.encodePacked(computedHash, proofElement)
                );
            } else {
                // Current node is right child
                computedHash = keccak256(
                    abi.encodePacked(proofElement, computedHash)
                );
            }
        }

        return computedHash == currentMerkleRoot;
    }
}
```

## Phase Rollout Plan

### Phase 1: Representative Data ✅ COMPLETE
- [x] Build pipeline implementation
- [x] Poseidon Merkle tree
- [x] 535 districts (House + Senate)
- [x] Mock data structure

### Phase 2: US Production Data 🚧 NEXT
- [ ] Download Census TIGER/Line shapefiles
- [ ] Implement shapefile processing
- [ ] Add Census Geocoding API integration
- [ ] Implement point-in-polygon tests
- [ ] Generate production Atlas with real boundaries
- [ ] Publish to IPFS
- [ ] Deploy DistrictGate contract to Scroll testnet
- [ ] Test end-to-end proof generation

### Phase 3: State Legislatures
- [ ] Add state house districts (~5,411 districts)
- [ ] Add state senate districts (~1,972 districts)
- [ ] Update Atlas structure for multi-level hierarchy

### Phase 4: City Councils
- [ ] Integrate Municipal Boundary data
- [ ] Add ~19,000 city council districts
- [ ] Implement hierarchical district lookups

### Phase 5: International
- [ ] Add UK Parliamentary constituencies (650)
- [ ] Add Canadian ridings (338)
- [ ] Add EU Parliament constituencies (705)
- [ ] Global rollout (190+ countries)

## File Size Projections

| Phase | Districts | Est. Size (compressed) | IPFS Storage Cost |
|-------|-----------|------------------------|-------------------|
| Phase 1 (Current) | 535 | 222 KB | ~$0.001/month |
| Phase 2 (Production) | 535 | ~2-5 MB | ~$0.01/month |
| Phase 3 (State) | 7,918 | ~30-50 MB | ~$0.15/month |
| Phase 4 (Municipal) | 26,918 | ~100-200 MB | ~$0.50/month |
| Phase 5 (Global) | ~50,000 | ~200-400 MB | ~$1.00/month |

**Note:** Pinata charges $20/month for 100GB pinning. These costs are negligible.

## Testing Strategy

### Unit Tests
```typescript
describe('Shadow Atlas', () => {
  it('should generate valid Merkle tree', async () => {
    const atlas = await buildShadowAtlas();
    expect(atlas.districts).toHaveLength(535);
    expect(atlas.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('should verify Merkle proofs', async () => {
    const atlas = await buildShadowAtlas();
    const proof = generateMerkleProof(atlas, 'CA-12');
    expect(verifyMerkleProof(proof, atlas.root)).toBe(true);
  });

  it('should geocode addresses correctly', async () => {
    const coords = await geocodeAddress(
      createStreetAddress('1600 Pennsylvania Ave NW, Washington, DC 20500')
    );
    expect(coords.lat).toBeCloseTo(38.8977, 3);
    expect(coords.lon).toBeCloseTo(-77.0365, 3);
  });
});
```

### Integration Tests
```typescript
describe('End-to-end proof generation', () => {
  it('should generate valid district proof for real address', async () => {
    const client = new VOTERClient({
      scrollRpcUrl: 'https://sepolia-rpc.scroll.io',
      shadowAtlasCID: 'QmTestCID...'
    });

    await client.ready();

    const proof = await client.proveDistrict(
      createStreetAddress('1600 Pennsylvania Ave NW, Washington, DC 20500')
    );

    expect(proof.districtId).toBe('DC-00');
    expect(proof.merkleProof.root).toBe(await client.getOnChainRoot());
  });
});
```

## Security Considerations

1. **PII Protection:** Address never leaves browser during proof generation
2. **Merkle Root Verification:** Client verifies on-chain root matches Atlas root
3. **Quarterly Updates:** Census redistricting handled via governance multi-sig
4. **IPFS Pinning:** Multiple redundant pins (Pinata + Infura + self-hosted)
5. **Governance Controls:** Only multi-sig can update Atlas CID

## Next Steps

1. **Implement shapefile processing** (scripts/process-shapefiles.ts)
2. **Add Census Geocoding integration** (packages/client/src/geocoding.ts)
3. **Generate production Atlas** with real district boundaries
4. **Deploy to IPFS** (Pinata + Infura)
5. **Update DistrictGate contract** with CID
6. **Test end-to-end** on Scroll testnet

## Resources

- **Census TIGER/Line Shapefiles:** https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **Census Geocoding API:** https://geocoding.geo.census.gov/geocoder/
- **Poseidon Hash Spec:** https://www.poseidon-hash.info/
- **IPFS Pinning (Pinata):** https://pinata.cloud/
- **IPFS Pinning (Infura):** https://infura.io/product/ipfs

---

**Status:** Phase 1 complete ✅ | Ready for Phase 2 implementation 🚀
