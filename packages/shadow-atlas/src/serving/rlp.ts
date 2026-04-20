/**
 * Minimal RLP Encoder
 *
 * Implements the Recursive Length Prefix encoding per the Ethereum Yellow Paper.
 * Extracted from relayer.ts for independent testability.
 *
 * Rules:
 * - Single byte in [0x00, 0x7f]: encoded as itself
 * - Byte string 0-55 bytes: (0x80 + len) prefix then bytes
 * - Byte string >55 bytes: (0xb7 + len_of_len) prefix, then BE length, then bytes
 * - List whose total payload is 0-55 bytes: (0xc0 + payload_len) then items
 * - List whose total payload >55 bytes: (0xf7 + len_of_len) then BE length then items
 */

import { hexToBytes } from '@noble/hashes/utils';

export type RLPInput = Uint8Array | bigint | number | string | RLPInput[];

/**
 * Encode a value into RLP format.
 *
 * Accepts Uint8Array (raw bytes), bigint/number (minimal BE encoding),
 * string (hex with optional 0x prefix), or arrays (RLP lists).
 */
export function rlpEncode(input: RLPInput): Uint8Array {
  if (Array.isArray(input)) {
    const encodedItems = input.map(item => rlpEncode(item));
    const payload = concat(...encodedItems);
    return concat(rlpLengthPrefix(payload.length, 0xc0, 0xf7), payload);
  }

  // Normalise scalar inputs to Uint8Array
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (typeof input === 'bigint') {
    bytes = bigintToMinimalBytes(input);
  } else if (typeof input === 'number') {
    bytes = bigintToMinimalBytes(BigInt(input));
  } else if (typeof input === 'string') {
    // Treat as hex string (with or without 0x prefix)
    const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
    bytes = hex.length === 0 ? new Uint8Array(0) : hexToBytes(hex.length % 2 === 0 ? hex : '0' + hex);
  } else {
    bytes = new Uint8Array(0);
  }

  if (bytes.length === 1 && bytes[0] <= 0x7f) {
    // Single byte shortcut — no length prefix needed
    return bytes;
  }

  return concat(rlpLengthPrefix(bytes.length, 0x80, 0xb7), bytes);
}

/** Build the RLP length prefix for either a string or a list. */
export function rlpLengthPrefix(length: number, shortBase: number, longBase: number): Uint8Array {
  if (length <= 55) {
    return new Uint8Array([shortBase + length]);
  }
  const lenBytes = numberToMinimalBytes(length);
  return new Uint8Array([longBase + lenBytes.length, ...lenBytes]);
}

/** Encode a non-negative integer as the minimum number of big-endian bytes. */
export function bigintToMinimalBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  if (value < 0n) {
    throw new Error('bigintToMinimalBytes: negative value');
  }
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return hexToBytes(hex);
}

/** Encode a non-negative JS number as the minimum number of big-endian bytes. */
export function numberToMinimalBytes(value: number): number[] {
  if (value === 0) return [];
  if (value < 0 || !Number.isFinite(value)) {
    throw new Error('numberToMinimalBytes: value must be a non-negative finite number');
  }
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return bytes;
}

/** Concatenate multiple Uint8Arrays. */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
