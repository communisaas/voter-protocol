import type { StreetAddress } from '../utils/addresses';

export interface MerkleProof {
  leaf: {
    hash: string;
    districtId?: string;
    districtType?: 'house' | 'senate';
  };
  path: string[];
  pathIndices: number[];
  root: string;
}

export interface ProofInputs {
  address: StreetAddress;
  merkleProof: MerkleProof;
}

export interface DistrictProof {
  proof: Uint8Array;
  districtHash: string;
  merkleRoot: string;
  publicSignals: string[];
  metadata?: {
    provingTimeMs?: number;
    proofSizeBytes?: number;
    circuitSize?: number;
    cacheHit?: boolean;
  };
}

export interface ShadowAtlasConfig {
  endpoint: string;
  cacheStrategy: 'aggressive' | 'moderate' | 'minimal';
}
