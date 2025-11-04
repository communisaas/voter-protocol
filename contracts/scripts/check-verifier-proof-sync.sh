#!/usr/bin/env bash
# Check Verifier-Proof Synchronization
#
# This script ensures the Halo2 verifier bytecode and test proofs
# are generated from the same proving key, preventing cryptographic
# mismatches that cause EC pairing failures.
#
# Usage: ./scripts/check-verifier-proof-sync.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "═══════════════════════════════════════════════════════"
echo "  Verifier-Proof Synchronization Check"
echo "═══════════════════════════════════════════════════════"
echo ""

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# File paths (absolute from project root)
VERIFIER="$PROJECT_ROOT/packages/crypto/circuits/src/bin/generate_verifier.rs"
PROVER="$PROJECT_ROOT/packages/crypto/circuits/src/prover.rs"
PK_FILE="$PROJECT_ROOT/packages/crypto/circuits/kzg_params/pk_k14.bin"
BREAKPOINTS="$PROJECT_ROOT/packages/crypto/circuits/kzg_params/pk_k14_break_points.json"
VERIFIER_BYTECODE="$PROJECT_ROOT/contracts/src/Halo2Verifier.bytecode"
PROOF_FIXTURE="$PROJECT_ROOT/contracts/test/fixtures/proof_integration_test.json"

# Check if files exist
echo "📁 Checking files..."
missing_files=0

check_file() {
    if [ ! -f "$1" ]; then
        echo -e "${RED}✗${NC} Missing: $1"
        missing_files=$((missing_files + 1))
    else
        echo -e "${GREEN}✓${NC} Found: $1"
    fi
}

check_file "$PK_FILE"
check_file "$BREAKPOINTS"
check_file "$VERIFIER_BYTECODE"
check_file "$PROOF_FIXTURE"

if [ $missing_files -gt 0 ]; then
    echo ""
    echo -e "${RED}ERROR: Missing files. Run 'cargo run --bin generate_verifier' first.${NC}"
    exit 1
fi

echo ""
echo "📊 Checking timestamps..."

# Get modification times
PK_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$PK_FILE" 2>/dev/null || stat -c "%y" "$PK_FILE" | cut -d'.' -f1)
VERIFIER_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$VERIFIER_BYTECODE" 2>/dev/null || stat -c "%y" "$VERIFIER_BYTECODE" | cut -d'.' -f1)
PROOF_TIME=$(grep "generated_at" "$PROOF_FIXTURE" | sed 's/.*: "\(.*\)".*/\1/' | sed 's/T/ /' | cut -d'+' -f1 | sed 's/\.[0-9]*//')

echo "  Proving Key:      $PK_TIME"
echo "  Verifier Bytecode: $VERIFIER_TIME"
echo "  Proof Fixture:     $PROOF_TIME"

# Check if proving key and verifier are from same generation
PK_DATE=$(echo "$PK_TIME" | cut -d' ' -f1)
VERIFIER_DATE=$(echo "$VERIFIER_TIME" | cut -d' ' -f1)

echo ""
if [ "$PK_DATE" != "$VERIFIER_DATE" ]; then
    echo -e "${RED}⚠️  WARNING: Proving key and verifier were generated on different days!${NC}"
    echo ""
    echo "This usually means:"
    echo "  • Verifier bytecode is stale"
    echo "  • Or proving key was regenerated without regenerating verifier"
    echo ""
    echo "To fix:"
    echo "  1. Delete cached files:"
    echo "     rm ../packages/crypto/circuits/kzg_params/pk_k14*"
    echo "  2. Regenerate everything:"
    echo "     cd ../packages/crypto/circuits && cargo run --bin generate_verifier --release"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Proving key and verifier appear synchronized"

# Check if proof is newer than PK (must be regenerated after PK changes)
echo ""
echo "🔍 Checking proof generation..."

if [ -z "$PROOF_TIME" ]; then
    echo -e "${RED}✗${NC} Cannot determine proof generation time from fixture"
    exit 1
fi

# Convert dates to seconds for comparison (works on macOS and Linux)
if [ "$(uname)" = "Darwin" ]; then
    PK_SECONDS=$(date -j -f "%Y-%m-%d %H:%M:%S" "$PK_TIME" "+%s" 2>/dev/null || echo "0")
    PROOF_SECONDS=$(date -j -f "%Y-%m-%d %H:%M:%S" "$PROOF_TIME" "+%s" 2>/dev/null || echo "0")
else
    PK_SECONDS=$(date -d "$PK_TIME" "+%s" 2>/dev/null || echo "0")
    PROOF_SECONDS=$(date -d "$PROOF_TIME" "+%s" 2>/dev/null || echo "0")
fi

if [ "$PK_SECONDS" = "0" ] || [ "$PROOF_SECONDS" = "0" ]; then
    echo -e "${YELLOW}⚠️  Cannot compare timestamps (date parsing failed)${NC}"
    echo "  Manual verification required"
else
    time_diff=$((PROOF_SECONDS - PK_SECONDS))

    if [ $time_diff -lt 0 ]; then
        echo -e "${RED}✗${NC} Proof is OLDER than proving key!"
        echo ""
        echo "Proof must be regenerated after PK changes:"
        echo "  cd ../packages/crypto/circuits"
        echo "  cargo test --lib export_proof_for_solidity -- --ignored --nocapture"
        echo "  cp proof_integration_test.json ../../contracts/test/fixtures/"
        echo ""
        exit 1
    elif [ $time_diff -lt 300 ]; then
        # Within 5 minutes - likely same generation run
        echo -e "${GREEN}✓${NC} Proof and PK appear to be from same generation run (${time_diff}s apart)"
    else
        # More than 5 minutes apart
        minutes=$((time_diff / 60))
        echo -e "${YELLOW}⚠️${NC} Proof was generated ${minutes} minutes after PK"
        echo "  This might be okay, but verify proof was regenerated after latest PK"
    fi
fi

# Check configuration consistency
echo ""
echo "⚙️  Checking circuit configuration..."

# Extract K value from verifier generator
K_VERIFIER=$(grep "^const K: u32 = " "$VERIFIER" | sed 's/.*= \([0-9]*\).*/\1/')
# Extract K from proof fixture
K_PROOF=$(grep '"k":' "$PROOF_FIXTURE" | head -1 | sed 's/.*: \([0-9]*\).*/\1/')

echo "  Circuit K (verifier):  $K_VERIFIER"
echo "  Circuit K (proof):     $K_PROOF"

if [ "$K_VERIFIER" != "$K_PROOF" ]; then
    echo -e "${RED}✗${NC} K value mismatch!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Circuit K values match"

# Check break points exist and are valid JSON
echo ""
echo "🔧 Checking break points..."
if ! jq empty "$BREAKPOINTS" 2>/dev/null; then
    echo -e "${RED}✗${NC} Break points file is not valid JSON!"
    exit 1
fi

BP_COUNT=$(jq 'length' "$BREAKPOINTS")
echo "  Break point phases: $BP_COUNT"

if [ "$BP_COUNT" = "0" ]; then
    echo -e "${RED}✗${NC} No break points found!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Break points file is valid"

# Final summary
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}✓ All synchronization checks passed!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Verifier and proof fixtures appear to be properly synchronized."
echo "If tests still fail, this indicates a deeper issue in:"
echo "  • snark-verifier-sdk library compatibility"
echo "  • Circuit configuration mismatch not caught by checks"
echo "  • Instance value formatting/encoding"
echo ""
echo "Next steps if tests fail:"
echo "  1. Run: forge test --match-test test_RealProofVerifies -vvvvv"
echo "  2. Check EC pairing inputs in traces"
echo "  3. Compare with working Axiom examples"
echo ""
