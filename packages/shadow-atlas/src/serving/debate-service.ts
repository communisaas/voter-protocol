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
  connectedAt: number;
}

// ============================================================================
// Service
// ============================================================================

export class DebateService {
  private markets = new Map<string, DebateMarketState>();
  private clients: SSEClient[] = [];
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

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
    // Send keepalive every 15s to prevent proxy timeouts
    this.keepaliveTimer = setInterval(() => {
      this.broadcast(':keepalive\n\n');
    }, 15_000);

    logger.info('DebateService: started');
  }

  /**
   * Stop the debate service and close all SSE connections.
   */
  stop(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    // Close all SSE connections
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        // Client already disconnected
      }
    }
    this.clients = [];

    logger.info('DebateService: stopped', {
      activeMarkets: this.markets.size,
    });
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
    state.lastUpdated = Date.now();
    this.emitToDebate(debateId, 'price_update', {
      debateId,
      epoch: state.epoch,
      prices,
      timestamp: Date.now(),
    } satisfies SSEPriceUpdate);
  }

  /**
   * Subscribe an SSE client to a debate's price stream.
   * Sends current state immediately as the initial event.
   */
  addSSEClient(debateId: string, res: ServerResponse): void {
    const client: SSEClient = {
      res,
      debateId,
      connectedAt: Date.now(),
    };
    this.clients.push(client);

    logger.debug('DebateService: SSE client connected', {
      debateId,
      totalClients: this.clients.length,
    });

    // Send current state immediately so the client has a baseline
    const state = this.markets.get(debateId);
    if (state) {
      this.sendSSE(res, 'state', state);
    }

    // Clean up on disconnect
    res.on('close', () => {
      this.clients = this.clients.filter(c => c !== client);
      logger.debug('DebateService: SSE client disconnected', {
        debateId,
        totalClients: this.clients.length,
      });
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
   * @returns        - Current Merkle root as bigint, or null if no tree exists
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
   * @param index    - Zero-based leaf index of the position to prove
   * @returns        - PositionMerkleProof, or null if not found
   */
  async getPositionProof(debateId: string, index: number): Promise<PositionMerkleProof | null> {
    const tree = this.positionTrees.get(debateId);
    if (!tree) return null;
    if (index < 0 || index >= tree.getLeafCount()) return null;
    return tree.getProof(index);
  }

  /**
   * Get the number of positions recorded for a debate.
   *
   * @param debateId - Debate identifier
   * @returns        - Leaf count, or 0 if no tree exists
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
          logger.error('DebateService: failed to insert position commitment', {
            debateId: event.debateId,
            error: err instanceof Error ? err.message : String(err),
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
        this.argumentStances.get(event.debateId)!.set(arg.argumentIndex, arg.stance);
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
        break;
      }
    }
  }

  // ========================================================================
  // Internal: Position Tree Helpers
  // ========================================================================

  /**
   * Insert a position commitment from a PositionCommitted event.
   *
   * The contract emits the actual noteCommitment hash (Poseidon2 of argumentIndex,
   * weightedAmount, randomness with DOMAIN_POS_COMMIT). We insert this verbatim
   * rather than recomputing — the randomness is the trader's secret and never
   * appears in on-chain events. This ensures the tree matches what position_note
   * circuit provers expect for settlement proof generation.
   *
   * @param event - PositionCommitted event from the chain scanner
   */
  private async _handlePositionCommitted(event: PositionCommittedEvent): Promise<void> {
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
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (client.debateId === debateId) {
        try {
          client.res.write(payload);
        } catch {
          // Client disconnected — will be cleaned up on 'close' event
        }
      }
    }
  }

  private broadcast(data: string): void {
    for (const client of this.clients) {
      try {
        client.res.write(data);
      } catch {
        // Client disconnected
      }
    }
  }

  private sendSSE(res: ServerResponse, eventType: string, data: unknown): void {
    try {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client disconnected
    }
  }
}
