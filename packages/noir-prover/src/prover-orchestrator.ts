/**
 * Prover Orchestrator
 *
 * Manages the split architecture for browser-based ZK proving:
 * - Main thread: NoirProver proof generation (UltraHonkBackend needs internal workers)
 * - Web Worker: Poseidon2 hashing for input preparation (can be TERMINATED to reclaim WASM memory)
 *
 * MEMORY MANAGEMENT:
 * WebAssembly linear memory can only grow, not shrink. The only way to reclaim
 * WASM memory is to terminate the Web Worker that owns it. This orchestrator
 * supports worker lifecycle management for memory-constrained environments.
 *
 * Usage:
 * ```typescript
 * const orchestrator = new ProverOrchestrator();
 * await orchestrator.init();
 *
 * // Generate inputs in worker (terminable for memory)
 * const inputs = await orchestrator.generateInputs({ leaf: '0x1111' });
 *
 * // Generate proof on main thread
 * const proof = await orchestrator.prove(inputs);
 *
 * // Terminate worker to reclaim WASM memory
 * orchestrator.terminateWorker();
 * ```
 */

import { getProver } from './prover';
import type { NoirProver } from './prover';
import type { CircuitInputs, ProofResult } from './types';
import type { WorkerEvent, GenerateInputsOptions } from './worker-protocol';

// Vite worker import syntax
// @ts-ignore - Vite handles this import at build time
import HashWorker from './hash.worker?worker';

export interface OrchestratorConfig {
    /** Auto-terminate worker after each proof to reclaim memory */
    autoTerminate?: boolean;
    /** Progress callback for proof generation */
    onProgress?: (stage: string, percent: number) => void;
}

export class ProverOrchestrator {
    private worker: Worker | null = null;
    private workerReady = false;
    private workerInitPromise: Promise<void> | null = null;

    private prover: NoirProver | null = null;
    private proverInitPromise: Promise<void> | null = null;

    private config: OrchestratorConfig;

    constructor(config: OrchestratorConfig = {}) {
        this.config = {
            autoTerminate: false,
            ...config,
        };
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize both main thread prover and hash worker
     */
    async init(): Promise<void> {
        await Promise.all([
            this.initProver(),
            this.initWorker(),
        ]);
    }

    /**
     * Initialize only the main thread prover (for proof generation)
     *
     * SINGLETON PATTERN: Uses getProver() to retrieve the shared prover instance.
     * The prover is initialized once at module level and reused across all orchestrators.
     * This prevents memory leaks from creating multiple UltraHonkBackend instances.
     */
    async initProver(): Promise<void> {
        if (this.proverInitPromise) {
            return this.proverInitPromise;
        }

        this.proverInitPromise = (async () => {
            console.log('[ProverOrchestrator] Initializing main thread prover (singleton)...');
            this.prover = await getProver();
            console.log('[ProverOrchestrator] Main thread prover ready (shared instance)');
        })();

        return this.proverInitPromise;
    }

    /**
     * Initialize only the hash worker (for input generation)
     */
    async initWorker(): Promise<void> {
        if (this.workerInitPromise) {
            return this.workerInitPromise;
        }

        this.workerInitPromise = new Promise((resolve, reject) => {
            console.log('[ProverOrchestrator] Spawning hash worker...');

            try {
                this.worker = new HashWorker();

                const handleInit = (event: MessageEvent) => {
                    const data = event.data as WorkerEvent;

                    if (data.type === 'STATUS' && data.status === 'ready') {
                        this.worker?.removeEventListener('message', handleInit);
                        this.workerReady = true;
                        console.log('[ProverOrchestrator] Hash worker ready');
                        resolve();
                    } else if (data.type === 'STATUS' && data.status === 'error') {
                        this.worker?.removeEventListener('message', handleInit);
                        reject(new Error('Hash worker initialization failed'));
                    } else if (data.type === 'ERROR') {
                        console.error('[ProverOrchestrator] Worker error during init:', data.message);
                    }
                };

                this.worker?.addEventListener('message', handleInit);

                if (this.worker) {
                    this.worker.onerror = (error) => {
                        console.error('[ProverOrchestrator] Worker error:', error);
                        reject(error);
                    };
                }

                // Send init command
                this.worker?.postMessage({ type: 'INIT_HASH_ONLY' });
            } catch (error) {
                reject(error);
            }
        });

        return this.workerInitPromise;
    }

    // ========================================================================
    // Hash Operations (run in worker - terminable for memory)
    // ========================================================================

    /**
     * Generate valid circuit inputs using Poseidon2 hashing (runs in worker)
     *
     * The new secure circuit computes internally:
     * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
     * - nullifier = hash(userSecret, actionDomain)
     *
     * This function computes:
     * - merkleRoot = compute_merkle_root(computed_leaf, path, index)
     */
    async generateInputs(options: GenerateInputsOptions = {}): Promise<CircuitInputs> {
        if (!this.workerReady) {
            await this.initWorker();
        }

        return new Promise((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                const data = event.data as WorkerEvent;

                if (data.type === 'INPUTS_RESULT') {
                    cleanup();
                    resolve(data.inputs);
                } else if (data.type === 'ERROR') {
                    cleanup();
                    reject(new Error(data.message));
                }
            };

            const cleanup = () => {
                this.worker?.removeEventListener('message', handleMessage);
            };

            this.worker!.addEventListener('message', handleMessage);
            this.worker!.postMessage({ type: 'GENERATE_INPUTS', options });
        });
    }

    /**
     * Compute Merkle root from leaf + path (runs in worker)
     */
    async computeMerkleRoot(leaf: string, merklePath: string[], leafIndex: number): Promise<string> {
        if (!this.workerReady) {
            await this.initWorker();
        }

        return new Promise((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                const data = event.data as WorkerEvent;

                if (data.type === 'MERKLE_ROOT_RESULT') {
                    cleanup();
                    resolve(data.merkleRoot);
                } else if (data.type === 'ERROR') {
                    cleanup();
                    reject(new Error(data.message));
                }
            };

            const cleanup = () => {
                this.worker?.removeEventListener('message', handleMessage);
            };

            this.worker!.addEventListener('message', handleMessage);
            this.worker!.postMessage({ type: 'COMPUTE_MERKLE_ROOT', leaf, merklePath, leafIndex });
        });
    }

    // ========================================================================
    // Proof Generation (runs on main thread)
    // ========================================================================

    /**
     * Generate a ZK proof (runs on main thread)
     *
     * UltraHonkBackend internally creates its own Web Workers for parallelism.
     * Running this inside another worker causes nested worker deadlocks.
     */
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        if (!this.prover) {
            await this.initProver();
        }

        console.log('[ProverOrchestrator] Starting proof generation...');
        const result = await this.prover!.prove(inputs);
        console.log('[ProverOrchestrator] Proof generated');

        // Auto-terminate worker if configured (for memory-constrained environments)
        if (this.config.autoTerminate) {
            this.terminateWorker();
        }

        return result;
    }

    /**
     * Full proof flow: generate inputs + prove
     */
    async proveWithInputGeneration(
        options: GenerateInputsOptions = {}
    ): Promise<{ inputs: CircuitInputs; proof: ProofResult }> {
        // Generate inputs in worker
        const inputs = await this.generateInputs(options);

        // Generate proof on main thread
        const proof = await this.prove(inputs);

        return { inputs, proof };
    }

    // ========================================================================
    // Memory Management
    // ========================================================================

    /**
     * Terminate the hash worker to reclaim its WASM memory
     *
     * This is the ONLY way to reclaim WebAssembly linear memory.
     * After termination, call initWorker() to create a fresh worker.
     */
    terminateWorker(): void {
        if (this.worker) {
            console.log('[ProverOrchestrator] Terminating hash worker...');
            this.worker.postMessage({ type: 'TERMINATE' });
            this.worker.terminate();
            this.worker = null;
            this.workerReady = false;
            this.workerInitPromise = null;
            console.log('[ProverOrchestrator] Hash worker terminated - WASM memory released');
        }
    }

    /**
     * Destroy the main thread prover
     *
     * NO-OP: The prover is now a singleton managed at module level.
     * It should NOT be destroyed between runs to prevent memory leaks
     * from recreating UltraHonkBackend instances.
     *
     * This method is kept for backward compatibility but does nothing.
     * The singleton prover will be automatically cleaned up when the
     * page/module is unloaded.
     *
     * @deprecated Use singleton prover pattern - no manual cleanup needed
     */
    async destroyProver(): Promise<void> {
        if (this.prover) {
            console.warn('[ProverOrchestrator] destroyProver() called but prover is now a singleton - skipping destruction');
            // Clear local reference but don't destroy the shared instance
            this.prover = null;
            this.proverInitPromise = null;
        }
    }

    /**
     * Full cleanup: terminate worker only
     *
     * SINGLETON PATTERN: Only terminates the worker to reclaim its WASM memory.
     * The prover is a singleton and should not be destroyed between runs.
     */
    async destroy(): Promise<void> {
        this.terminateWorker();
        // Clear local prover reference without destroying the shared instance
        this.prover = null;
        this.proverInitPromise = null;
    }

    // ========================================================================
    // State Queries
    // ========================================================================

    isWorkerReady(): boolean {
        return this.workerReady;
    }

    isProverReady(): boolean {
        return this.prover !== null;
    }

    /**
     * Check if the orchestrator is fully initialized (both prover and worker ready)
     */
    isInitialized(): boolean {
        return this.prover !== null;
    }

    getThreadCount(): number {
        return (this.prover as any)?.threads ?? 1;
    }
}

/**
 * Create a prover orchestrator configured for memory-constrained environments
 *
 * Auto-terminates worker after each proof to prevent WASM memory accumulation.
 */
export function createMemorySafeOrchestrator(): ProverOrchestrator {
    return new ProverOrchestrator({ autoTerminate: true });
}
