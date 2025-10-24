/**
 * Type-safe address handling
 * Prevents accidental mixing of street addresses (PII) with Ethereum addresses (public)
 */

import { getAddress, isAddress } from 'ethers';

/**
 * Street address (PII - NEVER log or expose publicly)
 * Example: "123 Main St, Springfield, IL 62701"
 */
export type StreetAddress = string & { readonly __brand: 'StreetAddress' };

/**
 * Ethereum/Scroll address (public blockchain data)
 * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
 */
export type EthereumAddress = string & { readonly __brand: 'EthereumAddress' };

/**
 * Validate and create a street address
 * Basic validation: non-empty string with reasonable length
 */
export function createStreetAddress(address: string): StreetAddress {
  const trimmed = address.trim();

  if (!trimmed) {
    throw new Error('Street address cannot be empty');
  }

  if (trimmed.length < 10) {
    throw new Error('Street address too short - must be at least 10 characters');
  }

  if (trimmed.length > 200) {
    throw new Error('Street address too long - maximum 200 characters');
  }

  // Basic sanity check: should contain at least one digit and one letter
  const hasDigit = /\d/.test(trimmed);
  const hasLetter = /[a-zA-Z]/.test(trimmed);

  if (!hasDigit || !hasLetter) {
    throw new Error('Street address must contain both letters and numbers');
  }

  return trimmed as StreetAddress;
}

/**
 * Validate and create an Ethereum address
 * Checks for valid hex format and EIP-55 checksum
 */
export function createEthereumAddress(address: string): EthereumAddress {
  const trimmed = address.trim();

  // Use ethers.js to validate address format and checksum
  if (!isAddress(trimmed)) {
    throw new Error(
      'Invalid Ethereum address format - must be 0x followed by 40 hex characters'
    );
  }

  // Convert to checksum format (EIP-55)
  // This will throw if the provided checksum is invalid
  try {
    const checksummed = getAddress(trimmed);
    return checksummed as EthereumAddress;
  } catch (error) {
    throw new Error(
      'Invalid Ethereum address checksum - use mixed case for checksum validation'
    );
  }
}

/**
 * Check if a value is a street address (type guard)
 */
export function isStreetAddress(value: unknown): value is StreetAddress {
  if (typeof value !== 'string') return false;

  try {
    createStreetAddress(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a value is an Ethereum address (type guard)
 */
export function isEthereumAddress(value: unknown): value is EthereumAddress {
  if (typeof value !== 'string') return false;

  try {
    createEthereumAddress(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize street address for logging (CRITICAL: prevents PII leaks)
 * Returns only the city/state portion, removes street number and name
 */
export function sanitizeStreetAddressForLogging(address: StreetAddress): string {
  // Example: "123 Main St, Springfield, IL 62701" → "Springfield, IL"
  const parts = address.split(',');

  if (parts.length >= 2) {
    // Return city and state (skip first part with street address)
    return parts.slice(1, 3).map(p => p.trim()).join(', ');
  }

  // Fallback: just return "[REDACTED]"
  return '[REDACTED STREET ADDRESS]';
}

/**
 * Convert Ethereum address to checksum format (EIP-55)
 * This is safe to log and display publicly
 */
export function toChecksumAddress(address: EthereumAddress | string): string {
  // Use ethers.js getAddress which implements EIP-55 checksum
  try {
    return getAddress(address);
  } catch (error) {
    // Fallback to lowercase if invalid
    return address.toLowerCase();
  }
}
