#!/bin/bash
# Debug script to test proof verification

cd "$(dirname "$0")"

echo "=== Verifier and Proof Timestamps ==="
ls -lh src/Halo2Verifier.bytecode ../packages/crypto/circuits/kzg_params/pk_k14.bin test/fixtures/proof_integration_test.json

echo ""
echo "=== Proof File Generation Time ==="
grep "generated_at" test/fixtures/proof_integration_test.json

echo ""
echo "=== Running Test with Verbose Traces ==="
forge test --match-test "test_RealProofVerifies" -vvvvv 2>&1 | grep -A 20 "ecpairing"
