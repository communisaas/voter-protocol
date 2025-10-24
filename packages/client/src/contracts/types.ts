/**
 * Smart contract interaction types
 * DistrictGate + ReputationRegistry (ERC-8004)
 */

export interface DistrictGateConfig {
  address: string;
  verifierAddress: string;     // Halo2 verifier contract
}

export enum ReputationTier {
  TRUSTED = 'trusted',         // 80-100 score
  ESTABLISHED = 'established', // 60-79 score
  EMERGING = 'emerging',       // 40-59 score
  NOVICE = 'novice',           // 20-39 score
  UNTRUSTED = 'untrusted'      // 0-19 score
}

export interface ReputationScore {
  score: number;               // 0-10000 (stored as integer on-chain)
  tier: ReputationTier;
  lastUpdate: Date;
  decayRate: number;           // Annual decay percentage
  domain: string;              // e.g., "healthcare", "climate"
}
