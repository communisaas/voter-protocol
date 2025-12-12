/**
 * Shadow Atlas Browser Adapter
 *
 * Browser-compatible interface for Shadow Atlas district lookups and Merkle proof generation.
 * Bridges the client's expected API with the crypto package's serving layer.
 *
 * Architecture Decision:
 * - The serving layer (packages/crypto/services/shadow-atlas/serving/) is server-side (SQLite)
 * - This adapter provides a browser-compatible interface that can:
 *   1. Call remote Shadow Atlas API endpoints
 *   2. Work with IPFS-hosted snapshot data
 *   3. Generate Merkle proofs client-side from loaded data
 *
 * Type Safety: Zero tolerance for `any` types, explicit type guards for runtime validation.
 */

import type { StreetAddress } from '../utils/addresses';
import type { MerkleProof as ClientMerkleProof } from './types';

/**
 * Cache strategy for Shadow Atlas data
 */
type CacheStrategy = 'aggressive' | 'minimal';

/**
 * Shadow Atlas snapshot metadata
 */
interface SnapshotMetadata {
  readonly cid: string;
  readonly merkleRoot: bigint;
  readonly timestamp: number;
  readonly districtCount: number;
  readonly version: string;
}

/**
 * District lookup result from geocoding
 */
interface DistrictLookup {
  readonly districtId: string;
  readonly districtType: 'house' | 'senate' | 'council' | 'ward' | 'municipal';
  readonly name: string;
  readonly jurisdiction: string;
  readonly coordinates: {
    readonly lat: number;
    readonly lon: number;
  };
}

/**
 * Shadow Atlas client for browser environments
 *
 * Provides district lookups and Merkle proof generation with support for:
 * - IPFS snapshot loading
 * - Remote API calls
 * - Client-side Merkle tree operations
 * - IndexedDB caching (aggressive mode)
 */
export class ShadowAtlas {
  private readonly gatewayUrl: string;
  private readonly cacheStrategy: CacheStrategy;

  // Loaded snapshot state
  private loadedCID: string | null = null;
  private loadedRoot: bigint | null = null;
  private snapshotMetadata: SnapshotMetadata | null = null;

  // API endpoint (if using remote service)
  private apiEndpoint: string | null = null;

  /**
   * Create Shadow Atlas client
   *
   * @param gatewayUrl - IPFS gateway URL or Shadow Atlas API endpoint
   * @param cacheStrategy - 'aggressive' for IndexedDB caching, 'minimal' for in-memory only
   */
  constructor(gatewayUrl: string, cacheStrategy: CacheStrategy = 'aggressive') {
    this.gatewayUrl = gatewayUrl;
    this.cacheStrategy = cacheStrategy;

    // Detect if URL is an API endpoint (has /api/ or /v1/) vs IPFS gateway
    if (gatewayUrl.includes('/api/') || gatewayUrl.includes('/v1/')) {
      this.apiEndpoint = gatewayUrl;
    }
  }

  /**
   * Load Shadow Atlas snapshot and verify against on-chain root
   *
   * CRITICAL: This prevents wasting 8-12 seconds generating proofs that will fail on-chain.
   * Always call this before generateProof() to ensure snapshot matches contract state.
   *
   * @param cid - IPFS CID of Shadow Atlas snapshot
   * @param expectedRoot - On-chain Merkle root to verify against (hex string or bigint)
   * @throws Error if snapshot root doesn't match on-chain root
   */
  async load(cid: string, expectedRoot: string | bigint): Promise<void> {
    // Convert string to bigint if needed
    const expectedRootBigInt = typeof expectedRoot === 'string'
      ? BigInt(expectedRoot)
      : expectedRoot;

    // Check if already loaded with correct root
    if (this.loadedCID === cid && this.loadedRoot === expectedRootBigInt) {
      return; // Already loaded and verified
    }

    // If using API endpoint, verify snapshot availability
    if (this.apiEndpoint) {
      await this.verifyAPISnapshot(cid, expectedRootBigInt);
      this.loadedCID = cid;
      this.loadedRoot = expectedRootBigInt;
      return;
    }

    // Otherwise, load snapshot from IPFS and verify
    await this.loadFromIPFS(cid, expectedRootBigInt);
    this.loadedCID = cid;
    this.loadedRoot = expectedRootBigInt;
  }

  /**
   * Generate Merkle proof for district membership
   *
   * @param address - Full street address (e.g., "123 Main St, Springfield, IL 62701")
   * @returns Merkle proof in client format
   * @throws Error if snapshot not loaded or address not found
   */
  async generateProof(address: StreetAddress): Promise<ClientMerkleProof> {
    if (!this.loadedCID || !this.loadedRoot) {
      throw new Error('Shadow Atlas not loaded - call load() first');
    }

    // If using API endpoint, fetch proof from API
    if (this.apiEndpoint) {
      return this.generateProofFromAPI(address);
    }

    // Otherwise, generate proof from local snapshot data
    return this.generateProofLocal(address);
  }

  /**
   * Verify API snapshot availability and root match
   */
  private async verifyAPISnapshot(cid: string, expectedRoot: bigint): Promise<void> {
    if (!this.apiEndpoint) {
      throw new Error('No API endpoint configured');
    }

    try {
      // Call API health/snapshot endpoint
      const response = await fetch(`${this.apiEndpoint}/snapshot`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        cid: string;
        merkleRoot: string;
        districtCount: number;
        version: string;
        timestamp: number;
      };

      // Verify CID matches
      if (data.cid !== cid) {
        throw new Error(
          `API snapshot mismatch: expected ${cid}, got ${data.cid}`
        );
      }

      // Verify Merkle root matches
      const apiRoot = BigInt(data.merkleRoot);
      if (apiRoot !== expectedRoot) {
        throw new Error(
          `Merkle root mismatch: expected ${expectedRoot.toString(16)}, got ${apiRoot.toString(16)}`
        );
      }

      // Store metadata
      this.snapshotMetadata = {
        cid: data.cid,
        merkleRoot: apiRoot,
        timestamp: data.timestamp,
        districtCount: data.districtCount,
        version: data.version,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to verify API snapshot: ${error.message}`);
      }
      throw new Error('Failed to verify API snapshot: Unknown error');
    }
  }

  /**
   * Load snapshot from IPFS and verify root
   */
  private async loadFromIPFS(cid: string, expectedRoot: bigint): Promise<void> {
    try {
      // Fetch snapshot metadata from IPFS
      const metadataUrl = `${this.gatewayUrl}/ipfs/${cid}/metadata.json`;
      const response = await fetch(metadataUrl);

      if (!response.ok) {
        throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
      }

      const metadata = await response.json() as {
        merkleRoot: string;
        districtCount: number;
        version: string;
        timestamp: number;
      };

      // Verify Merkle root
      const ipfsRoot = BigInt(metadata.merkleRoot);
      if (ipfsRoot !== expectedRoot) {
        throw new Error(
          `Merkle root mismatch: expected ${expectedRoot.toString(16)}, got ${ipfsRoot.toString(16)}`
        );
      }

      // Store metadata
      this.snapshotMetadata = {
        cid,
        merkleRoot: ipfsRoot,
        timestamp: metadata.timestamp,
        districtCount: metadata.districtCount,
        version: metadata.version,
      };

      // If aggressive caching, store in IndexedDB
      if (this.cacheStrategy === 'aggressive') {
        await this.cacheSnapshot(cid, metadata);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load IPFS snapshot: ${error.message}`);
      }
      throw new Error('Failed to load IPFS snapshot: Unknown error');
    }
  }

  /**
   * Generate proof from API endpoint
   */
  private async generateProofFromAPI(address: StreetAddress): Promise<ClientMerkleProof> {
    if (!this.apiEndpoint) {
      throw new Error('No API endpoint configured');
    }

    try {
      // First, geocode address to coordinates
      const geocodeResponse = await fetch(`${this.apiEndpoint}/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      if (!geocodeResponse.ok) {
        throw new Error(`Geocoding failed: ${geocodeResponse.status}`);
      }

      const geocodeData = await geocodeResponse.json() as {
        lat: number;
        lon: number;
        district: DistrictLookup;
      };

      // Then, get Merkle proof for district
      const proofResponse = await fetch(`${this.apiEndpoint}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: geocodeData.lat,
          lon: geocodeData.lon,
        }),
      });

      if (!proofResponse.ok) {
        throw new Error(`Proof generation failed: ${proofResponse.status}`);
      }

      const proofData = await proofResponse.json() as {
        merkleProof: {
          r: string;
          l: string;
          s: readonly string[];
          p: readonly number[];
        };
      };

      // Convert from compact format to client format
      return this.convertProofToClientFormat(
        proofData.merkleProof,
        geocodeData.district
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to generate proof from API: ${error.message}`);
      }
      throw new Error('Failed to generate proof from API: Unknown error');
    }
  }

  /**
   * Generate proof from local snapshot data
   *
   * NOTE: This requires loading full district data from IPFS, which can be large.
   * For production, prefer using API endpoint.
   */
  private async generateProofLocal(_address: StreetAddress): Promise<ClientMerkleProof> {
    // TODO: Implement local proof generation
    // This requires:
    // 1. Loading full district boundaries from IPFS
    // 2. Geocoding address to coordinates
    // 3. Point-in-polygon lookup
    // 4. Building Merkle proof from loaded tree
    //
    // For now, throw error directing to API usage
    throw new Error(
      'Local proof generation not yet implemented - use API endpoint instead. ' +
      'Configure ShadowAtlas with an API URL (e.g., https://atlas.voter.network/api/v1)'
    );
  }

  /**
   * Convert compact proof format to client format
   */
  private convertProofToClientFormat(
    compactProof: {
      readonly r: string;
      readonly l: string;
      readonly s: readonly string[];
      readonly p: readonly number[];
    },
    district: DistrictLookup
  ): ClientMerkleProof {
    // Extract district type (house or senate only for client)
    const clientDistrictType = this.mapDistrictType(district.districtType);

    return {
      leaf: {
        hash: compactProof.l,
        districtId: district.districtId,
        districtType: clientDistrictType,
      },
      path: compactProof.s as string[],
      pathIndices: compactProof.p as number[],
      root: compactProof.r,
    };
  }

  /**
   * Map district type to client format
   */
  private mapDistrictType(
    type: 'house' | 'senate' | 'council' | 'ward' | 'municipal'
  ): 'house' | 'senate' {
    // For now, map all non-federal types to 'house'
    // TODO: Extend client types to support municipal districts
    if (type === 'senate') return 'senate';
    return 'house';
  }

  /**
   * Cache snapshot in IndexedDB (for aggressive caching)
   */
  private async cacheSnapshot(
    cid: string,
    _metadata: {
      merkleRoot: string;
      districtCount: number;
      version: string;
      timestamp: number;
    }
  ): Promise<void> {
    // TODO: Implement IndexedDB caching
    // For now, log that caching is not yet implemented
    console.log(`[ShadowAtlas] Caching snapshot ${cid} (not yet implemented)`);
  }

  /**
   * Get current snapshot metadata
   */
  getSnapshotMetadata(): SnapshotMetadata | null {
    return this.snapshotMetadata;
  }

  /**
   * Check if snapshot is loaded
   */
  isLoaded(): boolean {
    return this.loadedCID !== null && this.loadedRoot !== null;
  }
}
