/**
 * Account management types
 * NEAR implicit accounts + Chain Signatures for universal wallet support
 */

import type { KeyPair } from 'near-api-js';

export interface NEARAccount {
  accountId: string;           // Implicit account ID (64-char hex)
  keyPair: KeyPair;            // Ed25519 keypair
  publicKey: string;           // Base58 encoded
}

export interface NEARAccountOptions {
  method: 'passkey' | 'seed';  // Passkey preferred (Face ID/Touch ID)
  networkId: 'mainnet' | 'testnet';
}

export interface ChainSignatureRequest {
  payload: Uint8Array;         // Transaction hash to sign
  path: string;                // Derivation path (e.g., "scroll,1")
  keyVersion: number;          // MPC key version
}

export interface ChainSignature {
  r: string;                   // ECDSA signature r
  s: string;                   // ECDSA signature s
  v: number;                   // Recovery ID
  publicKey: string;           // Derived public key
}
