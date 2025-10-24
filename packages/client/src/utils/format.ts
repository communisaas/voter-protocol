/**
 * Utility functions for formatting and validation
 */

import { ReputationTier } from '../contracts/types';

/**
 * Format token amounts for display
 */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  // Format with 2 decimal places
  const fractionStr = fraction.toString().padStart(decimals, '0');
  return `${whole}.${fractionStr.slice(0, 2)}`;
}

/**
 * Get reputation tier from score
 */
export function getReputationTier(score: number): ReputationTier {
  if (score >= 80) return ReputationTier.TRUSTED;
  if (score >= 60) return ReputationTier.ESTABLISHED;
  if (score >= 40) return ReputationTier.EMERGING;
  if (score >= 20) return ReputationTier.NOVICE;
  return ReputationTier.UNTRUSTED;
}

/**
 * Check if address type is connected wallet
 */
export function isConnectedWallet(addressType: string): boolean {
  return addressType === 'connected' || addressType === 'certified';
}

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Shorten address for display (0x1234...5678)
 */
export function shortenAddress(address: string, chars: number = 4): string {
  if (!isValidAddress(address)) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
