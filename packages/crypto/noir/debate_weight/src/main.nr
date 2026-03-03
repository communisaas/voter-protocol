// Debate Weight Circuit (Barretenberg / Noir)
//
// Proves that a debater's weighted influence amount is correctly derived from
// their private stake and engagement tier, and binds the result to a note
// commitment without revealing stake or tier individually.
//
// FORMULA:
//   weightedAmount = floor(sqrt(stakeAmount)) * 2^tier
//
// This implements quadratic funding mechanics (Gitcoin-style sqrt) weighted
// by engagement tier, enabling private position trading in the debate market.
//
// SECURITY:
// - Stake is kept private: only weightedAmount is revealed on-chain
// - Tier is kept private: only used in the weighting formula
// - Note commitment binds the position: H3(stake, tier, randomness)
// - u64 arithmetic is safe: max USDC stake = 100_000_000 ($100) << 2^64
// - BA-007 pattern: tier range-checked through u64 before u8 cast to prevent
//   truncation attacks (e.g. 256+3 = 259 would silently truncate to 3 as u8)
// - sqrt_stake is a private witness: prover computes floor(sqrt(stake)) off-
//   circuit, and the circuit verifies root_u64^2 <= stake < (root_u64+1)^2
//
// PUBLIC INPUTS (visible on-chain):
//   weighted_amount  --influence weight for this position
//   note_commitment  --Poseidon2 commitment binding stake, tier, randomness
//
// PRIVATE INPUTS (witnesses):
//   stake            --USDC stake amount (6 decimals, max 100_000_000 = $100)
//   sqrt_stake       --floor(sqrt(stake)), computed by prover off-circuit
//   tier             --engagement tier [1, 4] (tier 0 rejected by DebateMarket)
//   randomness       --128-bit entropy for note commitment

use dep::std::hash::poseidon2_permutation;

// ===============================================================================
// CONSTANTS
// ===============================================================================

// Hash-1 Marker ('H1M') -- single-input hash domain separation. Must match poseidon2.ts DOMAIN_HASH1.
global DOMAIN_HASH1: Field = 0x48314d;

// BA-003: Domain separation tag for 3-input hash.
// Matches three_tree_membership circuit: global DOMAIN_HASH3: Field = 0x48334d;
// Value: 0x48334d = "H3M" (Hash-3 Marker)
// MUST match poseidon2.ts DOMAIN_HASH3 for cross-language parity.
global DOMAIN_HASH3: Field = 0x48334d;

// Valid engagement tier bounds for debate market (tier 0 rejected by contract)
global MIN_DEBATE_TIER: Field = 1;
global MAX_DEBATE_TIER: Field = 4;

// ===============================================================================
// HASH FUNCTIONS
// ===============================================================================

/// Domain-separated 3-input Poseidon2 hash.
/// State layout: [a, b, c, DOMAIN_HASH3]
/// Used for: note_commitment = H3(stake, tier, randomness)
///
/// CROSS-CIRCUIT PARITY: Must match poseidon2_hash3 in three_tree_membership
/// and Poseidon2Hasher.hash3() in poseidon2.ts.
fn poseidon2_hash3(a: Field, b: Field, c: Field) -> Field {
    let state: [Field; 4] = [a, b, c, DOMAIN_HASH3];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

// ===============================================================================
// VALIDATION
// ===============================================================================

/// Validates that tier is within the valid debate range [1, 4].
///
/// SECURITY (BA-007): Cast through u64 first to detect values >= 256 that
/// would silently truncate when cast to u8 (e.g., 259 = 256 + 3 would
/// become 3 as u8, bypassing the minimum check for tier 0).
fn validate_debate_tier(tier: Field) {
    // BA-007: Ensure value fits in u8 range before casting to prevent truncation.
    assert(tier as u64 < 256, "Debate tier exceeds u8 range");
    let tier_u8 = tier as u8;
    assert(tier_u8 >= MIN_DEBATE_TIER as u8, "Debate tier must be >= 1 (tier 0 rejected by DebateMarket)");
    assert(tier_u8 <= MAX_DEBATE_TIER as u8, "Debate tier must be <= 4");
}

// ===============================================================================
// MAIN CIRCUIT
// ===============================================================================

/// Debate weight circuit --proves:
///   1. stake > 0
///   2. tier in [1, 4]
///   3. sqrt_stake = floor(sqrt(stake))  [via u64 inequality constraints]
///   4. weighted_amount = floor(sqrt(stake)) * 2^tier
///   5. note_commitment = H3(stake, tier, randomness)
///
/// PUBLIC INPUTS (on-chain, contract-controlled):
///   weighted_amount  --The computed influence weight
///   note_commitment  --Poseidon2 commitment to the position
///
/// PRIVATE INPUTS (witnesses, never revealed):
///   stake            --USDC stake amount (6 decimals, max $100 = 100_000_000)
///   sqrt_stake       --floor(sqrt(stake)), provided by prover, verified in-circuit
///   tier             --Engagement tier [1, 4]
///   randomness       --128-bit entropy for note commitment
fn main(
    // Private inputs (witnesses)
    stake: Field,
    sqrt_stake: Field,
    tier: Field,
    randomness: Field,
    // Public inputs
    weighted_amount: pub Field,
    note_commitment: pub Field,
) {
    // =========================================================================
    // STEP 1: Validate stake range [1, MAX_STAKE]
    // Defense-in-depth: enforce $100 cap in-circuit, not just in TS prover.
    // This guarantees (root+1)^2 stays well within u64 range for Step 3.
    // =========================================================================
    assert(stake != 0, "stake must be non-zero");
    assert(stake as u64 <= 100_000_000, "stake exceeds $100 maximum (100_000_000 USDC units)");

    // =========================================================================
    // STEP 2: Range-check tier [1, 4]
    // BA-007: validate through u64 then u8 to prevent truncation attacks
    // =========================================================================
    validate_debate_tier(tier);

    // =========================================================================
    // STEP 3: Prove sqrt_stake = floor(sqrt(stake)) via u64 arithmetic
    //
    // Safety: USDC amounts (max $100 = 100_000_000) fit in u64.
    //   max root_u64 = 10_000 (floor(sqrt(100_000_000)))
    //   (10_001)^2 = 100_020_001, well within u64 range (2^64 ~ 1.8 * 10^19)
    //
    // Constraints: root^2 <= stake AND (root+1)^2 > stake
    //   Together these uniquely determine floor(sqrt(stake)).
    // =========================================================================
    let stake_u64 = stake as u64;
    let root_u64 = sqrt_stake as u64;

    // Lower bound: root^2 <= stake
    assert(root_u64 * root_u64 <= stake_u64, "sqrt_stake^2 must be <= stake");

    // Upper bound: (root+1)^2 > stake
    assert((root_u64 + 1) * (root_u64 + 1) > stake_u64, "(sqrt_stake+1)^2 must be > stake");

    // =========================================================================
    // STEP 4: Compute weighted_amount = floor(sqrt(stake)) * 2^tier
    //
    // tier is in [1, 4], so 2^tier is in {2, 4, 8, 16}.
    // tier_u64 pattern: cast tier through u64 (matching BA-007 pattern in
    // three_tree_membership.nr: `let tier_u64 = engagement_tier as u64`)
    // =========================================================================
    let tier_u64 = tier as u64;
    let multiplier = 1u64 << tier_u64;
    let computed_weight = root_u64 * multiplier;

    // =========================================================================
    // STEP 5: Assert computed weight matches the public input
    // =========================================================================
    assert(computed_weight as Field == weighted_amount, "weighted amount mismatch");

    // =========================================================================
    // STEP 6: Compute note_commitment = H3(stake, tier, randomness)
    //
    // Uses domain-separated H3 (DOMAIN_HASH3 = 0x48334d = "H3M").
    // Must match Poseidon2Hasher.hash3(stake, tier, randomness) in TypeScript.
    // This binds the position to the exact stake and tier without revealing them.
    // =========================================================================
    let computed_note = poseidon2_hash3(stake, tier, randomness);
    assert(computed_note == note_commitment, "note commitment mismatch");
}

// ===============================================================================
// TESTS
// ===============================================================================

#[test]
fn test_hash3_deterministic() {
    // Verify poseidon2_hash3 produces consistent output for same inputs
    let a: Field = 25_000_000;  // $25 USDC
    let b: Field = 3;           // tier 3
    let c: Field = 12345;       // randomness

    let result1 = poseidon2_hash3(a, b, c);
    let result2 = poseidon2_hash3(a, b, c);
    assert(result1 == result2, "hash3 must be deterministic");

    // Input order must matter
    let result3 = poseidon2_hash3(c, b, a);
    assert(result1 != result3, "hash3 input order must matter");

    // Non-zero output for non-zero inputs
    assert(result1 != 0, "hash3 should produce non-zero output");
}

#[test]
fn test_hash3_domain_separation() {
    // H3 with DOMAIN_HASH3 must not collide with a different permutation
    // (guards cross-arity hash collision --BA-003)
    let a: Field = 7;
    let b: Field = 13;
    let c: Field = 99;

    let h3 = poseidon2_hash3(a, b, c);
    // Different inputs must produce different output
    let h3b = poseidon2_hash3(a, b, 0);
    assert(h3 != h3b, "hash3 with different third input must differ");

    assert(h3 != 0, "hash3 must be non-zero for non-zero inputs");
}

#[test]
fn test_debate_tier_validation() {
    // Valid tiers: 1 through 4
    validate_debate_tier(1);
    validate_debate_tier(2);
    validate_debate_tier(3);
    validate_debate_tier(4);
}

#[test(should_fail_with = "Debate tier must be >= 1 (tier 0 rejected by DebateMarket)")]
fn test_debate_tier_rejects_zero() {
    validate_debate_tier(0);
}

#[test(should_fail_with = "Debate tier must be <= 4")]
fn test_debate_tier_rejects_five() {
    validate_debate_tier(5);
}

#[test(should_fail_with = "Debate tier exceeds u8 range")]
fn test_debate_tier_rejects_overflow() {
    // 259 = 256 + 3, would truncate to 3 as u8 (BA-007)
    validate_debate_tier(259);
}

#[test(should_fail_with = "stake exceeds $100 maximum")]
fn test_stake_rejects_over_100usd() {
    // $101 USDC = 101_000_000 units, above $100 cap
    let stake_u64: u64 = 101_000_000;
    assert(stake_u64 <= 100_000_000, "stake exceeds $100 maximum (100_000_000 USDC units)");
}

#[test]
fn test_sqrt_constraints_perfect_square() {
    // $25 USDC: sqrt(25_000_000) = 5000 exactly
    let stake_u64: u64 = 25_000_000;
    let root_u64: u64 = 5000;

    // Lower bound: 5000^2 = 25_000_000 <= 25_000_000
    assert(root_u64 * root_u64 <= stake_u64, "lower bound failed");
    // Upper bound: 5001^2 = 25_010_001 > 25_000_000
    assert((root_u64 + 1) * (root_u64 + 1) > stake_u64, "upper bound failed");
}

#[test]
fn test_sqrt_constraints_non_perfect_square() {
    // $10 USDC: sqrt(10_000_000) = 3162.277... -> floor = 3162
    let stake_u64: u64 = 10_000_000;
    let root_u64: u64 = 3162;

    // Lower bound: 3162^2 = 9_998_244 <= 10_000_000
    assert(root_u64 * root_u64 <= stake_u64, "lower bound failed");
    // Upper bound: 3163^2 = 10_004_569 > 10_000_000
    assert((root_u64 + 1) * (root_u64 + 1) > stake_u64, "upper bound failed");
}

#[test]
fn test_weight_computation_tier3_25usd() {
    // $25 USDC, tier 3: weight = floor(sqrt(25_000_000)) * 2^3 = 5000 * 8 = 40_000
    let root_u64: u64 = 5000;
    let tier_u64: u64 = 3;
    let multiplier = 1u64 << tier_u64;  // 8
    let weight = root_u64 * multiplier; // 40_000

    assert(weight == 40_000, "weight computation failed for $25 tier 3");
}

#[test]
fn test_weight_computation_tier1_1usd() {
    // $1 USDC, tier 1: weight = floor(sqrt(1_000_000)) * 2^1 = 1000 * 2 = 2000
    let root_u64: u64 = 1000;
    let tier_u64: u64 = 1;
    let multiplier = 1u64 << tier_u64;  // 2
    let weight = root_u64 * multiplier; // 2000

    assert(weight == 2_000, "weight computation failed for $1 tier 1");
}

#[test]
fn test_weight_computation_max() {
    // $100 USDC, tier 4: weight = floor(sqrt(100_000_000)) * 2^4 = 10000 * 16 = 160_000
    let root_u64: u64 = 10_000;
    let tier_u64: u64 = 4;
    let multiplier = 1u64 << tier_u64;  // 16
    let weight = root_u64 * multiplier; // 160_000

    assert(weight == 160_000, "weight computation failed for $100 tier 4");
}
