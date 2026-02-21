/**
 * Register Tree Roots On-Chain — Scroll Sepolia
 *
 * Registers userRoot and/or cellMapRoot in their respective registries
 * on Scroll Sepolia. Roots must be registered before DistrictGate will
 * accept proofs against them.
 *
 * Usage:
 *   # From Shadow Atlas server:
 *   npx tsx scripts/register-roots.ts --shadow-atlas-url http://localhost:3000
 *
 *   # With explicit roots:
 *   npx tsx scripts/register-roots.ts --user-root 0x... --cell-map-root 0x... --depth 20
 *
 *   # Dry run (print calldata without broadcasting):
 *   npx tsx scripts/register-roots.ts --shadow-atlas-url http://localhost:3000 --dry-run
 *
 * Requires:
 *   - PRIVATE_KEY env var (deployer/governance wallet, funded on Scroll Sepolia)
 */

import { ethers } from 'ethers';

// ============================================================================
// Config
// ============================================================================

const CONTRACTS = {
  userRootRegistry: '0x19318d473b07e622751Fb5047e7929833cE687c9',
  cellMapRegistry: '0xbe0970996F18D37F4E8d261E1d579702f74cf364',
};

const RPC_URL = process.env.SCROLL_RPC_URL || 'https://sepolia-rpc.scroll.io';
const COUNTRY_USA = '0x555341'; // "USA" as bytes3

const USER_ROOT_REGISTRY_ABI = [
  'function registerUserRoot(bytes32 root, bytes3 country, uint8 depth) external',
  'function isValidUserRoot(bytes32 root) external view returns (bool)',
];

const CELL_MAP_REGISTRY_ABI = [
  'function registerCellMapRoot(bytes32 root, bytes3 country, uint8 depth) external',
  'function isValidCellMapRoot(bytes32 root) external view returns (bool)',
];

// ============================================================================
// CLI Parsing
// ============================================================================

interface CLIOptions {
  shadowAtlasUrl?: string;
  userRoot?: string;
  cellMapRoot?: string;
  depth: number;
  dryRun: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = { depth: 20, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--shadow-atlas-url':
        opts.shadowAtlasUrl = args[++i];
        break;
      case '--user-root':
        opts.userRoot = args[++i];
        break;
      case '--cell-map-root':
        opts.cellMapRoot = args[++i];
        break;
      case '--depth':
        opts.depth = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!opts.shadowAtlasUrl && !opts.userRoot && !opts.cellMapRoot) {
    console.error('Must provide --shadow-atlas-url or explicit --user-root / --cell-map-root');
    process.exit(1);
  }

  return opts;
}

// ============================================================================
// Fetch roots from Shadow Atlas
// ============================================================================

async function fetchRootsFromServer(url: string): Promise<{ userRoot?: string; cellMapRoot?: string; depth: number }> {
  // Fetch cell map info (Tree 2 root + metadata)
  const cellMapRes = await fetch(`${url}/v1/cell-map-info`);
  if (!cellMapRes.ok) {
    throw new Error(`GET /v1/cell-map-info failed: ${cellMapRes.status} ${cellMapRes.statusText}`);
  }
  const cellMapInfo = await cellMapRes.json() as { root?: string; depth?: number; available?: boolean };

  if (!cellMapInfo.available || !cellMapInfo.root) {
    throw new Error('Cell map not available on server (Tree 2 not loaded)');
  }

  // User root comes from the /v1/info endpoint or the latest registration
  const infoRes = await fetch(`${url}/v1/info`);
  let userRoot: string | undefined;
  if (infoRes.ok) {
    const info = await infoRes.json() as { merkleRoot?: string };
    userRoot = info.merkleRoot;
  }

  return {
    userRoot,
    cellMapRoot: cellMapInfo.root,
    depth: cellMapInfo.depth ?? 20,
  };
}

// ============================================================================
// Root Registration
// ============================================================================

function toBigIntHex(root: string): string {
  // Convert a bigint string or hex to bytes32 (0x-prefixed, 64 hex chars)
  const bn = BigInt(root);
  return '0x' + bn.toString(16).padStart(64, '0');
}

async function main() {
  const opts = parseArgs();

  console.log('=== Root Registration — Scroll Sepolia ===\n');

  // Resolve roots
  let userRoot = opts.userRoot;
  let cellMapRoot = opts.cellMapRoot;
  let depth = opts.depth;

  if (opts.shadowAtlasUrl) {
    console.log(`Fetching roots from ${opts.shadowAtlasUrl}...`);
    const fetched = await fetchRootsFromServer(opts.shadowAtlasUrl);
    userRoot = userRoot ?? fetched.userRoot;
    cellMapRoot = cellMapRoot ?? fetched.cellMapRoot;
    depth = fetched.depth ?? depth;
    console.log(`  Cell map root: ${cellMapRoot}`);
    console.log(`  User root: ${userRoot ?? '(none — no registrations yet)'}`);
    console.log(`  Depth: ${depth}\n`);
  }

  if (!userRoot && !cellMapRoot) {
    console.error('No roots to register. Provide --user-root and/or --cell-map-root, or ensure the Shadow Atlas server has data.');
    process.exit(1);
  }

  // Set up provider + signer
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey && !opts.dryRun) {
    console.error('PRIVATE_KEY env var required (governance wallet). Set it or use --dry-run.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  if (opts.dryRun) {
    console.log('[DRY RUN] Would register the following roots:\n');
    if (userRoot) {
      const bytes32 = toBigIntHex(userRoot);
      console.log(`  UserRootRegistry.registerUserRoot(${bytes32}, ${COUNTRY_USA}, ${depth})`);
      console.log(`    Contract: ${CONTRACTS.userRootRegistry}`);
    }
    if (cellMapRoot) {
      const bytes32 = toBigIntHex(cellMapRoot);
      console.log(`  CellMapRegistry.registerCellMapRoot(${bytes32}, ${COUNTRY_USA}, ${depth})`);
      console.log(`    Contract: ${CONTRACTS.cellMapRegistry}`);
    }
    console.log('\nRe-run without --dry-run to broadcast transactions.');
    return;
  }

  const wallet = new ethers.Wallet(privateKey!, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Signer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance < ethers.parseEther('0.001')) {
    console.error('WARNING: Balance very low. Registration transactions may fail.');
  }

  // Register User Root
  if (userRoot) {
    const bytes32 = toBigIntHex(userRoot);
    const registry = new ethers.Contract(CONTRACTS.userRootRegistry, USER_ROOT_REGISTRY_ABI, wallet);

    // Check if already registered
    const alreadyValid = await registry.isValidUserRoot(bytes32);
    if (alreadyValid) {
      console.log(`[UserRoot] Already registered and valid: ${bytes32}`);
    } else {
      console.log(`[UserRoot] Registering: ${bytes32} (depth=${depth})...`);
      const tx = await registry.registerUserRoot(bytes32, COUNTRY_USA, depth);
      console.log(`  TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed.toString()})`);

      // Verify
      const valid = await registry.isValidUserRoot(bytes32);
      console.log(`  isValidUserRoot: ${valid}\n`);
    }
  }

  // Register Cell Map Root
  if (cellMapRoot) {
    const bytes32 = toBigIntHex(cellMapRoot);
    const registry = new ethers.Contract(CONTRACTS.cellMapRegistry, CELL_MAP_REGISTRY_ABI, wallet);

    // Check if already registered
    const alreadyValid = await registry.isValidCellMapRoot(bytes32);
    if (alreadyValid) {
      console.log(`[CellMapRoot] Already registered and valid: ${bytes32}`);
    } else {
      console.log(`[CellMapRoot] Registering: ${bytes32} (depth=${depth})...`);
      const tx = await registry.registerCellMapRoot(bytes32, COUNTRY_USA, depth);
      console.log(`  TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed.toString()})`);

      // Verify
      const valid = await registry.isValidCellMapRoot(bytes32);
      console.log(`  isValidCellMapRoot: ${valid}\n`);
    }
  }

  console.log('=== Root registration complete ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
