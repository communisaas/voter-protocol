use dep::std::hash::poseidon2_permutation;

// Returns all 4 elements of the permutation state (not just state[0])
// This is needed for implementing the sponge construction in TypeScript
fn main(inputs: [Field; 4]) -> pub [Field; 4] {
    poseidon2_permutation(inputs, 4)
}
