/**
 * Memory and Performance Profiler for NoirProver
 *
 * Run this on real mobile devices to get actual memory/timing data.
 *
 * ARCHITECTURE (matches communique pattern):
 * - Hash worker: Generates valid circuit inputs using Poseidon2 (TERMINABLE for memory)
 * - Main thread: Runs NoirProver for proof generation (UltraHonkBackend internal workers)
 *
 * MEMORY MANAGEMENT:
 * The hash worker can be TERMINATED between runs to reclaim its WASM memory.
 * Main thread WASM memory cannot be reclaimed without a page refresh.
 *
 * USAGE:
 * 1. Build and serve this in a web page
 * 2. Open on real iPhone (Safari) or Android (Chrome)
 * 3. Open browser DevTools (Safari Web Inspector / Chrome Remote Debug)
 * 4. Call window.runProverProfile() from console
 * 5. Watch memory timeline + console output
 *
 * Expected times for ~4K constraint circuit:
 * - Desktop (8 threads): 5-15 seconds
 * - Mobile (1-4 threads): 20-60 seconds
 */

import { ProverOrchestrator } from './prover-orchestrator';
import type { CircuitInputs } from './types';

/**
 * Module-level orchestrator singleton.
 * Reused across profiler runs to avoid recreating ~500MB UltraHonkBackend.
 */
let sharedOrchestrator: ProverOrchestrator | null = null;

/**
 * Quiet mode - suppresses console output to test if logging causes memory growth.
 * Enable with: window.setQuietMode(true)
 */
let quietMode = false;

export function setQuietMode(quiet: boolean): void {
    quietMode = quiet;
    console.log(`[Profiler] Quiet mode: ${quiet}`);
}

function log(...args: any[]) {
    if (!quietMode) console.log(...args);
}

function warn(...args: any[]) {
    if (!quietMode) console.warn(...args);
}

function error(...args: any[]) {
    console.error(...args); // Always log errors
}

export interface ProfileResult {
    device: string;
    userAgent: string;
    timestamp: string;

    // Memory (if available)
    memoryBefore?: number;
    memoryAfterInit?: number;
    memoryAfterInputs?: number;
    memoryAfterProof?: number;
    memoryAfterCleanup?: number;
    memoryPeak?: number;

    // Timing
    initTimeMs: number;
    inputGenTimeMs: number;
    proofTimeMs: number;
    cleanupTimeMs: number;
    totalTimeMs: number;

    // Environment
    threads: number;
    sharedArrayBuffer: boolean;
    crossOriginIsolated: boolean;
    workerSupported: boolean;

    // Proof details
    proofSizeBytes?: number;

    // Errors
    error?: string;

    // Reuse tracking
    orchestratorReused: boolean;
}

/**
 * Get memory usage if Performance.memory API available (Chrome only)
 */
function getMemoryMB(): number | undefined {
    const perf = performance as any;
    if (perf.memory) {
        return Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
    }
    return undefined;
}

/**
 * Detect device info
 */
function getDeviceInfo(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) {
        const match = ua.match(/Android [0-9.]+; ([^)]+)\)/);
        return match ? match[1] : 'Android';
    }
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'Unknown';
}

/**
 * Run full profiling suite using ProverOrchestrator
 *
 * This matches the communique architecture:
 * - Input generation in terminable worker
 * - Proof generation on main thread
 *
 * SINGLETON MODE: Reuses orchestrator across runs to avoid recreating UltraHonkBackend.
 * Worker is still terminated between runs for memory isolation.
 */
export async function runProfile(): Promise<ProfileResult> {
    const result: ProfileResult = {
        device: getDeviceInfo(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        threads: 0,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
        workerSupported: typeof Worker !== 'undefined',
        initTimeMs: 0,
        inputGenTimeMs: 0,
        proofTimeMs: 0,
        cleanupTimeMs: 0,
        totalTimeMs: 0,
        orchestratorReused: false,
    };

    log('=== NOIR PROVER PROFILER (Orchestrator Mode - Singleton) ===');
    log(`Device: ${result.device}`);
    log(`SharedArrayBuffer: ${result.sharedArrayBuffer}`);
    log(`crossOriginIsolated: ${result.crossOriginIsolated}`);
    log(`Worker supported: ${result.workerSupported}`);

    result.memoryBefore = getMemoryMB();
    log(`Memory before: ${result.memoryBefore ?? 'N/A'} MB`);

    const totalStart = performance.now();

    try {
        // Phase 1: Initialize or Reuse Orchestrator
        const initStart = performance.now();

        if (sharedOrchestrator && sharedOrchestrator.isInitialized()) {
            log('\n[1/5] Reusing existing orchestrator (prover already loaded)...');
            result.orchestratorReused = true;
            result.initTimeMs = Math.round(performance.now() - initStart);
            log(`Orchestrator reused: ${result.initTimeMs}ms`);
        } else {
            log('\n[1/5] Initializing orchestrator (worker + prover) - FIRST RUN...');
            result.orchestratorReused = false;

            sharedOrchestrator = new ProverOrchestrator();
            await sharedOrchestrator.init();

            result.initTimeMs = Math.round(performance.now() - initStart);
            log(`Init complete (first run): ${result.initTimeMs}ms`);
        }

        result.memoryAfterInit = getMemoryMB();
        result.threads = sharedOrchestrator.getThreadCount();

        log(`Memory after init: ${result.memoryAfterInit ?? 'N/A'} MB`);
        log(`Threads: ${result.threads}`);

        // Phase 2: Generate valid inputs in worker
        log('\n[2/5] Generating valid inputs in hash worker...');
        const inputsStart = performance.now();

        const inputs: CircuitInputs = await sharedOrchestrator.generateInputs({
            leaf: '0x0000000000000000000000000000000000000000000000000000000000001111',
            userSecret: '0x0000000000000000000000000000000000000000000000000000000000001234',
            campaignId: '0x0000000000000000000000000000000000000000000000000000000000000001',
            authorityHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
            epochId: '0x0000000000000000000000000000000000000000000000000000000000000001',
            leafIndex: 0,
        });

        result.inputGenTimeMs = Math.round(performance.now() - inputsStart);
        result.memoryAfterInputs = getMemoryMB();

        log(`Input generation: ${result.inputGenTimeMs}ms`);
        log(`Memory after inputs: ${result.memoryAfterInputs ?? 'N/A'} MB`);
        log('Valid inputs:', {
            merkleRoot: inputs.merkleRoot.slice(0, 18) + '...',
            nullifier: inputs.nullifier.slice(0, 18) + '...',
            leafIndex: inputs.leafIndex,
        });

        // Phase 3: Terminate worker to reclaim WASM memory before proof
        log('\n[3/5] Terminating hash worker to reclaim WASM memory...');
        sharedOrchestrator.terminateWorker();

        // Give GC a chance
        await new Promise(resolve => setTimeout(resolve, 100));
        if ((globalThis as any).gc) {
            (globalThis as any).gc();
            log('Forced GC');
        }

        const memoryAfterTerminate = getMemoryMB();
        log(`Memory after worker terminate: ${memoryAfterTerminate ?? 'N/A'} MB`);

        // Phase 4: Generate proof on main thread (prover is reused)
        log('\n[4/5] Generating proof on main thread (20-60s on mobile)...');
        const proofStart = performance.now();

        try {
            const proofResult = await sharedOrchestrator.prove(inputs);
            result.proofTimeMs = Math.round(performance.now() - proofStart);

            const proofSize = proofResult.proof instanceof Uint8Array
                ? proofResult.proof.length
                : 0;
            result.proofSizeBytes = proofSize;

            log(`✅ PROOF GENERATED: ${result.proofTimeMs}ms`);
            log(`Proof size: ${proofSize} bytes`);
            log('Public inputs:', proofResult.publicInputs);

        } catch (e) {
            result.proofTimeMs = Math.round(performance.now() - proofStart);
            const msg = e instanceof Error ? e.message : String(e);

            if (msg.includes('assert') || msg.includes('constraint')) {
                error(`❌ Circuit assertion failed: ${msg}`);
                result.error = `Circuit assertion: ${msg}`;
            } else if (msg.includes('memory') || msg.includes('OOM') || msg.includes('allocation')) {
                error(`❌ OUT OF MEMORY: ${msg}`);
                result.error = `OOM: ${msg}`;
            } else {
                error(`❌ Proof failed: ${msg}`);
                result.error = msg;
            }
        }

        result.memoryAfterProof = getMemoryMB();
        log(`Memory after proof: ${result.memoryAfterProof ?? 'N/A'} MB`);

        // Phase 5: Cleanup (keep orchestrator alive, only clean up worker if needed)
        log('\n[5/5] Cleanup (keeping orchestrator alive for reuse)...');
        const cleanupStart = performance.now();

        // Force GC if available
        if ((globalThis as any).gc) {
            (globalThis as any).gc();
            log('Forced GC');
        }

        result.cleanupTimeMs = Math.round(performance.now() - cleanupStart);
        result.memoryAfterCleanup = getMemoryMB();
        log(`Cleanup: ${result.cleanupTimeMs}ms`);
        log(`Memory after cleanup: ${result.memoryAfterCleanup ?? 'N/A'} MB`);
        log('Orchestrator kept alive for next run');

    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`FATAL ERROR: ${msg}`);
        result.error = msg;

        if (msg.includes('memory') || msg.includes('OOM') || msg.includes('allocation')) {
            error('🚨 LIKELY OUT OF MEMORY');
        }

        // On fatal error, destroy the orchestrator so next run starts fresh
        if (sharedOrchestrator) {
            try {
                await sharedOrchestrator.destroy();
                sharedOrchestrator = null;
                log('Orchestrator destroyed due to fatal error');
            } catch {}
        }
    }

    result.totalTimeMs = Math.round(performance.now() - totalStart);
    result.memoryPeak = Math.max(
        result.memoryBefore ?? 0,
        result.memoryAfterInit ?? 0,
        result.memoryAfterInputs ?? 0,
        result.memoryAfterProof ?? 0,
    ) || undefined;

    log('\n=== PROFILE RESULTS ===');
    log(JSON.stringify(result, null, 2));

    return result;
}

/**
 * Reset the profiler by destroying the shared orchestrator.
 * Use this for testing or to force a fresh start.
 */
export async function resetProfiler(): Promise<void> {
    if (sharedOrchestrator) {
        log('Resetting profiler: destroying shared orchestrator...');
        try {
            await sharedOrchestrator.destroy();
            sharedOrchestrator = null;
            log('Profiler reset complete');
        } catch (e) {
            error('Error during profiler reset:', e);
            sharedOrchestrator = null;
        }
    } else {
        log('Profiler already reset (no active orchestrator)');
    }
}

/**
 * Run multiple profiler iterations with shared orchestrator
 *
 * This demonstrates proper memory management:
 * - Worker termination reclaims input generation WASM memory between runs
 * - Orchestrator (including UltraHonkBackend) is reused across all runs
 * - First run initializes, subsequent runs reuse
 */
export async function runProfileMultiple(iterations: number = 3): Promise<ProfileResult[]> {
    const results: ProfileResult[] = [];

    log(`\n=== RUNNING ${iterations} PROFILER ITERATIONS (Singleton Mode) ===`);
    log('Worker will be terminated between runs for memory isolation');
    log('Orchestrator will be REUSED across all runs\n');

    for (let i = 0; i < iterations; i++) {
        log(`\n========== ITERATION ${i + 1}/${iterations} ==========\n`);
        const result = await runProfile();
        results.push(result);

        // Brief pause between iterations
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    log('\n=== SUMMARY ===');
    results.forEach((r, i) => {
        const reused = r.orchestratorReused ? 'REUSED' : 'FIRST';
        log(`[${i + 1}] ${reused} | Proof: ${r.proofTimeMs}ms, Peak memory: ${r.memoryPeak ?? 'N/A'}MB, Error: ${r.error ?? 'none'}`);
    });

    return results;
}

// Expose to window for console access
if (typeof window !== 'undefined') {
    (window as any).runProverProfile = runProfile;
    (window as any).runProfileMultiple = runProfileMultiple;
    (window as any).resetProfiler = resetProfiler;
    (window as any).setQuietMode = setQuietMode;
    (window as any).getMemoryMB = getMemoryMB;
    console.log('Profiler loaded (Orchestrator Mode - Singleton).');
    console.log('  - window.runProverProfile() - Single run');
    console.log('  - window.runProfileMultiple(n) - Multiple runs');
    console.log('  - window.resetProfiler() - Force reset');
    console.log('  - window.setQuietMode(true) - Suppress logs to test memory');
}
