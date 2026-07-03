import { describe, it, expect } from 'vitest';
import {
	TIGER_VINTAGE_PATTERN,
	resolveTigerVintage,
} from '../../../distribution/snapshots/tiger-vintage.js';

describe('resolveTigerVintage', () => {
	it('returns a valid TIGER20YY label in non-dry-run mode', () => {
		expect(resolveTigerVintage('TIGER2024', { dryRun: false })).toBe('TIGER2024');
	});

	it('returns a valid TIGER20YY label in dry-run mode', () => {
		expect(resolveTigerVintage('TIGER2024', { dryRun: true })).toBe('TIGER2024');
	});

	it("throws on the 'unknown' default in a non-dry-run publish", () => {
		expect(() => resolveTigerVintage('unknown', { dryRun: false })).toThrow(/TIGER20YY/);
	});

	it("passes 'unknown' through unchanged in dry-run mode", () => {
		expect(resolveTigerVintage('unknown', { dryRun: true })).toBe('unknown');
	});

	it('throws on a malformed bare-year label in a non-dry-run publish', () => {
		expect(() => resolveTigerVintage('2024', { dryRun: false })).toThrow(/TIGER20YY/);
	});

	it('matches the canonical TIGER20YY form', () => {
		expect(TIGER_VINTAGE_PATTERN.test('TIGER2024')).toBe(true);
		expect(TIGER_VINTAGE_PATTERN.test('unknown')).toBe(false);
		expect(TIGER_VINTAGE_PATTERN.test('2024')).toBe(false);
	});
});
