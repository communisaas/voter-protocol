#!/bin/bash

# ============================================================
# Shadow Atlas - Live Batch Monitoring
# ============================================================
#
# PURPOSE: Real-time monitoring of batch discovery progress
# USAGE: bash scripts/monitor-batch.sh
# INTERVAL: Updates every 10 seconds
#
# ============================================================

SHADOW_ATLAS_DIR="/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas"
PROVENANCE_DIR="$SHADOW_ATLAS_DIR/discovery-attempts"
CURRENT_MONTH=$(date +%Y-%m)

clear

watch -n 10 "
echo '╔══════════════════════════════════════════════════════╗'
echo '║   SHADOW ATLAS - BATCH MONITOR                      ║'
echo '╚══════════════════════════════════════════════════════╝'
echo ''
echo 'Updated: $(date "+%Y-%m-%d %H:%M:%S")'
echo ''

# Provenance entries count
ENTRY_COUNT=\$(zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | wc -l | xargs)
echo '📊 Provenance Entries: '\$ENTRY_COUNT
echo ''

# Recent discoveries (last 5)
echo '🔍 Recent Discoveries (last 5):'
zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | \
  tail -5 | \
  jq -r '\"  \" + .n + \", \" + .s + \" (Tier \" + (.g | tostring) + \")\"'
echo ''

# Success rate
TOTAL=\$(zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | wc -l | xargs)
SUCCESS=\$(zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | jq -r 'select(.blocked == null)' | wc -l | xargs)
if [ \$TOTAL -gt 0 ]; then
  SUCCESS_RATE=\$((SUCCESS * 100 / TOTAL))
  echo \"✅ Success Rate: \$SUCCESS/\$TOTAL (\${SUCCESS_RATE}%)\"
else
  echo '✅ Success Rate: 0/0 (waiting for discoveries...)'
fi
echo ''

# Tier breakdown
echo '📈 Tier Breakdown:'
zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | \
  jq -r 'select(.blocked == null) | .g' | \
  sort | uniq -c | \
  awk '{print \"  Tier \" \$2 \": \" \$1 \" cities\"}'
echo ''

# Top blockers
echo '🚫 Top Blockers:'
zcat \"$PROVENANCE_DIR/$CURRENT_MONTH\"/*.ndjson.gz 2>/dev/null | \
  jq -r 'select(.blocked != null) | .blocked' | \
  sort | uniq -c | sort -rn | head -5 | \
  awk '{print \"  \" \$2 \": \" \$1}'
echo ''

# System resources
echo '💻 System Resources:'
CPU_USAGE=\$(top -l 1 | grep \"CPU usage\" | awk '{print \$3}' | sed 's/%//')
MEMORY_FREE_GB=\$(vm_stat | grep \"Pages free\" | awk '{print int(\$3 * 4096 / 1024 / 1024 / 1024)}')
DISK_FREE_GB=\$(df -g . | awk 'NR==2 {print \$4}')

echo \"  CPU Usage: \${CPU_USAGE}%\"
echo \"  Memory Free: \${MEMORY_FREE_GB}GB\"
echo \"  Disk Free: \${DISK_FREE_GB}GB\"
echo ''

echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo 'Press Ctrl+C to exit monitor'
"
