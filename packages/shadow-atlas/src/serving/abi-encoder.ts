/**
 * ABI Encoding Helpers
 *
 * Implements minimal Solidity ABI encoding for DebateMarket contract calls.
 * Extracted from relayer.ts for independent testability.
 *
 * Covers: function selectors, static/dynamic parameter encoding,
 * commitTrade, revealTrade, and executeEpoch calldata construction.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import type { CommitTradeParams, RevealTradeParams } from './relayer-types.js';

/** BN254 scalar field modulus — inputs must be < this value for valid on-chain verification. */
const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Compute keccak256 of an ASCII function signature string and return "0x" + 8 hex chars. */
export function functionSelector(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig));
  return '0x' + bytesToHex(hash).slice(0, 8);
}

/** Left-pad a hex value (without 0x) to 32 bytes (64 hex chars). */
export function abiPadLeft(hex: string): string {
  const stripped = hex.replace(/^0x/i, '');
  if (stripped.length > 64) {
    throw new Error(`abiPadLeft: value exceeds 32 bytes (${stripped.length} hex chars)`);
  }
  if (!/^[0-9a-fA-F]*$/.test(stripped)) {
    throw new Error(`abiPadLeft: value contains non-hex characters`);
  }
  return stripped.padStart(64, '0');
}

/**
 * Encode executeEpoch(bytes32 debateId, uint256 epoch).
 *
 * calldata = selector(4 bytes) + abi.encode(debateId, epoch)
 */
export function encodeExecuteEpoch(debateId: string, epoch: number): string {
  // reject empty or all-zero debateId — would encode as 0x0 on-chain
  const strippedDebateId = debateId.replace(/^0x/i, '');
  if (!strippedDebateId || /^0+$/.test(strippedDebateId)) {
    throw new Error('encodeExecuteEpoch: debateId must be non-zero');
  }
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error(`encodeExecuteEpoch: invalid epoch ${epoch}`);
  }
  const sel = functionSelector('executeEpoch(bytes32,uint256)');
  return sel + abiPadLeft(debateId) + abiPadLeft(epoch.toString(16));
}

/**
 * Encode a `bytes` dynamic value into its ABI tail representation:
 * [32-byte length][data padded to next 32-byte boundary]
 *
 * Input must be a hex string (with or without 0x prefix).
 */
export function encodeDynamicBytes(data: string): string {
  const hex = data.replace(/^0x/i, '');
  // R9-L1: Validate hex chars before encoding — non-hex data would produce
  // invalid calldata that passes silently through the rest of the pipeline.
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('encodeDynamicBytes: data contains non-hex characters');
  }
  // Left-pad odd-length hex to even length (adds leading zero nibble)
  const paddedInputHex = hex.length % 2 !== 0 ? '0' + hex : hex;
  // Each pair of hex chars is one byte
  const byteLen = paddedInputHex.length / 2;
  const lenSlot = abiPadLeft(byteLen.toString(16));
  // Pad the data to a multiple of 32 bytes (64 hex chars)
  const paddedHex = paddedInputHex.padEnd(Math.ceil(paddedInputHex.length / 64) * 64, '0');
  return lenSlot + paddedHex;
}

/**
 * Encode commitTrade with the full canonical ABI for the DebateMarket contract:
 *
 * commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)
 *
 * ABI layout (offsets are measured from byte 0 of the encoding, i.e. after the selector):
 *
 * Head (static part, one 32-byte slot per parameter):
 * slot 0 debateId (bytes32, static)
 * slot 1 commitHash (bytes32, static)
 * slot 2 signer (address, left-padded, static)
 * slot 3 offset->proof (bytes, dynamic)
 * slots 4-34 publicInputs[0..30] (uint256[31], static fixed array = 31 inline slots)
 * slot 35 verifierDepth (uint8, static)
 * slot 36 deadline (uint256, static)
 * slot 37 offset->signature (bytes, dynamic)
 *
 * Tail (dynamic data, appended after the head):
 * proof: length slot + padded data
 * signature: length slot + padded data
 *
 * The offset for each dynamic value is the byte distance from the start of the encoding
 * (slot 0) to the first byte of that value's tail entry.
 *
 * Total head size: 38 slots x 32 bytes = 1216 bytes.
 * proof offset = 1216 (0x4c0)
 * signature offset depends on proof tail length.
 */
export function encodeCommitTrade(params: CommitTradeParams): string {
  // reject empty or all-zero debateId — would encode as 0x0 on-chain
  const strippedDebateId = params.debateId.replace(/^0x/i, '');
  if (!strippedDebateId || /^0+$/.test(strippedDebateId)) {
    throw new Error('encodeCommitTrade: debateId must be non-zero');
  }

  // Reject empty proof/signature — they encode as valid zero-length
  // bytes calldata but always revert on-chain, wasting relayer gas.
  const strippedProof = params.proof.replace(/^0x/i, '');
  if (!strippedProof) {
    throw new Error('encodeCommitTrade: proof must be non-empty');
  }
  const strippedSig = params.signature.replace(/^0x/i, '');
  if (!strippedSig) {
    throw new Error('encodeCommitTrade: signature must be non-empty');
  }

  const sel = functionSelector('commitTrade(bytes32,bytes32,address,bytes,uint256[31],uint8,uint256,bytes)');

  // --- Head section ---
  // Slots 0-2: fixed value types
  const headFixed0 = abiPadLeft(params.debateId);   // slot 0
  const headFixed1 = abiPadLeft(params.commitHash); // slot 1
  // Validate signer is exactly 20 bytes (40 hex chars).
  // abiPadLeft accepts any hex ≤ 64 chars; a shorter or longer address
  // would silently produce wrong calldata (EVM reads low 20 bytes).
  const strippedSigner = params.signer.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(strippedSigner)) {
    throw new Error(`encodeCommitTrade: signer must be a 20-byte hex address, got ${strippedSigner.length / 2} bytes`);
  }
  const headFixed2 = abiPadLeft(params.signer);     // slot 2 (address, left-padded by abiPadLeft)

  // Slot 3: offset to proof tail
  // Head = 38 slots x 32 bytes = 1216 bytes; proof is first tail entry.
  const HEAD_SLOTS = 38;
  const HEAD_BYTES = HEAD_SLOTS * 32; // 1216
  const proofOffset = HEAD_BYTES; // 1216 = 0x4c0

  const headOffset3 = abiPadLeft(proofOffset.toString(16));

  // Slots 4-34: publicInputs[0..30] inline (uint256[31] is a static fixed-size array)
  if (params.publicInputs.length !== 31) {
    throw new Error(
      `commitTrade: publicInputs must have exactly 31 elements, got ${params.publicInputs.length}`,
    );
  }
  // Validate each public input is a valid BN254 field element before encoding.
  // An element >= modulus encodes as valid calldata but always reverts on-chain,
  // which wastes relayer gas.
  for (let i = 0; i < params.publicInputs.length; i++) {
    const stripped = params.publicInputs[i].replace(/^0x/i, '');
    const value = BigInt('0x' + (stripped || '0'));
    if (value >= BN254_MODULUS) {
      throw new Error(
        `commitTrade: publicInputs[${i}] is not a valid BN254 field element (>= modulus)`,
      );
    }
  }
  const headPublicInputs = params.publicInputs.map(v => abiPadLeft(v)).join('');

  // Slot 35: verifierDepth (uint8) — R4-07: range check prevents silent EVM truncation
  if (params.verifierDepth < 0 || params.verifierDepth > 255) {
    throw new Error(`commitTrade: verifierDepth must be 0-255, got ${params.verifierDepth}`);
  }
  const headFixed35 = abiPadLeft(params.verifierDepth.toString(16));

  // Slot 36: deadline (uint256)
  if (params.deadline < 0n) {
    throw new Error('commitTrade: deadline must be non-negative');
  }
  const headFixed36 = abiPadLeft(params.deadline.toString(16));

  // Slot 37: offset to signature tail (comes after proof tail)
  const proofHex = params.proof.replace(/^0x/i, '');
  // Left-pad odd-length hex to even length (adds leading zero nibble)
  const paddedProofHex = proofHex.length % 2 !== 0 ? '0' + proofHex : proofHex;
  const proofByteLen = paddedProofHex.length / 2;
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
 * revealTrade(bytes32,uint256,uint256,uint256,uint8,uint256,uint8,bytes32)
 *
 * All parameters are static value types; they pack into consecutive 32-byte slots.
 * Parameter order:
 * debateId bytes32
 * epoch uint256
 * commitIndex uint256
 * argumentIndex uint256
 * direction uint8 (TradeDirection enum)
 * stakeAmount uint256
 * engagementTier uint8
 * salt bytes32
 */
export function encodeRevealTrade(params: RevealTradeParams): string {
  // reject empty or all-zero debateId — would encode as 0x0 on-chain
  const strippedDebateId = params.debateId.replace(/^0x/i, '');
  if (!strippedDebateId || /^0+$/.test(strippedDebateId)) {
    throw new Error('encodeRevealTrade: debateId must be non-zero');
  }
  // R4-07: uint8 range checks prevent silent EVM truncation
  if (params.direction !== 0 && params.direction !== 1) {
    throw new Error(`revealTrade: direction must be 0 or 1, got ${params.direction}`);
  }
  if (params.engagementTier < 0 || params.engagementTier > 255) {
    throw new Error(`revealTrade: engagementTier must be 0-255, got ${params.engagementTier}`);
  }
  if (!Number.isInteger(params.epoch) || params.epoch < 0) {
    throw new Error(`revealTrade: invalid epoch ${params.epoch}`);
  }
  if (!Number.isInteger(params.commitIndex) || params.commitIndex < 0) {
    throw new Error(`revealTrade: invalid commitIndex ${params.commitIndex}`);
  }
  if (!Number.isInteger(params.argumentIndex) || params.argumentIndex < 0) {
    throw new Error(`revealTrade: invalid argumentIndex ${params.argumentIndex}`);
  }
  if (params.stakeAmount < 0n) {
    throw new Error(`revealTrade: stakeAmount must be non-negative, got ${params.stakeAmount}`);
  }
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
