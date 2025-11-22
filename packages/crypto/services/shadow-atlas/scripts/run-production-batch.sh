#!/bin/bash
set -euo pipefail

echo "╔══════════════════════════════════════════════════════╗"
echo "║   SHADOW ATLAS - PRODUCTION BATCH DISCOVERY         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Configuration
LIMIT=100
CONCURRENCY=20
STRATEGY="population"
STAGING="true"
MIN_DISK_GB=5
MIN_MEMORY_GB=8

# Directories
SHADOW_ATLAS_DIR="/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas"
DATA_DIR="$SHADOW_ATLAS_DIR/data"
PROVENANCE_DIR="$SHADOW_ATLAS_DIR/discovery-attempts"

cd "$SHADOW_ATLAS_DIR"

# ============================================================
# Pre-Flight Checks
# ============================================================

echo "📋 Running pre-flight checks..."
echo ""

# Check 1: City database exists
echo "  [1/6] Checking city database..."
if [ ! -f "$DATA_DIR/us-cities-top-1000.json" ]; then
  echo "    ❌ ERROR: City database not found"
  echo "    Expected: $DATA_DIR/us-cities-top-1000.json"
  exit 1
fi

CITY_COUNT=$(jq 'length' "$DATA_DIR/us-cities-top-1000.json")
if [ "$CITY_COUNT" -lt "$LIMIT" ]; then
  echo "    ⚠️  WARNING: City database has only $CITY_COUNT cities (need $LIMIT)"
fi
echo "    ✅ City database found ($CITY_COUNT cities)"

# Check 2: Disk space (need >5GB)
echo "  [2/6] Checking disk space..."
DISK_AVAIL_GB=$(df -g . | awk 'NR==2 {print $4}')
if [ "$DISK_AVAIL_GB" -lt "$MIN_DISK_GB" ]; then
  echo "    ❌ ERROR: Low disk space (${DISK_AVAIL_GB}GB available, need ${MIN_DISK_GB}GB)"
  exit 1
fi
echo "    ✅ Disk space: ${DISK_AVAIL_GB}GB available"

# Check 3: Memory (need >8GB)
echo "  [3/6] Checking available memory..."
FREE_MEMORY_GB=$(vm_stat | grep "Pages free" | awk '{print int($3 * 4096 / 1024 / 1024 / 1024)}')
if [ "$FREE_MEMORY_GB" -lt "$MIN_MEMORY_GB" ]; then
  echo "    ⚠️  WARNING: Low memory (${FREE_MEMORY_GB}GB free, recommend ${MIN_MEMORY_GB}GB)"
  echo "    Consider reducing concurrency to 10 agents"
fi
echo "    ✅ Memory: ${FREE_MEMORY_GB}GB available"

# Check 4: Network connectivity
echo "  [4/6] Checking network connectivity..."
if ! ping -c 3 geocoding.geo.census.gov > /dev/null 2>&1; then
  echo "    ⚠️  WARNING: Cannot reach Census geocoding service"
  echo "    Discovery may fail for cities requiring Census TIGER data"
else
  echo "    ✅ Network: Census geocoding service reachable"
fi

# Check 5: Provenance directory
echo "  [5/6] Checking provenance directory..."
mkdir -p "$PROVENANCE_DIR"
if [ ! -w "$PROVENANCE_DIR" ]; then
  echo "    ❌ ERROR: Provenance directory not writable"
  echo "    Directory: $PROVENANCE_DIR"
  exit 1
fi
echo "    ✅ Provenance directory: $PROVENANCE_DIR"

# Check 6: Registry health
echo "  [6/6] Validating registry health..."
REGISTRY_HEALTH=$(npm run atlas:validate-registry --silent 2>&1 || echo "error")
if [[ "$REGISTRY_HEALTH" == *"error"* ]]; then
  echo "    ⚠️  WARNING: Registry validation failed (proceeding anyway)"
else
  echo "    ✅ Registry health: OK"
fi

echo ""
echo "✅ Pre-flight checks complete!"
echo ""

# ============================================================
# Generate Expansion Plan
# ============================================================

echo "📊 Generating expansion plan..."
echo ""

EXPANSION_PLAN_FILE="expansion-plan-$LIMIT-$(date -u +%Y-%m-%dT%H-%M-%S).json"

npm run atlas:plan-expansion "$LIMIT" > "$EXPANSION_PLAN_FILE"

if [ ! -f "$EXPANSION_PLAN_FILE" ]; then
  echo "❌ ERROR: Expansion plan generation failed"
  exit 1
fi

echo "✅ Expansion plan saved: $EXPANSION_PLAN_FILE"
echo ""

# Show plan summary
echo "Expansion Plan Summary:"
jq -r '
  "  Total Candidates: \(.totalCandidates)",
  "  Recommended: \(.recommended | length)",
  "  Estimated Impact:",
  "    - People Reached: \(.estimatedImpact.peopleReached | tonumber | . / 1000000 | floor)M",
  "    - Tier Upgrades: \(.estimatedImpact.tierUpgrades)",
  "    - New Coverage: \(.estimatedImpact.newCoverage)"
' "$EXPANSION_PLAN_FILE"

echo ""

# ============================================================
# Run Batch Discovery
# ============================================================

echo "╔══════════════════════════════════════════════════════╗"
echo "║       STARTING BATCH DISCOVERY                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

echo "Configuration:"
echo "  Limit:       $LIMIT cities"
echo "  Concurrency: $CONCURRENCY agents"
echo "  Strategy:    $STRATEGY"
echo "  Staging:     $STAGING"
echo ""

START_TIME=$(date +%s)

# Run batch discovery
npm run atlas:discover-batch -- \
  --limit="$LIMIT" \
  --concurrency="$CONCURRENCY" \
  --strategy="$STRATEGY" \
  --staging

BATCH_EXIT_CODE=$?
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

if [ $BATCH_EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Batch discovery failed with exit code $BATCH_EXIT_CODE"
  echo "Elapsed time: ${ELAPSED}s"
  exit $BATCH_EXIT_CODE
fi

echo ""
echo "✅ Batch discovery complete!"
echo "Elapsed time: ${ELAPSED}s ($(($ELAPSED / 60)) minutes)"
echo ""

# ============================================================
# Post-Execution Analysis
# ============================================================

echo "╔══════════════════════════════════════════════════════╗"
echo "║       POST-BATCH ANALYSIS                            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check coverage dashboard
echo "📈 Coverage Dashboard:"
npm run atlas:coverage-dashboard

echo ""

# Check freshness
echo "🕒 Data Freshness:"
npm run atlas:check-freshness

echo ""

# Merge staging logs
if [ "$STAGING" = "true" ]; then
  echo "💾 Merging staging logs..."
  npm run atlas:merge-staging
  echo "✅ Staging logs merged"
  echo ""
fi

# ============================================================
# Results Summary
# ============================================================

echo "╔══════════════════════════════════════════════════════╗"
echo "║       BATCH COMPLETE - SUMMARY                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Count provenance entries
CURRENT_MONTH=$(date +%Y-%m)
PROVENANCE_COUNT=$(zcat "$PROVENANCE_DIR/$CURRENT_MONTH"/*.ndjson.gz 2>/dev/null | wc -l | xargs)

echo "Provenance Entries: $PROVENANCE_COUNT"
echo "Execution Time: ${ELAPSED}s ($(($ELAPSED / 60)) minutes)"
echo "Avg Time/City: $((ELAPSED / LIMIT))s"
echo ""

# ============================================================
# Next Steps
# ============================================================

echo "📋 Next Steps:"
echo ""
echo "  1. Review results:"
echo "     npm run atlas:coverage-dashboard"
echo ""
echo "  2. Queue retry candidates:"
echo "     npm run atlas:retry-worker"
echo ""
echo "  3. Add high-confidence discoveries to registry:"
echo "     Review: $EXPANSION_PLAN_FILE"
echo "     Edit: registry/known-portals.ts"
echo ""
echo "  4. Run second batch (100-200 cities):"
echo "     bash scripts/run-production-batch.sh"
echo ""

echo "✅ Production batch complete!"
