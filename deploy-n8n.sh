#!/bin/bash

# Deploy all VOTER Protocol workflows to N8N

set -e

# Load environment variables
source .env

API_KEY="$N8N_API_KEY"
API_URL="${N8N_INSTANCE_URL}/api/v1"
WORKFLOWS_DIR="n8n-workflows"

echo "🚀 Deploying VOTER Protocol workflows to N8N"
echo "URL: ${N8N_INSTANCE_URL}"
echo "================================================"

# Check if cleanup mode
if [ "$1" = "--clean" ]; then
    echo "🧹 Cleaning deployment first..."
    echo ""
    
    # Get all workflow IDs
    ids=$(curl -s -H "X-N8N-API-KEY: ${API_KEY}" "${API_URL}/workflows" | \
        jq -r '.data[].id')
    
    # Delete all existing workflows
    for id in $ids; do
        name=$(curl -s -H "X-N8N-API-KEY: ${API_KEY}" \
            "${API_URL}/workflows/${id}" | jq -r '.name')
        echo -n "  Removing '$name'... "
        curl -s -X DELETE -H "X-N8N-API-KEY: ${API_KEY}" \
            "${API_URL}/workflows/${id}" > /dev/null && echo "✓"
    done
    echo ""
fi

# Function to deploy a workflow
deploy_workflow() {
    local file="$1"
    local name=$(jq -r '.name' "$file")
    
    echo -n "📦 Deploying '$name'... "
    
    # Check if workflow exists
    existing=$(curl -s -H "X-N8N-API-KEY: ${API_KEY}" \
        "${API_URL}/workflows" | \
        jq -r ".data[] | select(.name == \"$name\") | .id" | head -1)
    
    if [ -n "$existing" ]; then
        # Update existing
        response=$(curl -s -X PATCH \
            -H "X-N8N-API-KEY: ${API_KEY}" \
            -H "Content-Type: application/json" \
            -d @"$file" \
            "${API_URL}/workflows/${existing}")
        
        if echo "$response" | jq -e '.data.id' > /dev/null 2>&1; then
            echo "✅ Updated (ID: $existing)"
        else
            echo "❌ Failed"
            echo "$response" | jq '.message // .error' 
        fi
    else
        # Create new
        response=$(curl -s -X POST \
            -H "X-N8N-API-KEY: ${API_KEY}" \
            -H "Content-Type: application/json" \
            -d @"$file" \
            "${API_URL}/workflows")
        
        new_id=$(echo "$response" | jq -r '.data.id // .id' 2>/dev/null)
        
        if [ -n "$new_id" ] && [ "$new_id" != "null" ]; then
            echo "✅ Created (ID: $new_id)"
            
            # Activate it
            curl -s -X POST \
                -H "X-N8N-API-KEY: ${API_KEY}" \
                "${API_URL}/workflows/${new_id}/activate" > /dev/null 2>&1
        else
            echo "❌ Failed"
            echo "$response" | jq '.message // .error'
        fi
    fi
}

# Deploy each workflow
for workflow in "$WORKFLOWS_DIR"/*.json; do
    [ -f "$workflow" ] || continue
    deploy_workflow "$workflow"
done

echo "================================================"
echo ""
echo "📋 Active workflows:"
curl -s -H "X-N8N-API-KEY: ${API_KEY}" "${API_URL}/workflows" | \
    jq -r '.data[] | select(.active == true) | "  ✓ \(.name)"'

echo ""
echo "✨ Deployment complete!"
echo ""
echo "🔧 Next steps:"
echo "  1. Configure database: psql < $WORKFLOWS_DIR/setup-database.sql"
echo "  2. Set environment variables in N8N"
echo "  3. Test workflows with webhook calls"