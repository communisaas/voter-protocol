#!/bin/bash
# Provider Health Check Script
# Tests all external data providers
# Usage: ./provider-health-check.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

echo "════════════════════════════════════════════════════════════════"
echo "Shadow Atlas Provider Health Check"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "════════════════════════════════════════════════════════════════"
echo ""

PASSED=0
FAILED=0

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_provider() {
    local name="$1"
    local url="$2"
    local timeout="${3:-10}"

    echo -n "Testing $name... "

    START_TIME=$(date +%s%3N)
    if timeout "$timeout" curl -sf "$url" > /dev/null 2>&1; then
        END_TIME=$(date +%s%3N)
        DURATION=$((END_TIME - START_TIME))
        echo -e "${GREEN}✓ OK${NC} (${DURATION}ms)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# 1. Census TIGER
echo "1. Census TIGER (Authoritative source)"
echo "────────────────────────────────────────────────────────────────"
test_provider \
    "TIGER Base URL" \
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"

test_provider \
    "TIGER Congressional Districts" \
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/17"

echo ""

# 2. ArcGIS Hub
echo "2. ArcGIS Hub"
echo "────────────────────────────────────────────────────────────────"
test_provider \
    "Hub Main Site" \
    "https://hub.arcgis.com"

test_provider \
    "Hub API" \
    "https://hub.arcgis.com/api/v3/datasets"

echo ""

# 3. Sample State Portals
echo "3. Sample State GIS Portals"
echo "────────────────────────────────────────────────────────────────"
test_provider \
    "Colorado GIS" \
    "https://gis.colorado.gov/arcgis/rest/services"

test_provider \
    "Wisconsin GIS" \
    "https://geodata.wisc.edu"

test_provider \
    "Minnesota GIS" \
    "https://gisdata.mn.gov"

echo ""

# 4. IPFS/Storacha
echo "4. IPFS/Storacha"
echo "────────────────────────────────────────────────────────────────"

# Test primary gateway
test_provider \
    "Storacha Gateway" \
    "https://w3s.link/ipfs/bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354" \
    15

# Test alternative gateways
test_provider \
    "Cloudflare IPFS Gateway" \
    "https://cloudflare-ipfs.com/ipfs/bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354" \
    15

# Test latest snapshot if database available
if [ -f ".shadow-atlas/persistence.db" ]; then
    LATEST_CID=$(sqlite3 .shadow-atlas/persistence.db "
    SELECT ipfs_cid FROM snapshots
    WHERE deprecated_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
    " 2>&1)

    if [ -n "$LATEST_CID" ] && [ "$LATEST_CID" != "" ]; then
        echo ""
        echo "Testing latest Shadow Atlas snapshot:"
        test_provider \
            "Latest Snapshot ($LATEST_CID)" \
            "https://w3s.link/ipfs/$LATEST_CID" \
            20
    fi
fi

echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "Provider Health Summary"
echo "────────────────────────────────────────────────────────────────"
TOTAL=$((PASSED + FAILED))
echo "Total providers tested: $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}All providers healthy${NC}"
    exit 0
elif [ $FAILED -lt 3 ]; then
    echo ""
    echo -e "${YELLOW}Some providers degraded${NC}"
    echo "Review failed providers above"
    echo "See: ops/runbooks/common-incidents/upstream-failure.md"
    exit 1
else
    echo ""
    echo -e "${RED}Multiple provider failures detected${NC}"
    echo "This may indicate a network issue or widespread outage"
    echo "See: ops/runbooks/common-incidents/upstream-failure.md"
    exit 2
fi
