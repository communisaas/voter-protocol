#!/usr/bin/env tsx
/**
 * Pin Artifacts to IPFS
 *
 * Pins shadow-atlas build artifacts (H3 mapping, Merkle snapshot, officials)
 * to Storacha (primary) and Pinata (backup) using the existing distribution
 * infrastructure.
 *
 * Usage:
 *   tsx scripts/pin-to-ipfs.ts --artifact <path> --name <name> [--all <dir>]
 *
 * Examples:
 *   # Pin a single file
 *   tsx scripts/pin-to-ipfs.ts --artifact output/h3-district-mapping.json.br --name h3-mapping
 *
 *   # Pin all quarterly artifacts from a directory
 *   tsx scripts/pin-to-ipfs.ts --all output/
 *
 * Environment Variables:
 *   STORACHA_SPACE_DID   - Storacha space DID (required)
 *   STORACHA_AGENT_KEY   - Storacha agent private key (required)
 *   PINATA_JWT           - Pinata JWT (optional, for backup pinning)
 *
 * Outputs:
 *   pin-results.json     - CIDs and metadata for all pinned artifacts
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createStorachaPinningService } from '../src/distribution/services/storacha.js';
import type { PinResult } from '../src/distribution/types.js';

interface ArtifactResult {
  name: string;
  path: string;
  sizeBytes: number;
  cid: string;
  service: string;
  gateway: string;
  pinnedAt: string;
  durationMs: number;
  verified: boolean;
}

interface PinOutput {
  timestamp: string;
  artifacts: ArtifactResult[];
  errors: Array<{ name: string; path: string; error: string }>;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let artifacts: Array<{ name: string; path: string }> = [];
  let outputPath = 'pin-results.json';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--artifact': {
        const path = args[++i];
        const name = args[i + 1] === '--name' ? args[(i += 2)] : basename(path);
        artifacts.push({ name, path });
        break;
      }
      case '--all': {
        const dir = args[++i];
        const files = readdirSync(dir).filter((f) => {
          const stat = statSync(join(dir, f));
          return stat.isFile() && !f.startsWith('.');
        });
        for (const file of files) {
          artifacts.push({ name: file, path: join(dir, file) });
        }
        break;
      }
      case '--output':
        outputPath = args[++i];
        break;
      case '--name':
        // Handled in --artifact case
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (artifacts.length === 0) {
    console.error('No artifacts specified.');
    printUsage();
    process.exit(1);
  }

  // Validate environment
  const spaceDid = process.env['STORACHA_SPACE_DID'];
  const agentKey = process.env['STORACHA_AGENT_KEY'];

  if (!spaceDid || !agentKey) {
    console.error(
      'Missing required environment variables: STORACHA_SPACE_DID, STORACHA_AGENT_KEY'
    );
    console.error(
      'See docs/guides/STORACHA_INTEGRATION_GUIDE.md for setup instructions.'
    );
    process.exit(1);
  }

  console.log(`Pinning ${artifacts.length} artifact(s) to IPFS via Storacha`);
  console.log(`Space DID: ${spaceDid.slice(0, 20)}...`);
  console.log();

  // Create pinning service
  const storacha = createStorachaPinningService('americas-east', {
    spaceDid,
    agentPrivateKey: agentKey,
    timeoutMs: 120000, // 2 min timeout for large files
  });

  // Health check
  const healthy = await storacha.healthCheck();
  if (!healthy) {
    console.error('Storacha health check failed. Service may be unavailable.');
    process.exit(1);
  }
  console.log('Storacha health check: OK');
  console.log();

  // Pin each artifact
  const output: PinOutput = {
    timestamp: new Date().toISOString(),
    artifacts: [],
    errors: [],
  };

  for (const artifact of artifacts) {
    console.log(`Pinning: ${artifact.name} (${artifact.path})`);

    try {
      const content = readFileSync(artifact.path);
      console.log(`  Size: ${(content.length / 1024).toFixed(1)} KB`);

      const result: PinResult = await storacha.pin(content, {
        name: artifact.name,
      });

      if (!result.success) {
        console.error(`  FAILED: ${result.error}`);
        output.errors.push({
          name: artifact.name,
          path: artifact.path,
          error: result.error ?? 'Unknown error',
        });
        continue;
      }

      // Verify the pin
      const verified = await storacha.verify(result.cid);
      const gateway = `https://${result.cid}.ipfs.w3s.link/`;

      console.log(`  CID: ${result.cid}`);
      console.log(`  Gateway: ${gateway}`);
      console.log(`  Verified: ${verified}`);
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log();

      output.artifacts.push({
        name: artifact.name,
        path: artifact.path,
        sizeBytes: content.length,
        cid: result.cid,
        service: result.service,
        gateway,
        pinnedAt: result.pinnedAt.toISOString(),
        durationMs: result.durationMs,
        verified,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR: ${msg}`);
      output.errors.push({
        name: artifact.name,
        path: artifact.path,
        error: msg,
      });
    }
  }

  // Write results
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Results written to: ${outputPath}`);

  // Summary
  console.log();
  console.log('=== Summary ===');
  console.log(`  Pinned: ${output.artifacts.length}/${artifacts.length}`);
  console.log(`  Errors: ${output.errors.length}`);

  if (output.artifacts.length > 0) {
    console.log();
    console.log('CIDs:');
    for (const a of output.artifacts) {
      console.log(`  ${a.name}: ${a.cid}`);
    }
  }

  if (output.errors.length > 0) {
    process.exit(1);
  }
}

function printUsage() {
  console.error(`
Usage:
  tsx scripts/pin-to-ipfs.ts --artifact <path> --name <name>
  tsx scripts/pin-to-ipfs.ts --all <directory>

Options:
  --artifact <path>   File to pin
  --name <name>       Human-readable name for the artifact
  --all <dir>         Pin all files in directory
  --output <path>     Output results file (default: pin-results.json)

Environment:
  STORACHA_SPACE_DID   Required - Storacha space DID
  STORACHA_AGENT_KEY   Required - Storacha agent private key
  PINATA_JWT           Optional - Pinata JWT for backup pinning
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
