#!/bin/bash
set -euo pipefail

# Shadow Atlas - Infrastructure Integration Test Suite
#
# PURPOSE: Validate all component integrations before production batch run
# STRATEGY: Test each npm script independently, track failures
# SCALE: 8 integration scenarios across 6 production components
#
# USAGE:
#   chmod +x scripts/test-integrations.sh
#   ./scripts/test-integrations.sh
#
# EXIT CODES:
#   0 - All tests passed
#   1 - One or more tests failed

echo ""
echo "🧪 Shadow Atlas - Integration Test Suite"
echo "========================================="
echo ""

FAILED=0
PASSED=0

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test helper function
run_test() {
  local test_name="$1"
  local test_command="$2"
  local silent="${3:-false}"

  echo -n "Testing: $test_name... "

  if [ "$silent" = "true" ]; then
    if eval "$test_command" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ PASS${NC}"
      PASSED=$((PASSED + 1))
    else
      echo -e "${RED}❌ FAIL${NC}"
      FAILED=$((FAILED + 1))
    fi
  else
    if eval "$test_command"; then
      echo -e "${GREEN}✅ PASS${NC}"
      PASSED=$((PASSED + 1))
    else
      echo -e "${RED}❌ FAIL${NC}"
      FAILED=$((FAILED + 1))
    fi
  fi
}

# Test 1: TypeScript Integration Tests
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: TypeScript Integration Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "TypeScript integration.test.ts" "npm test -- integration.test.ts" false

# Test 2: Coverage Analyzer Integration
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Coverage Analyzer Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Coverage dashboard generation" "npm run atlas:dashboard" true
run_test "Gap analysis (top 50)" "npm run atlas:gaps" true
run_test "Stale data detection" "npm run atlas:stale" true

# Test 3: Freshness Tracker Integration
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Freshness Tracker Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Freshness check" "npm run atlas:check-freshness" true

# Test 4: Retry Orchestrator Integration
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: Retry Orchestrator Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Retry worker (dry-run)" "npm run atlas:retry-worker -- --dry-run" true
run_test "Retry statistics" "npm run atlas:retry-stats" true
run_test "Retry candidates query" "npm run atlas:retry-candidates" true

# Test 5: Expansion Planner Integration
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 5: Expansion Planner Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Expansion plan (20 cities)" "npm run atlas:plan-expansion 20" true
run_test "Expansion plan (100 cities)" "npm run atlas:plan-100" true

# Test 6: Registry Validator Integration
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 6: Registry Validator Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Registry validation" "npm run atlas:validate-registry" true

# Test 7: Batch Discovery Integration (Dry-Run)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 7: Batch Discovery Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
run_test "Batch discover (dry-run, 1 city)" "npm run atlas:discover-batch -- --limit 1 --dry-run" true

# Test 8: Provenance Query System
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 8: Provenance Query System"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test provenance query by creating temp test script
cat > /tmp/test-provenance.ts <<'EOF'
import { queryProvenance } from './services/shadow-atlas/services/provenance-writer.js';

async function testQuery() {
  const all = await queryProvenance({});
  console.log(`Total entries: ${all.length}`);

  if (all.length === 0) {
    console.log('No provenance data found - this is expected for fresh installs');
    process.exit(0);
  }

  // Test state filter
  const firstState = all[0].s;
  if (firstState) {
    const byState = await queryProvenance({ state: firstState });
    console.log(`Entries for ${firstState}: ${byState.length}`);
  }

  // Test FIPS filter
  const firstFips = all[0].f;
  const byFips = await queryProvenance({ fips: firstFips });
  console.log(`Entries for ${firstFips}: ${byFips.length}`);
}

testQuery().catch(console.error);
EOF

run_test "Provenance query filters" "tsx /tmp/test-provenance.ts" true
rm -f /tmp/test-provenance.ts

# Final Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TOTAL=$((PASSED + FAILED))
echo "Total tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}Failed: 0${NC}"
  echo ""
  echo -e "${GREEN}✅ All integration tests passed!${NC}"
  echo ""
  echo "Production readiness: ✅ READY"
  echo "Next step: Run 100-city batch with --staging flag"
  echo ""
  exit 0
else
  echo -e "${RED}Failed: $FAILED${NC}"
  echo ""
  echo -e "${RED}❌ $FAILED integration test(s) failed${NC}"
  echo ""
  echo "Production readiness: ❌ NOT READY"
  echo "Action required: Investigate and fix failing components"
  echo ""
  exit 1
fi
