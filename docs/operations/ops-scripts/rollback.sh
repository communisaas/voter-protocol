#!/bin/bash
# Snapshot Rollback Script
# Rolls back to a previous snapshot
# Usage: ./rollback.sh <snapshot_id>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

if [ -z "$1" ]; then
    echo "Usage: $0 <snapshot_id>"
    echo ""
    echo "Available snapshots:"
    sqlite3 .shadow-atlas/persistence.db "
    SELECT
        id,
        ipfs_cid,
        boundary_count,
        datetime(created_at) as created,
        CASE WHEN deprecated_at IS NULL THEN 'ACTIVE' ELSE 'DEPRECATED' END as status
    FROM snapshots
    ORDER BY created_at DESC
    LIMIT 10;
    " 2>&1
    exit 1
fi

ROLLBACK_TO="$1"

echo "════════════════════════════════════════════════════════════════"
echo "Shadow Atlas Snapshot Rollback"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Verify target snapshot exists
echo "Verifying snapshot $ROLLBACK_TO..."
SNAPSHOT_INFO=$(sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid, boundary_count, datetime(created_at) as created
FROM snapshots
WHERE id = '$ROLLBACK_TO';
" 2>&1)

if [ -z "$SNAPSHOT_INFO" ]; then
    echo "✗ ERROR: Snapshot $ROLLBACK_TO not found"
    exit 1
fi

echo "Target snapshot:"
echo "$SNAPSHOT_INFO"
echo ""

# Get current active snapshot
CURRENT_SNAPSHOT=$(sqlite3 .shadow-atlas/persistence.db "
SELECT id FROM snapshots WHERE deprecated_at IS NULL ORDER BY created_at DESC LIMIT 1;
" 2>&1)

if [ "$CURRENT_SNAPSHOT" == "$ROLLBACK_TO" ]; then
    echo "⚠ WARNING: $ROLLBACK_TO is already the active snapshot"
    echo "No rollback needed."
    exit 0
fi

echo "Current active snapshot: $CURRENT_SNAPSHOT"
echo ""

# Confirmation prompt
read -p "Rollback from $CURRENT_SNAPSHOT to $ROLLBACK_TO? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Rollback cancelled."
    exit 0
fi

echo ""

# Step 1: Create emergency backup before rollback
echo "Step 1: Creating emergency backup..."
./ops/scripts/emergency-backup.sh "pre-rollback-to-$ROLLBACK_TO"
echo ""

# Step 2: Deprecate current snapshot
echo "Step 2: Deprecating current snapshot..."
sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots
SET deprecated_at = datetime('now')
WHERE id = '$CURRENT_SNAPSHOT';
"
echo "✓ Snapshot $CURRENT_SNAPSHOT deprecated"
echo ""

# Step 3: Activate rollback snapshot
echo "Step 3: Activating rollback snapshot..."
sqlite3 .shadow-atlas/persistence.db "
UPDATE snapshots
SET deprecated_at = NULL
WHERE id = '$ROLLBACK_TO';
"
echo "✓ Snapshot $ROLLBACK_TO activated"
echo ""

# Step 4: Verify rollback
echo "Step 4: Verifying rollback..."
NEW_ACTIVE=$(sqlite3 .shadow-atlas/persistence.db "
SELECT id, ipfs_cid FROM snapshots
WHERE deprecated_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
" 2>&1)

echo "New active snapshot:"
echo "$NEW_ACTIVE"
echo ""

# Step 5: Test IPFS retrieval
IPFS_CID=$(echo "$NEW_ACTIVE" | awk -F'|' '{print $2}')
if [ -n "$IPFS_CID" ]; then
    echo "Testing IPFS retrieval for CID: $IPFS_CID"
    if timeout 10 curl -sf "https://w3s.link/ipfs/$IPFS_CID" > /dev/null 2>&1; then
        echo "✓ Snapshot retrievable from IPFS"
    else
        echo "✗ WARNING: IPFS retrieval test failed!"
        echo "   This may indicate an issue with the rollback snapshot."
        echo "   Consider rolling forward or investigating further."
    fi
else
    echo "⚠ WARNING: Snapshot missing IPFS CID"
fi

echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "Rollback Complete"
echo "────────────────────────────────────────────────────────────────"
echo "Previous snapshot: $CURRENT_SNAPSHOT (now deprecated)"
echo "Active snapshot: $ROLLBACK_TO"
echo ""
echo "Next steps:"
echo "  1. Test proof generation with new snapshot"
echo "  2. Monitor metrics for anomalies"
echo "  3. If issues persist, investigate root cause"
echo "  4. Emergency backup created at: .shadow-atlas/emergency-backups/"
echo ""
echo "To undo this rollback:"
echo "  ./ops/scripts/rollback.sh $CURRENT_SNAPSHOT"
echo "════════════════════════════════════════════════════════════════"
