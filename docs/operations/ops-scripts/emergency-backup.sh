#!/bin/bash
# Emergency Backup Script
# Creates immediate backups of all critical Shadow Atlas data
# Usage: ./emergency-backup.sh [reason]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

TIMESTAMP=$(date +%s)
REASON="${1:-manual-emergency-backup}"
BACKUP_DIR=".shadow-atlas/emergency-backups"

echo "════════════════════════════════════════════════════════════════"
echo "Shadow Atlas Emergency Backup"
echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "Reason: $REASON"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup persistence database
if [ -f ".shadow-atlas/persistence.db" ]; then
    echo "Backing up persistence.db..."
    cp .shadow-atlas/persistence.db "$BACKUP_DIR/persistence-emergency-$TIMESTAMP.db"
    BACKUP_SIZE=$(ls -lh "$BACKUP_DIR/persistence-emergency-$TIMESTAMP.db" | awk '{print $5}')
    echo "✓ persistence.db backed up ($BACKUP_SIZE)"

    # Verify backup integrity
    if sqlite3 "$BACKUP_DIR/persistence-emergency-$TIMESTAMP.db" "PRAGMA integrity_check;" | grep -q "ok"; then
        echo "✓ Backup integrity verified"
    else
        echo "✗ WARNING: Backup integrity check failed!"
        exit 1
    fi
else
    echo "✗ persistence.db not found - skipping"
fi

echo ""

# Backup metrics database
if [ -f ".shadow-atlas/metrics.db" ]; then
    echo "Backing up metrics.db..."
    cp .shadow-atlas/metrics.db "$BACKUP_DIR/metrics-emergency-$TIMESTAMP.db"
    BACKUP_SIZE=$(ls -lh "$BACKUP_DIR/metrics-emergency-$TIMESTAMP.db" | awk '{print $5}')
    echo "✓ metrics.db backed up ($BACKUP_SIZE)"
else
    echo "⚠ metrics.db not found - skipping"
fi

echo ""

# Backup job state files
if [ -d ".shadow-atlas/jobs" ]; then
    echo "Backing up job state files..."
    mkdir -p "$BACKUP_DIR/jobs-$TIMESTAMP"
    cp -r .shadow-atlas/jobs/* "$BACKUP_DIR/jobs-$TIMESTAMP/" 2>/dev/null || echo "No job files to backup"
    FILE_COUNT=$(find "$BACKUP_DIR/jobs-$TIMESTAMP" -type f | wc -l | tr -d ' ')
    echo "✓ $FILE_COUNT job state files backed up"
else
    echo "⚠ jobs directory not found - skipping"
fi

echo ""

# Create manifest
MANIFEST_FILE="$BACKUP_DIR/manifest-$TIMESTAMP.txt"
cat > "$MANIFEST_FILE" << EOF
Shadow Atlas Emergency Backup Manifest
=====================================
Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Unix Timestamp: $TIMESTAMP
Reason: $REASON
Created by: $(whoami)@$(hostname)

Files:
EOF

ls -lh "$BACKUP_DIR" | grep "$TIMESTAMP" >> "$MANIFEST_FILE"

echo "✓ Manifest created: $MANIFEST_FILE"

echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "Emergency Backup Complete"
echo "────────────────────────────────────────────────────────────────"
echo "Backup location: $BACKUP_DIR"
echo "Timestamp: $TIMESTAMP"
echo ""
echo "Files created:"
ls -lh "$BACKUP_DIR" | grep "$TIMESTAMP"
echo ""
echo "To restore from this backup:"
echo "  cp $BACKUP_DIR/persistence-emergency-$TIMESTAMP.db .shadow-atlas/persistence.db"
echo "  cp $BACKUP_DIR/metrics-emergency-$TIMESTAMP.db .shadow-atlas/metrics.db"
echo ""
echo "⚠ IMPORTANT: Verify backup integrity before using!"
echo "  sqlite3 $BACKUP_DIR/persistence-emergency-$TIMESTAMP.db \"PRAGMA integrity_check;\""
echo "════════════════════════════════════════════════════════════════"
