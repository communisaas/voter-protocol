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
 *   CF_PAGES_PROJECT        Optional - Project name (default: 'commons')
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
  pinResultsPath: string;
  project: string;
  dryRun: boolean;
} {
  let pinResultsPath = './pin-results.json';
  let project = process.env['CF_PAGES_PROJECT'] ?? 'commons';
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

  return { pinResultsPath, project, dryRun };
}

function printUsage(): void {
  console.error(`
Usage:
  tsx scripts/push-cids.ts [--pin-results <path>] [--project <name>] [--dry-run]

Options:
  --pin-results <path>  Path to pin-results.json (default: ./pin-results.json)
  --project <name>      Cloudflare Pages project name
                        (default: CF_PAGES_PROJECT env var or 'commons')
  --dry-run             Print what would be done without making API calls

Environment:
  CLOUDFLARE_API_TOKEN    Required - API token with Pages:Edit permission
  CLOUDFLARE_ACCOUNT_ID   Required - Cloudflare account ID
  CF_PAGES_PROJECT        Optional - Project name (default: 'commons')
`);
}

// ---------------------------------------------------------------------------
// Read pin-results.json
// ---------------------------------------------------------------------------

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

async function setEnvVar(
  accountId: string,
  projectName: string,
  apiToken: string,
  rootCid: string
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

  console.log(`\nSetting IPFS_CID_ROOT on Cloudflare Pages project '${projectName}'...`);
  console.log(`  API: PATCH /accounts/${accountId.slice(0, 8)}..../pages/projects/${projectName}`);

  const body = {
    deployment_configs: {
      production: {
        env_vars: {
          IPFS_CID_ROOT: {
            type: 'secret_text',
            value: rootCid,
          },
        },
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

async function verifyEnvVar(
  accountId: string,
  projectName: string,
  apiToken: string
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

    if (envVars && 'IPFS_CID_ROOT' in envVars) {
      console.log('  IPFS_CID_ROOT: [set] (value redacted by Cloudflare)');
    } else {
      console.warn(
        '  Warning: IPFS_CID_ROOT not found in verification response.'
      );
      console.warn(
        '  The env var may have been set — Cloudflare sometimes omits secret_text values from GET responses.'
      );
    }
  } catch {
    console.warn('  Warning: Could not parse verification response.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { pinResultsPath, project, dryRun } = parseArgs(process.argv.slice(2));

  // Step 1: Extract root CID
  const { rootCid } = extractRootCid(pinResultsPath);

  if (!rootCid) {
    console.error('Error: Root CID is empty.');
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
    console.log('\n[DRY RUN] Would execute:');
    console.log(
      `  PATCH https://api.cloudflare.com/client/v4/accounts/${accountId ?? '<CLOUDFLARE_ACCOUNT_ID>'}/pages/projects/${project}`
    );
    console.log('  Body: {');
    console.log('    "deployment_configs": {');
    console.log('      "production": {');
    console.log('        "env_vars": {');
    console.log('          "IPFS_CID_ROOT": {');
    console.log('            "type": "secret_text",');
    console.log(`            "value": "${rootCid}"`);
    console.log('          }');
    console.log('        }');
    console.log('      }');
    console.log('    }');
    console.log('  }');
    console.log('\n[DRY RUN] No API calls made.');
    return;
  }

  // Step 4: Set the env var (apiToken and accountId guaranteed non-null here)
  await setEnvVar(accountId!, project, apiToken!, rootCid);

  // Step 5: Verify
  await verifyEnvVar(accountId!, project, apiToken!);

  // Step 6: Done
  const cidPreview = rootCid.length > 20 ? rootCid.slice(0, 20) + '...' : rootCid;
  console.log(`\nDone. Next deploy will use CID ${cidPreview}`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
