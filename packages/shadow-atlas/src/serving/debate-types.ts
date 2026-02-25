/**
 * Debate Market Event Types and State
 *
 * Types for DebateMarket.sol on-chain events and aggregated market state.
 * Used by the chain scanner (event ingestion) and debate service (SSE streaming).
 *
 * EVENT SIGNATURES (must match DebateMarket.sol):
 *   TradeCommitted(bytes32 indexed debateId, uint256 indexed epoch, bytes32 commitHash, uint256 commitIndex)
 *   TradeRevealed(bytes32 indexed debateId, uint256 indexed epoch, uint256 argumentIndex, uint8 direction, uint256 weightedAmount)
 *   EpochExecuted(bytes32 indexed debateId, uint256 indexed epoch, uint256 tradesApplied)
 *   DebateResolved(bytes32 indexed debateId, uint256 winningArgumentIndex, uint8 winningStance, uint256 winningScore, uint256 uniqueParticipants, uint256 jurisdictionSizeHint)
 *   DebateProposed(bytes32 indexed debateId, bytes32 indexed actionDomain, bytes32 propositionHash, uint256 deadline, bytes32 baseDomain)
 *   ArgumentSubmitted(bytes32 indexed debateId, uint256 indexed argumentIndex, uint8 stance, bytes32 bodyHash, uint8 engagementTier, uint256 weight)
 *   SettlementClaimed(bytes32 indexed debateId, bytes32 nullifier, uint256 payout, address indexed recipient)
 *   AIEvaluationSubmitted(bytes32 indexed debateId, uint256 signatureCount, uint256 nonce)
 *   DebateResolvedWithAI(bytes32 indexed debateId, uint256 winningArgumentIndex, uint256 aiScore, uint256 communityScore, uint256 finalScore, uint8 resolutionMethod)
 */

// ============================================================================
// On-chain Event Types
// ============================================================================

/** Base debate market event fields */
export interface DebateMarketEvent {
  type:
    | 'TradeCommitted'
    | 'TradeRevealed'
    | 'EpochExecuted'
    | 'DebateResolved'
    | 'DebateProposed'
    | 'ArgumentSubmitted'
    | 'SettlementClaimed'
    | 'AIEvaluationSubmitted'
    | 'DebateResolvedWithAI'
    | 'PositionCommitted';
  debateId: string;
  epoch?: number;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
}

export interface TradeCommittedEvent extends DebateMarketEvent {
  type: 'TradeCommitted';
  commitHash: string;
  commitIndex: number;
  epoch: number;
}

export interface TradeRevealedEvent extends DebateMarketEvent {
  type: 'TradeRevealed';
  argumentIndex: number;
  direction: 'BUY' | 'SELL';
  weightedAmount: string;
  epoch: number;
}

export interface EpochExecutedEvent extends DebateMarketEvent {
  type: 'EpochExecuted';
  epoch: number;
  tradesApplied: number;
}

export interface DebateResolvedEvent extends DebateMarketEvent {
  type: 'DebateResolved';
  winningArgumentIndex: number;
  winningStance: 'SUPPORT' | 'OPPOSE' | 'AMEND';
  winningScore: string;
  uniqueParticipants: number;
}

export interface DebateProposedEvent extends DebateMarketEvent {
  type: 'DebateProposed';
  actionDomain: string;
  propositionHash: string;
  deadline: number;
  baseDomain: string;
}

export interface ArgumentSubmittedEvent extends DebateMarketEvent {
  type: 'ArgumentSubmitted';
  argumentIndex: number;
  stance: 'SUPPORT' | 'OPPOSE' | 'AMEND';
  bodyHash: string;
  engagementTier: number;
  weight: string;
}

export interface SettlementClaimedEvent extends DebateMarketEvent {
  type: 'SettlementClaimed';
  nullifier: string;
  payout: string;
  recipient: string;
}

export interface AIEvaluationSubmittedEvent extends DebateMarketEvent {
  type: 'AIEvaluationSubmitted';
  signatureCount: number;
  nonce: number;
}

export interface DebateResolvedWithAIEvent extends DebateMarketEvent {
  type: 'DebateResolvedWithAI';
  winningArgumentIndex: number;
  aiScore: string;
  communityScore: string;
  finalScore: string;
  resolutionMethod: number; // 0=community, 1=ai_community, 2=governance
}

export interface PositionCommittedEvent extends DebateMarketEvent {
  type: 'PositionCommitted';
  epoch: number;
  argumentIndex: number;
  weightedAmount: string;
  noteCommitment: string;
}

export type AnyDebateEvent =
  | TradeCommittedEvent
  | TradeRevealedEvent
  | EpochExecutedEvent
  | DebateResolvedEvent
  | DebateProposedEvent
  | ArgumentSubmittedEvent
  | SettlementClaimedEvent
  | AIEvaluationSubmittedEvent
  | DebateResolvedWithAIEvent
  | PositionCommittedEvent;

// ============================================================================
// Aggregated Market State
// ============================================================================

/** Current market state (aggregated from events + on-chain views) */
export interface DebateMarketState {
  debateId: string;
  epoch: number;
  epochPhase: 'commit' | 'reveal' | 'executing' | 'unknown';
  epochSecondsRemaining: number;
  prices: Record<number, string>; // argumentIndex -> price (decimal string 0-1)
  argumentCount: number;
  totalStake: string;
  uniqueParticipants: number;
  pendingCommits: number; // current epoch commit count
  lastUpdated: number;
}

// ============================================================================
// SSE Event Payloads
// ============================================================================

export interface SSEPriceUpdate {
  debateId: string;
  epoch: number;
  prices: Record<number, string>;
  timestamp: number;
}

export interface SSETradeActivity {
  debateId: string;
  epoch: number;
  pendingCommits: number;
  timestamp: number;
}

