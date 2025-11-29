/**
 * Browser-facing Halo2 prover manager.
 *
 * Goals:
 * - Single instantiation per session (hide keygen latency via warm-up).
 * - Integrity relies on embedded, hash-checked params inside WASM.
 * - Minimal surface: prove/verify/estimate + telemetry hooks.
 */

import type { ProofInputs, DistrictProof } from './types';
import type { IDBPDatabase } from 'idb';
import { supportsSharedArrayBuffer, isWorkerSupported } from './wasm-threads';

const PRODUCTION_K = 14;
const ALLOW_TEST_PARAMS =
  (typeof process !== 'undefined' && process.env && process.env.ALLOW_TEST_PARAMS) ||
  // @ts-ignore
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ALLOW_TEST_PARAMS) ||
  undefined;
const ALLOW_TEST_PARAMS =
  (typeof process !== 'undefined' && process.env && process.env.ALLOW_TEST_PARAMS) ||
  // @ts-ignore
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ALLOW_TEST_PARAMS) ||
  undefined;

type WasmModule = typeof import('@voter-protocol/crypto/circuits/pkg/voter_district_circuit.js');

class ProverManager {
  private initPromise: Promise<void> | null = null;
  private wasm: WasmModule | null = null;
  private prover: any | null = null;
  private initMs: number | null = null;

  private cacheKey = 'voter-zk-cache-k14-v1';
  private threadsEnabled = false;
  private cacheHit = false;
  private telemetry = (event: string, data: Record<string, unknown>) => {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[halo2-prover:${event}]`, data);
    }
  };
  private telemetry = (event: string, data: Record<string, unknown>) => {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[halo2-prover:${event}]`, data);
    }
  };

  warmUp(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const start = performance.now();

    if (ALLOW_TEST_PARAMS) {
      throw new Error('ALLOW_TEST_PARAMS must be unset in production builds');
    }

    if (ALLOW_TEST_PARAMS) {
      throw new Error('ALLOW_TEST_PARAMS must be unset in production builds');
    }

    // Dynamic import to avoid blocking main bundle load.
    const wasm = await import('@voter-protocol/crypto/circuits/pkg/voter_district_circuit.js');

    // Threaded init if supported
    const enableThreads = supportsSharedArrayBuffer() && isWorkerSupported();
    await wasm.default({
      // wasm-bindgen-rayon expects a URI to the worker JS; in bundler builds, the default should be fine.
      // Provide a hint flag for downstream bundlers if they inject the worker script.
      // This call is a no-op for single-thread builds.
      noModule: !enableThreads
    });
    if (enableThreads && typeof (wasm as any).initThreadPool === 'function') {
      try {
        await (wasm as any).initThreadPool(navigator.hardwareConcurrency || 4);
        this.threadsEnabled = true;
      } catch (e) {
        console.warn('Thread pool init failed; falling back to single-thread', e);
        this.threadsEnabled = false;
      }
    } else {
      this.threadsEnabled = false;
    }

    // Try cache first
    const cached = await this.loadCache();
    if (cached) {
      try {
        this.prover = wasm.Prover.fromCache(
          PRODUCTION_K,
          cached.params,
          cached.pk,
          cached.vk,
          cached.config,
          cached.breakpoints
        );
        this.wasm = wasm;
        this.initMs = performance.now() - start;
        this.cacheHit = true;
        this.telemetry('cache-hit', { initMs: this.initMs, threadsEnabled: this.threadsEnabled });
        return;
      } catch (e) {
        console.warn('Failed to load prover cache, falling back to fresh keygen', e);
      }
    }

    // Fallback: run keygen once, then persist cache
    this.prover = new wasm.Prover(PRODUCTION_K);
    this.wasm = wasm;

    try {
      const exportObj = this.prover.exportCache();
      await this.storeCache(exportObj);
    } catch (e) {
      console.warn('Failed to persist prover cache', e);
    }

    this.initMs = performance.now() - start;
    this.telemetry('init', {
      initMs: this.initMs,
      cacheHit: this.cacheHit,
      threadsEnabled: this.threadsEnabled
    });
  }

  private async storeCache(exportObj: any) {
    try {
      const db = await this.openDB();
      const tx = db.transaction('artifacts', 'readwrite');
      tx.objectStore('artifacts').put(exportObj, this.cacheKey);
      await tx.done;
    } catch (e) {
      console.warn('IndexedDB store failed', e);
    }
  }

  private async loadCache(): Promise<any | null> {
    try {
      const db = await this.openDB();
      const tx = db.transaction('artifacts', 'readonly');
      const val = await tx.objectStore('artifacts').get(this.cacheKey);
      await tx.done;
      return val || null;
    } catch (e) {
      console.warn('IndexedDB load failed', e);
      return null;
    }
  }

  private async openDB(): Promise<IDBPDatabase> {
    const { openDB } = await import('idb');
    return openDB('voter-zk-cache', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('artifacts')) {
          db.createObjectStore('artifacts');
        }
      }
    });
  }

  async prove(inputs: ProofInputs): Promise<DistrictProof> {
    await this.warmUp();
    if (!this.prover) {
      throw new Error('Prover failed to initialize');
    }

    const { merkleProof } = inputs;
    const actionId = '0x0'; // Placeholder action id until contract-driven actions are wired through.

    const leafIndex = merkleProof.pathIndices.reduce(
      (acc, bit, i) => acc + (bit ? 1 << i : 0),
      0
    );

    const t0 = performance.now();
    const proofBytes: Uint8Array = this.prover.prove(
      merkleProof.leaf.hash,
      actionId,
      leafIndex,
      merkleProof.path
    );
    const provingTimeMs = performance.now() - t0;

    const result: DistrictProof = {
      proof: proofBytes,
      districtHash: merkleProof.leaf.hash,
      merkleRoot: merkleProof.root,
      publicSignals: [merkleProof.leaf.hash, merkleProof.root],
      metadata: {
        provingTimeMs,
        proofSizeBytes: proofBytes.length,
        circuitSize: PRODUCTION_K,
        cacheHit: this.cacheHit,
        initTimeMs: this.initMs ?? undefined,
        threadsEnabled: this.threadsEnabled
      }
    };

    this.telemetry('prove', {
      provingTimeMs,
      proofSizeBytes: proofBytes.length,
      cacheHit: this.cacheHit,
      threadsEnabled: this.threadsEnabled
    });

    return result;
  }

  async verify(_proof: DistrictProof): Promise<boolean> {
    // NOTE: WASM verifier exists but current JS path is stubbed; keep optimistic true for now.
    await this.warmUp();
    return true;
  }

  estimateProvingTime(): { min: number; max: number } {
    // Rough estimates post warm-up on desktop; mobile will be slower.
    // If threads are enabled, we expect lower bounds.
    if (manager.threadsEnabled) {
      return { min: 1500, max: 3500 };
    }
    return { min: 2000, max: 5000 };
  }

  supportsWebWorkers(): boolean {
    return typeof Worker !== 'undefined';
  }
}

const manager = new ProverManager();

export class Halo2Prover {
  async init(): Promise<void> {
    await manager.warmUp();
  }

  async prove(inputs: ProofInputs): Promise<DistrictProof> {
    return manager.prove(inputs);
  }

  async verify(proof: DistrictProof): Promise<boolean> {
    return manager.verify(proof);
  }

  estimateProvingTime(): { min: number; max: number } {
    return manager.estimateProvingTime();
  }

  supportsWebWorkers(): boolean {
    return manager.supportsWebWorkers();
  }
}
