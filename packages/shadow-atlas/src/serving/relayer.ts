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
 * drained every batchIntervalMs to submit transactions sequentially
 * - Epoch keeper runs on a 60s interval and calls executeEpoch when the reveal
 * window of an active debate has closed
 * - Dead-letter array captures failed submissions; no indefinite retry
 * - Health stats exposed via getStats()
 *
 * RLP ENCODING REFERENCE (EIP-1559 type-2):
 * signing payload: 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 * maxFeePerGas, gasLimit, to, value, data, accessList])
 * signed envelope: 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 * maxFeePerGas, gasLimit, to, value, data, accessList,
 * v, r, s])
 *
 * SPEC REFERENCE: specs/STAKED-DEBATE-PROTOCOL-SPEC.md
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { logger } from '../core/utils/logger.js';
import { rlpEncode } from './rlp.js';
import type { RLPInput } from './rlp.js';
import {
  encodeCommitTrade,
  encodeRevealTrade,
  encodeExecuteEpoch,
} from './abi-encoder.js';
import type { CommitTradeParams, RevealTradeParams } from './relayer-types.js';

// ============================================================================
// Hex Parsing (R60 — consistency with chain-scanner.ts)
// ============================================================================

/** Safe hex-to-number via BigInt. Throws RangeError if value > MAX_SAFE_INTEGER. */
function safeHexToNumber(hex: string): number {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const n = BigInt('0x' + clean);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Hex value 0x${clean} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(n);
}

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

// Types extracted to relayer-types.ts to break import cycle with abi-encoder.ts
export type { CommitTradeParams, RevealTradeParams } from './relayer-types.js';

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
// RLP + ABI: imported from./rlp.js and./abi-encoder.js (extraction)
// ============================================================================

// ============================================================================
// Address Derivation
// ============================================================================

/** Derive the Ethereum address (lowercase hex with 0x prefix) from an secp256k1 private key. */
export function privateKeyToAddress(privateKey: Uint8Array): string {
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

  /** Maximum queued trades before rejecting new submissions. */
  private readonly MAX_QUEUE_SIZE = 10_000;

  // Prevents post-shutdown operations (signing with zeroed key).
  private stopped = false;

  // Monotonic JSON-RPC request ID counter (avoids collisions from Date.now())
  private rpcIdCounter = 0;

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
    this.stopped = true;

    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.epochTimer) {
      clearInterval(this.epochTimer);
      this.epochTimer = null;
    }

    // Zeroize private key material on shutdown.
    // Prevents key recovery from process memory dumps or core files.
    this.privateKeyBytes.fill(0);

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
    if (this.stopped) {
      throw new Error('DebateRelayer: cannot queue trades after stop()');
    }
    if (this.tradeQueue.length >= this.MAX_QUEUE_SIZE) {
      logger.warn('DebateRelayer: trade queue full, rejecting submission', {
        queueDepth: this.tradeQueue.length,
        maxQueueSize: this.MAX_QUEUE_SIZE,
      });
      throw new Error('Trade queue is full — try again later');
    }
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
    // Propagate stopped guard from queueCommitTrade.
    if (this.stopped) {
      throw new Error('DebateRelayer: cannot queue trades after stop()');
    }
    if (this.tradeQueue.length >= this.MAX_QUEUE_SIZE) {
      logger.warn('DebateRelayer: trade queue full, rejecting submission', {
        queueDepth: this.tradeQueue.length,
        maxQueueSize: this.MAX_QUEUE_SIZE,
      });
      throw new Error('Trade queue is full — try again later');
    }
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
    // Validate epoch parameters.
    if (!Number.isFinite(epochStartTime) || epochStartTime < 0) {
      throw new Error(`DebateRelayer: invalid epochStartTime: ${epochStartTime}`);
    }
    if (!Number.isInteger(currentEpoch) || currentEpoch < 0) {
      throw new Error(`DebateRelayer: invalid currentEpoch: ${currentEpoch}`);
    }
    const maxFutureSeconds = 365 * 24 * 3600;
    if (epochStartTime > Math.floor(Date.now() / 1000) + maxFutureSeconds) {
      throw new Error(`DebateRelayer: epochStartTime too far in future: ${epochStartTime}`);
    }

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

    try {
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
    } catch (err) {
      throw err;
    }
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
      if (epochsMissed > 0) {
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
          // R22-H3: Log as warning, not info — a revert may indicate a real problem
          // (OOG, access control, bad calldata) rather than the benign cases
          // (EpochAlreadyExecuted, NoRevealsToExecute). We still mark epoch done to
          // avoid infinite retry loops, but the warning severity ensures operator visibility.
          logger.warn('DebateRelayer: executeEpoch reverted on-chain', {
            debateId: state.debateId,
            epoch: state.currentEpoch,
            txHash,
            gasUsed: receipt.gasUsed.toString(),
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
   * replaces the first. The lock ensures that nonce fetch + sign + broadcast is
   * atomic from the perspective of this process.
   */
  private submitTx(to: string, data: string, value: bigint = 0n): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.txLock = this.txLock.catch(() => {}).then(async () => {
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
    // Reject operations after shutdown to prevent signing with zeroed key.
    if (this.stopped) {
      throw new Error('DebateRelayer: cannot submit transaction after stop()');
    }

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

    // Assert recovery parameter exists — BigInt(undefined) would crash.
    if (sig.recovery === undefined) {
      throw new Error('secp256k1.sign did not return recovery parameter');
    }

    // EIP-1559: v is the recovery bit (0 or 1), NOT 27/28
    const v = sig.recovery;
    const r = sig.r;
    const s = sig.s;

    // Convert r and s to 32-byte big-endian Uint8Arrays.
    // WARNING: do NOT refactor r/s from Uint8Array to BigInt and pass them directly
    // into RLP encoding. rlpEncode() treats bigint inputs as minimal-length integers
    // (leading zeros stripped), which would produce a malformed signature for any r
    // or s value whose most-significant byte is 0x00. Always go via the hex→bytes
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
        const blockNumber = safeHexToNumber(receipt.blockNumber);
        const gasUsed = BigInt(receipt.gasUsed);
        const status = safeHexToNumber(receipt.status);

        // Decrement in-flight counter once confirmed
        this.noncePendingCount = Math.max(0, this.noncePendingCount - 1);

        return { transactionHash: txHash, blockNumber, gasUsed, status };
      }

      await sleep(pollMs);
    }

    this.noncePendingCount = Math.max(0, this.noncePendingCount - 1);
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
    const chainNonceInt = safeHexToNumber(chainNonce);

    if (this.nonce === null) {
      // First call — initialize from chain
      this.nonce = chainNonceInt;
    } else if (chainNonceInt > this.nonce) {
      // Chain is ahead — a transaction confirmed, advance our counter
      this.nonce = chainNonceInt;
    } else if (this.nonce >= chainNonceInt + this.noncePendingCount + 5) {
      // R46-FIX: Changed > to >= to catch exact-boundary desync (5 dropped txs → nonce == chain+5)
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
  // R22-H2: Hard cap on gas limit — prevents runaway estimates from draining the wallet.
  // commitTrade/revealTrade ≈200-500K gas; executeEpoch ≈500K-2M gas. 5M is generous.
  private static readonly MAX_GAS_LIMIT = 5_000_000n;

  private async estimateGas(to: string, data: string): Promise<bigint> {
    const params = [{ from: this.address, to, data }];

    // First attempt
    try {
      const estimate = await this.rpcCall<string>('eth_estimateGas', params);
      const buffered = (BigInt(estimate) * 120n) / 100n;
      if (buffered > DebateRelayer.MAX_GAS_LIMIT) {
        logger.warn('DebateRelayer: gas estimate exceeds MAX_GAS_LIMIT, capping', {
          estimated: buffered.toString(),
          cap: DebateRelayer.MAX_GAS_LIMIT.toString(),
        });
        return DebateRelayer.MAX_GAS_LIMIT;
      }
      return buffered;
    } catch (firstErr) {
      // Retry once — some estimation failures are RPC-transient
      logger.warn('DebateRelayer: gas estimation failed, retrying once', {
        error: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });
    }

    // Wait 2s and retry
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const estimate = await this.rpcCall<string>('eth_estimateGas', params);
      const buffered = (BigInt(estimate) * 120n) / 100n;
      if (buffered > DebateRelayer.MAX_GAS_LIMIT) {
        logger.warn('DebateRelayer: gas estimate exceeds MAX_GAS_LIMIT on retry, capping', {
          estimated: buffered.toString(),
          cap: DebateRelayer.MAX_GAS_LIMIT.toString(),
        });
        return DebateRelayer.MAX_GAS_LIMIT;
      }
      return buffered;
    } catch (retryErr) {
      // Fail fast — don't waste gas on a transaction that will revert
      const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.error('DebateRelayer: gas estimation failed after retry — transaction will NOT be submitted', {
        error: message,
      });
      throw new Error(`Gas estimation failed after retry: ${message}`);
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
    } catch (err) {
      // Fallback to safe static values if the RPC call fails
      logger.warn('DebateRelayer: eth_gasPrice failed, using fallback', { error: err instanceof Error ? err.message : String(err) });
      // Use configured maxGasPrice instead of hardcoded 1 gwei.
      return {
        maxFeePerGas: this.config.maxGasPrice,
        maxPriorityFeePerGas: 100_000n,
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
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.rpcIdCounter, method, params }),
      signal: AbortSignal.timeout(30_000),
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

    // R43-FIX: Guard against RPC responses with no result field (returns undefined as T).
    // Only checks undefined, not null — waitForReceipt legitimately receives null for pending txs.
    if (json.result === undefined) {
      throw new Error(`RPC returned no result for method ${method}`);
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
