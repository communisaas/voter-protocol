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
import { atomicWriteFile } from '../core/utils/atomic-write.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import { logger } from '../core/utils/logger.js';
import type { NullifierEvent } from '../engagement-tree-builder.js';
import type { AnyDebateEvent } from './debate-types.js';

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

/** DebateMarket event topics */
const TRADE_COMMITTED_TOPIC = eventTopic(
  'TradeCommitted(bytes32,uint256,bytes32,uint256)',
);
const TRADE_REVEALED_TOPIC = eventTopic(
  'TradeRevealed(bytes32,uint256,uint256,uint8,uint256)',
);
const EPOCH_EXECUTED_TOPIC = eventTopic(
  'EpochExecuted(bytes32,uint256,uint256)',
);
const DEBATE_RESOLVED_TOPIC = eventTopic(
  'DebateResolved(bytes32,uint256,uint8,uint256,uint256,uint256)',
);
const DEBATE_PROPOSED_TOPIC = eventTopic(
  'DebateProposed(bytes32,bytes32,bytes32,uint256,bytes32)',
);
const ARGUMENT_SUBMITTED_TOPIC = eventTopic(
  'ArgumentSubmitted(bytes32,uint256,uint8,bytes32,uint8,uint256,bytes32)',
);
const SETTLEMENT_CLAIMED_TOPIC = eventTopic(
  'SettlementClaimed(bytes32,bytes32,uint256,address)',
);
const AI_EVALUATION_SUBMITTED_TOPIC = eventTopic(
  'AIEvaluationSubmitted(bytes32,uint256,uint256)',
);
const DEBATE_RESOLVED_WITH_AI_TOPIC = eventTopic(
  'DebateResolvedWithAI(bytes32,uint256,uint256,uint256,uint256,uint8)',
);
const POSITION_COMMITTED_TOPIC = eventTopic(
  'PositionCommitted(bytes32,uint256,uint256,uint256,bytes32)',
);

// ============================================================================
// Hex Parsing
// ============================================================================

/**
 * R59-F04: Safe hex-to-number conversion via BigInt.
 *
 * `parseInt(hexString, 16)` silently loses precision for values above
 * Number.MAX_SAFE_INTEGER (2^53-1). Solidity uint256 topics/data are 32-byte
 * hex strings — while counter/index fields will practically never exceed 2^53,
 * silent truncation is a correctness hazard. This helper throws instead.
 */
function safeHexToNumber(hex: string): number {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const n = BigInt('0x' + clean);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Hex value 0x${clean} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(n);
}

// ============================================================================
// Types
// ============================================================================

export interface ChainScannerConfig {
  /** JSON-RPC endpoint URL (e.g., https://sepolia-rpc.scroll.io) */
  readonly rpcUrl: string;
  /** DistrictGate contract address */
  readonly districtGateAddress: string;
  /** DebateMarket contract address (optional — omit to skip debate scanning) */
  readonly debateMarketAddress?: string;
  /** Path to cursor file for persisting last processed block */
  readonly cursorPath: string;
  /** Block number to start scanning from (used for initial backfill) */
  readonly startBlock?: number;
  /** Polling interval in milliseconds (default: 30000 for L2) */
  readonly pollIntervalMs?: number;
  /** Maximum blocks per eth_getLogs request (default: 2000) */
  readonly maxBlockRange?: number;
  /** Confirmation depth — blocks behind chain tip to wait before processing (default: 5) */
  readonly confirmationDepth?: number;
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

/** Result of a single poll cycle's fetch phase (no side effects applied yet) */
interface PollCycleResult {
  readonly events: NullifierEvent[];
  readonly debateEvents: AnyDebateEvent[];
  readonly processedBlock: number;
  readonly totalNew: number;
  readonly newEventIds: Set<string>;
}

/** Callback invoked with new nullifier events each poll cycle */
export type EventCallback = (events: NullifierEvent[]) => Promise<void>;

/** Callback invoked with new debate market events each poll cycle */
export type DebateEventCallback = (events: AnyDebateEvent[]) => Promise<void>;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mask RPC URL credentials for safe logging.
 * Handles both user:pass@host and path-based API keys (/v2/sk-live-XXX).
 */
function maskRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const masked = `${parsed.protocol}//${parsed.host}/***`;
    return masked;
  } catch {
    return '***invalid-url***';
  }
}

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
  private onDebateEvents: DebateEventCallback | null = null;

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
      debateMarketAddress: config.debateMarketAddress?.toLowerCase() ?? '',
      cursorPath: config.cursorPath,
      startBlock: config.startBlock ?? 0,
      pollIntervalMs: config.pollIntervalMs ?? 30_000,
      maxBlockRange: config.maxBlockRange ?? 2000,
      confirmationDepth: config.confirmationDepth ?? 5,
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
   * Register the callback that receives new AnyDebateEvent[] each poll cycle.
   * Only invoked when debateMarketAddress is configured.
   */
  setDebateEventCallback(cb: DebateEventCallback): void {
    this.onDebateEvents = cb;
  }

  /**
   * Start polling for new events.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info('ChainScanner: starting', {
      rpcUrl: maskRpcUrl(this.config.rpcUrl),
      districtGate: this.config.districtGateAddress,
      debateMarket: this.config.debateMarketAddress || '(not configured)',
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
   * Returns nullifier events; debate events are delivered via callback.
   */
  async pollOnce(): Promise<NullifierEvent[]> {
    const result = await this.fetchAll();

    // R14-L1: Skip commit+save when nothing happened (no new blocks).
    // Avoids unnecessary disk writes and misleading timestamp updates.
    if (result.totalNew === 0 && result.processedBlock === this.cursor.lastProcessedBlock) {
      return result.events;
    }

    // Deliver debate events via callback
    if (result.debateEvents.length > 0 && this.onDebateEvents) {
      await this.onDebateEvents(result.debateEvents);
    }

    // R13-C1+C2: Commit AFTER debate callback succeeds.
    // If callback throws, neither cursor nor seenEvents are advanced,
    // so the next poll retries the entire range including these events.
    this.commitPollResult(result);
    await this.saveCursor();
    return result.events;
  }

  // ========================================================================
  // Internal: Fetch-all (pure fetch, no side effects on cursor/seenEvents)
  // ========================================================================

  /**
   * Fetch all events from cursor to chain tip. Returns a result bundle
   * that must be explicitly committed via commitPollResult().
   *
   * R13-C1: Uses a local dedup set — does NOT touch this.seenEvents.
   * If any chunk fails mid-loop, no dedup state is poisoned and the
   * next poll retries the full range.
   *
   * R13-C2: Does NOT advance this.cursor. Cursor is committed only
   * after all callbacks succeed in poll()/pollOnce().
   */
  private async fetchAll(): Promise<PollCycleResult> {
    // R70-C1: Stay confirmationDepth blocks behind chain tip to handle L2 reorgs.
    const rawTip = await this.getBlockNumber();
    const latestBlock = rawTip - this.config.confirmationDepth;
    const fromBlock = this.cursor.lastProcessedBlock + 1;

    if (fromBlock > latestBlock) {
      return {
        events: [],
        debateEvents: [],
        processedBlock: this.cursor.lastProcessedBlock,
        totalNew: 0,
        newEventIds: new Set(),
      };
    }

    const allEvents: NullifierEvent[] = [];
    const allDebateEvents: AnyDebateEvent[] = [];
    const newEventIds = new Set<string>();
    let currentFrom = fromBlock;
    let processedBlock = this.cursor.lastProcessedBlock;
    let totalNew = 0;

    while (currentFrom <= latestBlock) {
      const currentTo = Math.min(currentFrom + this.config.maxBlockRange - 1, latestBlock);
      const events = await this.fetchAndMapEvents(currentFrom, currentTo, newEventIds);
      allEvents.push(...events);

      if (this.config.debateMarketAddress) {
        const debateEvents = await this.fetchAndMapDebateEvents(currentFrom, currentTo, newEventIds);
        allDebateEvents.push(...debateEvents);
        totalNew += debateEvents.length;
      }

      totalNew += events.length;
      processedBlock = currentTo;
      currentFrom = currentTo + 1;
    }

    return { events: allEvents, debateEvents: allDebateEvents, processedBlock, totalNew, newEventIds };
  }

  /**
   * Commit a poll cycle result: advance cursor and persist dedup state.
   * Called only after ALL callbacks have succeeded.
   */
  private commitPollResult(result: PollCycleResult): void {
    // Merge new event IDs into the persistent dedup set
    for (const id of result.newEventIds) {
      this.seenEvents.add(id);
    }

    // Evict oldest entries when dedup set grows too large
    if (this.seenEvents.size > 100_000) {
      const entries = Array.from(this.seenEvents);
      for (let i = 0; i < 50_000; i++) {
        this.seenEvents.delete(entries[i]);
      }
    }

    // Advance in-memory cursor
    this.cursor = {
      lastProcessedBlock: result.processedBlock,
      lastProcessedTimestamp: Date.now(),
      totalEventsProcessed: this.cursor.totalEventsProcessed + result.totalNew,
    };
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
      // R13-C1+C2: fetchAll() is pure — no side effects on cursor or seenEvents.
      // We commit only after ALL callbacks succeed. If any callback throws,
      // both cursor and dedup state stay at pre-poll positions, and the
      // entire range is retried on the next cycle.
      const result = await this.fetchAll();

      // R14-L1: Skip commit+save when nothing happened (no new blocks).
      if (result.totalNew === 0 && result.processedBlock === this.cursor.lastProcessedBlock) {
        return;
      }

      if (result.events.length > 0 && this.onEvents) {
        await this.onEvents(result.events);
      }
      if (result.debateEvents.length > 0 && this.onDebateEvents) {
        await this.onDebateEvents(result.debateEvents);
      }

      // COMMIT: cursor + seenEvents + disk persistence
      this.commitPollResult(result);
      await this.saveCursor();
    } finally {
      this.polling = false;
    }
  }

  // ========================================================================
  // Internal: RPC Calls
  // ========================================================================

  // R11-L1: Monotonic RPC ID counter (was static `id: 1`)
  private rpcIdCounter = 0;

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.rpcIdCounter,
        method,
        params,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { result?: T; error?: { code: number; message: string } };
    if (json.error) {
      throw new Error(`RPC error: ${json.error.code} ${json.error.message}`);
    }
    // R42-FIX: Guard against RPC responses with no result field (returns undefined as T)
    if (json.result === undefined || json.result === null) {
      throw new Error(`RPC returned empty result for method ${method}`);
    }
    return json.result as T;
  }

  private async getBlockNumber(): Promise<number> {
    const hex = await this.rpcCall<string>('eth_blockNumber', []);
    return safeHexToNumber(hex);
  }

  private async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.rpcCall<{ timestamp: string }>(
      'eth_getBlockByNumber',
      ['0x' + blockNumber.toString(16), false],
    );
    return safeHexToNumber(block.timestamp);
  }

  // ========================================================================
  // Internal: Event Fetching and Mapping
  // ========================================================================

  private async fetchAndMapEvents(
    fromBlock: number,
    toBlock: number,
    localDedup: Set<string>,
  ): Promise<NullifierEvent[]> {
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

      // R20-H5: Defense-in-depth — verify returned log address matches our filter.
      // RPC filters by address, but a buggy/malicious RPC could return logs from other contracts.
      if (log.address?.toLowerCase() !== this.config.districtGateAddress.toLowerCase()) continue;

      const topic0 = log.topics[0];
      if (!topic0) continue;

      // R13-C1: Dedup against both the persistent set (prior cycles) and
      // the local set (this cycle). Add to localDedup only — seenEvents
      // is committed in commitPollResult() after callbacks succeed.
      const eventId = `${log.transactionHash}:${log.logIndex}`;
      if (this.seenEvents.has(eventId) || localDedup.has(eventId)) continue;
      localDedup.add(eventId);

      const mapped = this.mapLogToEvent(topic0, log);
      if (!mapped) continue;

      const blockNum = safeHexToNumber(log.blockNumber);
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
   * topics[0] = event sig
   * topics[1] = signer (indexed, address padded to 32 bytes)
   * topics[2] = submitter (indexed)
   * topics[3] = userRoot (indexed)
   * data = abi.encode(cellMapRoot, nullifier, actionDomain, authorityLevel, verifierDepth)
   * = 5 words (160 bytes)
   *
   * ThreeTreeProofVerified ABI layout:
   * topics[0] = event sig
   * topics[1] = signer (indexed)
   * topics[2] = submitter (indexed)
   * topics[3] = userRoot (indexed)
   * data = abi.encode(cellMapRoot, engagementRoot, nullifier, actionDomain,
   * authorityLevel, engagementTier, verifierDepth)
   * = 7 words (224 bytes)
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
      // [0] cellMapRoot, [1] engagementRoot, [2] nullifier,
      // [3] actionDomain, [4] authorityLevel, [5] engagementTier, [6] verifierDepth
      if (data.length < 7 * WORD) return null;
      const nullifier = '0x' + data.slice(2 * WORD, 3 * WORD);
      const actionDomain = '0x' + data.slice(3 * WORD, 4 * WORD);
      return { signer, nullifier, actionDomain };
    }

    if (topic0Lower === TWO_TREE_TOPIC) {
      // TwoTreeProofVerified data:
      // [0] cellMapRoot, [1] nullifier, [2] actionDomain,
      // [3] authorityLevel, [4] verifierDepth
      if (data.length < 5 * WORD) return null;
      const nullifier = '0x' + data.slice(1 * WORD, 2 * WORD);
      const actionDomain = '0x' + data.slice(2 * WORD, 3 * WORD);
      return { signer, nullifier, actionDomain };
    }

    return null;
  }

  // ========================================================================
  // Internal: Debate Market Event Fetching
  // ========================================================================

  /**
   * Fetch and map DebateMarket events for a block range.
   *
   * ABI layouts (indexed params go in topics, non-indexed in data):
   *
   * TradeCommitted(bytes32 indexed debateId, uint256 indexed epoch, bytes32 commitHash, uint256 commitIndex)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = epoch
   * data = abi.encode(commitHash, commitIndex) = 2 words
   *
   * TradeRevealed(bytes32 indexed debateId, uint256 indexed epoch, uint256 argumentIndex, uint8 direction, uint256 weightedAmount)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = epoch
   * data = abi.encode(argumentIndex, direction, weightedAmount) = 3 words
   *
   * EpochExecuted(bytes32 indexed debateId, uint256 indexed epoch, uint256 tradesApplied)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = epoch
   * data = abi.encode(tradesApplied) = 1 word
   *
   * DebateResolved(bytes32 indexed debateId, uint256 winningArgumentIndex, uint8 winningStance, uint256 winningScore, uint256 uniqueParticipants, uint256 jurisdictionSizeHint)
   * topics[0] = event sig, topics[1] = debateId
   * data = abi.encode(winningArgumentIndex, winningStance, winningScore, uniqueParticipants, jurisdictionSizeHint) = 5 words
   *
   * DebateProposed(bytes32 indexed debateId, bytes32 indexed actionDomain, bytes32 propositionHash, uint256 deadline, bytes32 baseDomain)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = actionDomain
   * data = abi.encode(propositionHash, deadline, baseDomain) = 3 words
   *
   * ArgumentSubmitted(bytes32 indexed debateId, uint256 indexed argumentIndex, uint8 stance, bytes32 bodyHash, uint8 engagementTier, uint256 weight, bytes32 nullifier)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = argumentIndex
   * data = abi.encode(stance, bodyHash, engagementTier, weight, nullifier) = 5 words
   *
   * SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout, address indexed recipient)
   * topics[0] = event sig, topics[1] = debateId, topics[2] = recipient (indexed address)
   * data = abi.encode(nullifier, payout) = 2 words
   *
   * AIEvaluationSubmitted(bytes32 indexed debateId, uint256 signatureCount, uint256 nonce)
   * topics[0] = event sig, topics[1] = debateId
   * data = abi.encode(signatureCount, nonce) = 2 words
   *
   * DebateResolvedWithAI(bytes32 indexed debateId, uint256 winningArgumentIndex, uint256 aiScore, uint256 communityScore, uint256 finalScore, uint8 resolutionMethod)
   * topics[0] = event sig, topics[1] = debateId
   * data = abi.encode(winningArgumentIndex, aiScore, communityScore, finalScore, resolutionMethod) = 5 words
   */
  private async fetchAndMapDebateEvents(
    fromBlock: number,
    toBlock: number,
    localDedup: Set<string>,
  ): Promise<AnyDebateEvent[]> {
    const logs = await this.rpcCall<RpcLogEntry[]>('eth_getLogs', [{
      address: this.config.debateMarketAddress,
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [[
        TRADE_COMMITTED_TOPIC,
        TRADE_REVEALED_TOPIC,
        EPOCH_EXECUTED_TOPIC,
        DEBATE_RESOLVED_TOPIC,
        DEBATE_PROPOSED_TOPIC,
        ARGUMENT_SUBMITTED_TOPIC,
        SETTLEMENT_CLAIMED_TOPIC,
        AI_EVALUATION_SUBMITTED_TOPIC,
        DEBATE_RESOLVED_WITH_AI_TOPIC,
        POSITION_COMMITTED_TOPIC,
      ]],
    }]);

    const events: AnyDebateEvent[] = [];
    const blockTimestamps = new Map<number, number>();

    for (const log of logs) {
      if (log.removed) continue;

      // R20-H5: Defense-in-depth — verify returned log address matches debate market.
      if (log.address?.toLowerCase() !== this.config.debateMarketAddress.toLowerCase()) continue;

      const topic0 = log.topics[0];
      if (!topic0) continue;

      // R13-C1: Same deferred-dedup pattern as fetchAndMapEvents.
      const eventId = `${log.transactionHash}:${log.logIndex}`;
      if (this.seenEvents.has(eventId) || localDedup.has(eventId)) continue;
      localDedup.add(eventId);

      const blockNum = safeHexToNumber(log.blockNumber);
      let timestamp = blockTimestamps.get(blockNum);
      if (timestamp === undefined) {
        timestamp = await this.getBlockTimestamp(blockNum);
        blockTimestamps.set(blockNum, timestamp);
      }

      // R42-FIX: Wrap mapDebateLog in try/catch — malformed hex in RPC data
      // causes BigInt SyntaxError that would otherwise crash the entire poll cycle
      try {
        const mapped = this.mapDebateLog(topic0, log, blockNum, timestamp);
        if (mapped) {
          events.push(mapped);
        }
      } catch (err) {
        logger.warn('ChainScanner: failed to parse debate log, skipping', {
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (events.length > 0) {
      logger.info('ChainScanner: fetched debate events', {
        fromBlock,
        toBlock,
        count: events.length,
      });
    }

    return events;
  }

  /**
   * Map a raw RPC log entry to a typed debate event.
   */
  private mapDebateLog(
    topic0: string,
    log: RpcLogEntry,
    blockNumber: number,
    timestamp: number,
  ): AnyDebateEvent | null {
    const topic0Lower = topic0.toLowerCase();
    const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const WORD = 64; // 32 bytes = 64 hex chars

    // All debate events have debateId as topics[1]
    const debateIdTopic = log.topics[1];
    if (!debateIdTopic) return null;
    const debateId = debateIdTopic;

    const base = {
      debateId,
      blockNumber,
      timestamp,
      transactionHash: log.transactionHash,
    };

    if (topic0Lower === TRADE_COMMITTED_TOPIC) {
      // topics[2] = epoch, data = [commitHash, commitIndex]
      const epochTopic = log.topics[2];
      if (!epochTopic || data.length < 2 * WORD) return null;
      const epoch = safeHexToNumber(epochTopic);
      const commitHash = '0x' + data.slice(0, WORD);
      const commitIndex = safeHexToNumber(data.slice(WORD, 2 * WORD));
      return { ...base, type: 'TradeCommitted', epoch, commitHash, commitIndex };
    }

    if (topic0Lower === TRADE_REVEALED_TOPIC) {
      // topics[2] = epoch, data = [argumentIndex, direction, weightedAmount]
      const epochTopic = log.topics[2];
      if (!epochTopic || data.length < 3 * WORD) return null;
      const epoch = safeHexToNumber(epochTopic);
      const argumentIndex = safeHexToNumber(data.slice(0, WORD));
      const directionRaw = safeHexToNumber(data.slice(WORD, 2 * WORD));
      // R22-M2: Reject unknown direction values instead of defaulting to SELL
      if (directionRaw !== 0 && directionRaw !== 1) {
        logger.warn('ChainScanner: unknown TradeDirection value, skipping event', { directionRaw, txHash: log.transactionHash });
        return null;
      }
      const direction = directionRaw === 0 ? 'BUY' as const : 'SELL' as const;
      const weightedAmount = BigInt('0x' + data.slice(2 * WORD, 3 * WORD)).toString();
      return { ...base, type: 'TradeRevealed', epoch, argumentIndex, direction, weightedAmount };
    }

    if (topic0Lower === EPOCH_EXECUTED_TOPIC) {
      // topics[2] = epoch, data = [tradesApplied]
      const epochTopic = log.topics[2];
      if (!epochTopic || data.length < 1 * WORD) return null;
      const epoch = safeHexToNumber(epochTopic);
      const tradesApplied = safeHexToNumber(data.slice(0, WORD));
      return { ...base, type: 'EpochExecuted', epoch, tradesApplied };
    }

    if (topic0Lower === DEBATE_RESOLVED_TOPIC) {
      // topics[1] = debateId (already extracted), data = [winningArgumentIndex, winningStance, winningScore, uniqueParticipants, jurisdictionSizeHint]
      if (data.length < 5 * WORD) return null;
      const winningArgumentIndex = safeHexToNumber(data.slice(0, WORD));
      const winningStanceRaw = safeHexToNumber(data.slice(WORD, 2 * WORD));
      const stanceMap = ['SUPPORT', 'OPPOSE', 'AMEND'] as const;
      // R22-M2: Reject unknown stance values instead of defaulting
      if (winningStanceRaw > 2) {
        logger.warn('ChainScanner: unknown Stance value in DebateResolved, skipping', { winningStanceRaw, txHash: log.transactionHash });
        return null;
      }
      const winningStance = stanceMap[winningStanceRaw];
      const winningScore = BigInt('0x' + data.slice(2 * WORD, 3 * WORD)).toString();
      const uniqueParticipants = safeHexToNumber(data.slice(3 * WORD, 4 * WORD));
      // jurisdictionSizeHint is data[4] — not stored in event type
      return { ...base, type: 'DebateResolved', winningArgumentIndex, winningStance, winningScore, uniqueParticipants };
    }

    if (topic0Lower === DEBATE_PROPOSED_TOPIC) {
      // topics[1] = debateId (already extracted), topics[2] = actionDomain (indexed)
      // data = [propositionHash, deadline, baseDomain] = 3 words
      const actionDomainTopic = log.topics[2];
      if (!actionDomainTopic || data.length < 3 * WORD) return null;
      const actionDomain = actionDomainTopic;
      const propositionHash = '0x' + data.slice(0, WORD);
      const deadline = safeHexToNumber(data.slice(WORD, 2 * WORD));
      const baseDomain = '0x' + data.slice(2 * WORD, 3 * WORD);
      return { ...base, type: 'DebateProposed', actionDomain, propositionHash, deadline, baseDomain };
    }

    if (topic0Lower === ARGUMENT_SUBMITTED_TOPIC) {
      // topics[1] = debateId (already extracted), topics[2] = argumentIndex (indexed)
      // data = [stance, bodyHash, engagementTier, weight, nullifier] = 5 words
      const argumentIndexTopic = log.topics[2];
      if (!argumentIndexTopic || data.length < 5 * WORD) return null;
      const argumentIndex = safeHexToNumber(argumentIndexTopic);
      const stanceRaw = safeHexToNumber(data.slice(0, WORD));
      const stanceMap = ['SUPPORT', 'OPPOSE', 'AMEND'] as const;
      // R22-M2: Reject unknown stance values instead of defaulting
      if (stanceRaw > 2) {
        logger.warn('ChainScanner: unknown Stance value in ArgumentSubmitted, skipping', { stanceRaw, txHash: log.transactionHash });
        return null;
      }
      const stance = stanceMap[stanceRaw];
      const bodyHash = '0x' + data.slice(WORD, 2 * WORD);
      const engagementTier = safeHexToNumber(data.slice(2 * WORD, 3 * WORD));
      const weight = BigInt('0x' + data.slice(3 * WORD, 4 * WORD)).toString();
      const nullifier = '0x' + data.slice(4 * WORD, 5 * WORD);
      return { ...base, type: 'ArgumentSubmitted', argumentIndex, stance, bodyHash, engagementTier, weight, nullifier };
    }

    if (topic0Lower === SETTLEMENT_CLAIMED_TOPIC) {
      // topics[1] = debateId (indexed, already extracted)
      // topics[2] = recipient (indexed address, right-padded to bytes32)
      // data = [nullifier, payout] = 2 words
      if (data.length < 2 * WORD) return null;
      const nullifier = '0x' + data.slice(0, WORD);
      const payout = BigInt('0x' + data.slice(WORD, 2 * WORD)).toString();
      const recipient = log.topics[2] ? '0x' + log.topics[2].slice(-40) : '';
      return { ...base, type: 'SettlementClaimed', nullifier, payout, recipient };
    }

    if (topic0Lower === AI_EVALUATION_SUBMITTED_TOPIC) {
      // topics[1] = debateId (already extracted)
      // data = [signatureCount, nonce] = 2 words
      if (data.length < 2 * WORD) return null;
      const signatureCount = safeHexToNumber(data.slice(0, WORD));
      const nonce = safeHexToNumber(data.slice(WORD, 2 * WORD));
      return { ...base, type: 'AIEvaluationSubmitted', signatureCount, nonce };
    }

    if (topic0Lower === DEBATE_RESOLVED_WITH_AI_TOPIC) {
      // topics[1] = debateId (already extracted)
      // data = [winningArgumentIndex, aiScore, communityScore, finalScore, resolutionMethod] = 5 words
      if (data.length < 5 * WORD) return null;
      const winningArgumentIndex = safeHexToNumber(data.slice(0, WORD));
      const aiScore = BigInt('0x' + data.slice(WORD, 2 * WORD)).toString();
      const communityScore = BigInt('0x' + data.slice(2 * WORD, 3 * WORD)).toString();
      const finalScore = BigInt('0x' + data.slice(3 * WORD, 4 * WORD)).toString();
      const resolutionMethod = safeHexToNumber(data.slice(4 * WORD, 5 * WORD));
      return { ...base, type: 'DebateResolvedWithAI', winningArgumentIndex, aiScore, communityScore, finalScore, resolutionMethod };
    }

    if (topic0Lower === POSITION_COMMITTED_TOPIC) {
      // topics[1] = debateId (indexed, already extracted)
      // topics[2] = epoch (indexed)
      // data = [argumentIndex, weightedAmount, noteCommitment] = 3 words
      if (data.length < 3 * WORD) return null;
      // R43-FIX: Return null for missing epoch topic instead of defaulting to 0
      // (epoch 0 is valid in DebateMarket — silent default would corrupt position attribution)
      if (!log.topics[2]) return null;
      const epoch = safeHexToNumber(log.topics[2]);
      const argumentIndex = safeHexToNumber(data.slice(0, WORD));
      const weightedAmount = BigInt('0x' + data.slice(WORD, 2 * WORD)).toString();
      const noteCommitment = '0x' + data.slice(2 * WORD, 3 * WORD);
      return { ...base, type: 'PositionCommitted', epoch, argumentIndex, weightedAmount, noteCommitment };
    }

    return null;
  }

  // ========================================================================
  // Internal: Cursor Persistence
  // ========================================================================

  // R49-M4: Atomic cursor write via shared atomicWriteFile utility
  private async saveCursor(): Promise<void> {
    try {
      await atomicWriteFile(
        this.config.cursorPath,
        JSON.stringify(this.cursor, null, 2) + '\n',
      );
    } catch (err) {
      logger.error('ChainScanner: failed to save cursor', {
        path: this.config.cursorPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
