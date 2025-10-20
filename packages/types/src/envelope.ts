/**
 * CipherVault envelope structure
 * Matches NEAR contract CipherEnvelope struct
 */
export interface CipherEnvelope {
  owner: string;              // alice.near
  encrypted_data: Uint8Array; // XChaCha20-Poly1305 sealed PII
  nonce: Uint8Array;          // 24 bytes (XChaCha20 nonce)
  poseidon_commit: string;    // Hex string (64 hex chars = 32 bytes)
  encrypted_sovereign_key: Uint8Array; // AES-GCM ciphertext
  sovereign_key_iv: Uint8Array;        // 12 bytes (AES-GCM IV)
  sovereign_key_tag: Uint8Array;       // 16 bytes (AES-GCM auth tag)
  version: number;
  created_at: number;         // Unix timestamp (nanoseconds on NEAR)
  guardians: string[];        // 2-of-3 recovery
}

/**
 * PII data structure (before encryption)
 */
export interface PIIData {
  legal_name?: string;
  address?: string;
  district_id?: string;
  phone?: string;
  personal_story?: string;
  verification_credential?: unknown; // Didit.me VC
  [key: string]: unknown;
}

/**
 * Envelope creation options
 */
export interface EnvelopeOptions {
  guardians?: string[];       // Optional guardian accounts
  ttl?: number;               // Time-to-live in seconds
}

/**
 * Envelope retrieval result
 */
export interface EnvelopeResult {
  envelope_id: string;
  data: PIIData;
  metadata: {
    created_at: Date;
    version: number;
    guardians: string[];
  };
}

/**
 * Envelope storage request (for contract calls)
 */
export interface StoreEnvelopeRequest {
  encrypted_data: number[];          // Vec<u8> as array
  nonce: number[];                   // Vec<u8> as array (24 bytes)
  poseidon_commit: string;           // Hex string (64 hex chars)
  encrypted_sovereign_key: number[]; // Vec<u8> as array
  sovereign_key_iv: number[];        // Vec<u8> as array (12 bytes)
  sovereign_key_tag: number[];       // Vec<u8> as array (16 bytes)
  guardians: string[] | null;        // Optional guardian accounts
}

/**
 * Envelope update request (for contract calls)
 */
export interface UpdateEnvelopeRequest {
  envelope_id: string;
  encrypted_data: number[];
  nonce: number[];
  poseidon_commit: string;
  encrypted_sovereign_key: number[];
  sovereign_key_iv: number[];        // Vec<u8> as array (12 bytes)
  sovereign_key_tag: number[];       // Vec<u8> as array (16 bytes)
}

/**
 * Storage balance (from NEP-145)
 */
export interface StorageBalance {
  total: string;       // U128 as string
  available: string;   // U128 as string
}

/**
 * Storage balance bounds (from NEP-145)
 */
export interface StorageBalanceBounds {
  min: string;         // U128 as string
  max: string | null;  // U128 as string or null
}
