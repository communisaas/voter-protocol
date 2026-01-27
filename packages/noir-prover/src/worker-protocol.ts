/**
 * Worker Protocol Definitions
 *
 * Type-safe message protocol for communication between
 * main thread (ProverOrchestrator) and Web Worker.
 *
 * Architecture matches communique pattern:
 * - Proof generation: main thread (UltraHonkBackend needs to create internal workers)
 * - Poseidon hashing: web worker (BarretenbergSync, threads:1, no nesting)
 */

import type { CircuitInputs, ProofResult } from './types';

// ============================================================================
// Commands: Main Thread → Worker
// ============================================================================

/**
 * Commands sent from main thread to worker
 *
 * INIT_HASH_ONLY: Initialize only Poseidon hashing (BarretenbergSync)
 *                 This is the primary mode - proof gen runs on main thread.
 *
 * COMPUTE_MERKLE_ROOT: Compute Merkle root from leaf + path
 * POSEIDON_HASH: Hash arbitrary inputs with Poseidon2
 * GENERATE_INPUTS: Generate valid circuit inputs (merkle root + nullifier)
 * TERMINATE: Graceful shutdown signal
 */
export type WorkerCommand =
    | { type: 'INIT_HASH_ONLY' }
    | { type: 'COMPUTE_MERKLE_ROOT'; leaf: string; merklePath: string[]; leafIndex: number }
    | { type: 'POSEIDON_HASH'; inputs: string[] }
    | { type: 'GENERATE_INPUTS'; options?: GenerateInputsOptions }
    | { type: 'TERMINATE' };

/**
 * Options for generating valid circuit inputs
 *
 * The new secure circuit computes leaf and nullifier internally:
 * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
 * - nullifier = hash(userSecret, actionDomain)
 */
export interface GenerateInputsOptions {
    // Private inputs (user secrets)
    /** User's secret for nullifier derivation and leaf computation */
    userSecret?: string;
    /** District identifier */
    districtId?: string;
    /** Authority level (1-5) */
    authorityLevel?: 1 | 2 | 3 | 4 | 5;
    /** Registration salt for leaf computation */
    registrationSalt?: string;

    // Public inputs
    /** Action domain (replaces epochId + campaignId) */
    actionDomain?: string;

    // Merkle proof data
    /** Leaf position in tree */
    leafIndex?: number;
    /** Custom merkle path siblings */
    merklePath?: string[];
}

// ============================================================================
// Events: Worker → Main Thread
// ============================================================================

/**
 * Events sent from worker to main thread
 */
export type WorkerEvent =
    | { type: 'STATUS'; status: WorkerStatus }
    | { type: 'ERROR'; message: string; stack?: string }
    | { type: 'MERKLE_ROOT_RESULT'; merkleRoot: string }
    | { type: 'POSEIDON_HASH_RESULT'; hash: string }
    | { type: 'INPUTS_RESULT'; inputs: CircuitInputs };

export type WorkerStatus =
    | 'idle'
    | 'initializing'
    | 'ready'
    | 'computing'
    | 'error'
    | 'terminated';

// ============================================================================
// Type Guards
// ============================================================================

export function isWorkerCommand(data: unknown): data is WorkerCommand {
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

export function isWorkerEvent(data: unknown): data is WorkerEvent {
    if (typeof data !== 'object' || data === null) return false;
    const evt = data as { type?: string };
    return (
        evt.type === 'STATUS' ||
        evt.type === 'ERROR' ||
        evt.type === 'MERKLE_ROOT_RESULT' ||
        evt.type === 'POSEIDON_HASH_RESULT' ||
        evt.type === 'INPUTS_RESULT'
    );
}
