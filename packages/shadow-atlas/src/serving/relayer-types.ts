/**
 * Shared types for the DebateMarket relayer subsystem.
 *
 * Extracted from relayer.ts (BR7-R3-L2) to break the conceptual
 * dependency cycle between relayer.ts and abi-encoder.ts.
 */

/** Parameters for commitTrade calldata encoding */
export interface CommitTradeParams {
  debateId: string;       // bytes32 hex
  commitHash: string;     // bytes32 hex
  signer: string;         // address hex — the user's Ethereum address
  proof: string;          // hex-encoded proof bytes from the ZK prover
  publicInputs: string[]; // 31 uint256 hex values (must be exactly 31 elements)
  verifierDepth: number;  // uint8 — Merkle depth selector for the verifier registry
  deadline: bigint;       // uint256 — unix timestamp after which the relay is void
  signature: string;      // hex-encoded EIP-712 signature bytes from the user
}

/** Parameters for revealTrade calldata encoding */
export interface RevealTradeParams {
  debateId: string;
  epoch: number;
  commitIndex: number;
  argumentIndex: number;
  direction: 0 | 1;       // 0 = BUY, 1 = SELL (TradeDirection enum → uint8)
  stakeAmount: bigint;    // uint256 — stake placed at commit time
  engagementTier: number; // uint8 — tier 0/1/2 derived from engagement tree
  salt: string;           // bytes32 hex — the random salt used in commitHash
}
