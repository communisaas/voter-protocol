#!/bin/bash
# Shadow Atlas Health Check Script
# Usage: ./health-check.sh
# Exit codes: 0 = healthy, 1 = degraded, 2 = critical

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Shadow Atlas Health Check"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

EXIT_CODE=0
WARNINGS=0
ERRORS=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Helper functions
print_ok() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARNINGS=$((WARNINGS + 1))
    EXIT_CODE=1
}

print_error() {
    echo -e "${RED}✗${NC} $1"
    ERRORS=$((ERRORS + 1))
    EXIT_CODE=2
}

# 1. Database Health
echo "1. Database Integrity"
echo "───────────────────────────────────────────────"

if [ -f ".shadow-atlas/persistence.db" ]; then
    INTEGRITY=$(sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;" 2>&1)
    if [ "$INTEGRITY" = "ok" ]; then
        print_ok "persistence.db: Integrity OK"
    else
        print_error "persistence.db: CORRUPTED - $INTEGRITY"
    fi

    # Check database size
    DB_SIZE=$(ls -lh .shadow-atlas/persistence.db | awk '{print $5}')
    print_ok "persistence.db: Size $DB_SIZE"
else
    print_error "persistence.db: NOT FOUND"
fi

if [ -f ".shadow-atlas/metrics.db" ]; then
    INTEGRITY=$(sqlite3 .shadow-atlas/metrics.db "PRAGMA integrity_check;" 2>&1)
    if [ "$INTEGRITY" = "ok" ]; then
        print_ok "metrics.db: Integrity OK"
    else
        print_error "metrics.db: CORRUPTED - $INTEGRITY"
    fi
else
    print_warn "metrics.db: Not found (expected on first run)"
fi

echo ""

# 2. Disk Space
echo "2. Disk Space"
echo "───────────────────────────────────────────────"

DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 80 ]; then
    print_ok "Disk usage: ${DISK_USAGE}%"
elif [ "$DISK_USAGE" -lt 90 ]; then
    print_warn "Disk usage: ${DISK_USAGE}% (nearing capacity)"
else
    print_error "Disk usage: ${DISK_USAGE}% (CRITICAL - cleanup needed)"
fi

echo ""

# 3. Recent Jobs
echo "3. Recent Job Status"
echo "───────────────────────────────────────────────"

if [ -f ".shadow-atlas/persistence.db" ]; then
    RECENT_JOBS=$(sqlite3 .shadow-atlas/persistence.db "
    SELECT
        status,
        COUNT(*) as count
    FROM jobs
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY status;
    " 2>&1)

    if [ -n "$RECENT_JOBS" ]; then
        echo "$RECENT_JOBS"

        FAILED_JOBS=$(sqlite3 .shadow-atlas/persistence.db "
        SELECT COUNT(*) FROM jobs
        WHERE status = 'failed'
        AND created_at >= datetime('now', '-7 days');
        " 2>&1)

        if [ "$FAILED_JOBS" -gt 0 ]; then
            print_warn "Failed jobs in last 7 days: $FAILED_JOBS"
        else
            print_ok "No failed jobs in last 7 days"
        fi
    else
        print_warn "No jobs found in last 7 days"
    fi
else
    print_error "Cannot check jobs - database not found"
fi

echo ""

# 4. Snapshots
echo "4. Snapshot Status"
echo "───────────────────────────────────────────────"

if [ -f ".shadow-atlas/persistence.db" ]; then
    ACTIVE_SNAPSHOT=$(sqlite3 .shadow-atlas/persistence.db "
    SELECT id, ipfs_cid, created_at
    FROM snapshots
    WHERE deprecated_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
    " 2>&1)

    if [ -n "$ACTIVE_SNAPSHOT" ]; then
        print_ok "Active snapshot found"
        echo "    $ACTIVE_SNAPSHOT"

        # Check if IPFS CID exists
        IPFS_CID=$(echo "$ACTIVE_SNAPSHOT" | awk -F'|' '{print $2}')
        if [ -n "$IPFS_CID" ] && [ "$IPFS_CID" != "" ]; then
            print_ok "IPFS CID: $IPFS_CID"
        else
            print_error "Active snapshot missing IPFS CID"
        fi
    else
        print_error "No active snapshot found"
    fi
else
    print_error "Cannot check snapshots - database not found"
fi

echo ""

# 5. Backups
echo "5. Backup Status"
echo "───────────────────────────────────────────────"

if [ -d ".shadow-atlas/backups" ]; then
    LATEST_BACKUP=$(ls -t .shadow-atlas/backups/persistence-*.db 2>/dev/null | head -1)
    if [ -n "$LATEST_BACKUP" ]; then
        BACKUP_AGE=$(find "$LATEST_BACKUP" -mtime +2)
        if [ -z "$BACKUP_AGE" ]; then
            print_ok "Latest backup: $LATEST_BACKUP (recent)"
        else
            print_warn "Latest backup older than 2 days: $LATEST_BACKUP"
        fi
    else
        print_warn "No backups found in .shadow-atlas/backups/"
    fi
else
    print_warn "Backup directory not found (create with: mkdir -p .shadow-atlas/backups)"
fi

echo ""

# 6. Active Alerts
echo "6. Active Alerts"
echo "───────────────────────────────────────────────"

if [ -f ".shadow-atlas/metrics.db" ]; then
    FIRING_ALERTS=$(sqlite3 .shadow-atlas/metrics.db "
    SELECT COUNT(*) FROM alerts WHERE status = 'firing';
    " 2>&1)

    if [ "$FIRING_ALERTS" -eq 0 ]; then
        print_ok "No active alerts"
    else
        print_error "Active alerts: $FIRING_ALERTS"

        # Show alert details
        sqlite3 .shadow-atlas/metrics.db "
        SELECT name, severity, started_at
        FROM alerts
        WHERE status = 'firing'
        ORDER BY started_at DESC;
        " 2>&1
    fi
else
    print_warn "metrics.db not found - cannot check alerts"
fi

echo ""

# 7. Provider Health (if network available)
echo "7. Provider Health (network check)"
echo "───────────────────────────────────────────────"

# Test Census TIGER
if timeout 5 curl -sf "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" > /dev/null 2>&1; then
    print_ok "Census TIGER: Responsive"
else
    print_warn "Census TIGER: Timeout or unreachable"
fi

# Test ArcGIS Hub
if timeout 5 curl -sf "https://hub.arcgis.com" > /dev/null 2>&1; then
    print_ok "ArcGIS Hub: Responsive"
else
    print_warn "ArcGIS Hub: Timeout or unreachable"
fi

echo ""

# 8. TypeScript Health (optional - check if Node.js available)
echo "8. Service Health (TypeScript)"
echo "───────────────────────────────────────────────"

if command -v npx &> /dev/null; then
    if npx tsx observability/cli.ts health-check 2>&1 | grep -q "✓"; then
        print_ok "TypeScript health check passed"
    else
        print_warn "TypeScript health check returned warnings"
    fi
else
    print_warn "Node.js/npx not available - skipping TypeScript checks"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Health Check Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}Status: CRITICAL${NC}"
    echo "Errors: $ERRORS"
    echo "Warnings: $WARNINGS"
    echo ""
    echo "Action required: Review errors above and consult runbooks"
    echo "See: ops/runbooks/incident-response.md"
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Status: DEGRADED${NC}"
    echo "Warnings: $WARNINGS"
    echo ""
    echo "Action recommended: Review warnings above"
    echo "Non-critical issues detected"
else
    echo -e "${GREEN}Status: HEALTHY${NC}"
    echo "All systems operational"
fi

echo ""
echo "Full diagnostics: ops/scripts/metrics-snapshot.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit $EXIT_CODE
