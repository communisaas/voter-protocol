/**
 * Unit tests for measure-boundary-population helpers.
 *
 * The script's IO layer (BAF read, centroid index, H3 mapping) is integration-
 * tested via the script's own smoke runs (CA, VT). These tests cover the
 * pure helpers: displayCode, pairKey.
 *
 * G3r note: a measurement that lands in audit reports needs at minimum the
 * helper unit tests. Wider coverage (state-level fallback hard-fail behavior,
 * per-district aggregate correctness against synthetic BAF input) is deferred
 * — the brutalist's call for "every state-level edge case tested" is a real
 * concern but would require synthesizing BAF + tract centroid fixtures, which
 * is more scope than G3 ships.
 */

import { describe, expect, it } from 'vitest';

import { displayCode, pairKey } from '../../../scripts/measure-boundary-population.js';

describe('displayCode — FIPS + CD → display string', () => {
	it('formats numeric districts with state abbreviation', () => {
		expect(displayCode('06', '12')).toBe('CA-12');
		expect(displayCode('48', '23')).toBe('TX-23');
	});

	it('zero-pads single-digit districts via BAF input convention', () => {
		expect(displayCode('06', '01')).toBe('CA-01');
	});

	it('renders at-large districts (00) as -AL', () => {
		expect(displayCode('50', '00')).toBe('VT-AL');
		expect(displayCode('56', '00')).toBe('WY-AL');
	});

	it('renders non-voting delegates (98) as -AL', () => {
		expect(displayCode('11', '98')).toBe('DC-AL');
	});

	it('falls through unknown FIPS rather than throwing', () => {
		expect(displayCode('99', '01')).toBe('99-01');
	});
});

describe('pairKey — pair canonicalization', () => {
	it('produces the same key regardless of argument order', () => {
		expect(pairKey('CA-12', 'CA-13')).toBe(pairKey('CA-13', 'CA-12'));
	});

	it('separates with pipe so multi-character codes do not collide', () => {
		const a = pairKey('CA-1', 'CA-12');
		const b = pairKey('CA-11', 'CA-2');
		expect(a).not.toBe(b);
	});

	it('orders alphabetically (lexically)', () => {
		expect(pairKey('TX-23', 'CA-12')).toBe('CA-12|TX-23');
		expect(pairKey('NY-01', 'AK-AL')).toBe('AK-AL|NY-01');
	});
});
