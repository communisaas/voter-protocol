/// <reference lib="webworker" />

/**
 * Hash Worker for Poseidon2 Operations
 *
 * This worker handles Poseidon2 hashing operations using the Noir fixtures circuit.
 * Running hashing in a worker allows us to TERMINATE the worker to reclaim WASM memory.
 *
 * ARCHITECTURE (matches communique pattern):
 * - Main thread: NoirProver proof generation (UltraHonkBackend creates internal workers)
 * - This worker: Poseidon2 hashing via Noir fixtures circuit (can be terminated)
 *
 * CRITICAL: Buffer polyfill MUST be loaded before @noir-lang/noir_js imports.
 * We use a local BufferShim because Vite's polyfill has issues in workers.
 */

// ============================================================================
// STEP 1: Buffer polyfill MUST run before any code that imports bb.js/noir
// ============================================================================
import { Buffer } from '../shims/buffer-shim';
(globalThis as any).Buffer = Buffer;

// ============================================================================
// STEP 2: Types (inline to avoid import hoisting issues)
// ============================================================================

type WorkerCommand =
    | { type: 'INIT_HASH_ONLY' }
    | { type: 'COMPUTE_MERKLE_ROOT'; leaf: string; merklePath: string[]; leafIndex: number }
    | { type: 'POSEIDON_HASH'; inputs: string[] }
    | { type: 'GENERATE_INPUTS'; options?: GenerateInputsOptions }
    | { type: 'TERMINATE' };

interface GenerateInputsOptions {
    leaf?: string;
    userSecret?: string;
    campaignId?: string;
    authorityHash?: string;
    epochId?: string;
    leafIndex?: number;
    merklePath?: string[];
}

type WorkerEvent =
    | { type: 'STATUS'; status: string }
    | { type: 'ERROR'; message: string; stack?: string }
    | { type: 'MERKLE_ROOT_RESULT'; merkleRoot: string }
    | { type: 'POSEIDON_HASH_RESULT'; hash: string }
    | { type: 'INPUTS_RESULT'; inputs: any };

function isWorkerCommand(data: unknown): data is WorkerCommand {
    if (typeof data !== 'object' || data === null) return false;
    const cmd = data as { type?: string };
    return (
        cmd.type === 'INIT_HASH_ONLY' ||
        cmd.type === 'COMPUTE_MERKLE_ROOT' ||
        cmd.type === 'POSEIDON_HASH' ||
        cmd.type === 'GENERATE_INPUTS' ||
        cmd.type === 'TERMINATE'
    );
}

// ============================================================================
// STEP 3: Worker context and lazy-loaded modules
// ============================================================================

const ctx: Worker = self as any;

// Lazy-loaded fixture generator module
let fixturesModule: typeof import('./fixtures') | null = null;

async function loadFixtures() {
    if (!fixturesModule) {
        console.log('[HashWorker] Loading fixtures module...');
        fixturesModule = await import('./fixtures');
    }
    return fixturesModule;
}

// ============================================================================
// STEP 4: Message Handler
// ============================================================================

ctx.onmessage = async (event: MessageEvent) => {
    const data = event.data;

    if (!isWorkerCommand(data)) {
        console.warn('[HashWorker] Invalid command:', data);
        return;
    }

    try {
        switch (data.type) {
            case 'INIT_HASH_ONLY':
                await handleInitHashOnly();
                break;
            case 'COMPUTE_MERKLE_ROOT':
                await handleComputeMerkleRoot(data.leaf, data.merklePath, data.leafIndex);
                break;
            case 'POSEIDON_HASH':
                await handlePoseidonHash(data.inputs);
                break;
            case 'GENERATE_INPUTS':
                await handleGenerateInputs(data.options);
                break;
            case 'TERMINATE':
                handleTerminate();
                break;
        }
    } catch (error) {
        sendEvent({
            type: 'ERROR',
            message: error instanceof Error ? error.message : 'Unknown worker error',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
};

// ============================================================================
// STEP 5: Command Handlers
// ============================================================================

async function handleInitHashOnly() {
    sendEvent({ type: 'STATUS', status: 'initializing' });
    console.log('[HashWorker] Initializing Poseidon2 hashing...');

    try {
        // Pre-load the fixtures module which initializes Noir
        const fixtures = await loadFixtures();

        // Warmup: generate a test input to ensure WASM is fully loaded
        console.log('[HashWorker] Warming up...');
        await fixtures.generateValidInputs({
            leaf: '0x01',
            userSecret: '0x01',
            campaignId: '0x01',
            authorityHash: '0x01',
            epochId: '0x01',
            leafIndex: 0,
        });

        console.log('[HashWorker] Ready!');
        sendEvent({ type: 'STATUS', status: 'ready' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Initialization failed';
        console.error('[HashWorker] Init failed:', error);
        sendEvent({ type: 'ERROR', message });
        sendEvent({ type: 'STATUS', status: 'error' });
    }
}

async function handleComputeMerkleRoot(leaf: string, merklePath: string[], leafIndex: number) {
    try {
        const fixtures = await loadFixtures();
        console.log('[HashWorker] Computing merkle root...');

        // Use generateValidInputs with the provided merkle data
        const inputs = await fixtures.generateValidInputs({
            leaf,
            merklePath,
            leafIndex,
            userSecret: '0x01',
            campaignId: '0x01',
            authorityHash: '0x01',
            epochId: '0x01',
        });

        console.log('[HashWorker] Merkle root computed:', inputs.merkleRoot.slice(0, 18) + '...');
        sendEvent({ type: 'MERKLE_ROOT_RESULT', merkleRoot: inputs.merkleRoot });
    } catch (error) {
        console.error('[HashWorker] Merkle root failed:', error);
        sendEvent({
            type: 'ERROR',
            message: error instanceof Error ? error.message : 'Merkle root computation failed'
        });
    }
}

async function handlePoseidonHash(inputs: string[]) {
    try {
        const fixtures = await loadFixtures();
        console.log('[HashWorker] Computing Poseidon hash...');

        // Use a leaf input to compute a hash
        // The fixtures circuit computes poseidon2_permutation
        const result = await fixtures.generateValidInputs({
            leaf: inputs[0] || '0x01',
            userSecret: inputs[1] || '0x01',
            campaignId: '0x01',
            authorityHash: '0x01',
            epochId: '0x01',
            leafIndex: 0,
        });

        // The nullifier is effectively a hash of the inputs
        console.log('[HashWorker] Hash computed:', result.nullifier.slice(0, 18) + '...');
        sendEvent({ type: 'POSEIDON_HASH_RESULT', hash: result.nullifier });
    } catch (error) {
        console.error('[HashWorker] Poseidon hash failed:', error);
        sendEvent({
            type: 'ERROR',
            message: error instanceof Error ? error.message : 'Poseidon hash failed'
        });
    }
}

async function handleGenerateInputs(options?: GenerateInputsOptions) {
    try {
        const fixtures = await loadFixtures();
        console.log('[HashWorker] Generating valid circuit inputs...');

        const inputs = await fixtures.generateValidInputs(options || {});

        console.log('[HashWorker] Inputs generated:', {
            merkleRoot: inputs.merkleRoot.slice(0, 18) + '...',
            nullifier: inputs.nullifier.slice(0, 18) + '...',
        });
        sendEvent({ type: 'INPUTS_RESULT', inputs });
    } catch (error) {
        console.error('[HashWorker] Input generation failed:', error);
        sendEvent({
            type: 'ERROR',
            message: error instanceof Error ? error.message : 'Input generation failed'
        });
    }
}

function handleTerminate() {
    console.log('[HashWorker] Terminating...');
    sendEvent({ type: 'STATUS', status: 'terminated' });
    // Reset module references to allow GC
    fixturesModule = null;
    // Worker will be terminated by the orchestrator calling worker.terminate()
}

// ============================================================================
// STEP 6: Helper
// ============================================================================

function sendEvent(event: WorkerEvent) {
    ctx.postMessage(event);
}

// Log startup
console.log('[HashWorker] Worker script loaded');
