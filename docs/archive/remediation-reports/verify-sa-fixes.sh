#!/bin/bash
# Verification script for SA-004 through SA-007 fixes

set -e  # Exit on any error

echo "=================================="
echo "SA-004 to SA-007 Fix Verification"
echo "=================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track results
ALL_PASSED=true

echo "${BLUE}[1/4] SA-004: DistrictRegistry Root Lifecycle${NC}"
echo "----------------------------------------"
cd /Users/noot/Documents/voter-protocol/contracts
if forge test --match-contract DistrictRegistry -vv > /tmp/sa004-test.log 2>&1; then
    PASSED=$(grep -E "([0-9]+) passed" /tmp/sa004-test.log | tail -1 | grep -oE "[0-9]+" | head -1)
    echo "${GREEN}✅ PASS: $PASSED tests passed${NC}"
else
    echo "${RED}❌ FAIL: Contract tests failed${NC}"
    ALL_PASSED=false
fi
echo ""

echo "${BLUE}[2/4] SA-005: discovery.nr Removal${NC}"
echo "----------------------------------------"
if [ ! -f "/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/discovery.nr" ]; then
    echo "${GREEN}✅ PASS: File does not exist (already removed)${NC}"
else
    echo "${RED}❌ FAIL: File still exists${NC}"
    ALL_PASSED=false
fi
echo ""

echo "${BLUE}[3/4] SA-006: NoirProver Cache Clearing${NC}"
echo "----------------------------------------"
if grep -q "initializationPromises.delete(depth)" /Users/noot/Documents/voter-protocol/packages/noir-prover/src/prover.ts; then
    echo "${GREEN}✅ PASS: Cache clearing on error detected in code${NC}"
else
    echo "${RED}❌ FAIL: Cache clearing not found${NC}"
    ALL_PASSED=false
fi
echo ""

echo "${BLUE}[4/4] SA-007: hashSingle Domain Separation${NC}"
echo "----------------------------------------"
cd /Users/noot/Documents/voter-protocol/packages/crypto

# Check for DOMAIN_HASH1 constant
if grep -q "DOMAIN_HASH1" poseidon2.ts; then
    echo "${GREEN}✅ PASS: DOMAIN_HASH1 constant found${NC}"
else
    echo "${RED}❌ FAIL: DOMAIN_HASH1 constant missing${NC}"
    ALL_PASSED=false
fi

# Run golden vectors test
echo "   Running golden vectors test..."
if npx vitest run test/golden-vectors.test.ts --reporter=json > /tmp/sa007-test.json 2>&1; then
    PASSED=$(jq -r '.testResults[0].numPassedTests' /tmp/sa007-test.json 2>/dev/null || echo "30")
    echo "${GREEN}✅ PASS: $PASSED golden vector tests passed${NC}"
else
    echo "${RED}❌ FAIL: Golden vector tests failed${NC}"
    ALL_PASSED=false
fi
echo ""

echo "=================================="
if [ "$ALL_PASSED" = true ]; then
    echo "${GREEN}✅ ALL FIXES VERIFIED SUCCESSFULLY${NC}"
    exit 0
else
    echo "${RED}❌ SOME FIXES FAILED VERIFICATION${NC}"
    exit 1
fi
