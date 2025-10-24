/**
 * ReputationRegistry smart contract interface (ERC-8004)
 * Domain-specific reputation with time decay
 */

import { Contract, ContractTransaction, type Signer, type Provider } from 'ethers';
import type { ReputationScore } from './types';
import { ReputationTier } from './types';
import { ContractError } from '../utils/errors';
import { getReputationTier } from '../utils/format';

// Contract ABI (ERC-8004 compliant)
const REPUTATION_REGISTRY_ABI = [
  // View functions
  'function getReputation(address user, string domain) view returns (uint256 score, uint256 lastUpdate, uint256 decayRate)',
  'function getReputationTier(address user, string domain) view returns (uint8)',
  'function hasReputation(address user, string domain, uint256 minScore) view returns (bool)',
  'function getDomains(address user) view returns (string[])',

  // State-changing functions
  'function updateReputation(address user, string domain, int256 delta, string reason) returns (uint256)',
  'function setDecayRate(address user, string domain, uint256 newRate) returns (bool)',
  'function transferReputation(address from, address to, string domain, uint256 amount) returns (bool)',

  // Events
  'event ReputationUpdated(address indexed user, string indexed domain, uint256 newScore, int256 delta, string reason)',
  'event ReputationDecayed(address indexed user, string indexed domain, uint256 oldScore, uint256 newScore)',
  'event ReputationTransferred(address indexed from, address indexed to, string indexed domain, uint256 amount)'
] as const;

export class ReputationRegistryContract {
  private contract: Contract;
  private signer: Signer | null = null;
  private contractAddress: string;

  constructor(contractAddress: string, providerOrSigner: Provider | Signer) {
    this.contractAddress = contractAddress;

    if ('sendTransaction' in providerOrSigner) {
      this.signer = providerOrSigner as Signer;
      this.contract = new Contract(contractAddress, REPUTATION_REGISTRY_ABI, providerOrSigner);
    } else {
      this.contract = new Contract(contractAddress, REPUTATION_REGISTRY_ABI, providerOrSigner);
    }
  }

  /**
   * Get reputation score for a user in a specific domain
   * Returns detailed reputation information including decay
   */
  async getReputation(address: string, domain: string): Promise<ReputationScore> {
    try {
      const result = await this.contract.getReputation(address, domain);

      // Contract returns: (score, lastUpdate, decayRate)
      const score = Number(result[0]);
      const lastUpdate = Number(result[1]);
      const decayRate = Number(result[2]);

      // Apply time decay to get current score
      const currentScore = this.calculateDecayedScore(
        score,
        lastUpdate,
        decayRate
      );

      return {
        score: currentScore,
        tier: getReputationTier(currentScore),
        lastUpdate: new Date(lastUpdate * 1000),
        decayRate: decayRate / 100,  // Convert basis points to percentage
        domain
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get reputation: ${error.message}`);
      }
      throw new ContractError('Failed to get reputation');
    }
  }

  /**
   * Get reputation tier for display
   * Returns enum value directly from contract
   */
  async getReputationTier(address: string, domain: string): Promise<ReputationTier> {
    try {
      const tierValue = await this.contract.getReputationTier(address, domain);

      const tiers: ReputationTier[] = [
        ReputationTier.UNTRUSTED,
        ReputationTier.NOVICE,
        ReputationTier.EMERGING,
        ReputationTier.ESTABLISHED,
        ReputationTier.TRUSTED
      ];

      return tiers[tierValue] || ReputationTier.UNTRUSTED;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get reputation tier: ${error.message}`);
      }
      throw new ContractError('Failed to get reputation tier');
    }
  }

  /**
   * Check if user meets minimum reputation threshold
   * Useful for gating features or permissions
   */
  async hasReputation(
    address: string,
    domain: string,
    minScore: number
  ): Promise<boolean> {
    try {
      return await this.contract.hasReputation(address, domain, minScore);
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to check reputation: ${error.message}`);
      }
      throw new ContractError('Failed to check reputation');
    }
  }

  /**
   * Get all domains where user has reputation
   */
  async getDomains(address: string): Promise<string[]> {
    try {
      return await this.contract.getDomains(address);
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Failed to get domains: ${error.message}`);
      }
      throw new ContractError('Failed to get domains');
    }
  }

  /**
   * Update reputation (authorized callers only)
   * Delta can be positive (reward) or negative (penalty)
   */
  async updateReputation(
    user: string,
    domain: string,
    delta: number,
    reason: string
  ): Promise<ContractTransaction> {
    if (!this.signer) {
      throw new ContractError('Signer required for state-changing operations');
    }

    try {
      const tx = await this.contract.updateReputation(user, domain, delta, reason);
      return tx;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Reputation update failed: ${error.message}`);
      }
      throw new ContractError('Reputation update failed');
    }
  }

  /**
   * Set reputation decay rate
   * Rate in basis points (100 = 1% annual decay)
   */
  async setDecayRate(
    user: string,
    domain: string,
    annualDecayPercent: number
  ): Promise<ContractTransaction> {
    if (!this.signer) {
      throw new ContractError('Signer required for state-changing operations');
    }

    try {
      // Convert percentage to basis points
      const decayRateBasisPoints = Math.round(annualDecayPercent * 100);

      const tx = await this.contract.setDecayRate(user, domain, decayRateBasisPoints);
      return tx;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Decay rate update failed: ${error.message}`);
      }
      throw new ContractError('Decay rate update failed');
    }
  }

  /**
   * Transfer reputation between addresses
   * Useful for account migration or delegation
   */
  async transferReputation(
    to: string,
    domain: string,
    amount: number
  ): Promise<ContractTransaction> {
    if (!this.signer) {
      throw new ContractError('Signer required for state-changing operations');
    }

    try {
      const signerAddress = await this.signer.getAddress();
      const tx = await this.contract.transferReputation(signerAddress, to, domain, amount);
      return tx;
    } catch (error) {
      if (error instanceof Error) {
        throw new ContractError(`Reputation transfer failed: ${error.message}`);
      }
      throw new ContractError('Reputation transfer failed');
    }
  }

  /**
   * Calculate current score with time decay applied
   * Formula: score * (1 - decayRate)^years
   */
  private calculateDecayedScore(
    baseScore: number,
    lastUpdateTimestamp: number,
    decayRateBasisPoints: number
  ): number {
    const now = Date.now() / 1000;
    const yearsElapsed = (now - lastUpdateTimestamp) / (365.25 * 24 * 60 * 60);

    // Convert basis points to decimal (10000 = 100%)
    const decayRate = decayRateBasisPoints / 10000;

    // Apply exponential decay
    const decayedScore = baseScore * Math.pow(1 - decayRate, yearsElapsed);

    return Math.floor(decayedScore);
  }

  /**
   * Listen for ReputationUpdated events
   */
  onReputationUpdated(
    callback: (user: string, domain: string, newScore: number, delta: number, reason: string) => void
  ): () => void {
    const listener = (
      user: string,
      domain: string,
      newScore: bigint,
      delta: bigint,
      reason: string
    ) => {
      callback(user, domain, Number(newScore), Number(delta), reason);
    };

    this.contract.on('ReputationUpdated', listener);

    return () => {
      this.contract.off('ReputationUpdated', listener);
    };
  }

  /**
   * Listen for ReputationDecayed events
   */
  onReputationDecayed(
    callback: (user: string, domain: string, oldScore: number, newScore: number) => void
  ): () => void {
    const listener = (
      user: string,
      domain: string,
      oldScore: bigint,
      newScore: bigint
    ) => {
      callback(user, domain, Number(oldScore), Number(newScore));
    };

    this.contract.on('ReputationDecayed', listener);

    return () => {
      this.contract.off('ReputationDecayed', listener);
    };
  }

  /**
   * Get contract address
   */
  getAddress(): string {
    return this.contractAddress;
  }
}
