fn main(x: Field, y: Field) -> pub Field {
    dep::std::hash::poseidon([x, y])
}
