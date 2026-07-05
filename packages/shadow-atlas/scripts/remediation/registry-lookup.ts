#!/usr/bin/env tsx
/**
 * Shadow Atlas remediation — registry row lookup
 *
 * Committed replacement for the round-1 `npx tsx -e "import ... .js"` inline
 * eval, which MODULE_NOT_FOUNDs: tsx's .js->.ts extension remap only applies
 * when the importing module has a TS parent (or `allowJs`), and an `-e`
 * (eval) invocation's parent is neither — so the import specifier must name
 * the real `.ts` file directly. Verified:
 *   npx tsx -e "import { SOURCE_REGISTRY } from './packages/shadow-atlas/src/acquisition/source-health.js'" -> MODULE_NOT_FOUND
 *   npx tsx -e "import { SOURCE_REGISTRY } from './packages/shadow-atlas/src/acquisition/source-health.ts'" -> works (35 rows)
 * Rather than re-encode that fragile one-liner a second time in a workflow
 * heredoc, this is a real, testable, committed script both workflow jobs
 * (diagnose + remediate in shadow-atlas-remediate.yml) shell out to via:
 *   npx tsx packages/shadow-atlas/scripts/remediation/registry-lookup.ts <source_id>
 *
 * Exit 0 + prints the matching SOURCE_REGISTRY row as JSON on success.
 * Exit 1 + a stderr message (no stdout JSON) when no row matches.
 */

import { SOURCE_REGISTRY } from '../../src/acquisition/source-health.ts';

const sourceId = process.argv[2];

if (!sourceId) {
  console.error('Usage: registry-lookup.ts <source_id>');
  process.exit(1);
}

const row = SOURCE_REGISTRY.find((r) => r.id === sourceId);

if (!row) {
  console.error(`No SOURCE_REGISTRY row found for id: ${sourceId}`);
  process.exit(1);
}

console.log(JSON.stringify(row, null, 2));
