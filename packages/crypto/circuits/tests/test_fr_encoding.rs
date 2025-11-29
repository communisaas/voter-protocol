use halo2_proofs::halo2curves::bn256::Fr;

#[test]
fn test_fr_from_bytes_encoding() {
    // Test with small value (42)
    let fr = Fr::from(42u64);

    // Convert to bytes
    let bytes = fr.to_bytes();

    println!("Fr(42) as bytes: {:02x?}", bytes);
    println!("First 8 bytes: {:02x?}", &bytes[0..8]);
    println!("Last 8 bytes: {:02x?}", &bytes[24..32]);

    // Try to parse back
    let fr2 = Fr::from_bytes(&bytes).unwrap();
    assert_eq!(fr, fr2);

    // Test hex encoding
    let hex = format!("0x{}", hex::encode(&bytes));
    println!("Fr(42) as hex: {}", hex);
}

#[test]
fn test_fr_from_u64() {
    // Test the values we're using
    let left = Fr::from(12345u64);
    let right = Fr::from(67890u64);

    println!("Fr(12345) as hex: 0x{}", hex::encode(left.to_bytes()));
    println!("Fr(67890) as hex: 0x{}", hex::encode(right.to_bytes()));
}
