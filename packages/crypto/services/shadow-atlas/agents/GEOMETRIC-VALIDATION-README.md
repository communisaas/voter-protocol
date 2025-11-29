# Shadow Atlas Layer 3: Geometric Validation

## Overview

This is the single source for Layer 3: pipeline description, validators, and how we test IoU/geometry fetching. Former Layer3 implementation summary and test guides are consolidated here.

## Testing quick notes
- `python3 test_geometric_validator.py` – unit coverage for validators and geometry parsing.
- `python3 test_geometric_simple.py` – sanity checks on self-intersection/degenerate rings.
- `python3 test_geometric_fetching.py` (after installing shapely/requests) – exercises live fetch + IoU path.

Validates geometry quality for 31,316 district boundaries before Merkle tree construction. Ensures only valid, well-formed polygons enter the ZK proof system.

## Validation Checks

### 1. Self-Intersection Detection
- **Tool**: Shapely `is_valid` + `explain_validity()`
- **Repair**: Attempts `buffer(0)` to fix self-intersections
- **Result**: `PASS`, `REPAIRED`, or `FAIL`

### 2. Area Validation
- **Projection**: WGS84 → Albers Equal Area Conic (ESRI:102003)
- **Context-Aware Bounds**:
  - City council: 0.01 km² to 10,000 km²
  - County: 10 km² to 50,000 km²
  - Congressional: 100 km² to 200,000 km²
  - Default: 0.01 km² to 1,000,000 km²
- **Result**: `PASS`, `WARNING` (unusual but acceptable), or `FAIL` (data error)

### 3. Coordinate Validation
- **Bounds**: lat ∈ [-90°, 90°], lon ∈ [-180°, 180°]
- **NaN/Inf Check**: Detects invalid floating-point values
- **Result**: `PASS` or `FAIL` (immediate rejection)

### 4. Degeneracy Detection
- **Empty geometries**: Polygon with no area
- **Zero-area slivers**: Collapsed polygons from bad digitization
- **Too few points**: <4 points (need 3 unique + closing point)
- **Result**: `PASS` or `FAIL` (immediate rejection)

### 5. Closed Rings
- **Check**: First point = last point for all rings
- **Note**: Shapely auto-closes rings, but we verify input was valid
- **Result**: `PASS` or `FAIL`

## Quality Tiers

### HIGH_QUALITY (56% expected)
- ✅ All checks pass
- ✅ Valid geometry, reasonable area
- ✅ Ready for Merkle tree

### MEDIUM_QUALITY (11% expected)
- ⚠️ Minor issues: geometry repaired OR unusual area (but within 2x bounds)
- ✅ Usable, but flagged for review

### LOW_QUALITY (2% expected)
- ⚠️ Multiple warnings: repaired geometry + unusual area
- ⚠️ Needs manual review before production

### REJECTED (31% expected)
- ❌ Invalid geometry (cannot repair)
- ❌ Invalid coordinates (lat > 90°, lon > 180°)
- ❌ Degenerate geometry (empty, zero-area)
- ❌ Non-polygon layers (already filtered in Layer 1)

## Architecture

### Sample-Based Validation
- **Strategy**: Fetch 2-3 sample features per layer (not all features)
- **Rationale**: Performance (some layers have 50k+ features)
- **Assumption**: If samples fail, layer likely has widespread issues
- **Trade-off**: May miss isolated bad features, but validates layer-level quality

### Async Concurrent Fetching
- **HTTP Requests**: 10 concurrent requests (configurable)
- **Timeout**: 30 seconds per request
- **Batching**: Process 50 layers per batch with checkpointing
- **Performance**: ~10-15 layers/second (varies by API response time)

### Output Format

Each layer augmented with validation metadata:

```json
{
  "layer_name": "City Council Districts",
  "district_type": "city_council",
  "tier": "GOLD",
  "confidence": 0.75,
  "validation": {
    "quality": "HIGH_QUALITY",
    "is_valid": true,
    "area_km2": 113.6,
    "coordinate_bounds": {
      "min_lat": 29.446,
      "max_lat": 29.563,
      "min_lon": -98.701,
      "max_lon": -98.522
    },
    "checks": {
      "self_intersection": "PASS",
      "area_bounds": "PASS",
      "coordinate_validity": "PASS",
      "degeneracy": "PASS",
      "closed_rings": "PASS"
    },
    "issues": [],
    "sample_size": 2
  }
}
```

## Usage

### Basic Validation

```bash
source langgraph/venv/bin/activate

# Full dataset (31,316 layers, ~30-45 minutes)
python3 geometric-validator.py \
  --input data/comprehensive_classified_layers.jsonl \
  --output data/geometric_validated_layers.jsonl \
  --report data/geometric_validation_report.json

# Custom parameters
python3 geometric-validator.py \
  --input data/comprehensive_classified_layers.jsonl \
  --output data/geometric_validated_layers.jsonl \
  --report data/geometric_validation_report.json \
  --sample-size 5 \
  --max-concurrent 20
```

### Test on Small Sample

```bash
# Create test sample
head -100 data/comprehensive_classified_layers.jsonl > data/test_sample_100.jsonl

# Validate sample
python3 geometric-validator.py \
  --input data/test_sample_100.jsonl \
  --output data/test_validated_100.jsonl \
  --report data/test_report_100.json \
  --sample-size 2 \
  --max-concurrent 10
```

### View Results

```bash
# View summary report
cat data/geometric_validation_report.json | python3 -m json.tool

# View sample validated layer
head -1 data/geometric_validated_layers.jsonl | python3 -m json.tool

# Filter by quality tier
grep '"quality": "HIGH_QUALITY"' data/geometric_validated_layers.jsonl | wc -l
grep '"quality": "REJECTED"' data/geometric_validated_layers.jsonl | wc -l
```

## Dependencies

Install required packages:

```bash
pip install shapely>=2.0.0 pyproj>=3.4.0 aiohttp>=3.9.0 tqdm>=4.66.0
```

Or use the requirements file:

```bash
pip install -r requirements-geometric-validator.txt
```

## Test Suite

### Unit Tests

```bash
# Run all tests
python3 test_geometric_validator.py -v

# Run specific test
python3 test_geometric_validator.py TestGeometricValidator.test_self_intersecting_bowtie
```

### Manual Tests

```bash
python3 test_geometric_simple.py
```

Test cases:
- ✅ Valid square polygon (HIGH_QUALITY)
- ✅ Self-intersecting bowtie (REPAIRED → MEDIUM_QUALITY or REJECTED)
- ✅ Invalid latitude >90° (REJECTED)
- ✅ Invalid longitude >180° (REJECTED)
- ✅ Empty polygon (REJECTED)
- ✅ Zero-area sliver (REJECTED)
- ✅ Too few points (REJECTED)
- ✅ Area too small (WARNING or REJECTED)
- ✅ Area too large (WARNING or REJECTED)
- ✅ Context-aware area validation (city_council vs congressional)

## Expected Results (100-layer Test)

```
Total layers: 100
Polygon layers: 75

Quality Distribution:
  HIGH_QUALITY   :     56 ( 56.0%)
  MEDIUM_QUALITY :     11 ( 11.0%)
  LOW_QUALITY    :      2 (  2.0%)
  REJECTED       :     31 ( 31.0%)

Check Failures:
  self_intersection   :      4
  area_bounds         :     13
  coordinate_validity :      0
  degeneracy          :      0
  closed_rings        :      0

Geometry Repairs:
  Attempted: 4
  Successful: 4
```

## Performance

- **100 layers**: ~6 seconds (~15 layers/second)
- **31,316 layers**: ~30-45 minutes (estimated)
- **Bottleneck**: ArcGIS REST API response time (varies by server load)
- **Optimization**: Increase `--max-concurrent` (default: 10, max: 50)

## Next Steps

### Layer 4: Deduplication
- Input: `geometric_validated_layers.jsonl`
- Process: Cross-source validation (IoU + name similarity)
- Output: `deduplicated_layers.jsonl`

### Layer 5: Merkle Tree Construction
- Input: `deduplicated_layers.jsonl`
- Process: Build Poseidon hash tree for ZK proofs
- Output: `shadow_atlas_merkle_tree.json` + IPFS CID

## Validation Philosophy

**Cryptographic proofs require cryptographic-grade data quality.**

Invalid geometry = broken ZK proofs. This layer ensures only valid, well-formed polygons enter the Shadow Atlas.

**Quality discourse pays. Bad faith costs.**
