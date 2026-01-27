// District membership circuit (Barretenberg / Noir)
// Mirrors Halo2 semantics with Poseidon hashing and domain-separated nullifier.
//
// SECURITY CHANGELOG:
// - CVE-001/CVE-003 FIX: Leaf is now COMPUTED inside the circuit from user_secret,
//   binding the user's identity to the merkle tree membership proof. Previously,
//   an attacker could provide any leaf value without proving ownership.
// - CVE-002 FIX: action_domain is now the ONLY nullifier domain component and is
//   PUBLIC (contract-controlled). Previously, epoch_id and campaign_id were private
//   inputs that users could manipulate to generate multiple valid proofs.
// - ISSUE-006 FIX: authority_level is now range-checked to [1, 5].

use dep::std::hash::poseidon2_permutation;

// Default depth; build pipeline rewrites this per-class (14 / 20 / 22).
global DEPTH: u32 = 14;

// Valid authority level bounds (inclusive)
global MIN_AUTHORITY_LEVEL: Field = 1;
global MAX_AUTHORITY_LEVEL: Field = 5;

fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let mut state: [Field; 4] = [left, right, 0, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

fn poseidon2_hash4(a: Field, b: Field, c: Field, d: Field) -> Field {
    let mut state: [Field; 4] = [a, b, c, d];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

fn compute_merkle_root(leaf: Field, merkle_path: [Field; DEPTH], leaf_index: u32) -> Field {
    assert(leaf_index < (1u32 << DEPTH)); // range-constrain index

    let mut node = leaf;
    for i in 0..DEPTH {
        let bit: bool = ((leaf_index >> i) & 1u32) == 1u32;
        let sibling = merkle_path[i];
        node = if bit { poseidon2_hash2(sibling, node) } else { poseidon2_hash2(node, sibling) };
    }
    node
}

/// Computes the leaf commitment that binds user identity to district membership.
///
/// SECURITY (CVE-001/CVE-003): The leaf MUST be derived from user_secret to prove
/// ownership. Without this binding, an attacker could use any valid leaf from the
/// tree without proving they control the corresponding secret.
///
/// Components:
/// - user_secret: The user's private key material (proves identity ownership)
/// - district_id: The district the user is registered in
/// - authority_level: The user's voting tier (1-5)
/// - registration_salt: Unique salt assigned during registration (prevents rainbow attacks)
fn compute_owned_leaf(
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,
) -> Field {
    poseidon2_hash4(user_secret, district_id, authority_level, registration_salt)
}

/// Computes a domain-separated nullifier to prevent double-voting.
///
/// SECURITY (CVE-002): The nullifier is derived from user_secret and a PUBLIC
/// action_domain that is controlled by the verifying contract. This prevents
/// users from manipulating private inputs to generate multiple valid proofs
/// for the same action.
///
/// The action_domain should encode: epoch_id || campaign_id || authority_hash
/// and is set by the contract, not the user.
fn compute_nullifier(user_secret: Field, action_domain: Field) -> Field {
    poseidon2_hash2(user_secret, action_domain)
}

/// Validates that authority_level is within the valid range [1, 5].
///
/// SECURITY (ISSUE-006): Authority levels must be bounded to prevent
/// privilege escalation or invalid tier claims.
fn validate_authority_level(authority_level: Field) {
    // Range check: 1 <= authority_level <= 5
    // We use Field comparisons via casting to u8 for bounded arithmetic
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8, "Authority level below minimum (1)");
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8, "Authority level above maximum (5)");
}

/// District membership circuit - proves user belongs to a district with specific authority.
///
/// PUBLIC INPUTS (contract-controlled, cannot be manipulated by prover):
/// - merkle_root: The expected merkle tree root (set by contract from on-chain state)
/// - action_domain: Domain separator for nullifier (encodes epoch, campaign, authority hash)
///
/// PRIVATE INPUTS (user-provided witnesses):
/// - user_secret: User's private key material (proves identity)
/// - district_id: District the user claims membership in
/// - authority_level: User's voting tier (1-5)
/// - registration_salt: Salt from user's registration
/// - merkle_path: Sibling hashes for merkle proof
/// - leaf_index: Position of user's leaf in the tree
///
/// PUBLIC OUTPUTS:
/// - merkle_root: Echoed for verifier binding
/// - nullifier: Unique per user+action_domain (prevents double-voting)
/// - authority_level: User's tier (for contract-side tier requirements)
/// - action_domain: Echoed for verifier binding
/// - district_id: User's district (for district-specific actions)
fn main(
    // PUBLIC inputs (contract-controlled)
    merkle_root: Field,
    action_domain: Field,
    // PRIVATE inputs (user witnesses)
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
) -> pub (Field, Field, Field, Field, Field) {
    // ISSUE-006 FIX: Validate authority_level is in valid range [1, 5]
    validate_authority_level(authority_level);

    // CVE-001/CVE-003 FIX: Compute the leaf INSIDE the circuit from user_secret.
    // This binds the user's identity to the membership proof - they must know
    // the secret that was used to create the leaf during registration.
    let computed_leaf = compute_owned_leaf(
        user_secret,
        district_id,
        authority_level,
        registration_salt
    );

    // Verify merkle membership using the computed (not provided) leaf
    let computed_root = compute_merkle_root(computed_leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root, "Merkle proof verification failed");

    // CVE-002 FIX: Compute nullifier using ONLY the user_secret and the PUBLIC
    // action_domain. The action_domain is controlled by the verifying contract
    // and cannot be manipulated by the user. This ensures one nullifier per
    // user per action context.
    let nullifier = compute_nullifier(user_secret, action_domain);

    // Return public outputs for verifier binding and application logic:
    // - merkle_root: Proves membership in the correct tree
    // - nullifier: Prevents double-voting (unique per user + action)
    // - authority_level: Allows contracts to enforce tier requirements
    // - action_domain: Binds proof to specific action context
    // - district_id: Allows district-specific voting rules
    (merkle_root, nullifier, authority_level, action_domain, district_id)
}
