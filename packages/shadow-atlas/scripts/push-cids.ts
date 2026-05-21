#!/usr/bin/env tsx
/**
 * Push CIDs to Cloudflare
 *
 * Reads pin-results.json from the directory pinning step and sets
 * IPFS_CID_ROOT as an environment variable on the Cloudflare Pages project.
 *
 * Usage:
 *   tsx scripts/push-cids.ts [--pin-results <path>] [--project <name>] [--dry-run]
 *
 * Environment:
 *   CLOUDFLARE_API_TOKEN    Required - API token with Pages:Edit
 *   CLOUDFLARE_ACCOUNT_ID   Required - Account ID
 *   CF_PAGES_PROJECT        Optional - Project name (default: 'communique-site')
 *   ATLAS_BASE_URL          Optional - R2 atlas URL
 *   EXPECTED_CELL_MAP_ROOT  Optional - Cell-map SMT root
 *   EXPECTED_CELL_MAP_DEPTH Optional - Cell-map SMT depth
 */

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Directory-mode output from pin-to-ipfs.ts --directory */
interface DirectoryPinResults {
  rootCid: string;
  /** pin-to-ipfs.ts writes `timestamp`, not `pinnedAt` */
  timestamp?: string;
  [key: string]: unknown;
}

/** Legacy per-artifact output from pin-to-ipfs.ts */
interface LegacyPinResults {
  timestamp: string;
  artifacts: Array<{
    name: string;
    cid: string;
    [key: string]: unknown;
  }>;
  errors: Array<unknown>;
}

interface CloudflareApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  pinResultsPath: string | null;
  project: string;
  atlasBaseUrl: string;
  cellMapRoot: string;
  cellMapDepth: string;
  dryRun: boolean;
} {
  // pin-results path is optional. With IPFS pinning paused (2026-05-02),
  // most invocations push only ATLAS_BASE_URL. The script regains the
  // IPFS_CID_ROOT push automatically once --pin-results is supplied again.
  let pinResultsPath: string | null = null;
  let project = process.env['CF_PAGES_PROJECT'] ?? 'communique-site';
  let atlasBaseUrl = process.env['ATLAS_BASE_URL'] ?? '';
  let cellMapRoot = process.env['EXPECTED_CELL_MAP_ROOT'] ?? '';
  let cellMapDepth = process.env['EXPECTED_CELL_MAP_DEPTH'] ?? '';
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--pin-results':
        pinResultsPath = argv[++i];
        if (!pinResultsPath) {
          console.error('Error: --pin-results requires a path argument.');
          process.exit(2);
        }
        break;
      case '--project':
        project = argv[++i];
        if (!project) {
          console.error('Error: --project requires a name argument.');
          process.exit(2);
        }
        break;
      case '--atlas-url':
        atlasBaseUrl = argv[++i];
        if (!atlasBaseUrl) {
          console.error('Error: --atlas-url requires a URL argument.');
          process.exit(2);
        }
        break;
      case '--cell-map-root':
        cellMapRoot = argv[++i];
        if (!cellMapRoot) {
          console.error('Error: --cell-map-root requires a root argument.');
          process.exit(2);
        }
        break;
      case '--cell-map-depth':
        cellMapDepth = argv[++i];
        if (!cellMapDepth) {
          console.error('Error: --cell-map-depth requires a depth argument.');
          process.exit(2);
        }
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(2);
    }
  }

  return { pinResultsPath, project, atlasBaseUrl, cellMapRoot, cellMapDepth, dryRun };
}

function printUsage(): void {
  console.error(`
Usage:
  tsx scripts/push-cids.ts [--pin-results <path>] [--project <name>] [--dry-run]

Options:
  --pin-results <path>  Path to pin-results.json (default: ./pin-results.json)
  --project <name>      Cloudflare Pages project name
                        (default: CF_PAGES_PROJECT env var or 'communique-site')
  --atlas-url <url>     Versioned R2 atlas base URL
  --cell-map-root <hex> Expected Tree 2 cell-map root
  --cell-map-depth <n>  Expected Tree 2 cell-map depth
  --dry-run             Print what would be done without making API calls

Environment:
  CLOUDFLARE_API_TOKEN    Required - API token with Pages:Edit permission
  CLOUDFLARE_ACCOUNT_ID   Required - Cloudflare account ID
  CF_PAGES_PROJECT        Optional - Project name (default: 'communique-site')
  ATLAS_BASE_URL          Optional - R2 atlas URL
  EXPECTED_CELL_MAP_ROOT  Optional - Cell-map SMT root
  EXPECTED_CELL_MAP_DEPTH Optional - Cell-map SMT depth
`);
}

// ---------------------------------------------------------------------------
// Read pin-results.json
// ---------------------------------------------------------------------------

const CID_PATTERN = /^(bafy[a-zA-Z0-9]{50,}|Qm[a-zA-Z0-9]{44,})$/;

function validateCidFormat(cid: string, sourcePath: string): void {
  if (!CID_PATTERN.test(cid)) {
    console.error(`Error: CID from ${sourcePath} does not match expected format (CIDv1 bafy... or CIDv0 Qm...): ${cid}`);
    process.exit(2);
  }
}

function validateCellMapRoot(root: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
    console.error(`Error: --cell-map-root must be a 0x-prefixed 32-byte hex string: ${root}`);
    process.exit(2);
  }
}

function validateCellMapDepth(depth: string): void {
  const parsed = Number(depth);
  if (!Number.isInteger(parsed) || parsed < 18 || parsed > 24 || parsed % 2 !== 0) {
    console.error(`Error: --cell-map-depth must be one of 18, 20, 22, or 24: ${depth}`);
    process.exit(2);
  }
}

function extractRootCid(filePath: string): { rootCid: string; pinnedAt: string | null } {
  console.log('Reading pin-results.json...');

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: Could not read ${filePath}: ${msg}`);
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Error: ${filePath} is not valid JSON.`);
    process.exit(2);
  }

  if (parsed === null || typeof parsed !== 'object') {
    console.error(`Error: ${filePath} does not contain a JSON object.`);
    process.exit(2);
  }

  const data = parsed as Record<string, unknown>;

  // Directory-mode format: { rootCid: "bafy..." }
  if (typeof data['rootCid'] === 'string' && data['rootCid'].length > 0) {
    const dir = data as unknown as DirectoryPinResults;
    const pinnedAt = typeof dir.timestamp === 'string' ? dir.timestamp : null;
    console.log(`  Root CID: ${dir.rootCid}`);
    if (pinnedAt) {
      console.log(`  Pinned at: ${pinnedAt}`);
    }
    validateCidFormat(dir.rootCid, filePath);
    // R64-F4: Refuse to promote unverified snapshots to production
    if ('verified' in data && data['verified'] === false) {
      console.error('Error: pin-results.json has verified=false — verification checks did not pass.');
      console.error('  Refusing to promote unverified CID to production.');
      process.exit(2);
    }
    return { rootCid: dir.rootCid, pinnedAt };
  }

  // Legacy format: { artifacts: [{ name, cid }] }
  if (Array.isArray(data['artifacts'])) {
    const legacy = data as unknown as LegacyPinResults;

    if (legacy.artifacts.length === 0) {
      console.error('Error: pin-results.json has an empty artifacts array. Nothing was pinned.');
      process.exit(2);
    }

    console.warn(
      'Warning: pin-results.json uses the legacy per-artifact format.'
    );
    console.warn(
      '  Consider using `pin-to-ipfs.ts --directory` to produce a single root CID.'
    );

    // Use the first artifact's CID as root
    const first = legacy.artifacts[0];
    const pinnedAt = typeof legacy.timestamp === 'string' ? legacy.timestamp : null;

    if (!first.cid || typeof first.cid !== 'string') {
      console.error('Error: First artifact in pin-results.json has no CID.');
      process.exit(2);
    }

    console.log(`  Using CID from artifact "${first.name}": ${first.cid}`);
    if (pinnedAt) {
      console.log(`  Pinned at: ${pinnedAt}`);
    }
    validateCidFormat(first.cid, filePath);
    return { rootCid: first.cid, pinnedAt };
  }

  console.error(
    'Error: pin-results.json has an unrecognized format. ' +
      'Expected { rootCid: "..." } or { artifacts: [{ cid: "..." }] }.'
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Cloudflare API
// ---------------------------------------------------------------------------

async function setEnvVars(
  accountId: string,
  projectName: string,
  apiToken: string,
  rootCid: string | null,
  atlasBaseUrl?: string,
  cellMapRoot?: string,
  cellMapDepth?: string,
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

  const envVars: Record<string, { type: string; value: string }> = {};

  if (rootCid) {
    envVars['IPFS_CID_ROOT'] = {
      type: 'secret_text',
      value: rootCid,
    };
  }

  if (atlasBaseUrl) {
    envVars['ATLAS_BASE_URL'] = {
      type: 'plain_text',
      value: atlasBaseUrl,
    };
    envVars['VITE_ATLAS_BASE_URL'] = {
      type: 'plain_text',
      value: atlasBaseUrl,
    };
  }

  if (cellMapRoot) {
    envVars['EXPECTED_CELL_MAP_ROOT'] = {
      type: 'plain_text',
      value: cellMapRoot,
    };
  }

  if (cellMapDepth) {
    envVars['EXPECTED_CELL_MAP_DEPTH'] = {
      type: 'plain_text',
      value: cellMapDepth,
    };
  }

  if (Object.keys(envVars).length === 0) {
    console.error(
      'Error: at least one of --pin-results, --atlas-url, --cell-map-root, or --cell-map-depth must be provided.'
    );
    process.exit(2);
  }

  const labels = Object.keys(envVars).join(' + ');
  console.log(`\nSetting ${labels} on Cloudflare Pages project '${projectName}'...`);
  console.log(`  API: PATCH /accounts/${accountId.slice(0, 8)}..../pages/projects/${projectName}`);

  const body = {
    deployment_configs: {
      production: {
        env_vars: envVars,
      },
    },
  };

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const status = `${response.status} ${response.statusText}`;
  console.log(`  Status: ${status}`);

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = (await response.json()) as CloudflareApiResponse;
      if (errBody.errors && errBody.errors.length > 0) {
        detail = errBody.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
      }
    } catch {
      // Response may not be JSON
    }
    console.error(`\nError: Cloudflare API returned ${status}.`);
    if (detail) {
      console.error(`  Details: ${detail}`);
    }
    process.exit(1);
  }

  const result = (await response.json()) as CloudflareApiResponse;

  if (!result.success) {
    const msgs = (result.errors ?? []).map((e) => `[${e.code}] ${e.message}`).join('; ');
    console.error(`\nError: Cloudflare API responded with success=false.`);
    if (msgs) {
      console.error(`  Errors: ${msgs}`);
    }
    process.exit(1);
  }
}

function getEnvVarValue(envVars: Record<string, unknown>, name: string): string | undefined {
  const entry = envVars[name];
  if (entry === null || typeof entry !== 'object') return undefined;
  const value = (entry as Record<string, unknown>)['value'];
  return typeof value === 'string' ? value : undefined;
}

async function verifyEnvVars(
  accountId: string,
  projectName: string,
  apiToken: string,
  expected: {
    rootCid: string | null;
    atlasBaseUrl: string;
    cellMapRoot: string;
    cellMapDepth: string;
  }
): Promise<void> {
  console.log('\nVerifying...');

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Verification request failed: ${msg}`);
    console.warn('  The env var may still have been set successfully.');
    return;
  }

  if (!response.ok) {
    console.warn(`  Warning: Verification GET returned ${response.status}. Skipping verification.`);
    return;
  }

  try {
    const data = (await response.json()) as CloudflareApiResponse;
    const result = data.result as Record<string, unknown> | null;
    if (!result) {
      console.warn('  Warning: No result in verification response.');
      return;
    }

    const deployConfigs = result['deployment_configs'] as Record<string, unknown> | undefined;
    const production = deployConfigs?.['production'] as Record<string, unknown> | undefined;
    const envVars = production?.['env_vars'] as Record<string, unknown> | undefined;

    if (!envVars) {
      const message = 'No production env_vars in verification response.';
      if (expected.atlasBaseUrl || expected.cellMapRoot || expected.cellMapDepth) {
        console.error(`  Error: ${message}`);
        process.exit(1);
      }
      console.warn(`  Warning: ${message}`);
      return;
    }

    if (expected.rootCid && 'IPFS_CID_ROOT' in envVars) {
      console.log('  IPFS_CID_ROOT: [set] (value redacted by Cloudflare)');
    } else if (expected.rootCid) {
      console.warn(
        '  Warning: IPFS_CID_ROOT not found in verification response.'
      );
      console.warn(
        '  The env var may have been set — Cloudflare sometimes omits secret_text values from GET responses.'
      );
    }

    if (expected.atlasBaseUrl) {
      const actualAtlasBaseUrl = getEnvVarValue(envVars, 'ATLAS_BASE_URL');
      if (actualAtlasBaseUrl === expected.atlasBaseUrl) {
        console.log('  ATLAS_BASE_URL: verified');
      } else {
        console.error('  Error: ATLAS_BASE_URL verification failed.');
        console.error(`    expected: ${expected.atlasBaseUrl}`);
        console.error(`    actual:   ${actualAtlasBaseUrl ?? '<missing or redacted>'}`);
        process.exit(1);
      }

      const actualViteAtlasBaseUrl = getEnvVarValue(envVars, 'VITE_ATLAS_BASE_URL');
      if (actualViteAtlasBaseUrl === expected.atlasBaseUrl) {
        console.log('  VITE_ATLAS_BASE_URL: verified');
      } else {
        console.error('  Error: VITE_ATLAS_BASE_URL verification failed.');
        console.error(`    expected: ${expected.atlasBaseUrl}`);
        console.error(`    actual:   ${actualViteAtlasBaseUrl ?? '<missing or redacted>'}`);
        process.exit(1);
      }
    }

    if (expected.cellMapRoot) {
      const actualCellMapRoot = getEnvVarValue(envVars, 'EXPECTED_CELL_MAP_ROOT');
      if (actualCellMapRoot === expected.cellMapRoot) {
        console.log('  EXPECTED_CELL_MAP_ROOT: verified');
      } else {
        console.error('  Error: EXPECTED_CELL_MAP_ROOT verification failed.');
        console.error(`    expected: ${expected.cellMapRoot}`);
        console.error(`    actual:   ${actualCellMapRoot ?? '<missing or redacted>'}`);
        process.exit(1);
      }
    }

    if (expected.cellMapDepth) {
      const actualCellMapDepth = getEnvVarValue(envVars, 'EXPECTED_CELL_MAP_DEPTH');
      if (actualCellMapDepth === expected.cellMapDepth) {
        console.log('  EXPECTED_CELL_MAP_DEPTH: verified');
      } else {
        console.error('  Error: EXPECTED_CELL_MAP_DEPTH verification failed.');
        console.error(`    expected: ${expected.cellMapDepth}`);
        console.error(`    actual:   ${actualCellMapDepth ?? '<missing or redacted>'}`);
        process.exit(1);
      }
    }
  } catch {
    console.warn('  Warning: Could not parse verification response.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pinResultsPath, project, atlasBaseUrl, cellMapRoot, cellMapDepth, dryRun } = parseArgs(
    process.argv.slice(2)
  );

  // Step 1: Extract root CID iff pin-results is supplied.
  // IPFS pinning is paused (2026-05-02) so most runs push ATLAS_BASE_URL only.
  let rootCid: string | null = null;
  if (pinResultsPath) {
    const extracted = extractRootCid(pinResultsPath);
    if (!extracted.rootCid) {
      console.error('Error: --pin-results path was supplied but Root CID is empty.');
      process.exit(2);
    }
    rootCid = extracted.rootCid;
  }

  if (cellMapRoot) validateCellMapRoot(cellMapRoot);
  if (cellMapDepth) validateCellMapDepth(cellMapDepth);
  if ((cellMapRoot && !cellMapDepth) || (!cellMapRoot && cellMapDepth)) {
    console.error('Error: --cell-map-root and --cell-map-depth must be supplied together.');
    process.exit(2);
  }

  if (!rootCid && !atlasBaseUrl && !cellMapRoot && !cellMapDepth) {
    console.error(
      'Error: at least one of --pin-results, --atlas-url, --cell-map-root, or --cell-map-depth must be provided.'
    );
    process.exit(2);
  }

  // Step 2: Validate env vars
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];

  if (!dryRun) {
    if (!apiToken) {
      console.error('\nError: CLOUDFLARE_API_TOKEN environment variable is not set.');
      console.error('  Create a token with Pages:Edit permission at:');
      console.error('  https://dash.cloudflare.com/profile/api-tokens');
      process.exit(2);
    }
    if (!accountId) {
      console.error('\nError: CLOUDFLARE_ACCOUNT_ID environment variable is not set.');
      console.error('  Find it in the Cloudflare dashboard sidebar under your domain.');
      process.exit(2);
    }
  }

  // Step 3: Dry-run mode
  if (dryRun) {
    const accountPreview = accountId ? accountId.slice(0, 8) + '...' : '<CLOUDFLARE_ACCOUNT_ID>';
    console.log('\n[DRY RUN] Would execute:');
    console.log(`  PATCH https://api.cloudflare.com/client/v4/accounts/${accountPreview}/pages/projects/${project}`);
    console.log('  Env vars:');
    if (rootCid) console.log(`    IPFS_CID_ROOT = ${rootCid}`);
    if (atlasBaseUrl) console.log(`    ATLAS_BASE_URL = ${atlasBaseUrl}`);
    if (atlasBaseUrl) console.log(`    VITE_ATLAS_BASE_URL = ${atlasBaseUrl}`);
    if (cellMapRoot) console.log(`    EXPECTED_CELL_MAP_ROOT = ${cellMapRoot}`);
    if (cellMapDepth) console.log(`    EXPECTED_CELL_MAP_DEPTH = ${cellMapDepth}`);
    console.log('\n[DRY RUN] No API calls made.');
    return;
  }

  // Step 4: Set the env vars
  if (rootCid) {
    console.log('\nPrevious CID (for rollback): check Cloudflare dashboard — API redacts secret values');
  }
  await setEnvVars(
    accountId!,
    project,
    apiToken!,
    rootCid,
    atlasBaseUrl || undefined,
    cellMapRoot || undefined,
    cellMapDepth || undefined
  );

  // Gateway verification removed 2026-05-02 with the Storacha sunset.
  // When IPFS pinning resumes, re-add a verification step pointing at the
  // chosen provider's gateway domain.

  // Step 5: Verify
  await verifyEnvVars(accountId!, project, apiToken!, {
    rootCid,
    atlasBaseUrl,
    cellMapRoot,
    cellMapDepth,
  });

  // Step 6: Done
  const targetPreview = rootCid
    ? `CID ${rootCid.length > 20 ? rootCid.slice(0, 20) + '...' : rootCid}`
    : `ATLAS_BASE_URL ${atlasBaseUrl}`;
  console.log(`\nDone. Next deploy will use ${targetPreview}`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
