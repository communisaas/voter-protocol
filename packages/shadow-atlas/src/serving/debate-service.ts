/**
 * Debate Market Service
 *
 * Manages debate market state and SSE (Server-Sent Events) subscriptions.
 * Receives events from the chain scanner, aggregates per-debate state,
 * and pushes real-time updates to connected SSE clients.
 *
 * Design:
 * - In-memory state per active debate (prices, epoch, phase)
 * - SSE subscribers keyed by debateId
 * - Keepalive pings every 15s to prevent proxy timeouts
 * - Clean start/stop lifecycle matching existing serving services
 */

import { logger } from '../core/utils/logger.js';
import type {
  DebateMarketState,
  AnyDebateEvent,
  SSEPriceUpdate,
  SSETradeActivity,
  DebateResolvedEvent,
  DebateProposedEvent,
  ArgumentSubmittedEvent,
  SettlementClaimedEvent,
  AIEvaluationSubmittedEvent,
  DebateResolvedWithAIEvent,
  PositionCommittedEvent,
} from './debate-types.js';
import type { ServerResponse } from 'http';
import {
  PositionTreeBuilder,
  type PositionMerkleProof,
} from '../position-tree-builder.js';

// ============================================================================
// Types
// ============================================================================

interface SSEClient {
  res: ServerResponse;
  debateId: string;
  clientIp: string;
  connectedAt: number;
  /** R33-SSE: Backpressure flag — true when write buffer is full */
  paused: boolean;
}

// ============================================================================
// Service
// ============================================================================

export class DebateService {
  private markets = new Map<string, DebateMarketState>();
  private clients = new Map<string, SSEClient[]>();
  private clientCount = 0;
  /** Per-IP SSE connection counter to prevent single-IP slot exhaustion */
  private clientsByIp = new Map<string, number>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxSSEClients = 1000;
  /** Maximum SSE connections per IP address */
  private readonly maxSSEClientsPerIp = 10;
  /** R33-M2: Max stale markets before forced eviction of oldest unresolved debates */
  private readonly maxMarkets = 500;
  /** R33-M2: Market staleness timer (runs every 10 minutes) */
  private marketSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** R33-M2: Max age for market state without events (24 hours) */
  private readonly marketMaxStalenessMs = 24 * 60 * 60 * 1000;

  /**
   * Per-debate position Merkle trees.
   *
   * Keyed by debateId (hex string with 0x prefix, as emitted by the chain scanner).
   * A tree is created lazily when the first TradeRevealed event arrives for a debate.
   *
   * Each tree is append-only, depth=20, and tracks every revealed position
   * commitment in insertion order. The root of each tree is the canonical
   * positionRoot that users reference when constructing position_note proofs
   * for settlement claims.
   */
  private positionTrees = new Map<string, PositionTreeBuilder>();

  /**
   * Per-debate insertion lock chains.
   *
   * PositionTreeBuilder.insertCommitment() is NOT thread-safe — concurrent
   * insertions for the same debate corrupt the Merkle tree. Since processEvent
   * is synchronous and fires _handlePositionCommitted as fire-and-forget,
   * two PositionCommitted events in the same batch would race.
   *
   * Each entry is the tail of a promise chain for that debate. New insertions
   * chain after the previous one, guaranteeing serial execution without
   * blocking processEvent (R7-C1).
   */
  private readonly insertionLocks = new Map<string, Promise<void>>();

  // R64-M3: Track debates with failed position tree insertions.
  // A gap means the tree is missing leaves — settlement proofs may fail verification.
  private readonly positionTreeGaps: Map<string, number> = new Map();

  /**
   * Finding 7: track argument stances so DebateResolvedWithAI can include
   * winningStance in its SSE payload.
   *
   * Outer key: debateId. Inner key: argumentIndex. Value: stance string.
   * Populated from ArgumentSubmitted events, which always arrive before
   * any resolution event for the same debate.
   */
  private argumentStances = new Map<string, Map<number, string>>();

  /**
   * Start the debate service (keepalive timer).
   */
  start(): void {
    // R36-F11: Idempotent start — clear existing timers to prevent orphaned intervals
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    if (this.marketSweepTimer) clearInterval(this.marketSweepTimer);

    // Send keepalive every 15s to prevent proxy timeouts
    this.keepaliveTimer = setInterval(() => {
      this.broadcast(':keepalive\n\n');
      logger.debug('DebateService: keepalive', {
        markets: this.markets.size,
        trees: this.positionTrees.size,
        clients: this.clientCount,
      });
    }, 15_000);

    // R33-M2: Sweep stale markets every 10 minutes
    this.marketSweepTimer = setInterval(() => this.sweepStaleMarkets(), 10 * 60 * 1000);

    logger.info('DebateService: started');
  }

  /**
   * R33-M2: Evict markets that haven't received events within staleness window.
   * Prevents unbounded memory growth from debates that are proposed but never resolve.
   */
  private sweepStaleMarkets(): void {
    const now = Date.now();
    let evicted = 0;
    // R42-FIX: Collect IDs first, then evict — avoids Map mutation during iteration
    // (cleanupDebate does SSE I/O which could trigger reentrant modifications)
    const staleIds: string[] = [];
    for (const [debateId, state] of this.markets) {
      // R43-FIX: lastUpdated is always a number (Unix seconds) — removed dead string branch
      const lastUpdatedMs = state.lastUpdated * 1000;
      if (now - lastUpdatedMs > this.marketMaxStalenessMs) {
        staleIds.push(debateId);
      }
    }
    for (const debateId of staleIds) {
      this.cleanupDebate(debateId);
      evicted++;
    }
    // Also enforce hard cap: if still over maxMarkets, evict oldest
    if (this.markets.size > this.maxMarkets) {
      const entries = [...this.markets.entries()]
        .sort((a, b) => {
          // R44-FIX: lastUpdated is always a number — removed dead typeof guard (consistency with R43 fix at line 140)
          const aTime = a[1].lastUpdated;
          const bTime = b[1].lastUpdated;
          return aTime - bTime;
        });
      const toEvict = this.markets.size - this.maxMarkets;
      for (let i = 0; i < toEvict; i++) {
        this.cleanupDebate(entries[i][0]);
        evicted++;
      }
    }
    if (evicted > 0) {
      logger.info('DebateService: swept stale markets', { evicted, remaining: this.markets.size });
    }
  }

  /**
   * Stop the debate service and close all SSE connections.
   */
  stop(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.marketSweepTimer) {
      clearInterval(this.marketSweepTimer);
      this.marketSweepTimer = null;
    }

    // Close all SSE connections
    for (const list of this.clients.values()) {
      for (const client of list) {
        try {
          client.res.end();
        } catch {
          // Client already disconnected
        }
      }
    }
    this.clients.clear();
    this.clientCount = 0;
    this.clientsByIp.clear();
    this.markets.clear();
    this.positionTrees.clear();
    this.argumentStances.clear();
    this.insertionLocks.clear();

    logger.info('DebateService: stopped');
  }

  /**
   * Remove all in-memory state for a resolved debate.
   * Called after emitting the final SSE event for the debate.
   *
   * R9-M1: Also closes SSE connections for this debate. Without this,
   * clients stay connected as zombies receiving keepalive pings but no data.
   */
  cleanupDebate(debateId: string): void {
    this.markets.delete(debateId);
    this.positionTrees.delete(debateId);
    this.argumentStances.delete(debateId);
    this.insertionLocks.delete(debateId);
    this.positionTreeGaps.delete(debateId); // R66-F7: Clean up gap counter

    // Close SSE connections for this debate
    const clients = this.clients.get(debateId);
    if (clients) {
      for (const client of clients) {
        try {
          // R33-SSE: Best-effort final event — skip backpressure check since we're closing
          client.res.write('event: debate_ended\ndata: {}\n\n');
          client.res.end();
        } catch {
          // Client already disconnected
        }
        // Decrement per-IP counter
        const ipCount = this.clientsByIp.get(client.clientIp) ?? 1;
        if (ipCount <= 1) {
          this.clientsByIp.delete(client.clientIp);
        } else {
          this.clientsByIp.set(client.clientIp, ipCount - 1);
        }
      }
      this.clientCount -= clients.length;
      this.clients.delete(debateId);
    }

    logger.info('DebateService: cleaned up debate state', { debateId });
  }

  /**
   * Process a batch of debate events from the chain scanner.
   */
  processEvents(events: AnyDebateEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  /**
   * Get current state for a debate.
   */
  getMarketState(debateId: string): DebateMarketState | undefined {
    return this.markets.get(debateId);
  }

  /**
   * Update cached prices for a debate. Called externally after fetching fresh
   * prices from the chain (e.g., by the chain scanner's debate event callback
   * or by the API server after an executeEpoch RPC call).
   */
  updatePrices(debateId: string, prices: Record<number, string>): void {
    const state = this.markets.get(debateId);
    if (!state) return;
    state.prices = prices;
    // R35-F1: Use Unix seconds (consistent with event.timestamp assignments everywhere else)
    state.lastUpdated = Math.floor(Date.now() / 1000);
    // R36-F1: SSE payload must also use Unix seconds (consistent with all other SSE events)
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.emitToDebate(debateId, 'price_update', {
      debateId,
      epoch: state.epoch,
      prices,
      timestamp: nowSeconds,
    } satisfies SSEPriceUpdate);
  }

  /**
   * R33-M5: Non-mutating capacity pre-check. Use before sending 200 headers
   * to avoid the 200→error sequence. Not atomic — a subsequent tryAddSSEClient
   * call is still needed after headers are sent.
   */
  hasSSECapacity(clientIp: string): boolean {
    if (this.clientCount >= this.maxSSEClients) return false;
    const ipCount = this.clientsByIp.get(clientIp) ?? 0;
    return ipCount < this.maxSSEClientsPerIp;
  }

  /**
   * Atomically check capacity (global + per-IP) and subscribe an
   * SSE client to a debate's price stream. Returns false if either limit is
   * exceeded — caller should respond with 503.
   *
   * Replaces the former canAcceptSSEClient() + addSSEClient() two-step
   * pattern, which had a TOCTOU race between the check and the mutation.
   *
   * @param debateId - Debate identifier
   * @param res - HTTP response to stream SSE events on
   * @param clientIp - Normalized client IP for per-IP limiting
   * @returns true if the client was accepted, false if at capacity
   */
  tryAddSSEClient(debateId: string, res: ServerResponse, clientIp: string): boolean {
    // Atomic check: global limit
    if (this.clientCount >= this.maxSSEClients) {
      return false;
    }

    // Atomic check: per-IP limit
    const ipCount = this.clientsByIp.get(clientIp) ?? 0;
    if (ipCount >= this.maxSSEClientsPerIp) {
      return false;
    }

    // Both limits passed — commit the mutation
    const client: SSEClient = {
      res,
      debateId,
      clientIp,
      connectedAt: Date.now(),
      paused: false,
    };
    const list = this.clients.get(debateId) ?? [];
    if (!list.length) this.clients.set(debateId, list);
    list.push(client);
    this.clientCount++;
    this.clientsByIp.set(clientIp, ipCount + 1);

    logger.debug('DebateService: SSE client connected', {
      debateId,
      clientIp,
      totalClients: this.clientCount,
      ipClients: ipCount + 1,
    });

    // Send current state immediately so the client has a baseline
    const state = this.markets.get(debateId);
    if (state) {
      this.sendSSE(res, 'state', state);
    }

    // Clean up on disconnect
    res.on('close', () => {
      this.removeSSEClient(debateId, client);
    });

    return true;
  }

  /**
   * Remove an SSE client and decrement both global and per-IP counters.
   */
  private removeSSEClient(debateId: string, client: SSEClient): void {
    const debateList = this.clients.get(debateId);
    if (debateList) {
      const idx = debateList.indexOf(client);
      if (idx !== -1) {
        debateList.splice(idx, 1);
        this.clientCount--;

        // Decrement per-IP counter
        const ipCount = this.clientsByIp.get(client.clientIp) ?? 1;
        if (ipCount <= 1) {
          this.clientsByIp.delete(client.clientIp);
        } else {
          this.clientsByIp.set(client.clientIp, ipCount - 1);
        }
      }
      if (!debateList.length) {
        this.clients.delete(debateId);
      }
    }
    logger.debug('DebateService: SSE client disconnected', {
      debateId,
      totalClients: this.clientCount,
    });
  }

  // ========================================================================
  // Position Tree API
  // ========================================================================

  /**
   * Get the current position Merkle root for a debate.
   *
   * Returns null if the debate has no revealed positions yet (tree not created).
   * The returned root is the value that should be stored on-chain as the
   * positionRoot after the latest epoch execution.
   *
   * @param debateId - Debate identifier (hex string with 0x prefix)
   * @returns - Current Merkle root as bigint, or null if no tree exists
   */
  async getPositionRoot(debateId: string): Promise<bigint | null> {
    const tree = this.positionTrees.get(debateId);
    if (!tree) return null;
    return tree.getRoot();
  }

  /**
   * Get a Merkle inclusion proof for a position in a debate's tree.
   *
   * Returns null if the debate has no position tree or the index is out of range.
   * The returned proof is ready to pass to the position_note Noir prover.
   *
   * @param debateId - Debate identifier (hex string with 0x prefix)
   * @param index - Zero-based leaf index of the position to prove
   * @returns - PositionMerkleProof, or null if not found
   */
  async getPositionProof(debateId: string, index: number): Promise<PositionMerkleProof | null> {
    const tree = this.positionTrees.get(debateId);
    if (!tree) return null;
    if (index < 0 || index >= tree.getLeafCount()) return null;
    return tree.getProof(index);
  }

  /**
   * R66-F7: Return number of failed position tree insertions for a debate.
   * Non-zero means the tree is incomplete — proofs from it may fail on-chain verification.
   */
  getPositionTreeGapCount(debateId: string): number {
    return this.positionTreeGaps.get(debateId) ?? 0;
  }

  /**
   * Get the number of positions recorded for a debate.
   *
   * @param debateId - Debate identifier
   * @returns - Leaf count, or 0 if no tree exists
   */
  getPositionCount(debateId: string): number {
    return this.positionTrees.get(debateId)?.getLeafCount() ?? 0;
  }

  // ========================================================================
  // Internal: Event Processing
  // ========================================================================

  private processEvent(event: AnyDebateEvent): void {
    let state = this.markets.get(event.debateId);
    if (!state) {
      state = {
        debateId: event.debateId,
        epoch: 0,
        epochPhase: 'unknown',
        epochSecondsRemaining: 0,
        prices: {},
        argumentCount: 0,
        totalStake: '0',
        uniqueParticipants: 0,
        pendingCommits: 0,
        lastUpdated: event.timestamp,
      };
      this.markets.set(event.debateId, state);
    }

    switch (event.type) {
      case 'TradeCommitted': {
        state.pendingCommits++;
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'trade_activity', {
          debateId: event.debateId,
          epoch: event.epoch,
          pendingCommits: state.pendingCommits,
          timestamp: event.timestamp,
        } satisfies SSETradeActivity);
        break;
      }

      case 'TradeRevealed': {
        state.lastUpdated = event.timestamp;
        break;
      }

      case 'PositionCommitted': {
        // The contract emits the actual noteCommitment in PositionCommitted events.
        // Insert it verbatim into the position tree — no recomputation needed.
        // This ensures the tree matches what position_note circuit provers expect.
        const posEvent = event as PositionCommittedEvent;
        this._handlePositionCommitted(posEvent).catch((err) => {
          // R64-M3: Track gap so settlement proof generation can detect inconsistency
          const gaps = (this.positionTreeGaps.get(event.debateId) ?? 0) + 1;
          this.positionTreeGaps.set(event.debateId, gaps);
          logger.error('DebateService: failed to insert position commitment', {
            debateId: event.debateId,
            error: err instanceof Error ? err.message : String(err),
            treeGaps: gaps,
          });
        });
        break;
      }

      case 'EpochExecuted': {
        // After epoch executes, on-chain prices changed but we don't have RPC access.
        // Signal staleness so clients refetch via the JSON endpoint. Fresh prices
        // will arrive via updatePrices() once the chain scanner or API server
        // queries the contract and pushes them in.
        state.epoch = event.epoch + 1;
        state.pendingCommits = 0;
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'epoch_executed', {
          debateId: event.debateId,
          epoch: state.epoch,
          pricesStale: true,
          timestamp: event.timestamp,
        });
        break;
      }

      case 'DebateResolved': {
        const resolved = event as DebateResolvedEvent;
        state.uniqueParticipants = resolved.uniqueParticipants;
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'resolved', {
          debateId: event.debateId,
          winningArgumentIndex: resolved.winningArgumentIndex,
          winningStance: resolved.winningStance,
          winningScore: resolved.winningScore,
          uniqueParticipants: resolved.uniqueParticipants,
          timestamp: event.timestamp,
        });
        this.cleanupDebate(event.debateId);
        break;
      }

      case 'DebateProposed': {
        const proposed = event as DebateProposedEvent;
        // Initialize a fresh market entry for the new debate
        state.epoch = 0;
        state.epochPhase = 'commit';
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'debate_proposed', {
          debateId: event.debateId,
          actionDomain: proposed.actionDomain,
          propositionHash: proposed.propositionHash,
          deadline: proposed.deadline,
          baseDomain: proposed.baseDomain,
          timestamp: event.timestamp,
        });
        break;
      }

      case 'ArgumentSubmitted': {
        const arg = event as ArgumentSubmittedEvent;
        state.argumentCount = Math.max(state.argumentCount, arg.argumentIndex + 1);
        state.lastUpdated = event.timestamp;
        // Finding 7: record stance so resolution events can look it up
        if (!this.argumentStances.has(event.debateId)) {
          this.argumentStances.set(event.debateId, new Map());
        }
        // R50-C1: Defensive optional chaining (cleanupDebate can delete stances mid-batch)
        this.argumentStances.get(event.debateId)?.set(arg.argumentIndex, arg.stance);
        this.emitToDebate(event.debateId, 'argument_submitted', {
          debateId: event.debateId,
          argumentIndex: arg.argumentIndex,
          stance: arg.stance,
          bodyHash: arg.bodyHash,
          engagementTier: arg.engagementTier,
          weight: arg.weight,
          timestamp: event.timestamp,
        });
        break;
      }

      case 'SettlementClaimed': {
        const settlement = event as SettlementClaimedEvent;
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'settlement_claimed', {
          debateId: event.debateId,
          nullifier: settlement.nullifier,
          payout: settlement.payout,
          recipient: settlement.recipient,
          timestamp: event.timestamp,
        });
        break;
      }

      case 'AIEvaluationSubmitted': {
        const aiEval = event as AIEvaluationSubmittedEvent;
        state.lastUpdated = event.timestamp;
        this.emitToDebate(event.debateId, 'ai_evaluation_submitted', {
          debateId: event.debateId,
          signatureCount: aiEval.signatureCount,
          nonce: aiEval.nonce,
          timestamp: event.timestamp,
        });
        break;
      }

      case 'DebateResolvedWithAI': {
        const aiResolved = event as DebateResolvedWithAIEvent;
        state.lastUpdated = event.timestamp;
        // Finding 7: derive winningStance from the stance index recorded when
        // ArgumentSubmitted fired for the winning argument. The contract emits
        // DebateResolvedWithAI only after all ArgumentSubmitted events, so the
        // map is always populated by the time we reach this branch.
        const winningStance =
          this.argumentStances.get(event.debateId)?.get(aiResolved.winningArgumentIndex) ?? null;
        this.emitToDebate(event.debateId, 'resolved_with_ai', {
          debateId: event.debateId,
          winningArgumentIndex: aiResolved.winningArgumentIndex,
          winningStance,
          aiScore: aiResolved.aiScore,
          communityScore: aiResolved.communityScore,
          finalScore: aiResolved.finalScore,
          resolutionMethod: aiResolved.resolutionMethod,
          timestamp: event.timestamp,
        });
        this.cleanupDebate(event.debateId);
        break;
      }
    }
  }

  // ========================================================================
  // Internal: Position Tree Helpers
  // ========================================================================

  /**
   * Serialize position commitment insertions per debate (R7-C1).
   *
   * PositionTreeBuilder.insertCommitment() is not thread-safe. Because
   * processEvent fires this method as fire-and-forget, two PositionCommitted
   * events in the same batch would race on the tree. We chain each insertion
   * behind the previous one for the same debateId so they execute serially
   * without blocking the synchronous processEvent loop.
   *
   * @param event - PositionCommitted event from the chain scanner
   * @returns - Promise that resolves when THIS insertion completes
   */
  private _handlePositionCommitted(event: PositionCommittedEvent): Promise<void> {
    const prevLock = this.insertionLocks.get(event.debateId) ?? Promise.resolve();
    const nextLock = prevLock.then(() => this._doInsertCommitment(event));
    // Store the chain tail — swallow rejections so a failed insertion
    // does not permanently block subsequent insertions for this debate.
    this.insertionLocks.set(event.debateId, nextLock.catch(() => {}));
    return nextLock;
  }

  /**
   * Perform the actual position commitment insertion.
   *
   * The contract emits the actual noteCommitment hash (Poseidon2 of argumentIndex,
   * weightedAmount, randomness with DOMAIN_POS_COMMIT). We insert this verbatim
   * rather than recomputing — the randomness is the trader's secret and never
   * appears in on-chain events. This ensures the tree matches what position_note
   * circuit provers expect for settlement proof generation.
   *
   * @param event - PositionCommitted event from the chain scanner
   */
  private async _doInsertCommitment(event: PositionCommittedEvent): Promise<void> {
    // R8-L1: Guard against resurrection after cleanupDebate().
    // If an async insertion completes after the debate was resolved and cleaned up,
    // creating a new tree would orphan ~16MB of state. Check market presence as
    // the authoritative "debate is active" signal.
    if (!this.markets.has(event.debateId)) {
      logger.warn('DebateService: skipping position insert for cleaned-up debate', {
        debateId: event.debateId,
      });
      return;
    }

    let tree = this.positionTrees.get(event.debateId);
    if (!tree) {
      tree = new PositionTreeBuilder(20);
      this.positionTrees.set(event.debateId, tree);
    }

    const commitment = BigInt(event.noteCommitment);
    const leafIndex = await tree.insertCommitment(commitment);

    logger.debug('DebateService: position commitment inserted', {
      debateId: event.debateId,
      leafIndex,
      argumentIndex: event.argumentIndex,
      noteCommitment: event.noteCommitment.slice(0, 18) + '...',
    });
  }

  // ========================================================================
  // Internal: SSE Helpers
  // ========================================================================

  private emitToDebate(debateId: string, eventType: string, data: unknown): void {
    const list = this.clients.get(debateId);
    if (!list) return;
    // Strip newlines from eventType to prevent SSE frame injection
    const safeType = eventType.replace(/[\r\n]/g, '');
    const payload = `event: ${safeType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of list) {
      // R33-SSE: Backpressure — skip clients whose write buffer is full
      if (client.paused) continue;
      try {
        const ok = client.res.write(payload);
        if (!ok) {
          client.paused = true;
          client.res.once('drain', () => { client.paused = false; });
        }
      } catch {
        // Client disconnected — will be cleaned up on 'close' event
      }
    }
  }

  private broadcast(data: string): void {
    for (const list of this.clients.values()) {
      for (const client of list) {
        // R33-SSE: Backpressure — skip clients whose write buffer is full
        if (client.paused) continue;
        try {
          const ok = client.res.write(data);
          if (!ok) {
            client.paused = true;
            client.res.once('drain', () => { client.paused = false; });
          }
        } catch {
          // Client disconnected
        }
      }
    }
  }

  private sendSSE(res: ServerResponse, eventType: string, data: unknown): void {
    try {
      // Strip newlines from eventType to prevent SSE frame injection
      const safeType = eventType.replace(/[\r\n]/g, '');
      const payload = `event: ${safeType}\ndata: ${JSON.stringify(data)}\n\n`;
      // R33-SSE: Backpressure — note: sendSSE is used for initial state push to
      // a single client, not via the SSEClient interface, so no paused check here.
      res.write(payload);
    } catch {
      // Client disconnected
    }
  }
}
