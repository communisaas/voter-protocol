// District membership circuit (Barretenberg / Noir)
// Mirrors Halo2 semantics with Poseidon hashing and domain-separated nullifier.

use dep::std::hash::poseidon2_permutation;

// Default depth; build pipeline rewrites this per-class (14 / 20 / 22).
global DEPTH: u32 = 14;

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

fn compute_nullifier(user_secret: Field, campaign_id: Field, authority_hash: Field, epoch_id: Field) -> Field {
    poseidon2_hash4(user_secret, campaign_id, authority_hash, epoch_id)
}

// Public inputs are marked `pub`; private witnesses remain secret.
fn main(
    merkle_root: Field,
    nullifier: Field,
    authority_hash: Field,
    epoch_id: Field,
    campaign_id: Field,
    leaf: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    user_secret: Field,
) -> pub (Field, Field, Field, Field, Field) {
    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    let computed_nullifier = compute_nullifier(user_secret, campaign_id, authority_hash, epoch_id);
    assert(computed_nullifier == nullifier);

    (merkle_root, nullifier, authority_hash, epoch_id, campaign_id)
}
