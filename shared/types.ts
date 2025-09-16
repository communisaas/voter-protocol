/**
 * Shared TypeScript types for VOTER Protocol
 * Used by both frontend (Communiqué) and backend
 */

// ============= Action Types =============

export enum ActionType {
  CWC_MESSAGE = "cwc_message",
  DIRECT_ACTION = "direct_action", 
  CHALLENGE_MARKET = "challenge_market"
}

export interface CivicAction {
  actionType: ActionType;
  userAddress: string;
  actionData: Record<string, any>;
  signature?: string;
  timestamp: string;
}

export interface CivicActionResult {
  success: boolean;
  actionHash: string;
  rewardAmount: bigint;
  reputationUpdate: ReputationUpdate;
  txHash?: string;
  error?: string;
}

// ============= Reputation Types =============

export interface ReputationScore {
  challengeScore: number;
  civicScore: number;
  discourseScore: number;
  totalScore: number;
}

export interface ReputationUpdate extends ReputationScore {
  tier: ReputationTier;
  change: number;
}

export enum ReputationTier {
  TRUSTED = "trusted",
  ESTABLISHED = "established",
  EMERGING = "emerging",
  NOVICE = "novice",
  UNTRUSTED = "untrusted"
}

// ============= Token Types =============

export interface TokenBalance {
  voter: bigint;
  stakedVoter: bigint;
  votingPower: bigint;
  pendingRewards: bigint;
}

export interface TokenStats {
  totalSupply: bigint;
  circulatingSupply: bigint;
  stakedAmount: bigint;
  dailyMintRemaining: bigint;
}

// ============= Challenge Market Types =============

export enum ChallengeStatus {
  ACTIVE = "active",
  RESOLVED_SUPPORT = "resolved_support",
  RESOLVED_OPPOSE = "resolved_oppose",
  CANCELLED = "cancelled"
}

export interface Challenge {
  id: number;
  challenger: string;
  defender: string;
  claimHash: string;
  stake: bigint;
  supportStake: bigint;
  opposeStake: bigint;
  status: ChallengeStatus;
  createdAt: number;
  resolveBy: number;
  evidenceIPFS: string;
  qualityScore?: number;
}

export interface ChallengeStake {
  challengeId: number;
  amount: bigint;
  isSupport: boolean;
  claimed: boolean;
}

// ============= Congressional Interface Types =============

export interface CongressionalMessage {
  representative: string;
  message: string;
  district: string;
  zipCode: string;
  subject?: string;
  email?: string;
}

export interface CongressionalReceipt {
  confirmationHash: string;
  submittedAt: string;
  representative: string;
  expectedResponse: string;
}

// ============= Identity Types =============

export interface Identity {
  address: string;
  verified: boolean;
  verificationMethod: "didit" | "government_id" | "email";
  districtHash: string;
  registeredAt: number;
  isActive: boolean;
}

export interface AgentIdentity extends Identity {
  modelType: "langchain" | "autogen" | "custom";
  capabilities: string[];
  controller: string;
  isAutonomous: boolean;
}

// ============= Governance Types =============

export enum ProposalState {
  PENDING = "pending",
  ACTIVE = "active",
  CANCELED = "canceled",
  DEFEATED = "defeated",
  SUCCEEDED = "succeeded",
  QUEUED = "queued",
  EXPIRED = "expired",
  EXECUTED = "executed"
}

export interface Proposal {
  id: number;
  proposer: string;
  title: string;
  description: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
  startBlock: number;
  endBlock: number;
  state: ProposalState;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
}

export interface Vote {
  proposalId: number;
  voter: string;
  support: boolean;
  weight: bigint;
  reason?: string;
}

// ============= API Types =============

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============= WebSocket Events =============

export enum WSEventType {
  // Actions
  ACTION_SUBMITTED = "action_submitted",
  ACTION_VERIFIED = "action_verified",
  ACTION_REWARDED = "action_rewarded",
  
  // Reputation
  REPUTATION_UPDATED = "reputation_updated",
  
  // Challenges
  CHALLENGE_CREATED = "challenge_created",
  CHALLENGE_RESOLVED = "challenge_resolved",
  
  // Governance
  PROPOSAL_CREATED = "proposal_created",
  VOTE_CAST = "vote_cast",
  PROPOSAL_EXECUTED = "proposal_executed",
  
  // System
  AGENT_UPDATE = "agent_update",
  PARAMETER_CHANGED = "parameter_changed"
}

export interface WSMessage<T = any> {
  type: WSEventType;
  payload: T;
  timestamp: string;
}

// ============= Contract Addresses =============

export const CONTRACT_ADDRESSES = {
  mainnet: {
    VOTERToken: "0x0000000000000000000000000000000000000000",
    VOTERRegistry: "0x0000000000000000000000000000000000000000",
    CommuniqueCore: "0x0000000000000000000000000000000000000000",
    ChallengeMarket: "0x0000000000000000000000000000000000000000",
    StakedVOTER: "0x0000000000000000000000000000000000000000",
    IdentityRegistry: "0x0000000000000000000000000000000000000000",
    ReputationRegistry: "0x0000000000000000000000000000000000000000"
  },
  testnet: {
    VOTERToken: "0x0000000000000000000000000000000000000001",
    VOTERRegistry: "0x0000000000000000000000000000000000000002",
    CommuniqueCore: "0x0000000000000000000000000000000000000003",
    ChallengeMarket: "0x0000000000000000000000000000000000000005",
    StakedVOTER: "0x0000000000000000000000000000000000000006",
    IdentityRegistry: "0x0000000000000000000000000000000000000007",
    ReputationRegistry: "0x0000000000000000000000000000000000000008"
  }
} as const;

// ============= API Endpoints =============

export const API_ENDPOINTS = {
  base: process.env.NEXT_PUBLIC_API_URL || "https://api.communi.email",
  
  // Actions
  processAction: "/api/v1/action",
  getAction: (hash: string) => `/api/v1/action/${hash}`,
  
  // Reputation
  getReputation: (address: string) => `/api/v1/reputation/${address}`,
  updateReputation: "/api/v1/reputation/update",
  
  // Challenges
  createChallenge: "/api/v1/challenge",
  listChallenges: "/api/v1/challenges",
  
  // Tokens
  tokenStats: "/api/v1/tokens/stats",
  tokenPrice: "/api/v1/tokens/price",
  
  // Governance
  proposals: "/api/v1/governance/proposals",
  vote: "/api/v1/governance/vote",
  
  // Congressional
  sendMessage: "/api/v1/congress/message",
  
  // WebSocket
  ws: process.env.NEXT_PUBLIC_WS_URL || "wss://api.communi.email/ws"
} as const;

// ============= Utility Types =============

export type Address = `0x${string}`;

export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: bigint;
  status: boolean;
}

// ============= Error Types =============

export enum ErrorCode {
  // Authentication
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  
  // Validation
  INVALID_ACTION = "INVALID_ACTION",
  DUPLICATE_ACTION = "DUPLICATE_ACTION",
  
  // Limits
  RATE_LIMITED = "RATE_LIMITED",
  DAILY_LIMIT_EXCEEDED = "DAILY_LIMIT_EXCEEDED",
  
  // Blockchain
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  
  // System
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
}

export interface APIError {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
}