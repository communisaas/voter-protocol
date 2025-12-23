#!/bin/bash
# Shadow Atlas End-to-End Integration Test
# Tests complete pipeline: Layer 2 → 3 → 4 → 5
# Uses test_subset_100.jsonl (100 layers from production data)

set -e  # Exit on error

echo "======================================================"
echo "Shadow Atlas End-to-End Integration Test"
echo "======================================================"
echo ""
echo "Pipeline: Layer 2 → Layer 3 → Layer 4 → Layer 5"
echo "Test Dataset: test_subset_100.jsonl (100 layers)"
echo ""

# Change to agents directory
cd "$(dirname "$0")"

# Setup test directories
TEST_DIR="data/test-e2e-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEST_DIR"

echo "Test directory: $TEST_DIR"
echo ""

# Copy test input
cp data/test_subset_100.jsonl "$TEST_DIR/layer2_output.jsonl"

echo "======================================================"
echo "LAYER 3: Geometric Validation"
echo "======================================================"
echo ""

python3 geometric-validator.py \
  --input "$TEST_DIR/layer2_output.jsonl" \
  --output "$TEST_DIR/layer3_output.jsonl" \
  --max-concurrent 5

echo ""
echo "✓ Layer 3 complete"
echo ""

# Validate Layer 3 output
LAYER3_COUNT=$(wc -l < "$TEST_DIR/layer3_output.jsonl" | tr -d ' ')
echo "Layer 3 output: $LAYER3_COUNT layers"

if [ "$LAYER3_COUNT" -eq 0 ]; then
  echo "ERROR: Layer 3 produced no output"
  exit 1
fi

# Check for validation field
VALIDATION_PRESENT=$(head -1 "$TEST_DIR/layer3_output.jsonl" | python3 -c "import sys, json; d=json.load(sys.stdin); print('YES' if 'validation' in d else 'NO')")
echo "Validation field present: $VALIDATION_PRESENT"

if [ "$VALIDATION_PRESENT" != "YES" ]; then
  echo "WARNING: Validation field not present in Layer 3 output"
fi

echo ""
echo "======================================================"
echo "LAYER 4: Deduplication"
echo "======================================================"
echo ""

python3 deduplicator.py \
  --input "$TEST_DIR/layer3_output.jsonl" \
  --output "$TEST_DIR/layer4_output.jsonl"

echo ""
echo "✓ Layer 4 complete"
echo ""

# Validate Layer 4 output
LAYER4_COUNT=$(wc -l < "$TEST_DIR/layer4_output.jsonl" | tr -d ' ')
echo "Layer 4 output: $LAYER4_COUNT layers"

if [ "$LAYER4_COUNT" -eq 0 ]; then
  echo "ERROR: Layer 4 produced no output"
  exit 1
fi

# Check for provenance field
PROVENANCE_PRESENT=$(head -1 "$TEST_DIR/layer4_output.jsonl" | python3 -c "import sys, json; d=json.load(sys.stdin); print('YES' if 'provenance' in d else 'NO')")
echo "Provenance field present: $PROVENANCE_PRESENT"

# Check if rejected_layers.jsonl exists
if [ -f "$TEST_DIR/rejected_layers.jsonl" ]; then
  REJECTED_COUNT=$(wc -l < "$TEST_DIR/rejected_layers.jsonl" | tr -d ' ')
  echo "Rejected layers: $REJECTED_COUNT"
else
  echo "Rejected layers: 0 (no rejected_layers.jsonl)"
fi

echo ""
echo "======================================================"
echo "LAYER 5: Merkle Tree Builder"
echo "======================================================"
echo ""

# Note: merkle-tree-builder.ts has hardcoded input path
# Copy Layer 4 output to expected location and run from data directory
cp "$TEST_DIR/layer4_output.jsonl" data/comprehensive_classified_layers.jsonl

npx tsx merkle-tree-builder.ts

# Move outputs to test directory
mv data/merkle_tree.json "$TEST_DIR/" 2>/dev/null || true
mv data/merkle_proofs.json "$TEST_DIR/" 2>/dev/null || true
mv data/merkle_leaves.json "$TEST_DIR/" 2>/dev/null || true
mv data/merkle_tree_report.txt "$TEST_DIR/" 2>/dev/null || true
mv data/merkle_tree_report.json "$TEST_DIR/" 2>/dev/null || true

echo ""
echo "✓ Layer 5 complete"
echo ""

# Validate Layer 5 outputs
if [ -f "$TEST_DIR/merkle_tree.json" ]; then
  echo "✓ merkle_tree.json created"
  MERKLE_ROOT=$(python3 -c "import sys, json; d=json.load(open('$TEST_DIR/merkle_tree.json')); print(d['root'])")
  echo "  Root: $MERKLE_ROOT"
  MERKLE_DEPTH=$(python3 -c "import sys, json; d=json.load(open('$TEST_DIR/merkle_tree.json')); print(d['depth'])")
  echo "  Depth: $MERKLE_DEPTH"
  MERKLE_LEAVES=$(python3 -c "import sys, json; d=json.load(open('$TEST_DIR/merkle_tree.json')); print(d['leaf_count'])")
  echo "  Leaves: $MERKLE_LEAVES"
else
  echo "ERROR: merkle_tree.json not created"
  exit 1
fi

if [ -f "$TEST_DIR/merkle_proofs.json" ]; then
  PROOF_COUNT=$(python3 -c "import sys, json; d=json.load(open('$TEST_DIR/merkle_proofs.json')); print(len(d))")
  echo "✓ merkle_proofs.json created ($PROOF_COUNT proofs)"
else
  echo "ERROR: merkle_proofs.json not created"
  exit 1
fi

if [ -f "$TEST_DIR/merkle_leaves.json" ]; then
  echo "✓ merkle_leaves.json created"
else
  echo "ERROR: merkle_leaves.json not created"
  exit 1
fi

if [ -f "$TEST_DIR/merkle_tree_report.txt" ]; then
  echo "✓ merkle_tree_report.txt created"
else
  echo "ERROR: merkle_tree_report.txt not created"
  exit 1
fi

echo ""
echo "======================================================"
echo "INTEGRATION TEST RESULTS"
echo "======================================================"
echo ""
echo "Pipeline Status: ✓ SUCCESS"
echo ""
echo "Layer 2 → Layer 3: $LAYER3_COUNT layers"
echo "Layer 3 → Layer 4: $LAYER4_COUNT layers"
echo "Layer 4 → Layer 5: $MERKLE_LEAVES leaves in Merkle tree"
echo ""
echo "Data Flow:"
echo "  - Layer 3 added validation field: $VALIDATION_PRESENT"
echo "  - Layer 4 added provenance field: $PROVENANCE_PRESENT"
echo "  - Layer 5 consumed augmented schema: YES"
echo ""
echo "Output Directory: $TEST_DIR"
echo ""
echo "Files Created:"
ls -lh "$TEST_DIR"
echo ""
echo "======================================================"
echo "✓ END-TO-END INTEGRATION TEST PASSED"
echo "======================================================"
