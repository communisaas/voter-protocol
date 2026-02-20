/**
 * E2E On-Chain Proof Submission — Scroll Sepolia
 *
 * Generates a real ZK proof from Census data and submits it on-chain:
 *   1. Load DC snapshot → build Tree 2
 *   2. Compute user leaf → insert into Tree 1
 *   3. Generate Noir ZK proof (UltraHonk, ~8s)
 *   4. Register roots on-chain (UserRootRegistry + CellMapRegistry)
 *   5. Construct EIP-712 signature
 *   6. Submit to DistrictGate.verifyTwoTreeProof()
 *   7. Verify nullifier was recorded
 *
 * Usage:
 *   npx tsx scripts/submit-proof-sepolia.ts
 *
 * Requires:
 *   - data/test-dc-snapshot.json (build with: npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --state 11 --output data/test-dc-snapshot.json --depth 20)
 *   - .env with PRIVATE_KEY funded on Scroll Sepolia
 */

import { ethers } from 'ethers';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// Shadow Atlas
import { loadCellMapStateFromSnapshot } from '../packages/shadow-atlas/src/hydration/snapshot-loader.js';
import { RegistrationService } from '../packages/shadow-atlas/src/serving/registration-service.js';

// Crypto
import { getHasher } from '@voter-protocol/crypto';

// Noir prover (TwoTreeNoirProver for input formatting + validation, backend for keccak proofs)
import { TwoTreeNoirProver } from '@voter-protocol/noir-prover';
import type { TwoTreeProofInput } from '@voter-protocol/noir-prover';
import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';

// ============================================================================
// Config
// ============================================================================

const TREE_DEPTH = 20;
const REPO_ROOT = resolve(__dirname, '..');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'data/test-dc-snapshot.json');

// Deployed contract addresses (Scroll Sepolia v4 — bb.js-compatible verifier)
const CONTRACTS = {
  districtGate: '0x0085DFAd6DB867e7486A460579d768BD7C37181e',
  userRootRegistry: '0x19318d473b07e622751Fb5047e7929833cE687c9',
  cellMapRegistry: '0xbe0970996F18D37F4E8d261E1d579702f74cf364',
  nullifierRegistry: '0x4D9060de86Adf846786E32BaFe753D944496D00e',
};

// Private witness values — use unique values per run to avoid nullifier collision
const USER_SECRET = BigInt(Date.now()) * 1000n + 987654321n;
const REGISTRATION_SALT = BigInt(Date.now()) * 1000n + 1122334455n;
const IDENTITY_COMMITMENT = BigInt(Date.now()) * 1000n + 42424242n;
const ACTION_DOMAIN = 100n; // Must match genesis-registered domain
const AUTHORITY_LEVEL = 1;

// Country code for US = "USA" = 0x555341
const COUNTRY_USA = '0x555341';

// RPC
const RPC_URL = 'https://sepolia-rpc.scroll.io';

// ============================================================================
// ABIs (minimal — only functions we call)
// ============================================================================

const USER_ROOT_REGISTRY_ABI = [
  'function registerUserRoot(bytes32 root, bytes3 country, uint8 depth) external',
  'function isValidUserRoot(bytes32 root) external view returns (bool)',
  'function getCountryAndDepth(bytes32 root) external view returns (bytes3, uint8)',
];

const CELL_MAP_REGISTRY_ABI = [
  'function registerCellMapRoot(bytes32 root, bytes3 country, uint8 depth) external',
  'function isValidCellMapRoot(bytes32 root) external view returns (bool)',
  'function getCountryAndDepth(bytes32 root) external view returns (bytes3, uint8)',
];

const DISTRICT_GATE_ABI = [
  'function verifyTwoTreeProof(address signer, bytes calldata proof, uint256[29] calldata publicInputs, uint8 verifierDepth, uint256 deadline, bytes calldata signature) external',
  'function nonces(address) external view returns (uint256)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
  'function allowedActionDomains(bytes32) external view returns (bool)',
  'function userRootRegistry() external view returns (address)',
  'function cellMapRegistry() external view returns (address)',
  'function genesisSealed() external view returns (bool)',
  'function verifierRegistry() external view returns (address)',
  // Custom errors for diagnostics
  'error ZeroAddress()',
  'error SignatureExpired()',
  'error InvalidSignature()',
  'error InvalidUserRoot()',
  'error InvalidCellMapRoot()',
  'error CountryMismatch()',
  'error DepthMismatch()',
  'error ActionDomainNotAllowed()',
  'error InsufficientAuthority(uint8 submitted, uint8 required)',
  'error VerifierNotFound()',
  'error TwoTreeVerificationFailed()',
  'error NullifierAlreadyUsed()',
];

const VERIFIER_REGISTRY_ABI = [
  'function getVerifier(uint8 depth) external view returns (address)',
];

const HONK_VERIFIER_ABI = [
  'function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool)',
  'error ProofLengthWrongWithLogN(uint256 logN, uint256 proofLength, uint256 expectedLength)',
  'error PublicInputsLengthWrong()',
];

const NULLIFIER_REGISTRY_ABI = [
  'function isNullifierUsed(bytes32 actionId, bytes32 nullifier) external view returns (bool)',
  'function getParticipantCount(bytes32 actionId) external view returns (uint256)',
];

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('============================================================');
  console.log('  E2E ON-CHAIN PROOF SUBMISSION — SCROLL SEPOLIA');
  console.log('============================================================\n');

  // --- Setup ---
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // --- Contracts ---
  const userRootRegistry = new ethers.Contract(CONTRACTS.userRootRegistry, USER_ROOT_REGISTRY_ABI, wallet);
  const cellMapRegistry = new ethers.Contract(CONTRACTS.cellMapRegistry, CELL_MAP_REGISTRY_ABI, wallet);
  const districtGate = new ethers.Contract(CONTRACTS.districtGate, DISTRICT_GATE_ABI, wallet);
  const nullifierRegistry = new ethers.Contract(CONTRACTS.nullifierRegistry, NULLIFIER_REGISTRY_ABI, provider);

  // --- Pre-flight checks ---
  console.log('[0] Pre-flight checks...');
  const genesisSealed = await districtGate.genesisSealed();
  console.log(`  Genesis sealed: ${genesisSealed}`);

  const actionDomainAllowed = await districtGate.allowedActionDomains(
    ethers.zeroPadValue(ethers.toBeHex(ACTION_DOMAIN), 32),
  );
  console.log(`  Action domain ${ACTION_DOMAIN} allowed: ${actionDomainAllowed}`);

  const urr = await districtGate.userRootRegistry();
  const cmr = await districtGate.cellMapRegistry();
  console.log(`  UserRootRegistry: ${urr}`);
  console.log(`  CellMapRegistry: ${cmr}\n`);

  if (!actionDomainAllowed) throw new Error('Action domain not registered!');

  // --- Step 1: Load Tree 2 from snapshot ---
  console.log('[1] Loading Tree 2 from DC Census snapshot...');
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(`Snapshot not found: ${SNAPSHOT_PATH}`);
  }

  const cellMapState = await loadCellMapStateFromSnapshot(SNAPSHOT_PATH);
  console.log(`  Cells: ${cellMapState.districtMap.size}`);
  console.log(`  Root: 0x${cellMapState.root.toString(16).slice(0, 16)}...`);

  // Pick a cell with multiple districts
  let cellId!: bigint;
  let districts!: readonly bigint[];
  for (const [key, dists] of cellMapState.districtMap) {
    const nonZero = dists.filter((d: bigint) => d !== 0n).length;
    if (nonZero >= 2) {
      cellId = BigInt(key);
      districts = dists;
      break;
    }
  }
  if (!cellId) {
    const firstKey = cellMapState.districtMap.keys().next().value!;
    cellId = BigInt(firstKey);
    districts = cellMapState.districtMap.get(firstKey)!;
  }
  console.log(`  Selected cell: ${cellId} (${districts.filter((d: bigint) => d !== 0n).length}/24 districts)\n`);

  // --- Step 2: Compute user leaf and insert into Tree 1 ---
  console.log('[2] Computing user leaf and inserting into Tree 1...');
  const hasher = await getHasher();

  const userLeaf = await hasher.hash4(
    USER_SECRET,
    cellId,
    REGISTRATION_SALT,
    BigInt(AUTHORITY_LEVEL),
  );
  console.log(`  User leaf: 0x${userLeaf.toString(16).slice(0, 16)}...`);

  const registrationService = await RegistrationService.create(TREE_DEPTH);
  const regResult = await registrationService.insertLeaf('0x' + userLeaf.toString(16));

  const userRoot = BigInt(regResult.userRoot);
  const userPath = regResult.userPath.map((s: string) => BigInt(s));
  const userIndex = regResult.leafIndex;
  console.log(`  User root: 0x${userRoot.toString(16).slice(0, 16)}...`);
  console.log(`  Leaf index: ${userIndex}\n`);

  // --- Step 3: Get Tree 2 SMT proof ---
  console.log('[3] Getting Tree 2 SMT proof...');
  const smtProof = await cellMapState.tree.getProof(cellId);
  console.log(`  SMT siblings: ${smtProof.siblings.length}`);
  console.log(`  Path bits: ${smtProof.pathBits.length}\n`);

  // --- Step 4: Compute nullifier ---
  console.log('[4] Computing nullifier...');
  const nullifier = await hasher.hashPair(IDENTITY_COMMITMENT, ACTION_DOMAIN);
  console.log(`  Nullifier: 0x${nullifier.toString(16).slice(0, 16)}...\n`);

  // --- Step 5: Generate proof (keccak mode for on-chain verification) ---
  console.log('[5] Generating proof (keccak mode for Solidity verifier)...');

  // Use TwoTreeNoirProver for input validation + formatting only
  const helperProver = new TwoTreeNoirProver({ depth: TREE_DEPTH });

  const proofInput: TwoTreeProofInput = {
    userRoot,
    cellMapRoot: cellMapState.root,
    districts: [...districts],
    nullifier,
    actionDomain: ACTION_DOMAIN,
    authorityLevel: AUTHORITY_LEVEL,
    userSecret: USER_SECRET,
    cellId,
    registrationSalt: REGISTRATION_SALT,
    identityCommitment: IDENTITY_COMMITMENT,
    userPath,
    userIndex,
    cellMapPath: smtProof.siblings,
    cellMapPathBits: smtProof.pathBits,
  };

  // Validate inputs via the prover
  helperProver.validateInputs(proofInput);
  const noirInputs = helperProver.formatInputs(proofInput);

  // Load circuit and create backend + noir directly (to control keccak option)
  const circuitModule = await import(
    resolve(REPO_ROOT, `packages/noir-prover/circuits/two_tree_membership_${TREE_DEPTH}.json`),
    { with: { type: 'json' } }
  );
  const circuit = circuitModule.default as unknown as CompiledCircuit;
  const noir = new Noir(circuit);
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 4 });

  console.log('  Generating witness...');
  const { witness } = await noir.execute(noirInputs as any);

  console.log('  Generating proof with { keccak: true } for on-chain...');
  const startTime = Date.now();
  const proofResult = await backend.generateProof(witness, { keccak: true });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Proof generated in ${elapsed}s`);
  console.log(`  Proof size: ${proofResult.proof.length} bytes`);
  console.log(`  Public inputs: ${proofResult.publicInputs.length}\n`);

  // Verify locally with keccak mode
  const localValid = await backend.verifyProof(proofResult, { keccak: true });
  console.log(`  Local verification (keccak): ${localValid ? 'PASS' : 'FAIL'}`);
  if (!localValid) throw new Error('Local proof verification failed!');

  // --- Step 6: Register roots on-chain ---
  console.log('\n[6] Registering roots on-chain...');

  const userRootBytes32 = ethers.zeroPadValue(ethers.toBeHex(userRoot), 32);
  const cellMapRootBytes32 = ethers.zeroPadValue(ethers.toBeHex(cellMapState.root), 32);

  // Check if already registered
  const userRootValid = await userRootRegistry.isValidUserRoot(userRootBytes32);
  if (!userRootValid) {
    console.log('  Registering user root...');
    const tx1 = await userRootRegistry.registerUserRoot(userRootBytes32, COUNTRY_USA, TREE_DEPTH);
    await tx1.wait();
    console.log(`  User root registered: ${tx1.hash}`);
  } else {
    console.log('  User root already registered');
  }

  const cellMapRootValid = await cellMapRegistry.isValidCellMapRoot(cellMapRootBytes32);
  if (!cellMapRootValid) {
    console.log('  Registering cell map root...');
    const tx2 = await cellMapRegistry.registerCellMapRoot(cellMapRootBytes32, COUNTRY_USA, TREE_DEPTH);
    await tx2.wait();
    console.log(`  Cell map root registered: ${tx2.hash}`);
  } else {
    console.log('  Cell map root already registered');
  }
  console.log('');

  // --- Step 7: Construct EIP-712 signature ---
  console.log('[7] Constructing EIP-712 signature...');

  const SUBMIT_TWO_TREE_PROOF_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
      'SubmitTwoTreeProof(bytes32 proofHash,bytes32 publicInputsHash,uint8 verifierDepth,uint256 nonce,uint256 deadline)',
    ),
  );

  const nonce = await districtGate.nonces(wallet.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n; // 1 hour from now

  // Proof bytes for on-chain submission
  const proofBytes = ethers.hexlify(proofResult.proof);
  const proofHash = ethers.keccak256(proofBytes);

  // Convert public inputs to uint256[29]
  const publicInputsUint256: bigint[] = proofResult.publicInputs.map((pi: string) => BigInt(pi));

  // Pack public inputs as abi.encodePacked(uint256[29]) for hashing
  const packedInputs = ethers.solidityPacked(
    Array(29).fill('uint256'),
    publicInputsUint256,
  );
  const publicInputsHash = ethers.keccak256(packedInputs);

  const DOMAIN_SEPARATOR = await districtGate.DOMAIN_SEPARATOR();

  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint8', 'uint256', 'uint256'],
      [SUBMIT_TWO_TREE_PROOF_TYPEHASH, proofHash, publicInputsHash, TREE_DEPTH, nonce, deadline],
    ),
  );

  const digest = ethers.keccak256(
    ethers.solidityPacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', DOMAIN_SEPARATOR, structHash]),
  );

  const sig = wallet.signingKey.sign(digest);
  const signature = ethers.Signature.from(sig).serialized;
  console.log(`  Nonce: ${nonce}`);
  console.log(`  Deadline: ${deadline}`);
  console.log(`  Signature: ${signature.slice(0, 20)}...\n`);

  // --- Step 8: Diagnostic checks (isolate each validation) ---
  console.log('[8] Running diagnostic checks before submission...');

  // 8a: Check roots are still valid (reuse bytes32 from step 6)
  const urValid = await userRootRegistry.isValidUserRoot(userRootBytes32);
  const cmValid = await cellMapRegistry.isValidCellMapRoot(cellMapRootBytes32);
  console.log(`  User root valid: ${urValid}`);
  console.log(`  Cell map root valid: ${cmValid}`);

  // 8b: Check country/depth
  const [userCountry, userDepthOnChain] = await userRootRegistry.getCountryAndDepth(userRootBytes32);
  const [cmCountry] = await cellMapRegistry.getCountryAndDepth(cellMapRootBytes32);
  console.log(`  User root country: ${userCountry}, depth: ${userDepthOnChain}`);
  console.log(`  Cell map root country: ${cmCountry}`);
  console.log(`  Countries match: ${userCountry === cmCountry}`);
  console.log(`  Depth matches verifierDepth: ${Number(userDepthOnChain) === TREE_DEPTH}`);

  // 8c: Check verifier exists
  const vrAddr = await districtGate.verifierRegistry();
  const verifierRegistryContract = new ethers.Contract(vrAddr, VERIFIER_REGISTRY_ABI, provider);
  const verifierAddr = await verifierRegistryContract.getVerifier(TREE_DEPTH);
  console.log(`  Verifier for depth ${TREE_DEPTH}: ${verifierAddr}`);
  console.log(`  Verifier has code: ${(await provider.getCode(verifierAddr)).length > 2}`);

  // 8d: Call verifier DIRECTLY to isolate proof verification
  console.log('\n  Calling HonkVerifier.verify() directly...');
  const honkVerifier = new ethers.Contract(verifierAddr, HONK_VERIFIER_ABI, provider);
  const honkInputs: string[] = publicInputsUint256.map((pi: bigint) =>
    ethers.zeroPadValue(ethers.toBeHex(pi), 32)
  );
  try {
    const verifyResult = await honkVerifier.verify.staticCall(proofBytes, honkInputs);
    console.log(`  Direct verifier result: ${verifyResult}`);
  } catch (err: any) {
    console.log(`  Direct verifier FAILED: ${err.message?.slice(0, 200)}`);
    if (err.data) {
      console.log(`  Revert data: ${err.data}`);
      try {
        const iface = new ethers.Interface(HONK_VERIFIER_ABI);
        const decoded = iface.parseError(err.data);
        console.log(`  Decoded error: ${decoded?.name}(${decoded?.args})`);
      } catch { /* ignore */ }
    }
  }

  // 8e: staticCall the full verifyTwoTreeProof to get exact revert reason
  console.log('\n  staticCall verifyTwoTreeProof...');
  try {
    await districtGate.verifyTwoTreeProof.staticCall(
      wallet.address,
      proofBytes,
      publicInputsUint256,
      TREE_DEPTH,
      deadline,
      signature,
    );
    console.log('  staticCall PASSED — proceeding with real TX\n');
  } catch (err: any) {
    console.log(`  staticCall FAILED: ${err.message?.slice(0, 300)}`);
    if (err.data) {
      console.log(`  Revert data: ${err.data}`);
      try {
        const iface = new ethers.Interface(DISTRICT_GATE_ABI);
        const decoded = iface.parseError(err.data);
        console.log(`  Decoded error: ${decoded?.name}(${decoded?.args?.join(', ')})`);
      } catch { /* ignore */ }
    }
    throw new Error('staticCall failed — aborting before spending gas');
  }

  // --- Step 9: Submit proof on-chain ---
  console.log('[9] Submitting proof to DistrictGate.verifyTwoTreeProof()...');

  const tx = await districtGate.verifyTwoTreeProof(
    wallet.address,
    proofBytes,
    publicInputsUint256,
    TREE_DEPTH,
    deadline,
    signature,
    { gasLimit: 3_000_000 }, // HonkVerifier is extremely gas-heavy (~1M gas)
  );

  console.log(`  TX submitted: ${tx.hash}`);
  console.log('  Waiting for confirmation...');
  const receipt = await tx.wait();
  console.log(`  TX confirmed in block ${receipt!.blockNumber}`);
  console.log(`  Gas used: ${receipt!.gasUsed.toString()}`);
  console.log(`  Status: ${receipt!.status === 1 ? 'SUCCESS' : 'FAILED'}\n`);

  if (receipt!.status !== 1) {
    throw new Error('Transaction reverted!');
  }

  // --- Step 10: Verify nullifier was recorded ---
  console.log('[10] Verifying nullifier was recorded...');
  const actionDomainBytes32 = ethers.zeroPadValue(ethers.toBeHex(ACTION_DOMAIN), 32);
  const nullifierBytes32 = ethers.zeroPadValue(ethers.toBeHex(nullifier), 32);

  const isUsed = await nullifierRegistry.isNullifierUsed(actionDomainBytes32, nullifierBytes32);
  const participantCount = await nullifierRegistry.getParticipantCount(actionDomainBytes32);

  console.log(`  Nullifier used: ${isUsed}`);
  console.log(`  Participant count: ${participantCount}\n`);

  if (!isUsed) {
    throw new Error('Nullifier NOT recorded — something went wrong!');
  }

  // --- Done ---
  console.log('============================================================');
  console.log('  E2E ON-CHAIN PROOF VERIFIED SUCCESSFULLY');
  console.log('============================================================');
  console.log('');
  console.log('Summary:');
  console.log(`  Cell: ${cellId}`);
  console.log(`  Districts: ${districts.filter((d: bigint) => d !== 0n).length}/24`);
  console.log(`  Proof: ${proofResult.proof.length} bytes, generated in ${elapsed}s`);
  console.log(`  TX: ${tx.hash}`);
  console.log(`  Gas: ${receipt!.gasUsed.toString()}`);
  console.log(`  Nullifier recorded: YES`);
  console.log(`  Participant count: ${participantCount}`);
  console.log('');
  console.log('  Scroll Sepolia Explorer:');
  console.log(`  https://sepolia.scrollscan.com/tx/${tx.hash}`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
