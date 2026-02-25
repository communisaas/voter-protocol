import { describe, it, expect } from 'vitest';
import { sanitizeArgumentText, wrapArgument } from '../prompt/sanitizer.js';

describe('sanitizeArgumentText', () => {
	it('strips control characters', () => {
		expect(sanitizeArgumentText('hello\x00world')).toBe('helloworld');
		expect(sanitizeArgumentText('test\x07beep')).toBe('testbeep');
	});

	it('preserves tabs and newlines', () => {
		expect(sanitizeArgumentText('hello\tworld')).toBe('hello\tworld');
		expect(sanitizeArgumentText('hello\nworld')).toBe('hello\nworld');
		expect(sanitizeArgumentText('hello\rworld')).toBe('hello\rworld');
	});

	it('trims whitespace', () => {
		expect(sanitizeArgumentText('  hello  ')).toBe('hello');
	});

	it('truncates at 10000 characters', () => {
		const long = 'a'.repeat(15000);
		const result = sanitizeArgumentText(long);
		expect(result.length).toBe(10000);
	});

	it('handles empty string', () => {
		expect(sanitizeArgumentText('')).toBe('');
	});
});

describe('wrapArgument', () => {
	it('wraps with XML-style tags', () => {
		const result = wrapArgument(0, 'SUPPORT', 'Good argument');
		expect(result).toContain('<argument index="0" stance="SUPPORT">');
		expect(result).toContain('Good argument');
		expect(result).toContain('</argument>');
	});

	it('includes amendment when provided', () => {
		const result = wrapArgument(1, 'AMEND', 'Main text', 'Amendment text');
		expect(result).toContain('<amendment>Amendment text</amendment>');
	});

	it('excludes amendment tag when not provided', () => {
		const result = wrapArgument(0, 'OPPOSE', 'Just opposing');
		expect(result).not.toContain('<amendment>');
	});

	it('sanitizes body text', () => {
		const result = wrapArgument(0, 'SUPPORT', 'test\x00text');
		expect(result).toContain('testtext');
		expect(result).not.toContain('\x00');
	});
});
