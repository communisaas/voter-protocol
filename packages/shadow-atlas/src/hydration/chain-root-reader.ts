/**
 * Chain Root Reader
 *
 * Fetches the current snapshot root from the SnapshotAnchor contract
 * via raw JSON-RPC eth_call — no ethers/viem dependency.
 *
 * Follows the same raw-fetch pattern as chain-scanner.ts.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

// ============================================================================
// Selector computation
// ============================================================================

/**
 * Compute the 4-byte function selector for `getCurrentRoot()`.
 *
 * keccak256("getCurrentRoot()") truncated to first 4 bytes.
 * Result: "0x8270482d" (verified, computed at runtime).
 */
export function computeGetCurrentRootSelector(): string {
    const hash = keccak_256(new TextEncoder().encode('getCurrentRoot()'));
    // First 4 bytes = 8 hex chars
    return '0x' + bytesToHex(hash).slice(0, 8);
}

// ============================================================================
// JSON-RPC helper
// ============================================================================

interface RpcResponse<T> {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: { code: number; message: string };
}

let rpcIdCounter = 0;

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++rpcIdCounter,
            method,
            params,
        }),
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        return null;
    }

    const json = (await response.json()) as RpcResponse<T>;
    if (json.error || json.result === undefined || json.result === null) {
        return null;
    }
    return json.result;
}

// ============================================================================
// ABI decoding helpers
// ============================================================================

/**
 * Decode a 32-byte hex word (64 hex chars) starting at a byte offset
 * within the hex data string (which has no "0x" prefix).
 */
function readWord(data: string, wordIndex: number): string {
    const start = wordIndex * 64;
    return data.slice(start, start + 64);
}

/**
 * Decode ABI-encoded return value: (bytes32, string, uint256)
 *
 * Layout:
 *   Word 0 (offset 0):   bytes32 cellMapRoot
 *   Word 1 (offset 32):  uint256 offset to string data (= 0x60 = 96)
 *   Word 2 (offset 64):  uint256 epoch
 *   Word 3 (offset 96):  uint256 string length
 *   Word 4+ (offset 128): string bytes (padded to 32-byte boundary)
 */
function decodeGetCurrentRootReturn(
    hexData: string,
): { cellMapRoot: bigint; ipfsCid: string; epoch: number } | null {
    // Strip 0x prefix
    const data = hexData.startsWith('0x') ? hexData.slice(2) : hexData;

    // Minimum: 4 words = 256 hex chars (root + offset + epoch + string-length)
    if (data.length < 256) {
        return null;
    }

    // Word 0: bytes32 cellMapRoot
    const cellMapRoot = BigInt('0x' + readWord(data, 0));

    // Word 1: offset to string data (should be 96 = 0x60)
    // We read the offset but use it to find the string data
    const stringOffset = Number(BigInt('0x' + readWord(data, 1)));

    // Word 2: uint256 epoch
    const epochBig = BigInt('0x' + readWord(data, 2));
    if (epochBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null; // epoch too large
    }
    const epoch = Number(epochBig);

    // String data starts at stringOffset bytes into the data
    const stringStartHex = stringOffset * 2; // byte offset -> hex char offset
    if (data.length < stringStartHex + 64) {
        return null; // not enough data for string length
    }

    // String length (in bytes)
    const stringLength = Number(
        BigInt('0x' + data.slice(stringStartHex, stringStartHex + 64)),
    );
    if (stringLength === 0 || stringLength > 256) {
        // CID should be reasonable length (typically 46-59 chars)
        return null;
    }

    // String bytes
    const stringBytesStart = stringStartHex + 64;
    const stringBytesEnd = stringBytesStart + stringLength * 2;
    if (data.length < stringBytesEnd) {
        return null;
    }

    const cidHex = data.slice(stringBytesStart, stringBytesEnd);
    // Convert hex to UTF-8 string
    const cidBytes = new Uint8Array(stringLength);
    for (let i = 0; i < stringLength; i++) {
        cidBytes[i] = parseInt(cidHex.slice(i * 2, i * 2 + 2), 16);
    }
    const ipfsCid = new TextDecoder().decode(cidBytes);

    return { cellMapRoot, ipfsCid, epoch };
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Fetch the current snapshot root from the SnapshotAnchor contract.
 *
 * Makes a single `eth_call` to `getCurrentRoot()` which returns
 * `(bytes32 cellMapRoot, string ipfsCid, uint256 epoch)`.
 *
 * @param rpcUrl - JSON-RPC endpoint URL
 * @param snapshotAnchorAddress - deployed SnapshotAnchor contract address
 * @returns decoded snapshot root, or null if the call fails or returns empty
 */
export async function fetchCurrentSnapshotRoot(
    rpcUrl: string,
    snapshotAnchorAddress: string,
): Promise<{ cellMapRoot: bigint; ipfsCid: string; epoch: number } | null> {
    const selector = computeGetCurrentRootSelector();

    // eth_call with no block tag defaults to "latest"
    const result = await rpcCall<string>(rpcUrl, 'eth_call', [
        {
            to: snapshotAnchorAddress,
            data: selector,
        },
        'latest',
    ]);

    if (!result || result === '0x' || result.length < 10) {
        return null;
    }

    return decodeGetCurrentRootReturn(result);
}
