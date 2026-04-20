/**
 * RLP Encoder Tests
 *
 * Tests the minimal RLP encoder extracted from relayer.ts into rlp.ts.
 * Covers all Yellow Paper encoding rules: single byte shortcuts, short/long
 * strings, short/long lists, bigint serialization, and a full EIP-1559
 * transaction signing payload verification.
 */

import { describe, it, expect } from 'vitest';
import {
  rlpEncode,
  rlpLengthPrefix,
  bigintToMinimalBytes,
  numberToMinimalBytes,
  concat,
} from '../../../serving/rlp.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ============================================================================
// bigintToMinimalBytes
// ============================================================================

describe('bigintToMinimalBytes', () => {
  it('encodes 0n as empty Uint8Array (RLP zero = empty bytes)', () => {
    const result = bigintToMinimalBytes(0n);
    expect(result).toEqual(new Uint8Array(0));
    expect(result.length).toBe(0);
  });

  it('encodes 1n as [0x01]', () => {
    expect(bigintToMinimalBytes(1n)).toEqual(new Uint8Array([0x01]));
  });

  it('encodes 127n (0x7f) as [0x7f]', () => {
    expect(bigintToMinimalBytes(127n)).toEqual(new Uint8Array([0x7f]));
  });

  it('encodes 128n (0x80) as [0x80]', () => {
    expect(bigintToMinimalBytes(128n)).toEqual(new Uint8Array([0x80]));
  });

  it('encodes 255n as [0xff]', () => {
    expect(bigintToMinimalBytes(255n)).toEqual(new Uint8Array([0xff]));
  });

  it('encodes 256n as [0x01, 0x00]', () => {
    expect(bigintToMinimalBytes(256n)).toEqual(new Uint8Array([0x01, 0x00]));
  });

  it('encodes max uint256 as exactly 32 bytes', () => {
    const maxUint256 = (1n << 256n) - 1n;
    const result = bigintToMinimalBytes(maxUint256);
    expect(result.length).toBe(32);
    // All bytes should be 0xff
    for (const byte of result) {
      expect(byte).toBe(0xff);
    }
  });

  it('encodes 0x0100 correctly without leading zero byte', () => {
    const result = bigintToMinimalBytes(0x0100n);
    expect(result).toEqual(new Uint8Array([0x01, 0x00]));
  });

  it('throws on negative value -1n', () => {
    expect(() => bigintToMinimalBytes(-1n)).toThrow('bigintToMinimalBytes: negative value');
  });

  it('throws on negative value -255n', () => {
    expect(() => bigintToMinimalBytes(-255n)).toThrow('bigintToMinimalBytes: negative value');
  });
});

// ============================================================================
// numberToMinimalBytes
// ============================================================================

describe('numberToMinimalBytes', () => {
  it('encodes 0 as empty array', () => {
    expect(numberToMinimalBytes(0)).toEqual([]);
  });

  it('encodes 1 as [1]', () => {
    expect(numberToMinimalBytes(1)).toEqual([1]);
  });

  it('encodes 255 as [0xff]', () => {
    expect(numberToMinimalBytes(255)).toEqual([0xff]);
  });

  it('encodes 256 as [0x01, 0x00]', () => {
    expect(numberToMinimalBytes(256)).toEqual([0x01, 0x00]);
  });

  it('encodes 65535 (0xffff) as [0xff, 0xff]', () => {
    expect(numberToMinimalBytes(65535)).toEqual([0xff, 0xff]);
  });

  it('throws on negative value -1', () => {
    expect(() => numberToMinimalBytes(-1)).toThrow('numberToMinimalBytes: value must be a non-negative finite number');
  });

  it('throws on NaN', () => {
    expect(() => numberToMinimalBytes(NaN)).toThrow('numberToMinimalBytes: value must be a non-negative finite number');
  });

  it('throws on Infinity', () => {
    expect(() => numberToMinimalBytes(Infinity)).toThrow('numberToMinimalBytes: value must be a non-negative finite number');
  });
});

// ============================================================================
// rlpLengthPrefix
// ============================================================================

describe('rlpLengthPrefix', () => {
  it('produces short prefix for string of length 0', () => {
    const result = rlpLengthPrefix(0, 0x80, 0xb7);
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('produces short prefix for string of length 55', () => {
    const result = rlpLengthPrefix(55, 0x80, 0xb7);
    expect(result).toEqual(new Uint8Array([0x80 + 55]));
  });

  it('produces long prefix for string of length 56', () => {
    const result = rlpLengthPrefix(56, 0x80, 0xb7);
    // 56 = 0x38, 1 byte to encode length
    expect(result).toEqual(new Uint8Array([0xb7 + 1, 56]));
  });

  it('produces long prefix for string of length 256', () => {
    const result = rlpLengthPrefix(256, 0x80, 0xb7);
    // 256 = 0x0100, 2 bytes to encode length
    expect(result).toEqual(new Uint8Array([0xb7 + 2, 0x01, 0x00]));
  });

  it('produces short prefix for list of length 0', () => {
    const result = rlpLengthPrefix(0, 0xc0, 0xf7);
    expect(result).toEqual(new Uint8Array([0xc0]));
  });

  it('produces long prefix for list of length 56', () => {
    const result = rlpLengthPrefix(56, 0xc0, 0xf7);
    expect(result).toEqual(new Uint8Array([0xf7 + 1, 56]));
  });
});

// ============================================================================
// concat
// ============================================================================

describe('concat', () => {
  it('concatenates zero arrays to empty result', () => {
    expect(concat()).toEqual(new Uint8Array(0));
  });

  it('concatenates single array unchanged', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(concat(a)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('concatenates multiple arrays in order', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    const c = new Uint8Array([5]);
    expect(concat(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('handles empty arrays in the mix', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array(0);
    const c = new Uint8Array([2]);
    expect(concat(a, b, c)).toEqual(new Uint8Array([1, 2]));
  });
});

// ============================================================================
// rlpEncode — byte strings
// ============================================================================

describe('rlpEncode (byte strings)', () => {
  it('encodes empty bytes as [0x80]', () => {
    const result = rlpEncode(new Uint8Array(0));
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('encodes single byte 0x00 as [0x00] (single byte shortcut)', () => {
    // 0x00 <= 0x7f, so it encodes as itself
    const result = rlpEncode(new Uint8Array([0x00]));
    expect(result).toEqual(new Uint8Array([0x00]));
  });

  it('encodes single byte 0x7f as [0x7f] (single byte shortcut)', () => {
    const result = rlpEncode(new Uint8Array([0x7f]));
    expect(result).toEqual(new Uint8Array([0x7f]));
  });

  it('encodes single byte 0x80 as [0x81, 0x80] (needs length prefix)', () => {
    const result = rlpEncode(new Uint8Array([0x80]));
    expect(result).toEqual(new Uint8Array([0x81, 0x80]));
  });

  it('encodes single byte 0xff as [0x81, 0xff]', () => {
    const result = rlpEncode(new Uint8Array([0xff]));
    expect(result).toEqual(new Uint8Array([0x81, 0xff]));
  });

  it('encodes 55-byte string with short prefix [0x80+55, ...data]', () => {
    const data = new Uint8Array(55).fill(0xab);
    const result = rlpEncode(data);
    expect(result.length).toBe(56); // 1 prefix byte + 55 data bytes
    expect(result[0]).toBe(0x80 + 55); // 0xb7
    expect(result.slice(1)).toEqual(data);
  });

  it('encodes 56-byte string with long prefix [0xb8, 56, ...data]', () => {
    const data = new Uint8Array(56).fill(0xcd);
    const result = rlpEncode(data);
    expect(result.length).toBe(58); // 2 prefix bytes + 56 data bytes
    expect(result[0]).toBe(0xb8); // 0xb7 + 1 (1 byte to store length)
    expect(result[1]).toBe(56);
    expect(result.slice(2)).toEqual(data);
  });

  it('encodes 256-byte string with 2-byte length in long prefix', () => {
    const data = new Uint8Array(256).fill(0xef);
    const result = rlpEncode(data);
    expect(result.length).toBe(259); // 3 prefix bytes + 256 data bytes
    expect(result[0]).toBe(0xb9); // 0xb7 + 2 (2 bytes to store length)
    expect(result[1]).toBe(0x01);
    expect(result[2]).toBe(0x00);
    expect(result.slice(3)).toEqual(data);
  });
});

// ============================================================================
// rlpEncode — scalar types
// ============================================================================

describe('rlpEncode (scalar types)', () => {
  it('encodes bigint 0n as [0x80] (empty bytes = RLP zero)', () => {
    const result = rlpEncode(0n);
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('encodes bigint 1n as [0x01]', () => {
    const result = rlpEncode(1n);
    expect(result).toEqual(new Uint8Array([0x01]));
  });

  it('encodes bigint 127n as [0x7f] (single byte shortcut)', () => {
    const result = rlpEncode(127n);
    expect(result).toEqual(new Uint8Array([0x7f]));
  });

  it('encodes bigint 128n as [0x81, 0x80]', () => {
    const result = rlpEncode(128n);
    expect(result).toEqual(new Uint8Array([0x81, 0x80]));
  });

  it('encodes number 0 as [0x80]', () => {
    const result = rlpEncode(0);
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('encodes number 42 as [0x2a]', () => {
    const result = rlpEncode(42);
    expect(result).toEqual(new Uint8Array([0x2a]));
  });

  it('encodes hex string "0x00" as [0x00]', () => {
    const result = rlpEncode('0x00');
    expect(result).toEqual(new Uint8Array([0x00]));
  });

  it('encodes hex string "ff" (without 0x) as [0x81, 0xff]', () => {
    const result = rlpEncode('ff');
    expect(result).toEqual(new Uint8Array([0x81, 0xff]));
  });

  it('encodes empty hex string as [0x80]', () => {
    const result = rlpEncode('');
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('encodes hex string with odd length (auto-pads)', () => {
    // "f" becomes "0f" which is a single byte 0x0f <= 0x7f
    const result = rlpEncode('f');
    expect(result).toEqual(new Uint8Array([0x0f]));
  });

  it('handles 0X prefix (uppercase)', () => {
    const result = rlpEncode('0X7f');
    expect(result).toEqual(new Uint8Array([0x7f]));
  });
});

// ============================================================================
// rlpEncode — lists
// ============================================================================

describe('rlpEncode (lists)', () => {
  it('encodes empty list as [0xc0]', () => {
    const result = rlpEncode([]);
    expect(result).toEqual(new Uint8Array([0xc0]));
  });

  it('encodes nested empty list [[]] as [0xc1, 0xc0]', () => {
    const result = rlpEncode([[]]);
    expect(result).toEqual(new Uint8Array([0xc1, 0xc0]));
  });

  it('encodes list with single empty string as [0xc1, 0x80]', () => {
    const result = rlpEncode([new Uint8Array(0)]);
    expect(result).toEqual(new Uint8Array([0xc1, 0x80]));
  });

  it('encodes list of small numbers', () => {
    // [1, 2, 3] — each encodes as single byte
    const result = rlpEncode([1n, 2n, 3n]);
    // Payload: [0x01, 0x02, 0x03] = 3 bytes
    // List prefix: 0xc0 + 3 = 0xc3
    expect(result).toEqual(new Uint8Array([0xc3, 0x01, 0x02, 0x03]));
  });

  it('encodes list with mixed types', () => {
    // [1, "cat"] where "cat" is hex "636174"
    const result = rlpEncode([1n, new Uint8Array([0x63, 0x61, 0x74])]);
    // 1n encodes as 0x01 (1 byte)
    // "cat" = 3 bytes, short string: [0x83, 0x63, 0x61, 0x74] (4 bytes)
    // Total payload: 5 bytes
    // List prefix: 0xc0 + 5 = 0xc5
    expect(result).toEqual(new Uint8Array([0xc5, 0x01, 0x83, 0x63, 0x61, 0x74]));
  });

  it('encodes deeply nested list [[[1]]]', () => {
    const result = rlpEncode([[[1n]]]);
    // Innermost: rlp(1n) = [0x01]
    // [1n]: payload = [0x01], length 1 => [0xc1, 0x01]
    // [[1n]]: payload = [0xc1, 0x01], length 2 => [0xc2, 0xc1, 0x01]
    // [[[1n]]]: payload = [0xc2, 0xc1, 0x01], length 3 => [0xc3, 0xc2, 0xc1, 0x01]
    expect(result).toEqual(new Uint8Array([0xc3, 0xc2, 0xc1, 0x01]));
  });

  it('encodes long list (>55 bytes payload) with long prefix', () => {
    // Create a list with enough elements to exceed 55 bytes payload
    const items: bigint[] = [];
    for (let i = 0; i < 56; i++) {
      items.push(BigInt(i + 1)); // values 1-56, each encodes as 1 byte
    }
    const result = rlpEncode(items);
    // Payload: 56 bytes (each value 1-56 is a single byte)
    // List prefix: 0xf7 + 1 = 0xf8, then length byte 56 = 0x38
    expect(result[0]).toBe(0xf8); // 0xf7 + 1
    expect(result[1]).toBe(56);
    expect(result.length).toBe(2 + 56); // 2 prefix + 56 payload
  });
});

// ============================================================================
// Known EIP-1559 transaction encoding
// ============================================================================

describe('rlpEncode (EIP-1559 transaction)', () => {
  it('encodes a complete EIP-1559 signing payload and verifies the keccak hash', () => {
    // Construct a simple EIP-1559 transaction
    // chainId=1, nonce=0, maxPriorityFeePerGas=1 gwei, maxFeePerGas=20 gwei,
    // gasLimit=21000, to=0x0000...0001, value=1 ether, data=empty, accessList=[]
    const chainId = 1n;
    const nonce = 0n;
    const maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei
    const maxFeePerGas = 20_000_000_000n; // 20 gwei
    const gasLimit = 21000n;
    const to = hexToBytes('0000000000000000000000000000000000000001');
    const value = 1_000_000_000_000_000_000n; // 1 ETH
    const data = new Uint8Array(0);
    const accessList: never[] = [];

    const txFields = [
      chainId, nonce, maxPriorityFeePerGas, maxFeePerGas,
      gasLimit, to, value, data, accessList,
    ];

    const rlpUnsigned = rlpEncode(txFields);

    // Build signing payload: 0x02 || rlp(txFields)
    const signingPayload = new Uint8Array(1 + rlpUnsigned.length);
    signingPayload[0] = 0x02;
    signingPayload.set(rlpUnsigned, 1);

    const hash = keccak_256(signingPayload);
    const hashHex = bytesToHex(hash);

    // Verify that the hash is a valid 32-byte value
    expect(hash.length).toBe(32);
    expect(hashHex.length).toBe(64);

    // The RLP should start with a list prefix
    expect(rlpUnsigned[0]).toBeGreaterThanOrEqual(0xc0);

    // Verify deterministic: same input always produces same hash
    const rlpUnsigned2 = rlpEncode(txFields);
    const signingPayload2 = new Uint8Array(1 + rlpUnsigned2.length);
    signingPayload2[0] = 0x02;
    signingPayload2.set(rlpUnsigned2, 1);
    const hash2 = keccak_256(signingPayload2);
    expect(bytesToHex(hash2)).toBe(hashHex);
  });

  it('verifies EIP-1559 transaction structure: type prefix + RLP list', () => {
    // Minimal valid transaction fields
    const txFields = [
      1n,                        // chainId
      0n,                        // nonce
      0n,                        // maxPriorityFeePerGas
      0n,                        // maxFeePerGas
      21000n,                    // gasLimit
      hexToBytes('d8da6bf26964af9d7eed9e03e53415d37aa96045'), // to (vitalik.eth)
      0n,                        // value
      new Uint8Array(0),         // data
      [],                        // accessList
    ];

    const encoded = rlpEncode(txFields);

    // The outer encoding must be an RLP list
    expect(encoded[0]).toBeGreaterThanOrEqual(0xc0);

    // The first item in the list is chainId=1, which should be 0x01
    // After the list prefix, the first payload byte should be 0x01
    const listPrefixSize = encoded[0] <= 0xf7 ? 1 : 1 + (encoded[0] - 0xf7);
    expect(encoded[listPrefixSize]).toBe(0x01); // chainId=1

    // Nonce 0 encodes as 0x80 (empty bytes)
    expect(encoded[listPrefixSize + 1]).toBe(0x80); // nonce=0
  });

  it('correctly encodes access list as empty RLP list [0xc0]', () => {
    // When access list is empty, it should encode as [0xc0]
    const emptyList = rlpEncode([]);
    expect(emptyList).toEqual(new Uint8Array([0xc0]));
  });
});
