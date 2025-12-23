#!/bin/bash
# Shadow Atlas Metrics Snapshot Script
# Captures comprehensive metrics for incident analysis
# Usage: ./metrics-snapshot.sh [output_file]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

OUTPUT_FILE="${1:-/tmp/shadow-atlas-metrics-$(date +%s).txt}"

exec > >(tee "$OUTPUT_FILE")
exec 2>&1

echo "════════════════════════════════════════════════════════════════"
echo "Shadow Atlas Metrics Snapshot"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "Hostname: $(hostname)"
echo "Output: $OUTPUT_FILE"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 1. System Information
echo "1. SYSTEM INFORMATION"
echo "────────────────────────────────────────────────────────────────"
echo "OS: $(uname -s)"
echo "Kernel: $(uname -r)"
echo "Uptime: $(uptime)"
echo ""

# 2. Disk Usage
echo "2. DISK USAGE"
echo "────────────────────────────────────────────────────────────────"
df -h | grep -E "Filesystem|/dev/"
echo ""
echo "Shadow Atlas data directory:"
du -sh .shadow-atlas/ 2>/dev/null || echo "Directory not found"
du -sh .shadow-atlas/persistence.db 2>/dev/null || echo "persistence.db not found"
du -sh .shadow-atlas/metrics.db 2>/dev/null || echo "metrics.db not found"
du -sh .shadow-atlas/backups/ 2>/dev/null || echo "backups/ not found"
echo ""

# 3. Memory Usage
echo "3. MEMORY USAGE"
echo "────────────────────────────────────────────────────────────────"
if [ "$(uname)" == "Darwin" ]; then
    # macOS
    vm_stat | head -10
else
    # Linux
    free -h 2>/dev/null || echo "free command not available"
fi
echo ""

# 4. Process Information
echo "4. RUNNING PROCESSES"
echo "────────────────────────────────────────────────────────────────"
ps aux | grep -E "batch-orchestrator|extract-all-states|tsx" | grep -v grep || echo "No relevant processes found"
echo ""

# 5. Database Integrity
echo "5. DATABASE INTEGRITY"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    echo "persistence.db:"
    sqlite3 .shadow-atlas/persistence.db "PRAGMA integrity_check;" 2>&1
    echo ""
    echo "Table sizes:"
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        name as table_name,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=main.name) as row_count
    FROM sqlite_master
    WHERE type='table'
    ORDER BY name;
    " 2>&1
else
    echo "persistence.db: NOT FOUND"
fi
echo ""

if [ -f ".shadow-atlas/metrics.db" ]; then
    echo "metrics.db:"
    sqlite3 .shadow-atlas/metrics.db "PRAGMA integrity_check;" 2>&1
else
    echo "metrics.db: NOT FOUND"
fi
echo ""

# 6. Recent Jobs
echo "6. RECENT JOBS (Last 10)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        id,
        status,
        datetime(created_at) as created,
        datetime(updated_at) as updated
    FROM jobs
    ORDER BY created_at DESC
    LIMIT 10;
    " 2>&1
else
    echo "Database not found"
fi
echo ""

# 7. Job Statistics
echo "7. JOB STATISTICS (Last 7 days)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        status,
        COUNT(*) as count,
        AVG(julianday(updated_at) - julianday(created_at)) * 24 * 60 as avg_duration_minutes
    FROM jobs
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY status;
    " 2>&1
else
    echo "Database not found"
fi
echo ""

# 8. Extraction Statistics
echo "8. EXTRACTION STATISTICS (Last 24 hours)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        state_code,
        layer_type,
        COUNT(*) as extraction_count
    FROM extractions
    WHERE extracted_at >= datetime('now', '-24 hours')
    GROUP BY state_code, layer_type
    ORDER BY state_code, layer_type;
    " 2>&1 | head -20
    echo "(Showing first 20 rows)"
else
    echo "Database not found"
fi
echo ""

# 9. Validation Results
echo "9. VALIDATION RESULTS (Last 24 hours)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) as failed,
        ROUND(100.0 * SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) as pass_rate_pct
    FROM validation_results
    WHERE validated_at >= datetime('now', '-24 hours');
    " 2>&1 || echo "validation_results table not found or query failed"
else
    echo "Database not found"
fi
echo ""

# 10. Failures
echo "10. RECENT FAILURES (Last 20)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        state_code,
        layer_type,
        error_message,
        attempt_count,
        datetime(failed_at) as failed
    FROM failures
    ORDER BY failed_at DESC
    LIMIT 20;
    " 2>&1 || echo "failures table not found or query failed"
else
    echo "Database not found"
fi
echo ""

# 11. Active Snapshots
echo "11. ACTIVE SNAPSHOTS"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/persistence.db" ]; then
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        id,
        ipfs_cid,
        boundary_count,
        datetime(created_at) as created,
        CASE WHEN deprecated_at IS NULL THEN 'ACTIVE' ELSE 'DEPRECATED' END as status
    FROM snapshots
    ORDER BY created_at DESC
    LIMIT 5;
    " 2>&1 || echo "snapshots table not found or query failed"
else
    echo "Database not found"
fi
echo ""

# 12. Metrics Summary
echo "12. METRICS SUMMARY (Last 1 hour)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/metrics.db" ]; then
    sqlite3 .shadow-atlas/metrics.db "
    SELECT
        type,
        COUNT(*) as count,
        ROUND(AVG(value), 2) as avg_value,
        ROUND(MIN(value), 2) as min_value,
        ROUND(MAX(value), 2) as max_value
    FROM metrics
    WHERE recorded_at >= datetime('now', '-1 hour')
    GROUP BY type
    ORDER BY count DESC;
    " 2>&1 || echo "metrics table not found or query failed"
else
    echo "metrics.db not found"
fi
echo ""

# 13. Active Alerts
echo "13. ACTIVE ALERTS"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/metrics.db" ]; then
    sqlite3 .shadow-atlas/metrics.db "
    SELECT
        name,
        severity,
        message,
        datetime(started_at) as started,
        status
    FROM alerts
    WHERE status = 'firing'
    ORDER BY started_at DESC;
    " 2>&1 || echo "No active alerts or alerts table not found"
else
    echo "metrics.db not found"
fi
echo ""

# 14. Provider Errors
echo "14. PROVIDER ERRORS (Last 1 hour)"
echo "────────────────────────────────────────────────────────────────"
if [ -f ".shadow-atlas/metrics.db" ]; then
    sqlite3 .shadow-atlas/metrics.db "
    SELECT
        json_extract(labels_json, '$.provider') as provider,
        json_extract(labels_json, '$.error') as error_type,
        COUNT(*) as error_count
    FROM metrics
    WHERE type = 'provider_error'
        AND recorded_at >= datetime('now', '-1 hour')
    GROUP BY provider, error_type
    ORDER BY error_count DESC
    LIMIT 10;
    " 2>&1 || echo "No provider errors or query failed"
else
    echo "metrics.db not found"
fi
echo ""

# 15. Backup Status
echo "15. BACKUP STATUS"
echo "────────────────────────────────────────────────────────────────"
if [ -d ".shadow-atlas/backups" ]; then
    echo "Available backups:"
    ls -lht .shadow-atlas/backups/*.db 2>/dev/null | head -10 || echo "No backups found"
else
    echo "Backup directory not found"
fi
echo ""

# 16. Network Connectivity
echo "16. NETWORK CONNECTIVITY"
echo "────────────────────────────────────────────────────────────────"
echo "Testing external providers..."
echo ""

# Test Census TIGER
echo -n "Census TIGER: "
if timeout 5 curl -sf "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer" > /dev/null 2>&1; then
    echo "✓ Responsive"
else
    echo "✗ Timeout or unreachable"
fi

# Test ArcGIS Hub
echo -n "ArcGIS Hub: "
if timeout 5 curl -sf "https://hub.arcgis.com" > /dev/null 2>&1; then
    echo "✓ Responsive"
else
    echo "✗ Timeout or unreachable"
fi

# Test Storacha (if latest snapshot CID available)
if [ -f ".shadow-atlas/persistence.db" ]; then
    LATEST_CID=$(sqlite3 .shadow-atlas/persistence.db "
    SELECT ipfs_cid FROM snapshots
    WHERE deprecated_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
    " 2>&1)

    if [ -n "$LATEST_CID" ] && [ "$LATEST_CID" != "" ]; then
        echo -n "IPFS/Storacha ($LATEST_CID): "
        if timeout 10 curl -sf "https://w3s.link/ipfs/$LATEST_CID" > /dev/null 2>&1; then
            echo "✓ Snapshot retrievable"
        else
            echo "✗ Snapshot retrieval failed"
        fi
    fi
fi

echo ""

# 17. Git Status (if in git repo)
echo "17. GIT STATUS"
echo "────────────────────────────────────────────────────────────────"
if git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
    echo "Commit: $(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
    echo "Status:"
    git status --short 2>/dev/null || echo "Cannot get git status"
else
    echo "Not a git repository"
fi
echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "Snapshot complete"
echo "Output saved to: $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "  - Review metrics above for anomalies"
echo "  - Attach this file to incident reports"
echo "  - Share with team for troubleshooting"
echo "════════════════════════════════════════════════════════════════"
