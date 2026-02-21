/**
 * Chain Event Scanner
 *
 * Polls DistrictGate for TwoTreeProofVerified and ThreeTreeProofVerified events
 * via raw JSON-RPC eth_getLogs, maps them to NullifierEvent[], and feeds them
 * into the EngagementTreeBuilder pipeline.
 *
 * Design:
 * - Uses raw fetch with eth_getLogs (no viem/ethers dependency)
 * - Uses @noble/hashes for keccak256 topic computation
 * - Persists cursor (last processed block) as a JSON file
 * - Handles backfill from a configurable start block
 * - Deduplicates events by txHash+logIndex
 * - Clean start/stop lifecycle matching existing serving services
 *
 * SPEC REFERENCE: specs/REPUTATION-ARCHITECTURE-SPEC.md Section 4
 */

import { promises as fs } from 'fs';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import { logger } from '../core/utils/logger.js';
import type { NullifierEvent } from '../engagement-tree-builder.js';

// ============================================================================
// ABI Event Topic Hashes
// ============================================================================

function eventTopic(sig: string): string {
  return '0x' + bytesToHex(keccak_256(new TextEncoder().encode(sig)));
}

/** keccak256("TwoTreeProofVerified(address,address,bytes32,bytes32,bytes32,bytes32,bytes32,uint8)") */
const TWO_TREE_TOPIC = eventTopic(
  'TwoTreeProofVerified(address,address,bytes32,bytes32,bytes32,bytes32,bytes32,uint8)',
);

/** keccak256("ThreeTreeProofVerified(address,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8)") */
const THREE_TREE_TOPIC = eventTopic(
  'ThreeTreeProofVerified(address,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8)',
);

// ============================================================================
// Types
// ============================================================================

export interface ChainScannerConfig {
  /** JSON-RPC endpoint URL (e.g., https://sepolia-rpc.scroll.io) */
  readonly rpcUrl: string;
  /** DistrictGate contract address */
  readonly districtGateAddress: string;
  /** Path to cursor file for persisting last processed block */
  readonly cursorPath: string;
  /** Block number to start scanning from (used for initial backfill) */
  readonly startBlock?: number;
  /** Polling interval in milliseconds (default: 30000 for L2) */
  readonly pollIntervalMs?: number;
  /** Maximum blocks per eth_getLogs request (default: 2000) */
  readonly maxBlockRange?: number;
}

export interface CursorState {
  readonly lastProcessedBlock: number;
  readonly lastProcessedTimestamp: number;
  readonly totalEventsProcessed: number;
}

interface RpcLogEntry {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
  readonly logIndex: string;
  readonly removed: boolean;
}

/** Callback invoked with new events each poll cycle */
export type EventCallback = (events: NullifierEvent[]) => Promise<void>;

// ============================================================================
// Chain Scanner
// ============================================================================

export class ChainScanner {
  private readonly config: Required<ChainScannerConfig>;
  private cursor: CursorState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private polling = false;
  private readonly seenEvents = new Set<string>();
  private onEvents: EventCallback | null = null;

  private constructor(config: Required<ChainScannerConfig>, cursor: CursorState) {
    this.config = config;
    this.cursor = cursor;
  }

  /**
   * Create a new ChainScanner, loading cursor from disk if available.
   */
  static async create(config: ChainScannerConfig): Promise<ChainScanner> {
    const fullConfig: Required<ChainScannerConfig> = {
      rpcUrl: config.rpcUrl,
      districtGateAddress: config.districtGateAddress.toLowerCase(),
      cursorPath: config.cursorPath,
      startBlock: config.startBlock ?? 0,
      pollIntervalMs: config.pollIntervalMs ?? 30_000,
      maxBlockRange: config.maxBlockRange ?? 2000,
    };

    let cursor: CursorState;
    try {
      const raw = await fs.readFile(fullConfig.cursorPath, 'utf-8');
      cursor = JSON.parse(raw) as CursorState;
      logger.info('ChainScanner: loaded cursor', {
        lastBlock: cursor.lastProcessedBlock,
        totalEvents: cursor.totalEventsProcessed,
      });
    } catch {
      cursor = {
        lastProcessedBlock: fullConfig.startBlock > 0 ? fullConfig.startBlock - 1 : 0,
        lastProcessedTimestamp: 0,
        totalEventsProcessed: 0,
      };
      logger.info('ChainScanner: no cursor found, starting from block', {
        startBlock: fullConfig.startBlock,
      });
    }

    return new ChainScanner(fullConfig, cursor);
  }

  /**
   * Register the callback that receives new NullifierEvent[] each poll cycle.
   */
  setEventCallback(cb: EventCallback): void {
    this.onEvents = cb;
  }

  /**
   * Start polling for new events.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info('ChainScanner: starting', {
      rpcUrl: this.config.rpcUrl.replace(/\/\/.*@/, '//***@'),
      districtGate: this.config.districtGateAddress,
      pollIntervalMs: this.config.pollIntervalMs,
      fromBlock: this.cursor.lastProcessedBlock + 1,
    });

    // Run first poll immediately, then on interval
    this.poll().catch(err => {
      logger.error('ChainScanner: initial poll failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    this.timer = setInterval(() => {
      this.poll().catch(err => {
        logger.error('ChainScanner: poll failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop polling and persist cursor.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.saveCursor();
    logger.info('ChainScanner: stopped', {
      lastBlock: this.cursor.lastProcessedBlock,
      totalEvents: this.cursor.totalEventsProcessed,
    });
  }

  /**
   * Get current cursor state (for monitoring/health checks).
   */
  getCursor(): CursorState {
    return { ...this.cursor };
  }

  /**
   * Exposed for testing: run a single poll cycle.
   */
  async pollOnce(): Promise<NullifierEvent[]> {
    const latestBlock = await this.getBlockNumber();
    const fromBlock = this.cursor.lastProcessedBlock + 1;

    if (fromBlock > latestBlock) return [];

    const allEvents: NullifierEvent[] = [];
    let currentFrom = fromBlock;

    while (currentFrom <= latestBlock) {
      const currentTo = Math.min(currentFrom + this.config.maxBlockRange - 1, latestBlock);
      const events = await this.fetchAndMapEvents(currentFrom, currentTo);
      allEvents.push(...events);

      this.cursor = {
        lastProcessedBlock: currentTo,
        lastProcessedTimestamp: Date.now(),
        totalEventsProcessed: this.cursor.totalEventsProcessed + events.length,
      };

      currentFrom = currentTo + 1;
    }

    await this.saveCursor();
    return allEvents;
  }

  // ========================================================================
  // Internal: Polling
  // ========================================================================

  private async poll(): Promise<void> {
    if (this.polling) {
      logger.debug('ChainScanner: skipping poll (previous still running)');
      return;
    }
    this.polling = true;

    try {
      const events = await this.pollOnce();
      if (events.length > 0 && this.onEvents) {
        await this.onEvents(events);
      }
    } finally {
      this.polling = false;
    }
  }

  // ========================================================================
  // Internal: RPC Calls
  // ========================================================================

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { result?: T; error?: { code: number; message: string } };
    if (json.error) {
      throw new Error(`RPC error: ${json.error.code} ${json.error.message}`);
    }
    return json.result as T;
  }

  private async getBlockNumber(): Promise<number> {
    const hex = await this.rpcCall<string>('eth_blockNumber', []);
    return parseInt(hex, 16);
  }

  private async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.rpcCall<{ timestamp: string }>(
      'eth_getBlockByNumber',
      ['0x' + blockNumber.toString(16), false],
    );
    return parseInt(block.timestamp, 16);
  }

  // ========================================================================
  // Internal: Event Fetching and Mapping
  // ========================================================================

  private async fetchAndMapEvents(fromBlock: number, toBlock: number): Promise<NullifierEvent[]> {
    // Filter by topic[0] = either TwoTree or ThreeTree event signature
    const logs = await this.rpcCall<RpcLogEntry[]>('eth_getLogs', [{
      address: this.config.districtGateAddress,
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [[TWO_TREE_TOPIC, THREE_TREE_TOPIC]],
    }]);

    const events: NullifierEvent[] = [];
    const blockTimestamps = new Map<number, number>();

    for (const log of logs) {
      if (log.removed) continue;

      const topic0 = log.topics[0];
      if (!topic0) continue;

      // Dedup by txHash:logIndex
      const eventId = `${log.transactionHash}:${log.logIndex}`;
      if (this.seenEvents.has(eventId)) continue;
      this.seenEvents.add(eventId);

      // Evict oldest entries when dedup set grows too large
      if (this.seenEvents.size > 100_000) {
        const entries = Array.from(this.seenEvents);
        for (let i = 0; i < 50_000; i++) {
          this.seenEvents.delete(entries[i]);
        }
      }

      const mapped = this.mapLogToEvent(topic0, log);
      if (!mapped) continue;

      const blockNum = parseInt(log.blockNumber, 16);
      let timestamp = blockTimestamps.get(blockNum);
      if (timestamp === undefined) {
        timestamp = await this.getBlockTimestamp(blockNum);
        blockTimestamps.set(blockNum, timestamp);
      }

      events.push({
        ...mapped,
        blockNumber: blockNum,
        timestamp,
      });
    }

    return events;
  }

  /**
   * Map a raw RPC log entry to a partial NullifierEvent (without block/timestamp).
   *
   * TwoTreeProofVerified ABI layout:
   *   topics[0] = event sig
   *   topics[1] = signer (indexed, address padded to 32 bytes)
   *   topics[2] = submitter (indexed)
   *   topics[3] = userRoot (indexed)
   *   data = abi.encode(cellMapRoot, nullifier, actionDomain, authorityLevel, verifierDepth)
   *          = 5 words (160 bytes)
   *
   * ThreeTreeProofVerified ABI layout:
   *   topics[0] = event sig
   *   topics[1] = signer (indexed)
   *   topics[2] = submitter (indexed)
   *   topics[3] = userRoot (indexed)
   *   data = abi.encode(cellMapRoot, engagementRoot, nullifier, actionDomain,
   *                     authorityLevel, engagementTier, verifierDepth)
   *          = 7 words (224 bytes)
   */
  private mapLogToEvent(
    topic0: string,
    log: RpcLogEntry,
  ): Omit<NullifierEvent, 'blockNumber' | 'timestamp'> | null {
    const signerTopic = log.topics[1];
    if (!signerTopic) return null;
    const signer = '0x' + signerTopic.slice(-40);

    const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const WORD = 64; // 32 bytes = 64 hex chars

    const topic0Lower = topic0.toLowerCase();

    if (topic0Lower === THREE_TREE_TOPIC) {
      // ThreeTreeProofVerified data:
      //   [0] cellMapRoot, [1] engagementRoot, [2] nullifier,
      //   [3] actionDomain, [4] authorityLevel, [5] engagementTier, [6] verifierDepth
      if (data.length < 7 * WORD) return null;
      const nullifier = '0x' + data.slice(2 * WORD, 3 * WORD);
      const actionDomain = '0x' + data.slice(3 * WORD, 4 * WORD);
      return { signer, nullifier, actionDomain };
    }

    if (topic0Lower === TWO_TREE_TOPIC) {
      // TwoTreeProofVerified data:
      //   [0] cellMapRoot, [1] nullifier, [2] actionDomain,
      //   [3] authorityLevel, [4] verifierDepth
      if (data.length < 5 * WORD) return null;
      const nullifier = '0x' + data.slice(1 * WORD, 2 * WORD);
      const actionDomain = '0x' + data.slice(2 * WORD, 3 * WORD);
      return { signer, nullifier, actionDomain };
    }

    return null;
  }

  // ========================================================================
  // Internal: Cursor Persistence
  // ========================================================================

  private async saveCursor(): Promise<void> {
    try {
      await fs.writeFile(
        this.config.cursorPath,
        JSON.stringify(this.cursor, null, 2) + '\n',
        'utf-8',
      );
    } catch (err) {
      logger.error('ChainScanner: failed to save cursor', {
        path: this.config.cursorPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
