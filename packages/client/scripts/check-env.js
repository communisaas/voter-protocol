#!/usr/bin/env node
/**
 * Fails the build if unsafe env flags are present.
 * This defends against accidentally shipping test params in production bundles.
 */

const unsafe = process.env.ALLOW_TEST_PARAMS;

if (unsafe) {
  console.error(
    'ERROR: ALLOW_TEST_PARAMS is set. This flag must never be enabled for production/browser builds.'
  );
  process.exit(1);
}
