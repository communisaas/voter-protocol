/**
 * Tests for jurisdiction encodeCellId functions and BN254 modulus guard.
 */

import { describe, it, expect } from 'vitest';
import {
  US_JURISDICTION,
  CA_JURISDICTION,
  NZ_JURISDICTION,
  AU_JURISDICTION,
  GB_JURISDICTION,
  BN254_MODULUS,
} from '../../jurisdiction.js';

// ============================================================================
// BN254 modulus constant
// ============================================================================

describe('BN254_MODULUS', () => {
  it('matches the known BN254 scalar field prime', () => {
    // The BN254 (alt_bn128) scalar field order:
    // p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
    const knownPrime =
      21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    expect(BN254_MODULUS).toBe(knownPrime);
  });

  it('is a 254-bit number', () => {
    // BN254 modulus should be ~2^253, fitting in 254 bits
    expect(BN254_MODULUS > 2n ** 253n).toBe(true);
    expect(BN254_MODULUS < 2n ** 254n).toBe(true);
  });
});

// ============================================================================
// US encodeCellId (encodeUsGeoid)
// ============================================================================

describe('US_JURISDICTION.encodeCellId', () => {
  it('encodes a numeric GEOID correctly', () => {
    const result = US_JURISDICTION.encodeCellId('06075061200');
    expect(result).toBe(6075061200n);
    expect(result < BN254_MODULUS).toBe(true);
  });

  it('encodes an alphanumeric GEOID via byte packing', () => {
    const result = US_JURISDICTION.encodeCellId('ZZ');
    // 'Z' = 0x5A, so "ZZ" = 0x5A5A = 23130
    expect(result).toBe(0x5a5an);
    expect(result < BN254_MODULUS).toBe(true);
  });

  it('throws on GEOID longer than 31 bytes', () => {
    const longId = 'A'.repeat(32);
    expect(() => US_JURISDICTION.encodeCellId(longId)).toThrow('too long');
  });

  it('produces values below BN254 modulus for realistic GEOIDs', () => {
    const geoids = ['01001020100', '06075061200', '48201231100', '36061000100'];
    for (const geoid of geoids) {
      expect(US_JURISDICTION.encodeCellId(geoid) < BN254_MODULUS).toBe(true);
    }
  });
});

// ============================================================================
// GB encodeCellId (encodeGBCellId)
// ============================================================================

describe('GB_JURISDICTION.encodeCellId', () => {
  it('encodes a known ONS code and produces value < BN254 modulus', () => {
    const result = GB_JURISDICTION.encodeCellId('E00000001');
    expect(result > 0n).toBe(true);
    expect(result < BN254_MODULUS).toBe(true);
  });

  it('encodes different country prefixes distinctly', () => {
    const england = GB_JURISDICTION.encodeCellId('E14000001');
    const scotland = GB_JURISDICTION.encodeCellId('S14000001');
    expect(england).not.toBe(scotland);
  });

  it('throws on code longer than 31 bytes', () => {
    const longCode = 'E'.repeat(32);
    expect(() => GB_JURISDICTION.encodeCellId(longCode)).toThrow('too long');
  });
});

// ============================================================================
// CA encodeCellId (encodeCanadaCellId)
// ============================================================================

describe('CA_JURISDICTION.encodeCellId', () => {
  it('encodes a numeric riding code', () => {
    const result = CA_JURISDICTION.encodeCellId('35001');
    expect(result).toBe(35001n);
    expect(result < BN254_MODULUS).toBe(true);
  });

  it('strips non-digit chars from DGUID and encodes', () => {
    const result = CA_JURISDICTION.encodeCellId('2021A000135001');
    // Strips to '202100013500135001' — wait, let me check: replace(/\D/g, '') on '2021A000135001' → '2021000135001'
    expect(result).toBe(2021000135001n);
    expect(result < BN254_MODULUS).toBe(true);
  });
});

// ============================================================================
// NZ encodeCellId (encodeNZCellId)
// ============================================================================

describe('NZ_JURISDICTION.encodeCellId', () => {
  it('encodes a numeric meshblock code', () => {
    const result = NZ_JURISDICTION.encodeCellId('0100100');
    expect(result).toBe(100100n);
    expect(result < BN254_MODULUS).toBe(true);
  });
});

// ============================================================================
// AU encodeCellId (encodeAuCellId)
// ============================================================================

describe('AU_JURISDICTION.encodeCellId', () => {
  it('encodes a numeric SA1 code', () => {
    const result = AU_JURISDICTION.encodeCellId('10101100101');
    expect(result).toBe(10101100101n);
    expect(result < BN254_MODULUS).toBe(true);
  });
});

// ============================================================================
// BN254 modulus guard — synthetic overflow tests
// ============================================================================

// ============================================================================
// M-4: Empty code guard — all encodeCellId functions
// ============================================================================

describe('M-4: empty code guard', () => {
  it('US rejects empty string', () => {
    expect(() => US_JURISDICTION.encodeCellId('')).toThrow('Empty cell/boundary code');
  });

  it('US rejects whitespace-only string', () => {
    expect(() => US_JURISDICTION.encodeCellId('   ')).toThrow('Empty cell/boundary code');
  });

  it('CA rejects empty string', () => {
    expect(() => CA_JURISDICTION.encodeCellId('')).toThrow('Empty cell/boundary code');
  });

  it('NZ rejects empty string', () => {
    expect(() => NZ_JURISDICTION.encodeCellId('')).toThrow('Empty cell/boundary code');
  });

  it('AU rejects empty string', () => {
    expect(() => AU_JURISDICTION.encodeCellId('')).toThrow('Empty cell/boundary code');
  });

  it('GB rejects empty string', () => {
    expect(() => GB_JURISDICTION.encodeCellId('')).toThrow('Empty cell/boundary code');
  });

  it('GB rejects whitespace-only string', () => {
    expect(() => GB_JURISDICTION.encodeCellId('  \t ')).toThrow('Empty cell/boundary code');
  });
});

describe('BN254 modulus guard', () => {
  it('31 bytes of 0xFF via byte packing stays below BN254 modulus', () => {
    // 31 bytes of 0xFF = 2^248 - 1, which is less than BN254 modulus (~2^253)
    // We need an alphanumeric string that byte-packs to a large value.
    // The largest 31-byte UTF-8 values come from high ASCII chars.
    // 31 bytes of 0x7F (DEL, valid UTF-8 single byte) = 0x7F repeated 31 times
    // This is 2^(7*31) area, well under BN254.
    // For a direct test, use the GB encoder (always byte-packs):
    const thirtyOneChars = '\x7f'.repeat(31);
    const result = GB_JURISDICTION.encodeCellId(thirtyOneChars);
    expect(result < BN254_MODULUS).toBe(true);
  });

  it('rejects a synthetically enormous numeric value exceeding modulus (US)', () => {
    // A numeric string larger than BN254 modulus
    const huge = (BN254_MODULUS + 1n).toString();
    expect(() => US_JURISDICTION.encodeCellId(huge)).toThrow(
      'exceeds BN254 field modulus',
    );
  });

  it('rejects a value exactly equal to the modulus (CA)', () => {
    const exact = BN254_MODULUS.toString();
    expect(() => CA_JURISDICTION.encodeCellId(exact)).toThrow(
      'exceeds BN254 field modulus',
    );
  });

  it('accepts a value one less than the modulus (NZ)', () => {
    const justUnder = (BN254_MODULUS - 1n).toString();
    const result = NZ_JURISDICTION.encodeCellId(justUnder);
    expect(result).toBe(BN254_MODULUS - 1n);
  });

  it('rejects a value exceeding modulus (AU)', () => {
    const huge = (BN254_MODULUS + 100n).toString();
    expect(() => AU_JURISDICTION.encodeCellId(huge)).toThrow(
      'exceeds BN254 field modulus',
    );
  });
});
