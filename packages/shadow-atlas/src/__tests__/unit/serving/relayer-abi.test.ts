/**
 * ABI Encoder Tests
 *
 * Tests the Solidity ABI encoding helpers extracted from relayer.ts into
 * abi-encoder.ts. Covers function selectors, padding, dynamic bytes encoding,
 * and full calldata construction for commitTrade, revealTrade, executeEpoch.
 */

import { describe, it, expect } from 'vitest';
import {
  functionSelector,
  abiPadLeft,
  encodeDynamicBytes,
  encodeCommitTrade,
  encodeRevealTrade,
  encodeExecuteEpoch,
} from '../../../serving/abi-encoder.js';
import type { CommitTradeParams, RevealTradeParams } from '../../../serving/relayer-types.js';

// ============================================================================
// functionSelector
// ============================================================================

describe('functionSelector', () => {
  it('computes known selector for transfer(address,uint256)', () => {
    // keccak256("transfer(address,uint256)") starts with a9059cbb
    const sel = functionSelector('transfer(address,uint256)');
    expect(sel).toBe('0xa9059cbb');
  });

  it('computes known selector for approve(address,uint256)', () => {
    // keccak256("approve(address,uint256)") starts with 095ea7b3
    const sel = functionSelector('approve(address,uint256)');
    expect(sel).toBe('0x095ea7b3');
  });

  it('computes known selector for balanceOf(address)', () => {
    // keccak256("balanceOf(address)") starts with 70a08231
    const sel = functionSelector('balanceOf(address)');
    expect(sel).toBe('0x70a08231');
  });

  it('computes selector for executeEpoch(bytes32,uint256)', () => {
    const sel = functionSelector('executeEpoch(bytes32,uint256)');
    // Verify format: 0x + 8 hex chars = 10 chars total
    expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
    // Selector must be deterministic
    expect(sel).toBe(functionSelector('executeEpoch(bytes32,uint256)'));
  });

  it('computes selector for commitTrade with full signature', () => {
    const sig = 'commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)';
    const sel = functionSelector(sig);
    expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it('computes selector for revealTrade with full signature', () => {
    const sig = 'revealTrade(bytes32,uint256,uint256,uint256,uint8,uint256,uint8,bytes32)';
    const sel = functionSelector(sig);
    expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it('returns different selectors for different signatures', () => {
    const a = functionSelector('transfer(address,uint256)');
    const b = functionSelector('approve(address,uint256)');
    expect(a).not.toBe(b);
  });
});

// ============================================================================
// abiPadLeft
// ============================================================================

describe('abiPadLeft', () => {
  it('pads "ff" to 64-char hex string with 62 leading zeros', () => {
    const result = abiPadLeft('ff');
    expect(result.length).toBe(64);
    expect(result).toBe('00'.repeat(31) + 'ff');
  });

  it('strips 0x prefix before padding', () => {
    const result = abiPadLeft('0xff');
    expect(result.length).toBe(64);
    expect(result).toBe('00'.repeat(31) + 'ff');
  });

  it('strips 0X prefix (uppercase)', () => {
    const result = abiPadLeft('0Xff');
    expect(result.length).toBe(64);
    expect(result).toBe('00'.repeat(31) + 'ff');
  });

  it('pads empty string to 64 zeros', () => {
    const result = abiPadLeft('');
    expect(result).toBe('0'.repeat(64));
  });

  it('does not truncate a 64-char value', () => {
    const full = 'ab'.repeat(32);
    const result = abiPadLeft(full);
    expect(result).toBe(full);
  });

  it('throws on overlong input (65 hex chars)', () => {
    expect(() => abiPadLeft('0'.repeat(65))).toThrow(
      'abiPadLeft: value exceeds 32 bytes (65 hex chars)',
    );
  });

  it('succeeds for exactly 64 hex chars (boundary case)', () => {
    const input = '0'.repeat(64);
    const result = abiPadLeft(input);
    expect(result).toBe(input);
    expect(result.length).toBe(64);
  });

  it('pads short input correctly (ff -> 62 leading zeros)', () => {
    const result = abiPadLeft('ff');
    expect(result.length).toBe(64);
    expect(result).toBe('0'.repeat(62) + 'ff');
  });

  it('pads an Ethereum address (20 bytes / 40 hex chars)', () => {
    const addr = 'd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const result = abiPadLeft(addr);
    expect(result.length).toBe(64);
    expect(result.endsWith(addr)).toBe(true);
    expect(result.startsWith('0'.repeat(24))).toBe(true);
  });
});

// ============================================================================
// encodeDynamicBytes
// ============================================================================

describe('encodeDynamicBytes', () => {
  it('encodes 2-byte data (0x1234): length slot + padded data', () => {
    const result = encodeDynamicBytes('0x1234');
    // Length: 2 bytes = 0x02, padded to 64 chars
    const expectedLength = '0'.repeat(62) + '02';
    // Data: 1234 padded to 64 hex chars (32 bytes)
    const expectedData = '1234' + '0'.repeat(60);
    expect(result).toBe(expectedLength + expectedData);
  });

  it('encodes without 0x prefix', () => {
    const result = encodeDynamicBytes('abcd');
    const expectedLength = '0'.repeat(62) + '02';
    const expectedData = 'abcd' + '0'.repeat(60);
    expect(result).toBe(expectedLength + expectedData);
  });

  it('encodes 32-byte data (exact slot boundary)', () => {
    const data = 'ff'.repeat(32); // 64 hex chars = 32 bytes
    const result = encodeDynamicBytes(data);
    const expectedLength = '0'.repeat(62) + '20'; // 32 = 0x20
    // Data is exactly 64 hex chars, no padding needed
    expect(result).toBe(expectedLength + data);
  });

  it('encodes 33-byte data (crosses slot boundary, pads to 64 bytes)', () => {
    const data = 'ff'.repeat(33); // 66 hex chars = 33 bytes
    const result = encodeDynamicBytes(data);
    const expectedLength = '0'.repeat(62) + '21'; // 33 = 0x21
    // Data padded to next 32-byte boundary: 64 bytes = 128 hex chars
    const expectedData = data + '0'.repeat(128 - 66);
    expect(result).toBe(expectedLength + expectedData);
  });

  it('encodes empty data', () => {
    const result = encodeDynamicBytes('0x');
    // Length 0
    const expectedLength = '0'.repeat(64);
    // No data bytes
    expect(result).toBe(expectedLength);
  });

  it('encodes single hex char ("a") as 1 byte with value 0x0a (odd-length padding)', () => {
    const result = encodeDynamicBytes('a');
    // Odd hex "a" is left-padded to "0a" → 1 byte
    const expectedLength = '0'.repeat(62) + '01';
    // Data: "0a" padded to 64 hex chars
    const expectedData = '0a' + '0'.repeat(62);
    expect(result).toBe(expectedLength + expectedData);
  });

  it('encodes three hex chars ("abc") as 2 bytes (odd-length padding)', () => {
    const result = encodeDynamicBytes('abc');
    // Odd hex "abc" is left-padded to "0abc" → 2 bytes
    const expectedLength = '0'.repeat(62) + '02';
    // Data: "0abc" padded to 64 hex chars
    const expectedData = '0abc' + '0'.repeat(60);
    expect(result).toBe(expectedLength + expectedData);
  });

  it('encodes empty string as 0 bytes', () => {
    const result = encodeDynamicBytes('');
    // Length 0
    const expectedLength = '0'.repeat(64);
    // No data bytes
    expect(result).toBe(expectedLength);
  });
});

// ============================================================================
// encodeExecuteEpoch
// ============================================================================

describe('encodeExecuteEpoch', () => {
  it('produces correct total length: 4 + 2*64 = 132 hex chars', () => {
    const debateId = 'aa'.repeat(32);
    const result = encodeExecuteEpoch(debateId, 5);
    // Selector: 8 hex chars (with 0x prefix in the function but output has no 0x on the whole)
    // Actually the returned string starts with "0x" + 8 hex chars selector
    // Then 2 slots of 64 hex chars each
    expect(result.length).toBe(10 + 2 * 64); // "0x" + 8 + 128 = 138
  });

  it('starts with the correct function selector', () => {
    const result = encodeExecuteEpoch('aa'.repeat(32), 1);
    const expectedSelector = functionSelector('executeEpoch(bytes32,uint256)');
    expect(result.startsWith(expectedSelector)).toBe(true);
  });

  it('encodes debateId in slot 0 and epoch in slot 1', () => {
    const debateId = '01'.repeat(32);
    const epoch = 42; // 0x2a
    const result = encodeExecuteEpoch(debateId, epoch);

    // Strip selector (first 10 chars: "0x" + 8 hex)
    const payload = result.slice(10);

    // Slot 0: debateId
    const slot0 = payload.slice(0, 64);
    expect(slot0).toBe(debateId);

    // Slot 1: epoch = 42 = 0x2a
    const slot1 = payload.slice(64, 128);
    expect(slot1).toBe('0'.repeat(62) + '2a');
  });
});

// ============================================================================
// encodeRevealTrade
// ============================================================================

describe('encodeRevealTrade', () => {
  const fixture: RevealTradeParams = {
    debateId: 'ab'.repeat(32),
    epoch: 3,
    commitIndex: 7,
    argumentIndex: 12,
    direction: 1, // SELL
    stakeAmount: 1000000000000000000n, // 1e18
    engagementTier: 2,
    salt: 'cd'.repeat(32),
  };

  it('produces correct total length: 4 + 8*64 hex chars', () => {
    const result = encodeRevealTrade(fixture);
    // "0x" + 8 selector + 8*64 slots = 10 + 512 = 522 chars
    expect(result.length).toBe(10 + 8 * 64);
  });

  it('starts with the correct function selector', () => {
    const result = encodeRevealTrade(fixture);
    const expectedSelector = functionSelector(
      'revealTrade(bytes32,uint256,uint256,uint256,uint8,uint256,uint8,bytes32)',
    );
    expect(result.startsWith(expectedSelector)).toBe(true);
  });

  it('encodes all 8 static slots correctly', () => {
    const result = encodeRevealTrade(fixture);
    const payload = result.slice(10); // strip "0x" + selector

    // Slot 0: debateId
    expect(payload.slice(0, 64)).toBe('ab'.repeat(32));

    // Slot 1: epoch = 3
    expect(payload.slice(64, 128)).toBe('0'.repeat(63) + '3');

    // Slot 2: commitIndex = 7
    expect(payload.slice(128, 192)).toBe('0'.repeat(63) + '7');

    // Slot 3: argumentIndex = 12 = 0xc
    expect(payload.slice(192, 256)).toBe('0'.repeat(63) + 'c');

    // Slot 4: direction = 1
    expect(payload.slice(256, 320)).toBe('0'.repeat(63) + '1');

    // Slot 5: stakeAmount = 1e18 = 0xde0b6b3a7640000 (15 hex chars)
    expect(payload.slice(320, 384)).toBe('0'.repeat(49) + 'de0b6b3a7640000');

    // Slot 6: engagementTier = 2
    expect(payload.slice(384, 448)).toBe('0'.repeat(63) + '2');

    // Slot 7: salt
    expect(payload.slice(448, 512)).toBe('cd'.repeat(32));
  });
});

// ============================================================================
// encodeRevealTrade — R5-M5 input guards
// ============================================================================

describe('encodeRevealTrade input guards (R5-M5)', () => {
  const base: RevealTradeParams = {
    debateId: 'ab'.repeat(32),
    epoch: 3,
    commitIndex: 7,
    argumentIndex: 12,
    direction: 1,
    stakeAmount: 1000000000000000000n,
    engagementTier: 2,
    salt: 'cd'.repeat(32),
  };

  it('throws on negative commitIndex', () => {
    expect(() => encodeRevealTrade({ ...base, commitIndex: -1 })).toThrow(
      'revealTrade: invalid commitIndex -1',
    );
  });

  it('throws on NaN commitIndex', () => {
    expect(() => encodeRevealTrade({ ...base, commitIndex: NaN })).toThrow(
      'revealTrade: invalid commitIndex NaN',
    );
  });

  it('throws on Infinity commitIndex', () => {
    expect(() => encodeRevealTrade({ ...base, commitIndex: Infinity })).toThrow(
      'revealTrade: invalid commitIndex Infinity',
    );
  });

  it('throws on negative argumentIndex', () => {
    expect(() => encodeRevealTrade({ ...base, argumentIndex: -5 })).toThrow(
      'revealTrade: invalid argumentIndex -5',
    );
  });

  it('throws on NaN argumentIndex', () => {
    expect(() => encodeRevealTrade({ ...base, argumentIndex: NaN })).toThrow(
      'revealTrade: invalid argumentIndex NaN',
    );
  });

  it('throws on Infinity argumentIndex', () => {
    expect(() => encodeRevealTrade({ ...base, argumentIndex: Infinity })).toThrow(
      'revealTrade: invalid argumentIndex Infinity',
    );
  });

  it('throws on negative stakeAmount', () => {
    expect(() => encodeRevealTrade({ ...base, stakeAmount: -1n })).toThrow(
      'revealTrade: stakeAmount must be non-negative, got -1',
    );
  });

  it('accepts zero stakeAmount', () => {
    expect(() => encodeRevealTrade({ ...base, stakeAmount: 0n })).not.toThrow();
  });

  it('accepts zero commitIndex and argumentIndex', () => {
    expect(() =>
      encodeRevealTrade({ ...base, commitIndex: 0, argumentIndex: 0 }),
    ).not.toThrow();
  });
});

// ============================================================================
// encodeCommitTrade
// ============================================================================

describe('encodeCommitTrade', () => {
  // Realistic fixture with exactly 31 public inputs
  const proof = 'de'.repeat(64); // 64 bytes proof
  const signature = 'ef'.repeat(65); // 65 bytes sig (EIP-712 + v)
  const publicInputs = Array.from({ length: 31 }, (_, i) =>
    (i + 1).toString(16),
  );

  const fixture: CommitTradeParams = {
    debateId: 'aa'.repeat(32),
    commitHash: 'bb'.repeat(32),
    signer: 'd8da6bf26964af9d7eed9e03e53415d37aa96045',
    proof: '0x' + proof,
    publicInputs,
    verifierDepth: 20,
    deadline: 1700000000n,
    signature: '0x' + signature,
  };

  it('starts with the correct function selector', () => {
    const result = encodeCommitTrade(fixture);
    const expectedSelector = functionSelector(
      'commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)',
    );
    expect(result.startsWith(expectedSelector)).toBe(true);
  });

  it('has head size = 38 slots (38*64 hex chars after selector)', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10); // strip "0x" + selector

    // The head is 38 slots = 38 * 64 hex chars
    // After head comes tail (proof + sig)
    // Total length should be > 38*64
    expect(payload.length).toBeGreaterThanOrEqual(38 * 64);
  });

  it('encodes proof offset as 0x4c0 (1216) in slot 3', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);

    // Slot 3 is at position 3*64 to 4*64
    const slot3 = payload.slice(3 * 64, 4 * 64);
    // 1216 = 0x4c0
    expect(slot3).toBe('0'.repeat(61) + '4c0');
  });

  it('encodes debateId in slot 0', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);
    expect(payload.slice(0, 64)).toBe('aa'.repeat(32));
  });

  it('encodes commitHash in slot 1', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);
    expect(payload.slice(64, 128)).toBe('bb'.repeat(32));
  });

  it('encodes signer (address) in slot 2, left-padded to 32 bytes', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);
    const slot2 = payload.slice(128, 192);
    expect(slot2).toBe('0'.repeat(24) + 'd8da6bf26964af9d7eed9e03e53415d37aa96045');
  });

  it('encodes publicInputs in slots 4-34 (31 inline uint256 slots)', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);

    for (let i = 0; i < 31; i++) {
      const slotStart = (4 + i) * 64;
      const slot = payload.slice(slotStart, slotStart + 64);
      const expectedValue = (i + 1).toString(16);
      expect(slot).toBe(expectedValue.padStart(64, '0'));
    }
  });

  it('encodes verifierDepth (20 = 0x14) in slot 35', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);
    const slot35 = payload.slice(35 * 64, 36 * 64);
    expect(slot35).toBe('0'.repeat(62) + '14');
  });

  it('encodes deadline in slot 36', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);
    const slot36 = payload.slice(36 * 64, 37 * 64);
    // 1700000000 = 0x6553f100
    expect(slot36).toBe('0'.repeat(56) + '6553f100');
  });

  it('has signature offset in slot 37 that accounts for proof tail', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);

    // Proof is 64 bytes. Proof tail = 32 (length slot) + 64 (data, already on boundary) = 96 bytes
    // Signature offset = 1216 + 96 = 1312 = 0x520
    const slot37 = payload.slice(37 * 64, 38 * 64);
    expect(slot37).toBe('0'.repeat(61) + '520');
  });

  it('proof tail starts at correct offset with length + padded data', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10);

    // Proof tail starts at slot 38 (after head)
    const proofTailStart = 38 * 64;

    // Length slot: 64 bytes = 0x40
    const proofLenSlot = payload.slice(proofTailStart, proofTailStart + 64);
    expect(proofLenSlot).toBe('0'.repeat(62) + '40'); // 64 = 0x40

    // Data: 64 bytes of 0xde
    const proofData = payload.slice(proofTailStart + 64, proofTailStart + 64 + 128);
    expect(proofData).toBe('de'.repeat(64));
  });

  it('total hex length is selector + head + proof_tail + sig_tail', () => {
    const result = encodeCommitTrade(fixture);
    const payload = result.slice(10); // strip "0x" + selector

    const headHexLen = 38 * 64;

    // Proof: 64 bytes => tail = length(64) + data(64 padded to 64) = 128 hex + 128 hex = 256
    const proofTailHexLen = 64 + 128; // length slot (64 hex) + 64 bytes data (128 hex)

    // Signature: 65 bytes => tail = length(64) + data(padded to 96 bytes = 192 hex)
    // 65 bytes = 130 hex chars, padded to ceil(130/64)*64 = 192 hex chars
    const sigTailHexLen = 64 + 192; // length slot + 96 bytes padded data

    expect(payload.length).toBe(headHexLen + proofTailHexLen + sigTailHexLen);
  });

  it('throws if publicInputs has wrong count', () => {
    const badFixture: CommitTradeParams = {
      ...fixture,
      publicInputs: ['1', '2', '3'],
    };
    expect(() => encodeCommitTrade(badFixture)).toThrow('exactly 31 elements');
  });

  it('throws on negative deadline (R7-H1)', () => {
    expect(() => encodeCommitTrade({ ...fixture, deadline: -1n })).toThrow(
      'commitTrade: deadline must be non-negative',
    );
  });
});

// ============================================================================
// abiPadLeft — R7-M2 hex validation
// ============================================================================

describe('abiPadLeft hex validation (R7-M2)', () => {
  it('throws on non-hex characters', () => {
    expect(() => abiPadLeft('0xZZZZ')).toThrow('abiPadLeft: value contains non-hex characters');
  });

  it('accepts valid hex with 0x prefix', () => {
    const result = abiPadLeft('0xabcdef');
    expect(result.length).toBe(64);
    expect(result.endsWith('abcdef')).toBe(true);
  });
});
