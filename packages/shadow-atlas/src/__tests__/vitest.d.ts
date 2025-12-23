/**
 * Custom Vitest Matcher Type Declarations for Shadow Atlas
 *
 * Extends Vitest's Assertion interface with custom matchers.
 */

import 'vitest';

interface CustomMatchers<R = unknown> {
  /**
   * Checks if value is one of the expected values in the array.
   *
   * @example
   * ```typescript
   * expect(result.status).toBeOneOf(['committed', 'validation_failed', 'extraction_failed']);
   * ```
   */
  toBeOneOf<T>(expected: readonly T[]): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
