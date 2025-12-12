use dep::std::hash::poseidon2_permutation;

fn main(inputs: [Field; 4]) -> pub Field {
    let out = poseidon2_permutation(inputs, 4);
    out[0]
}
