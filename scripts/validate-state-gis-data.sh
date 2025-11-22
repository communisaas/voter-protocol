#!/bin/bash
#
# State GIS Data Validation Script
# Validates downloaded municipal boundary GeoJSON files
# Created: 2025-11-15
#

cd /Users/noot/Documents/voter-protocol/packages/crypto/data/state-clearinghouses

echo "=== Municipal Boundary GeoJSON Validation ==="
echo ""

total_features=0
completed_states=0

for state in CA TX PA NY OH WI MI MN IA KS; do
    if [ -f "${state}.geojson" ]; then
        count=$(/opt/homebrew/bin/ogrinfo -al -so ${state}.geojson 2>/dev/null | grep "Feature Count" | awk '{print $3}')
        size=$(ls -lh ${state}.geojson | awk '{print $5}')

        echo "✅ ${state}: ${count} municipalities (${size})"
        total_features=$((total_features + count))
        completed_states=$((completed_states + 1))
    else
        echo "❌ ${state}: FILE NOT FOUND"
    fi
done

echo ""
echo "=== SUMMARY ==="
echo "Completed: ${completed_states}/10 states"
echo "Total municipalities: ${total_features}"
echo "Target: ~7,200 municipalities (36% of US)"
echo "US Coverage: $(echo "scale=1; $total_features / 19616 * 100" | bc)% of 19,616 total US municipalities"
echo ""

if [ $completed_states -eq 10 ]; then
    echo "🎉 ALL 10 STATES COMPLETE!"
else
    echo "⏳ $(( 10 - completed_states )) states remaining"
fi
