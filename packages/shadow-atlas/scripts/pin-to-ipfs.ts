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
 *   STORACHA_AGENT_KEY   - Ed25519 agent private key (required, Mg... format)
 *   STORACHA_PROOF       - UCAN delegation proof (required, base64)
 *   PINATA_JWT           - Pinata JWT (optional, for backup pinning)
 *
 * Outputs:
 *   pin-results.json     - CIDs and metadata for all pinned artifacts
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { createStorachaPinningService } from '../src/distribution/services/storacha.js';
import type { PinResult } from '../src/distribution/types.js';

/**
 * Files to skip when using --all mode.
 * Metadata and sample files are build artifacts for debugging — not client data.
 */
const SKIP_PATTERNS = [
  'metadata.json',       // Build stats, not client-consumable
  '-sample.json',        // Subset for integration testing
  'pin-results.json',    // Our own output file
];

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

interface DirectoryPinOutput {
  timestamp: string;
  mode: 'directory';
  rootCid: string;
  directoryPath: string;
  totalFiles: number;
  totalSizeBytes: number;
  gateway: string;
  verified: boolean;
  verificationDetails: {
    manifest: boolean;
    randomChunk: boolean;
    randomOfficials: boolean;
  };
  durationMs: number;
}

async function verifyGatewayPath(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(30000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Count files recursively in a directory */
function countFiles(dir: string): number {
  let count = 0;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      count += countFiles(fullPath);
    } else if (stat.isFile()) {
      count++;
    }
  }
  return count;
}

/** Sum file sizes recursively in a directory */
function totalDirSize(dir: string): number {
  let total = 0;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      total += totalDirSize(fullPath);
    } else if (stat.isFile()) {
      total += stat.size;
    }
  }
  return total;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let artifacts: Array<{ name: string; path: string }> = [];
  let directoryMode: { path: string } | null = null;
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
          if (!stat.isFile() || f.startsWith('.')) return false;
          // Skip non-client files (metadata, samples, our own output)
          if (SKIP_PATTERNS.some((p) => f.includes(p))) return false;
          return true;
        });
        for (const file of files) {
          artifacts.push({ name: file, path: join(dir, file) });
        }
        break;
      }
      case '--directory': {
        const dir = args[++i];
        directoryMode = { path: dir };
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

  if (artifacts.length === 0 && !directoryMode) {
    console.error('No artifacts or directory specified.');
    printUsage();
    process.exit(1);
  }

  if (directoryMode && artifacts.length > 0) {
    console.error('Cannot combine --directory with --artifact or --all.');
    printUsage();
    process.exit(1);
  }

  // Validate environment
  const spaceDid = process.env['STORACHA_SPACE_DID'];
  const agentKey = process.env['STORACHA_AGENT_KEY'];
  const proof = process.env['STORACHA_PROOF'];

  if (!spaceDid || !agentKey || !proof) {
    console.error(
      'Missing required environment variables: STORACHA_SPACE_DID, STORACHA_AGENT_KEY, STORACHA_PROOF'
    );
    console.error(
      'STORACHA_PROOF is the UCAN delegation proof (base64). Generate with: storacha delegation create'
    );
    console.error(
      'See docs/guides/STORACHA_INTEGRATION_GUIDE.md for setup instructions.'
    );
    process.exit(1);
  }

  if (directoryMode) {
    console.log(`Pinning directory as single DAG: ${directoryMode.path}`);
  } else {
    console.log(`Pinning ${artifacts.length} artifact(s) to IPFS via Storacha`);
  }
  console.log(`Space DID: ${spaceDid.slice(0, 20)}...`);
  console.log();

  // Create pinning service (UCAN auth via @storacha/client)
  const storacha = createStorachaPinningService('americas-east', {
    spaceDid,
    agentPrivateKey: agentKey,
    proof,
    timeoutMs: directoryMode ? 1200000 : 600000, // 20 min for directory, 10 min for single files
  });

  // Health check
  const healthy = await storacha.healthCheck();
  if (!healthy) {
    console.error('Storacha health check failed. Service may be unavailable.');
    process.exit(1);
  }
  console.log('Storacha health check: OK');
  console.log();

  // === Directory mode: pin entire tree as single UnixFS DAG ===
  if (directoryMode) {
    const dirStartTime = Date.now();
    console.log(`Walking directory: ${directoryMode.path}`);
    const fileCount = countFiles(directoryMode.path);
    const dirSize = totalDirSize(directoryMode.path);
    console.log(`  Files: ${fileCount}, Total size: ${(dirSize / 1024 / 1024).toFixed(1)} MB`);
    console.log();

    const result = await storacha.pinDirectory(directoryMode.path);

    if (!result.success) {
      console.error(`Directory pin FAILED: ${result.error}`);
      process.exit(1);
    }

    const rootCid = result.cid;
    const gatewayBase = `https://storacha.link/ipfs/${rootCid}`;

    console.log(`Root CID: ${rootCid}`);
    console.log(`Gateway:  ${gatewayBase}`);
    console.log(`Duration: ${result.durationMs}ms`);
    console.log();

    // Verify via gateway
    console.log('Verifying directory contents via gateway...');

    // 1. Check manifest
    const manifestOk = await verifyGatewayPath(`${gatewayBase}/US/manifest.json`);
    console.log(`  US/manifest.json: ${manifestOk ? 'OK' : 'FAIL'}`);

    // 2. Check a random chunk
    let chunkOk = false;
    const districtsDir = join(directoryMode.path, 'US', 'districts');
    if (existsSync(districtsDir)) {
      const chunks = readdirSync(districtsDir);
      if (chunks.length > 0) {
        const randomChunk = chunks[Math.floor(Math.random() * chunks.length)];
        chunkOk = await verifyGatewayPath(`${gatewayBase}/US/districts/${randomChunk}`);
        console.log(`  US/districts/${randomChunk}: ${chunkOk ? 'OK' : 'FAIL'}`);
      }
    }

    // 3. Check a random officials file (if exists)
    let officialsOk = true;
    const officialsDir = join(directoryMode.path, 'US', 'officials');
    if (existsSync(officialsDir)) {
      const officials = readdirSync(officialsDir);
      if (officials.length > 0) {
        const randomOfficial = officials[Math.floor(Math.random() * officials.length)];
        officialsOk = await verifyGatewayPath(`${gatewayBase}/US/officials/${randomOfficial}`);
        console.log(`  US/officials/${randomOfficial}: ${officialsOk ? 'OK' : 'FAIL'}`);
      }
    }

    const verified = manifestOk && chunkOk && officialsOk;
    const totalDurationMs = Date.now() - dirStartTime;

    console.log();
    console.log(`Overall verified: ${verified}`);

    const dirOutput: DirectoryPinOutput = {
      timestamp: new Date().toISOString(),
      mode: 'directory',
      rootCid,
      directoryPath: directoryMode.path,
      totalFiles: fileCount,
      totalSizeBytes: dirSize,
      gateway: gatewayBase,
      verified,
      verificationDetails: {
        manifest: manifestOk,
        randomChunk: chunkOk,
        randomOfficials: officialsOk,
      },
      durationMs: totalDurationMs,
    };

    writeFileSync(outputPath, JSON.stringify(dirOutput, null, 2));
    console.log(`Results written to: ${outputPath}`);

    if (!verified) {
      console.error('WARNING: Not all verification checks passed.');
    }

    return;
  }

  // === Artifact mode: pin individual files ===
  const output: PinOutput = {
    timestamp: new Date().toISOString(),
    artifacts: [],
    errors: [],
  };

  for (const artifact of artifacts) {
    console.log(`Pinning: ${artifact.name} (${artifact.path})`);

    try {
      let content = readFileSync(artifact.path);
      let pinName = artifact.name;

      // Decompress .br (Brotli) files before pinning.
      // IPFS stores content-addressed data — clients fetch raw bytes via
      // response.json(). Pinning compressed bytes would require every client
      // to handle decompression. Pin the uncompressed JSON instead.
      if (artifact.path.endsWith('.br')) {
        console.log(`  Decompressing Brotli (${(content.length / 1024).toFixed(1)} KB compressed)...`);
        content = Buffer.from(brotliDecompressSync(content));
        pinName = pinName.replace(/\.br$/, '');
        console.log(`  Decompressed: ${(content.length / 1024 / 1024).toFixed(1)} MB`);
      }

      console.log(`  Pinning ${(content.length / 1024).toFixed(1)} KB as "${pinName}"`);

      const result: PinResult = await storacha.pin(content, {
        name: pinName,
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
      const gateway = `https://storacha.link/ipfs/${result.cid}`;

      console.log(`  CID: ${result.cid}`);
      console.log(`  Gateway: ${gateway}`);
      console.log(`  Verified: ${verified}`);
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log();

      output.artifacts.push({
        name: pinName,
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
  tsx scripts/pin-to-ipfs.ts --directory <path>

Options:
  --artifact <path>    File to pin (individually)
  --name <name>        Human-readable name for the artifact
  --all <dir>          Pin all files in directory (individually)
  --directory <path>   Pin entire directory tree as a single UnixFS DAG
                       Returns one root CID; files addressable via subpaths
                       Cannot be combined with --artifact or --all
  --output <path>      Output results file (default: pin-results.json)

Environment:
  STORACHA_SPACE_DID   Required - Storacha space DID
  STORACHA_AGENT_KEY   Required - Ed25519 agent key (Mg... format)
  STORACHA_PROOF       Required - UCAN delegation proof (base64)
  PINATA_JWT           Optional - Pinata JWT for backup pinning
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
