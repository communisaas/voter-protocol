/**
 * Deterministic street→shard hash — SEAM-CONTRACT v2 §1.
 *
 * Oversized ZIP5 chunks (serialized bytes > CHUNK_P95_LIMIT_BYTES) are split
 * into N shard files. Both the producer (this file, assigning each street to
 * a shard at emit time) and the consumer (the identical copy of this file,
 * computing which shard to fetch at resolve time) must land on the SAME
 * shard index for the SAME normalized street key — the split is invisible to
 * correctness only if the hash is byte-identical on both sides of the seam.
 *
 * Algorithm: FNV-1a, 32-bit, over the (already §3 normalized) street key's
 * UTF-16 code units — see fnv1a32 below for why that coincides with UTF-8
 * bytes for every real input here. Chosen over a cryptographic hash (sha256,
 * already used elsewhere in this contract for content-addressing) because
 * this function runs in the hot path on BOTH sides: once per street during
 * producer chunk assembly (potentially millions of streets in a national
 * build) and once per resolve in a Cloudflare Worker on the consumer side,
 * where an extra async WebCrypto digest per address lookup is pure latency
 * with no security property to buy — the shard index is a load-balancing
 * seam, not a commitment. FNV-1a is synchronous, allocation-free, and trivial
 * to keep bit-for-bit identical in plain TypeScript on both sides (32-bit
 * unsigned arithmetic only, no platform crypto primitives to drift).
 *
 * Test vectors: `shared-vectors/stable-street-shard.vectors.json` is
 * generated once and committed BYTE-IDENTICAL in both repos (voter-protocol
 * and commons); each side's tests assert this module's output against that
 * file, so any accidental edit to the algorithm on either side fails loudly
 * as a vector mismatch instead of silently routing resolves to the wrong
 * shard file.
 */

/**
 * FNV-1a 32-bit hash of a UTF-16 string, taken code-unit-by-code-unit (NOT
 * UTF-8 byte-by-byte). Normalized street keys are pure ASCII by construction
 * (§3 step 1 uppercases and strips combining marks), so UTF-16 code units and
 * UTF-8 bytes coincide for every real input — this is a plain, dependency-free
 * 32-bit computation identical on both sides regardless of JS engine.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime (32-bit)
  }
  return hash >>> 0; // unsigned 32-bit
}

/**
 * Deterministic shard assignment for one normalized street key. `shards`
 * must be a positive integer (the emitted stub's `shards` field); callers on
 * both sides pass the SAME `shards` value that the stub published.
 */
export function stableStreetShard(normalizedStreetKey: string, shards: number): number {
  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error(`stableStreetShard: shards must be a positive integer, got ${String(shards)}`);
  }
  if (shards === 1) return 0;
  return fnv1a32(normalizedStreetKey) % shards;
}
