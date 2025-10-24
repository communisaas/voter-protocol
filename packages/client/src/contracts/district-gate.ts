/**
 * DistrictGate smart contract interface
 * Verifies Halo2 proofs of congressional district membership
 */

import { Contract, ContractTransaction, type Signer, type Provider } from 'ethers';
import type { DistrictGateConfig } from './types';
import type { DistrictProof } from '../zk/types';
import { ContractError } from '../utils/errors';
import { uint8ToHex } from '../utils/encoding';

// Contract ABI (minimal interface for Phase 1)
const DISTRICT_GATE_ABI = [
  // View functions
  'function shadowAtlasCID() view returns (string)',
  'function currentMerkleRoot() view returns (bytes32)',
  'function verifierContract() view returns (address)',
  'function isVerified(address user) view returns (bool)',
  'function getUserDistrict(address user) view returns (bytes32)',

  // State-changing functions
  'function verifyDistrict(bytes proof, bytes32 districtHash, bytes32 merkleRoot) returns (bool)',
  'function updateShadowAtlas(string newCID, bytes32 newRoot) returns (bool)',

  // Events
  'event DistrictVerified(address indexed user, bytes32 indexed districtHash)',
  'event ShadowAtlasUpdated(string newCID, bytes32 newRoot)',
  'event VerificationRevoked(address indexed user)'
] as const;

export class DistrictGateContract {
  private contract: Contract;
  private signer: Signer | null = null;
  private config: DistrictGateConfig;

  constructor(config: DistrictGateConfig, providerOrSigner: Provider | Signer) {
    this.config = config;

    // Determine if we have a signer or just a provider
    if ('sendTransaction' in providerOrSigner) {
      this.signer = providerOrSigner as Signer;
      this.contract = new Contract(config.address, DISTRICT_GATE_ABI, providerOrSigner);
    } else {
      this.contract = new Contract(config.address, DISTRICT_GATE_ABI, providerOrSigner);
    }
  }

  /**
   * Submit district verification proof on-chain
   * Gas cost: ~200-250k (Halo2 verification)
   * Finality: ~2 seconds on Scroll L2
   */
  async verifyDistrict(proof: DistrictProof): Promise<ContractTransaction> {
    if (!this.signer) {
      throw new ContractError('Signer required for state-changing operations');
    }

    try {
      // Convert proof to bytes for Solidity
      const proofBytes = uint8ToHex(proof.proof);

      const tx = await this.contract.verifyDistrict(
        proofBytes,
        proof.districtHash,
        proof.merkleRoot
      );

      return tx;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`District verification failed: ${error.message}`);
      }
      throw new ContractError('District verification failed');
    }
  }

  /**
   * Check if an address has verified their district
   */
  async isVerified(address: string): Promise<boolean> {
    try {
      return await this.contract.isVerified(address);
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to check verification status: ${error.message}`);
      }
      throw new ContractError('Failed to check verification status');
    }
  }

  /**
   * Get the district hash for a verified address
   * Returns bytes32(0) if not verified
   */
  async getUserDistrict(address: string): Promise<string> {
    try {
      return await this.contract.getUserDistrict(address);
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get user district: ${error.message}`);
      }
      throw new ContractError('Failed to get user district');
    }
  }

  /**
   * Get current Shadow Atlas CID from contract
   * Used to load the correct Atlas version
   */
  async getShadowAtlasCID(): Promise<string> {
    try {
      return await this.contract.shadowAtlasCID();
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get Shadow Atlas CID: ${error.message}`);
      }
      throw new ContractError('Failed to get Shadow Atlas CID');
    }
  }

  /**
   * Get current Merkle root from contract
   * Must match Shadow Atlas root for proofs to be valid
   */
  async getCurrentMerkleRoot(): Promise<string> {
    try {
      return await this.contract.currentMerkleRoot();
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get Merkle root: ${error.message}`);
      }
      throw new ContractError('Failed to get Merkle root');
    }
  }

  /**
   * Get Halo2 verifier contract address
   */
  async getVerifierContract(): Promise<string> {
    try {
      return await this.contract.verifierContract();
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get verifier address: ${error.message}`);
      }
      throw new ContractError('Failed to get verifier address');
    }
  }

  /**
   * Update Shadow Atlas (governance-only)
   * Requires multi-sig or DAO approval in production
   */
  async updateShadowAtlas(newCID: string, newRoot: string): Promise<ContractTransaction> {
    if (!this.signer) {
      throw new ContractError('Signer required for state-changing operations');
    }

    try {
      const tx = await this.contract.updateShadowAtlas(newCID, newRoot);
      return tx;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Shadow Atlas update failed: ${error.message}`);
      }
      throw new ContractError('Shadow Atlas update failed');
    }
  }

  /**
   * Listen for DistrictVerified events
   * Useful for tracking verification activity
   */
  onDistrictVerified(
    callback: (user: string, districtHash: string) => void
  ): () => void {
    const listener = (user: string, districtHash: string) => {
      callback(user, districtHash);
    };

    this.contract.on('DistrictVerified', listener);

    // Return cleanup function
    return () => {
      this.contract.off('DistrictVerified', listener);
    };
  }

  /**
   * Listen for ShadowAtlasUpdated events
   * Useful for detecting when to refresh Atlas data
   */
  onShadowAtlasUpdated(
    callback: (newCID: string, newRoot: string) => void
  ): () => void {
    const listener = (newCID: string, newRoot: string) => {
      callback(newCID, newRoot);
    };

    this.contract.on('ShadowAtlasUpdated', listener);

    return () => {
      this.contract.off('ShadowAtlasUpdated', listener);
    };
  }

  /**
   * Estimate gas for district verification
   * Useful for showing gas cost to users before transaction
   */
  async estimateVerificationGas(proof: DistrictProof): Promise<bigint> {
    try {
      const proofBytes = uint8ToHex(proof.proof);

      const gasEstimate = await this.contract.verifyDistrict.estimateGas(
        proofBytes,
        proof.districtHash,
        proof.merkleRoot
      );

      return gasEstimate;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Gas estimation failed: ${error.message}`);
      }
      throw new ContractError('Gas estimation failed');
    }
  }

  /**
   * Get contract address
   */
  getAddress(): string {
    return this.config.address;
  }

  /**
   * Get verifier address from config
   */
  getVerifierAddress(): string {
    return this.config.verifierAddress;
  }
}
