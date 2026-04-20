/**
 * privateKeyToAddress Tests
 *
 * Tests Ethereum address derivation from secp256k1 private keys.
 * Uses well-known keypairs from the Ethereum ecosystem to verify
 * the keccak256(pubkey) → last 20 bytes → hex address pipeline.
 */

import { describe, it, expect } from 'vitest';
import { privateKeyToAddress } from '../../../serving/relayer.js';
import { hexToBytes } from '@noble/hashes/utils';

describe('privateKeyToAddress', () => {
  it('derives correct address for private key 0x0...01', () => {
    // Well-known keypair: private key 1 → address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
    const pk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const address = privateKeyToAddress(pk);
    expect(address).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  });

  it('derives correct address for private key 0x0...02', () => {
    // Well-known keypair: private key 2 → address 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF
    const pk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
    const address = privateKeyToAddress(pk);
    expect(address).toBe('0x2b5ad5c4795c026514f8317c7a215e218dccd6cf');
  });

  it('derives correct address for private key 0x0...03', () => {
    // Well-known keypair: private key 3 → address 0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69
    const pk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
    const address = privateKeyToAddress(pk);
    expect(address).toBe('0x6813eb9362372eef6200f3b1dbc3f819671cba69');
  });

  it('output is lowercase hex with 0x prefix, 42 chars total', () => {
    const pk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const address = privateKeyToAddress(pk);

    expect(address.length).toBe(42);
    expect(address.startsWith('0x')).toBe(true);
    expect(address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('different private keys produce different addresses', () => {
    const pk1 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const pk2 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');

    const addr1 = privateKeyToAddress(pk1);
    const addr2 = privateKeyToAddress(pk2);

    expect(addr1).not.toBe(addr2);
  });

  it('is deterministic: same key always returns same address', () => {
    const pk = hexToBytes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const addr1 = privateKeyToAddress(pk);
    const addr2 = privateKeyToAddress(pk);
    expect(addr1).toBe(addr2);
  });

  it('handles a random 32-byte key correctly (format check)', () => {
    // A known non-trivial private key
    const pk = hexToBytes('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
    const address = privateKeyToAddress(pk);

    expect(address.length).toBe(42);
    expect(address.startsWith('0x')).toBe(true);
    expect(address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});
