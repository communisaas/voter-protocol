/**
 * Debate Market Relayer + Epoch Keeper
 *
 * Submits user trade transactions to the DebateMarket contract on behalf of
 * users (relayer pattern) and automatically executes epochs when their reveal
 * windows close.
 *
 * Design:
 * - Uses raw fetch() for JSON-RPC calls (no viem/ethers dependency)
 * - Uses @noble/curves/secp256k1 for signing and @noble/hashes/sha3 for keccak
 * - Implements a minimal RLP encoder for EIP-1559 (type-2) transaction signing
 * - Trade submissions are batched: incoming calls are queued in memory and
 *   drained every batchIntervalMs to submit transactions sequentially
 * - Epoch keeper runs on a 60s interval and calls executeEpoch when the reveal
 *   window of an active debate has closed
 * - Dead-letter array captures failed submissions; no indefinite retry
 * - Health stats exposed via getStats()
 *
 * RLP ENCODING REFERENCE (EIP-1559 type-2):
 *   signing payload:  0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 *                                   maxFeePerGas, gasLimit, to, value, data, accessList])
 *   signed envelope:  0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 *                                   maxFeePerGas, gasLimit, to, value, data, accessList,
 *                                   v, r, s])
 *
 * SPEC REFERENCE: specs/STAKED-DEBATE-PROTOCOL-SPEC.md
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Config + Public Types
// ============================================================================

export interface RelayerConfig {
  /** JSON-RPC endpoint URL */
  readonly rpcUrl: string;
  /** Hex private key (with or without 0x prefix) from RELAYER_PRIVATE_KEY env var */
  readonly privateKey: string;
  /** DebateMarket contract address */
  readonly debateMarketAddress: string;
  /** Chain ID: 534351 = Scroll Sepolia, 534352 = Scroll mainnet */
  readonly chainId: number;
  /** Maximum gas price guard (default: 1_000_000_000n = 1 gwei) */
  readonly maxGasPrice?: bigint;
  /** Batch window for trade queue draining in ms (default: 10_000) */
  readonly batchIntervalMs?: number;
}

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

export interface TxReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: bigint;
  status: number; // 1 = success, 0 = reverted
}

export interface RelayerStats {
  epochsExecuted: number;
  epochsFailed: number;
  tradesSubmitted: number;
  tradesFailed: number;
  /** Cumulative gas used across all confirmed transactions, serialized as decimal string for JSON safety. */
  totalGasUsed: string;
}

// Internal: config type with private key stripped out after key material is parsed
type SafeRelayerConfig = Omit<Required<RelayerConfig>, 'privateKey'>;

// ============================================================================
// Internal Types
// ============================================================================

interface QueuedCommit {
  type: 'commit';
  params: CommitTradeParams;
}

interface QueuedReveal {
  type: 'reveal';
  params: RevealTradeParams;
}

type QueuedTrade = QueuedCommit | QueuedReveal;

interface DeadLetterEntry {
  trade: QueuedTrade;
  error: string;
  failedAt: number;
}

// Represents epoch state per debate tracked by the keeper
interface DebateEpochState {
  debateId: string;
  currentEpoch: number;
  epochStartTime: number; // unix seconds when current epoch began
  lastExecutedEpoch: number;
}

// ============================================================================
// RLP Encoder
// ============================================================================

type RLPInput = Uint8Array | bigint | number | string | RLPInput[];

/**
 * Minimal RLP encoder per the Ethereum Yellow Paper spec.
 *
 * Rules:
 *   - Single byte in [0x00, 0x7f]: encoded as itself
 *   - Byte string 0–55 bytes: (0x80 + len) prefix then bytes
 *   - Byte string >55 bytes: (0xb7 + len_of_len) prefix, then BE length, then bytes
 *   - List whose total payload is 0–55 bytes: (0xc0 + payload_len) then items
 *   - List whose total payload >55 bytes: (0xf7 + len_of_len) then BE length then items
 */
function rlpEncode(input: RLPInput): Uint8Array {
  if (Array.isArray(input)) {
    const encodedItems = input.map(item => rlpEncode(item));
    const payload = concat(...encodedItems);
    return concat(rlpLengthPrefix(payload.length, 0xc0, 0xf7), payload);
  }

  // Normalise scalar inputs to Uint8Array
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (typeof input === 'bigint') {
    bytes = bigintToMinimalBytes(input);
  } else if (typeof input === 'number') {
    bytes = bigintToMinimalBytes(BigInt(input));
  } else if (typeof input === 'string') {
    // Treat as hex string (with or without 0x prefix)
    const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
    bytes = hex.length === 0 ? new Uint8Array(0) : hexToBytes(hex.length % 2 === 0 ? hex : '0' + hex);
  } else {
    bytes = new Uint8Array(0);
  }

  if (bytes.length === 1 && bytes[0] <= 0x7f) {
    // Single byte shortcut — no length prefix needed
    return bytes;
  }

  return concat(rlpLengthPrefix(bytes.length, 0x80, 0xb7), bytes);
}

/** Build the RLP length prefix for either a string or a list. */
function rlpLengthPrefix(length: number, shortBase: number, longBase: number): Uint8Array {
  if (length <= 55) {
    return new Uint8Array([shortBase + length]);
  }
  const lenBytes = numberToMinimalBytes(length);
  return new Uint8Array([longBase + lenBytes.length, ...lenBytes]);
}

/** Encode a non-negative integer as the minimum number of big-endian bytes. */
function bigintToMinimalBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return hexToBytes(hex);
}

/** Encode a non-negative JS number as the minimum number of big-endian bytes. */
function numberToMinimalBytes(value: number): number[] {
  if (value === 0) return [];
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return bytes;
}

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ============================================================================
// ABI Encoding Helpers
// ============================================================================

/** Compute keccak256 of an ASCII function signature string and return "0x" + 8 hex chars. */
function functionSelector(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig));
  return '0x' + bytesToHex(hash).slice(0, 8);
}

/** Left-pad a hex value (without 0x) to 32 bytes (64 hex chars). */
function abiPadLeft(hex: string): string {
  return hex.replace(/^0x/i, '').padStart(64, '0');
}

/**
 * Encode executeEpoch(bytes32 debateId, uint256 epoch).
 *
 * calldata = selector(4 bytes) + abi.encode(debateId, epoch)
 */
function encodeExecuteEpoch(debateId: string, epoch: number): string {
  const sel = functionSelector('executeEpoch(bytes32,uint256)');
  return sel + abiPadLeft(debateId) + abiPadLeft(epoch.toString(16));
}

/**
 * Encode a `bytes` dynamic value into its ABI tail representation:
 *   [32-byte length][data padded to next 32-byte boundary]
 *
 * Input must be a hex string (with or without 0x prefix).
 */
function encodeDynamicBytes(data: string): string {
  const hex = data.replace(/^0x/i, '');
  // Each pair of hex chars is one byte
  const byteLen = hex.length / 2;
  const lenSlot = abiPadLeft(byteLen.toString(16));
  // Pad the data to a multiple of 32 bytes (64 hex chars)
  const paddedHex = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return lenSlot + paddedHex;
}

/**
 * Encode commitTrade with the full canonical ABI for the DebateMarket contract:
 *
 *   commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)
 *
 * ABI layout (offsets are measured from byte 0 of the encoding, i.e. after the selector):
 *
 *   Head (static part, one 32-byte slot per parameter):
 *     slot  0  debateId      (bytes32, static)
 *     slot  1  commitHash    (bytes32, static)
 *     slot  2  signer        (address, left-padded, static)
 *     slot  3  offset→proof  (bytes, dynamic)
 *     slots 4–34  publicInputs[0..30]  (uint256[31], static fixed array = 31 inline slots)
 *     slot 35  verifierDepth (uint8, static)
 *     slot 36  deadline      (uint256, static)
 *     slot 37  offset→signature  (bytes, dynamic)
 *
 *   Tail (dynamic data, appended after the head):
 *     proof:     length slot + padded data
 *     signature: length slot + padded data
 *
 * The offset for each dynamic value is the byte distance from the start of the encoding
 * (slot 0) to the first byte of that value's tail entry.
 *
 * Total head size: 38 slots × 32 bytes = 1216 bytes.
 * proof offset   = 1216 (0x4c0)
 * signature offset depends on proof tail length.
 */
function encodeCommitTrade(params: CommitTradeParams): string {
  const sel = functionSelector('commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)');

  // --- Head section ---
  // Slots 0-2: fixed value types
  const headFixed0 = abiPadLeft(params.debateId);   // slot 0
  const headFixed1 = abiPadLeft(params.commitHash); // slot 1
  const headFixed2 = abiPadLeft(params.signer);     // slot 2 (address, left-padded by abiPadLeft)

  // Slot 3: offset to proof tail
  // Head = 38 slots × 32 bytes = 1216 bytes; proof is first tail entry.
  const HEAD_SLOTS = 38;
  const HEAD_BYTES = HEAD_SLOTS * 32; // 1216
  const proofOffset = HEAD_BYTES; // 1216 = 0x4c0

  const headOffset3 = abiPadLeft(proofOffset.toString(16));

  // Slots 4–34: publicInputs[0..30] inline (uint256[31] is a static fixed-size array)
  if (params.publicInputs.length !== 31) {
    throw new Error(
      `commitTrade: publicInputs must have exactly 31 elements, got ${params.publicInputs.length}`,
    );
  }
  const headPublicInputs = params.publicInputs.map(v => abiPadLeft(v)).join('');

  // Slot 35: verifierDepth (uint8)
  const headFixed35 = abiPadLeft(params.verifierDepth.toString(16));

  // Slot 36: deadline (uint256)
  const headFixed36 = abiPadLeft(params.deadline.toString(16));

  // Slot 37: offset to signature tail (comes after proof tail)
  const proofHex = params.proof.replace(/^0x/i, '');
  const proofByteLen = proofHex.length / 2;
  // Proof tail = 1 length slot (32 bytes) + padded data
  const proofTailBytes = 32 + Math.ceil(proofByteLen / 32) * 32;
  const sigOffset = HEAD_BYTES + proofTailBytes;
  const headOffset37 = abiPadLeft(sigOffset.toString(16));

  // --- Tail section ---
  const proofTail = encodeDynamicBytes(params.proof);
  const sigTail   = encodeDynamicBytes(params.signature);

  return (
    sel +
    headFixed0 +
    headFixed1 +
    headFixed2 +
    headOffset3 +
    headPublicInputs +
    headFixed35 +
    headFixed36 +
    headOffset37 +
    proofTail +
    sigTail
  );
}

/**
 * Encode revealTrade with the full canonical ABI for the DebateMarket contract:
 *
 *   revealTrade(bytes32,uint256,uint256,uint256,uint8,uint256,uint8,bytes32)
 *
 * All parameters are static value types; they pack into consecutive 32-byte slots.
 * Parameter order:
 *   debateId       bytes32
 *   epoch          uint256
 *   commitIndex    uint256
 *   argumentIndex  uint256
 *   direction      uint8   (TradeDirection enum)
 *   stakeAmount    uint256
 *   engagementTier uint8
 *   salt           bytes32
 */
function encodeRevealTrade(params: RevealTradeParams): string {
  const sel = functionSelector('revealTrade(bytes32,uint256,uint256,uint256,uint8,uint256,uint8,bytes32)');
  return (
    sel +
    abiPadLeft(params.debateId) +
    abiPadLeft(params.epoch.toString(16)) +
    abiPadLeft(params.commitIndex.toString(16)) +
    abiPadLeft(params.argumentIndex.toString(16)) +
    abiPadLeft(params.direction.toString(16)) +
    abiPadLeft(params.stakeAmount.toString(16)) +
    abiPadLeft(params.engagementTier.toString(16)) +
    abiPadLeft(params.salt)
  );
}

// ============================================================================
// Address Derivation
// ============================================================================

/** Derive the Ethereum address (checksummed hex) from an secp256k1 private key. */
function privateKeyToAddress(privateKey: Uint8Array): string {
  // Uncompressed public key: 0x04 + 64 bytes (x || y), take the 64-byte body
  const publicKey = secp256k1.getPublicKey(privateKey, false); // 65 bytes
  const pubKeyBody = publicKey.slice(1); // drop 0x04 prefix
  const addressBytes = keccak_256(pubKeyBody).slice(12); // last 20 bytes
  return '0x' + bytesToHex(addressBytes);
}

// ============================================================================
// Relayer
// ============================================================================

/** Epoch duration and phase boundaries (must match DebateMarket.sol). */
const EPOCH_DURATION_SECONDS = 300; // 5 minutes

export class DebateRelayer {
  // SafeRelayerConfig: Required<RelayerConfig> with privateKey omitted — key material
  // is held exclusively in privateKeyBytes and never stored in a string field.
  private readonly config: SafeRelayerConfig;
  private readonly privateKeyBytes: Uint8Array;
  private readonly address: string;

  // Nonce tracking
  private nonce: number | null = null;
  private noncePendingCount = 0;

  // Serialized transaction lock: chains submitTx calls so that nonce assignment
  // is strictly sequential — prevents two concurrent callers from using the same nonce.
  private txLock: Promise<void> = Promise.resolve();

  // Trade queue
  private readonly tradeQueue: QueuedTrade[] = [];
  private readonly deadLetters: DeadLetterEntry[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private epochTimer: ReturnType<typeof setInterval> | null = null;

  // Maximum dead-letter entries to retain (prevents unbounded memory growth).
  private readonly MAX_DEAD_LETTERS = 1000;

  // Per-debate epoch execution lock: prevents concurrent executeEpoch calls for
  // the same debate/epoch if the keeper loop fires while a prior call is in flight.
  private readonly epochExecuting = new Set<string>();

  // Epoch keeper state: debateId → DebateEpochState
  private readonly activeDebates = new Map<string, DebateEpochState>();

  // Health stats (totalGasUsed is serialized as decimal string in getStats() for JSON safety)
  private stats: Omit<RelayerStats, 'totalGasUsed'> & { _totalGasUsedBigInt: bigint } = {
    epochsExecuted: 0,
    epochsFailed: 0,
    tradesSubmitted: 0,
    tradesFailed: 0,
    _totalGasUsedBigInt: 0n,
  };

  private constructor(config: SafeRelayerConfig, privateKeyBytes: Uint8Array) {
    this.config = config;
    this.privateKeyBytes = privateKeyBytes;
    this.address = privateKeyToAddress(privateKeyBytes);
  }

  /**
   * Create a new DebateRelayer, deriving the wallet address from the private key.
   */
  static async create(config: RelayerConfig): Promise<DebateRelayer> {
    // Parse private key first — accept with or without 0x prefix
    const pkHex = config.privateKey.startsWith('0x')
      ? config.privateKey.slice(2)
      : config.privateKey;

    if (pkHex.length !== 64) {
      throw new Error(`Invalid private key length: expected 32 bytes (64 hex chars), got ${pkHex.length / 2}`);
    }

    const privateKeyBytes = hexToBytes(pkHex);

    // Validate the key is in the valid secp256k1 range before constructing
    try {
      secp256k1.getPublicKey(privateKeyBytes, true);
    } catch (err) {
      throw new Error(`Invalid secp256k1 private key: ${err instanceof Error ? err.message : String(err)}`);
    }

    // R-3: Strip the private key from the stored config so it is never accessible
    // via this.config — key material lives exclusively in privateKeyBytes.
    const { privateKey: _stripped, ...rest } = config;
    const safeConfig: SafeRelayerConfig = {
      rpcUrl: rest.rpcUrl,
      debateMarketAddress: rest.debateMarketAddress.toLowerCase(),
      chainId: rest.chainId,
      maxGasPrice: rest.maxGasPrice ?? 1_000_000_000n,
      batchIntervalMs: rest.batchIntervalMs ?? 10_000,
    };

    const relayer = new DebateRelayer(safeConfig, privateKeyBytes);

    logger.info('DebateRelayer: created', {
      address: relayer.address,
      chainId: safeConfig.chainId,
      debateMarket: safeConfig.debateMarketAddress,
      maxGasPrice: safeConfig.maxGasPrice.toString(),
      batchIntervalMs: safeConfig.batchIntervalMs,
    });

    return relayer;
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Start the trade batch processor and epoch keeper timers.
   */
  start(): void {
    if (this.batchTimer !== null) return; // already running

    // Batch timer: drain trade queue every batchIntervalMs
    this.batchTimer = setInterval(() => {
      this.drainTradeQueue().catch(err => {
        logger.error('DebateRelayer: drainTradeQueue error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.batchIntervalMs);

    // Epoch keeper: check for executable epochs every 60s
    this.epochTimer = setInterval(() => {
      this.epochKeeperLoop().catch(err => {
        logger.error('DebateRelayer: epochKeeperLoop error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 60_000);

    logger.info('DebateRelayer: started batch processor + epoch keeper', {
      address: this.address,
    });
  }

  /**
   * Stop all timers. Transactions already in flight continue to completion.
   */
  stop(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.epochTimer) {
      clearInterval(this.epochTimer);
      this.epochTimer = null;
    }

    logger.info('DebateRelayer: stopped', {
      queueDepth: this.tradeQueue.length,
      deadLetters: this.deadLetters.length,
      ...this.getStats(),
    });
  }

  // ========================================================================
  // Public: Trade Queue
  // ========================================================================

  /**
   * Enqueue a commitTrade call for the next batch window.
   */
  queueCommitTrade(params: CommitTradeParams): void {
    this.tradeQueue.push({ type: 'commit', params });
    logger.debug('DebateRelayer: commit queued', {
      debateId: params.debateId,
      signer: params.signer,
      deadline: params.deadline.toString(),
      queueDepth: this.tradeQueue.length,
    });
  }

  /**
   * Enqueue a revealTrade call for the next batch window.
   */
  queueRevealTrade(params: RevealTradeParams): void {
    this.tradeQueue.push({ type: 'reveal', params });
    logger.debug('DebateRelayer: reveal queued', {
      debateId: params.debateId,
      epoch: params.epoch,
      queueDepth: this.tradeQueue.length,
    });
  }

  // ========================================================================
  // Public: Epoch Keeper Integration
  // ========================================================================

  /**
   * Register or update an active debate's epoch state.
   * Called by the serve command when the debate service receives on-chain events.
   */
  trackDebate(debateId: string, currentEpoch: number, epochStartTime: number): void {
    const existing = this.activeDebates.get(debateId);
    this.activeDebates.set(debateId, {
      debateId,
      currentEpoch,
      epochStartTime,
      lastExecutedEpoch: existing?.lastExecutedEpoch ?? -1,
    });
  }

  /**
   * Unregister a debate (e.g., after DebateResolved event).
   */
  untrackDebate(debateId: string): void {
    this.activeDebates.delete(debateId);
    logger.info('DebateRelayer: debate untracked', { debateId });
  }

  // ========================================================================
  // Public: Wallet Info + Stats
  // ========================================================================

  /** Ethereum address derived from the relayer's private key. */
  getAddress(): string {
    return this.address;
  }

  /** Current health stats snapshot. totalGasUsed is a decimal string for JSON safety. */
  getStats(): RelayerStats {
    const { _totalGasUsedBigInt, ...rest } = this.stats;
    return { ...rest, totalGasUsed: _totalGasUsedBigInt.toString(10) };
  }

  /** Dead-letter entries (for monitoring / alerting). */
  getDeadLetters(): DeadLetterEntry[] {
    return [...this.deadLetters];
  }

  // ========================================================================
  // Internal: Trade Queue Draining
  // ========================================================================

  private async drainTradeQueue(): Promise<void> {
    if (this.tradeQueue.length === 0) return;

    // Snapshot current batch and reset queue
    const batch = this.tradeQueue.splice(0, this.tradeQueue.length);

    logger.info('DebateRelayer: draining trade queue', { count: batch.length });

    for (const trade of batch) {
      try {
        await this.submitTrade(trade);
        this.stats.tradesSubmitted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('DebateRelayer: trade submission failed', {
          type: trade.type,
          debateId: trade.type === 'commit' ? trade.params.debateId : trade.params.debateId,
          error: message,
        });
        this.stats.tradesFailed++;
        // R-7: Cap dead-letter array to prevent unbounded memory growth.
        if (this.deadLetters.length >= this.MAX_DEAD_LETTERS) {
          this.deadLetters.shift(); // drop oldest entry
        }
        this.deadLetters.push({ trade, error: message, failedAt: Date.now() });
      }
    }
  }

  private async submitTrade(trade: QueuedTrade): Promise<void> {
    const calldata =
      trade.type === 'commit'
        ? encodeCommitTrade(trade.params)
        : encodeRevealTrade(trade.params);

    const txHash = await this.submitTx(this.config.debateMarketAddress, calldata);
    const receipt = await this.waitForReceipt(txHash);

    if (receipt.status !== 1) {
      throw new Error(`Transaction reverted: ${txHash}`);
    }

    this.stats._totalGasUsedBigInt += receipt.gasUsed;

    logger.info('DebateRelayer: trade submitted', {
      type: trade.type,
      debateId: trade.params.debateId,
      // epoch only present on reveal params; commit params identify by debateId+deadline
      ...(trade.type === 'reveal' ? { epoch: (trade.params as RevealTradeParams).epoch } : {}),
      txHash,
      gasUsed: receipt.gasUsed.toString(),
    });
  }

  // ========================================================================
  // Internal: Epoch Keeper
  // ========================================================================

  private async epochKeeperLoop(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const state of this.activeDebates.values()) {
      try {
        await this.checkAndExecuteEpoch(state, nowSeconds);
      } catch (err) {
        logger.error('DebateRelayer: epoch keeper check failed', {
          debateId: state.debateId,
          epoch: state.currentEpoch,
          error: err instanceof Error ? err.message : String(err),
        });
        this.stats.epochsFailed++;
      }
    }
  }

  private async checkAndExecuteEpoch(
    state: DebateEpochState,
    nowSeconds: number,
  ): Promise<void> {
    const epochElapsed = nowSeconds - state.epochStartTime;

    // Epoch is executable only after the full epoch duration has passed
    if (epochElapsed < EPOCH_DURATION_SECONDS) return;

    // Already executed this epoch
    if (state.lastExecutedEpoch >= state.currentEpoch) return;

    // R-5: Per-debate epoch execution lock — prevents a second keeper iteration
    // from submitting a duplicate executeEpoch while the first call is still in flight.
    const lockKey = `${state.debateId}:${state.currentEpoch}`;
    if (this.epochExecuting.has(lockKey)) return;
    this.epochExecuting.add(lockKey);

    try {
      // Warn if we missed epochs (elapsed > 2× epoch duration and still unexecuted)
      const epochsMissed = Math.floor(epochElapsed / EPOCH_DURATION_SECONDS) - 1;
      if (epochsMissed > 1) {
        logger.warn('DebateRelayer: epoch keeper missed epochs', {
          debateId: state.debateId,
          currentEpoch: state.currentEpoch,
          lastExecuted: state.lastExecutedEpoch,
          epochsMissed,
          epochElapsedSeconds: epochElapsed,
        });
      }

      logger.info('DebateRelayer: executing epoch', {
        debateId: state.debateId,
        epoch: state.currentEpoch,
      });

      try {
        const calldata = encodeExecuteEpoch(state.debateId, state.currentEpoch);
        const txHash = await this.submitTx(this.config.debateMarketAddress, calldata);
        const receipt = await this.waitForReceipt(txHash);

        if (receipt.status !== 1) {
          // The contract may revert with EpochAlreadyExecuted or NoRevealsToExecute —
          // both are benign from the keeper's perspective.
          logger.info('DebateRelayer: executeEpoch reverted (likely already executed or no reveals)', {
            debateId: state.debateId,
            epoch: state.currentEpoch,
            txHash,
          });
          // Mark as executed locally so we don't keep retrying this epoch
          state.lastExecutedEpoch = state.currentEpoch;
          return;
        }

        this.stats._totalGasUsedBigInt += receipt.gasUsed;
        this.stats.epochsExecuted++;
        state.lastExecutedEpoch = state.currentEpoch;

        // Optimistically advance epoch; the chain scanner will correct this on the
        // next EpochExecuted event if the epoch number differs.
        state.currentEpoch = state.currentEpoch + 1;
        state.epochStartTime = nowSeconds;

        logger.info('DebateRelayer: epoch executed', {
          debateId: state.debateId,
          epoch: state.lastExecutedEpoch,
          txHash,
          gasUsed: receipt.gasUsed.toString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Filter benign revert messages from expected contract errors
        if (
          message.includes('EpochAlreadyExecuted') ||
          message.includes('NoRevealsToExecute')
        ) {
          logger.info('DebateRelayer: epoch already executed or no reveals (skipping)', {
            debateId: state.debateId,
            epoch: state.currentEpoch,
          });
          state.lastExecutedEpoch = state.currentEpoch;
          return;
        }

        throw err;
      }
    } finally {
      // Always release the lock so future keeper iterations can retry on next epoch
      this.epochExecuting.delete(lockKey);
    }
  }

  // ========================================================================
  // Internal: Transaction Submission
  // ========================================================================

  /**
   * Serialize all transaction submissions through a promise-chain lock.
   *
   * R-4: Without this, two concurrent callers (e.g. a trade submission racing an
   * epoch execution) could both call getNonce() at the same time, receive the same
   * nonce value, and produce a collision where the second transaction silently
   * replaces the first.  The lock ensures that nonce fetch + sign + broadcast is
   * atomic from the perspective of this process.
   */
  private submitTx(to: string, data: string, value: bigint = 0n): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.txLock = this.txLock.then(async () => {
        try {
          const result = await this._submitTxImpl(to, data, value);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Build, sign, and broadcast an EIP-1559 transaction. Returns the tx hash.
   *
   * Called only through submitTx() which serializes concurrent callers.
   */
  private async _submitTxImpl(to: string, data: string, value: bigint = 0n): Promise<string> {
    const [nonce, gasPrice] = await Promise.all([
      this.getNonce(),
      this.getGasPrice(),
    ]);

    // Guard against runaway gas prices
    if (gasPrice.maxFeePerGas > this.config.maxGasPrice) {
      logger.warn('DebateRelayer: gas price exceeds maxGasPrice guard — transaction aborted', {
        maxFeePerGas: gasPrice.maxFeePerGas.toString(),
        maxGasPrice: this.config.maxGasPrice.toString(),
      });
      throw new Error(
        `Gas price ${gasPrice.maxFeePerGas} exceeds maxGasPrice guard ${this.config.maxGasPrice}`,
      );
    }

    const gasLimit = await this.estimateGas(to, data);

    // EIP-1559 transaction fields
    const chainId = BigInt(this.config.chainId);
    const txFields: RLPInput[] = [
      chainId,
      BigInt(nonce),
      gasPrice.maxPriorityFeePerGas,
      gasPrice.maxFeePerGas,
      gasLimit,
      hexToBytes(to.replace(/^0x/i, '')),      // address as bytes
      value,
      hexToBytes(data.replace(/^0x/i, '')),     // calldata as bytes
      [],                                        // empty accessList → encodes as 0xc0
    ];

    // Signing payload: 0x02 || rlp(unsigned fields)
    const rlpUnsigned = rlpEncode(txFields);
    const signingPayload = new Uint8Array(1 + rlpUnsigned.length);
    signingPayload[0] = 0x02;
    signingPayload.set(rlpUnsigned, 1);

    const msgHash = keccak_256(signingPayload);
    const sig = secp256k1.sign(msgHash, this.privateKeyBytes);

    // EIP-1559: v is the recovery bit (0 or 1), NOT 27/28
    const v = sig.recovery;
    const r = sig.r;
    const s = sig.s;

    // Convert r and s to 32-byte big-endian Uint8Arrays.
    // WARNING: do NOT refactor r/s from Uint8Array to BigInt and pass them directly
    // into RLP encoding.  rlpEncode() treats bigint inputs as minimal-length integers
    // (leading zeros stripped), which would produce a malformed signature for any r
    // or s value whose most-significant byte is 0x00.  Always go via the hex→bytes
    // path so the 32-byte width is preserved.
    const rHex = r.toString(16).padStart(64, '0');
    const sHex = s.toString(16).padStart(64, '0');
    const rBytes = hexToBytes(rHex);
    const sBytes = hexToBytes(sHex);

    // Signed envelope: 0x02 || rlp([...txFields, v, r, s])
    const signedFields: RLPInput[] = [...txFields, BigInt(v), rBytes, sBytes];
    const rlpSigned = rlpEncode(signedFields);
    const rawTx = new Uint8Array(1 + rlpSigned.length);
    rawTx[0] = 0x02;
    rawTx.set(rlpSigned, 1);

    const rawHex = '0x' + bytesToHex(rawTx);
    const txHash = await this.rpcCall<string>('eth_sendRawTransaction', [rawHex]);

    // Increment in-memory nonce so concurrent calls within the batch window
    // don't re-fetch the same nonce from the node.
    this.nonce = nonce + 1;
    this.noncePendingCount++;

    logger.debug('DebateRelayer: transaction broadcast', {
      txHash,
      nonce,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: gasPrice.maxFeePerGas.toString(),
    });

    return txHash;
  }

  /**
   * Poll eth_getTransactionReceipt until the transaction is mined.
   * Defaults to a 120s timeout with 2s polling interval.
   */
  private async waitForReceipt(txHash: string, timeoutMs = 120_000): Promise<TxReceipt> {
    const deadline = Date.now() + timeoutMs;
    const pollMs = 2_000;

    while (Date.now() < deadline) {
      const receipt = await this.rpcCall<{
        blockNumber: string;
        gasUsed: string;
        status: string;
      } | null>('eth_getTransactionReceipt', [txHash]);

      if (receipt !== null) {
        const blockNumber = parseInt(receipt.blockNumber, 16);
        const gasUsed = BigInt(receipt.gasUsed);
        const status = parseInt(receipt.status, 16);

        // Decrement in-flight counter once confirmed
        this.noncePendingCount = Math.max(0, this.noncePendingCount - 1);

        return { transactionHash: txHash, blockNumber, gasUsed, status };
      }

      await sleep(pollMs);
    }

    throw new Error(`Transaction ${txHash} not mined within ${timeoutMs}ms`);
  }

  // ========================================================================
  // Internal: Nonce + Gas
  // ========================================================================

  /**
   * Fetch the next nonce to use.
   *
   * Uses the in-memory cached nonce when available to support sequential
   * multi-transaction batches without waiting for each confirmation.
   * If nonce diverges from the chain value (desync), it resets from chain.
   */
  private async getNonce(): Promise<number> {
    const chainNonce = await this.rpcCall<string>(
      'eth_getTransactionCount',
      [this.address, 'pending'],
    );
    const chainNonceInt = parseInt(chainNonce, 16);

    if (this.nonce === null) {
      // First call — initialize from chain
      this.nonce = chainNonceInt;
    } else if (chainNonceInt > this.nonce) {
      // Chain is ahead — a transaction confirmed, advance our counter
      this.nonce = chainNonceInt;
    } else if (this.nonce > chainNonceInt + this.noncePendingCount + 5) {
      // Detected desync: our local nonce is too far ahead of chain
      logger.warn('DebateRelayer: nonce desync detected, resetting from chain', {
        localNonce: this.nonce,
        chainNonce: chainNonceInt,
        pendingCount: this.noncePendingCount,
      });
      this.nonce = chainNonceInt;
      this.noncePendingCount = 0;
    }

    return this.nonce;
  }

  /**
   * Estimate gas for a call using eth_estimateGas.
   * Adds a 20% buffer and caps to a reasonable maximum.
   */
  private async estimateGas(to: string, data: string): Promise<bigint> {
    try {
      const estimate = await this.rpcCall<string>('eth_estimateGas', [{
        from: this.address,
        to,
        data,
      }]);
      // Add 20% buffer to avoid edge-case out-of-gas failures
      return (BigInt(estimate) * 120n) / 100n;
    } catch (err) {
      // Estimation failed (transaction will likely revert) — use a safe fallback
      // so we can still submit and get a receipt with the revert reason.
      logger.warn('DebateRelayer: gas estimation failed, using fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 300_000n;
    }
  }

  /**
   * Get current EIP-1559 gas prices.
   *
   * Scroll L2 fees are very low (~0.01 gwei base fee).
   * We set conservative values that keep costs predictable.
   */
  private async getGasPrice(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    try {
      const baseFeeHex = await this.rpcCall<string>('eth_gasPrice', []);
      const baseFee = BigInt(baseFeeHex);

      // maxPriorityFeePerGas: 0.0001 gwei (generous for Scroll L2)
      const maxPriorityFeePerGas = 100_000n;

      // maxFeePerGas: 2× current base fee + priority fee, capped at 1 gwei
      const computed = baseFee * 2n + maxPriorityFeePerGas;
      const maxFeePerGas =
        computed < this.config.maxGasPrice ? computed : this.config.maxGasPrice;

      return { maxFeePerGas, maxPriorityFeePerGas };
    } catch {
      // Fallback to safe static values if the RPC call fails
      return {
        maxFeePerGas: 1_000_000_000n,    // 1 gwei
        maxPriorityFeePerGas: 100_000n,  // 0.0001 gwei
      };
    }
  }

  // ========================================================================
  // Internal: RPC
  // ========================================================================

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as {
      result?: T;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(`RPC error: ${json.error.code} ${json.error.message}`);
    }

    return json.result as T;
  }
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
