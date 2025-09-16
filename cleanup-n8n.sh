#!/bin/bash

# Clean up N8N deployment by removing specified workflows

set -e

# Load environment variables
source .env

API_KEY="$N8N_API_KEY"
API_URL="${N8N_INSTANCE_URL}/api/v1"

echo "🧹 Cleaning up N8N deployment"
echo "URL: ${N8N_INSTANCE_URL}"
echo "================================================"

# Function to delete a workflow
delete_workflow() {
    local id="$1"
    
    # Get workflow name
    name=$(curl -s -H "X-N8N-API-KEY: ${API_KEY}" \
        "${API_URL}/workflows/${id}" | \
        jq -r '.name // "Unknown"')
    
    echo -n "🗑️  Deleting '$name' ($id)... "
    
    response=$(curl -s -w "\n%{http_code}" -X DELETE \
        -H "X-N8N-API-KEY: ${API_KEY}" \
        "${API_URL}/workflows/${id}")
    
    status_code=$(echo "$response" | tail -n 1)
    
    if [ "$status_code" = "200" ] || [ "$status_code" = "204" ]; then
        echo "✅ Deleted"
    else
        echo "❌ Failed (HTTP $status_code)"
    fi
}

# Accept workflow IDs as arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 <workflow_id> [workflow_id ...]"
    echo ""
    echo "Current workflows:"
    curl -s -H "X-N8N-API-KEY: ${API_KEY}" "${API_URL}/workflows" | \
        jq -r '.data[] | "\(.id) - \(.name) [\(if .active then "active" else "inactive" end)]"'
    exit 1
fi

# Delete each specified workflow
for workflow_id in "$@"; do
    delete_workflow "$workflow_id"
done

echo "================================================"
echo "✨ Cleanup complete!"
echo ""
echo "📋 Remaining workflows:"
curl -s -H "X-N8N-API-KEY: ${API_KEY}" "${API_URL}/workflows" | \
    jq -r '.data[] | "  \(if .active then "✓" else "○" end) \(.name)"'