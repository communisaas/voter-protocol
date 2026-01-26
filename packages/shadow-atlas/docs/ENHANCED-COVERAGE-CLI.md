# Enhanced Coverage CLI Command

## Overview

The `shadow-atlas diagnose coverage` command has been significantly enhanced to fully subsume the functionality of two analysis scripts:
- `analyze-remaining-failures.ts`
- `analyze-unresolved.ts`

This enhancement provides **unified failure taxonomy**, **actionable insights**, **progressive disclosure**, and **pattern recognition** capabilities directly through the CLI.

## Mission Accomplished

### Scripts Subsumed

#### 1. `analyze-remaining-failures.ts`
**Original Capabilities:**
- Analyzed 302 remaining unresolved layers
- Categorized failures into patterns
- Extracted metadata, centroid, and geocoding results
- Generated failure category breakdown

**Now Available Via:**
```bash
shadow-atlas diagnose coverage <fips> --deep --categorize
```

#### 2. `analyze-unresolved.ts`
**Original Capabilities:**
- Analyzed edge case layers from results
- Grouped failures by primary reason
- Provided geographic classification
- Generated detailed failure reports

**Now Available Via:**
```bash
shadow-atlas diagnose coverage <fips> --layer-diagnostics --recovery-potential
```

## Architecture

### Unified Failure Taxonomy

The CLI now implements a comprehensive failure categorization system:

```typescript
type FailureCategory =
  | 'METADATA_TIMEOUT'      // Service timeouts
  | 'METADATA_HTTP_ERROR'   // HTTP errors (4xx, 5xx)
  | 'METADATA_ERROR'        // Parse or network errors
  | 'NO_EXTENT'             // Missing extent metadata
  | 'QUERY_TIMEOUT'         // Query execution timeout
  | 'QUERY_HTTP_ERROR'      // Query HTTP errors
  | 'QUERY_ERROR'           // Query execution errors
  | 'NO_FEATURES'           // Empty result set
  | 'NO_GEOMETRY'           // Feature without geometry
  | 'GEOMETRY_PARSE_ERROR'  // Cannot parse geometry
  | 'GEOCODE_TIMEOUT'       // Geocoding timeout
  | 'GEOCODE_HTTP_ERROR'    // Geocoding HTTP error
  | 'NOT_INCORPORATED_PLACE' // County but not city
  | 'OUTSIDE_CONUS'         // International/territories
  | 'NO_CENSUS_PLACE'       // No Census place found
  | 'UNKNOWN';              // Uncategorized
```

### Recovery Potential Assessment

Each failure is assessed for recovery potential:

```typescript
type RecoveryPotential = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

// HIGH: Temporary issues, retry with adjustments
// - Timeout-related failures
// - Metadata available but query failed

// MEDIUM: Alternative strategy required
// - International locations
// - Non-incorporated places
// - Has centroid but geocoding failed

// LOW: Manual investigation needed
// - No features or geometry
// - HTTP errors (permissions, deprecation)

// NONE: Out of project scope
// - Confirmed international/territories
// - Fundamental data issues
```

### Pattern Recognition

The system distinguishes between:

**Systemic Issues (>20% of failures):**
- Indicates infrastructure or process problems
- Requires systematic remediation
- Flagged with "SYSTEMIC:" prefix

**One-off Issues (<20% of failures):**
- Individual layer problems
- Can be addressed case-by-case
- Lower priority for automation

## Progressive Disclosure

The CLI provides five levels of analysis depth:

### Level 1: Basic (Default)
```bash
shadow-atlas diagnose coverage 0666000
```
**Output:**
- Coverage metrics (boundary area, district area, ratio)
- Verdict (PASS/FAIL/WARN)
- Basic notes

### Level 2: Deep Analysis
```bash
shadow-atlas diagnose coverage 0666000 --deep
```
**Output:**
- Level 1 +
- Failure analysis summary
- Geographic distribution (domestic/international)
- Total unresolved count

### Level 3: Categorized Patterns
```bash
shadow-atlas diagnose coverage 0666000 --categorize
```
**Output:**
- Level 2 +
- Systemic vs one-off pattern breakdown
- Failure category statistics
- Remediation paths for each category
- Examples for top categories

### Level 4: Recovery Assessment
```bash
shadow-atlas diagnose coverage 0666000 --recovery-potential
```
**Output:**
- Level 2 +
- Recovery potential distribution
- Top recovery candidates (HIGH/MEDIUM potential)
- Specific recovery strategies per layer

### Level 5: Comprehensive
```bash
shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential --layer-diagnostics
```
**Output:**
- All previous levels +
- Per-layer diagnostic details
- Metadata analysis
- Centroid and geocoding results
- Individual recovery strategies

## Actionable Insights

### Remediation Paths

Each failure category includes specific remediation guidance:

| Category | Remediation Path |
|----------|------------------|
| METADATA_TIMEOUT | Implement retry logic with exponential backoff |
| QUERY_TIMEOUT | Increase timeout, reduce query complexity |
| NO_FEATURES | Verify layer has data, check query filters |
| NOT_INCORPORATED_PLACE | Use county-level or alternative resolution strategy |
| OUTSIDE_CONUS | Implement international geocoding or mark as out-of-scope |

### Recovery Strategies

Top recovery candidates are prioritized with specific strategies:

```
Top Recovery Candidates:

1. CouncilDistricts Layer [HIGH]
   URL: https://services.arcgis.com/.../FeatureServer/2
   Strategy: Retry with increased timeout and rate limiting
   Location: 41.5034, -81.6934

2. District Boundaries [MEDIUM]
   URL: https://gis.cityname.gov/.../FeatureServer/0
   Strategy: Try alternative geocoding services (Nominatim, Geocodio)
   Location: 34.0522, -118.2437
```

## Key Capabilities

### 1. Failure Pattern Categorization
Automatically identifies and categorizes all failure types, distinguishing between:
- Infrastructure issues (timeouts, HTTP errors)
- Data issues (missing geometry, empty features)
- Geographic issues (international, non-incorporated)

### 2. Recovery Potential Assessment
Evaluates each failure for recovery feasibility:
- Identifies quick wins (HIGH potential)
- Suggests alternative strategies (MEDIUM)
- Flags manual investigation needs (LOW)
- Marks out-of-scope items (NONE)

### 3. International vs Domestic Classification
Automatically classifies layers by geography:
- Domestic (CONUS): Uses Census geocoding
- International: Requires alternative geocoding
- Unknown: Needs manual investigation

### 4. Per-Layer Diagnostics
Provides detailed analysis for each layer:
- Metadata availability and quality
- Geometry extraction results
- Geocoding results and confidence
- Specific recovery strategy

## Usage Examples

### Analyze System-Wide Patterns
```bash
# Identify systemic issues affecting >20% of failures
shadow-atlas diagnose coverage 0666000 --categorize

# Output shows:
# SYSTEMIC ISSUES (>20% of failures):
#   QUERY_TIMEOUT - 87 occurrences (28.8%)
#     Remediation: SYSTEMIC: Increase timeout, reduce query complexity
```

### Find Quick Wins
```bash
# Identify high-recovery-potential layers
shadow-atlas diagnose coverage 0666000 --recovery-potential

# Output shows:
# Recovery Distribution:
#   HIGH:   42 (13.9%) - Quick wins, retry with adjustments
#   MEDIUM: 78 (25.8%) - Requires alternative strategy
```

### Deep Dive Investigation
```bash
# Get per-layer diagnostics for detailed investigation
shadow-atlas diagnose coverage 0666000 --layer-diagnostics --limit 100

# Output shows full details for each layer including:
# - Failure reason
# - Metadata analysis
# - Centroid extraction
# - Geocoding results
# - Recovery strategy
```

### Comprehensive Analysis
```bash
# All analysis layers for complete picture
shadow-atlas diagnose coverage 0666000 \
  --categorize \
  --recovery-potential \
  --layer-diagnostics \
  --limit 200

# Generates complete report with:
# - Pattern analysis
# - Recovery assessment
# - Layer-by-layer diagnostics
```

### Automation-Friendly Output
```bash
# JSON output for automated processing
shadow-atlas diagnose coverage 0666000 --deep --json > analysis.json

# Parse with jq:
jq '.deepAnalysis.failurePatterns[] | select(.isSystemic)' analysis.json
```

## Performance Considerations

### Default Limits
- Default analysis limit: 50 layers
- Prevents excessive API calls
- Provides representative sample

### Custom Limits
```bash
# Analyze more layers for comprehensive coverage
shadow-atlas diagnose coverage 0666000 --deep --limit 200

# Analyze all layers (may take 10+ minutes)
shadow-atlas diagnose coverage 0666000 --deep --limit 1000
```

### Progress Feedback
Non-JSON mode shows progress:
```
Deep Analysis: Analyzing 50 unresolved layers...
  Progress: 10/50
  Progress: 20/50
  Progress: 30/50
  ...
```

## Integration with Existing Workflows

### Replace Script Usage

**Before:**
```bash
# Run separate scripts
npx tsx src/scripts/analyze-remaining-failures.ts
npx tsx src/scripts/analyze-unresolved.ts
```

**After:**
```bash
# Single unified command
shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential
```

### CI/CD Integration
```bash
# Check for systemic issues in CI
if shadow-atlas diagnose coverage 0666000 --categorize --json | \
   jq -e '.deepAnalysis.failurePatterns[] | select(.isSystemic)' > /dev/null; then
  echo "⚠️  Systemic issues detected"
  exit 1
fi
```

### Monitoring and Alerting
```bash
# Track recovery potential over time
shadow-atlas diagnose coverage 0666000 --recovery-potential --json | \
  jq '.deepAnalysis.recoveryAssessment.high' > metrics/recovery_potential.txt
```

## Distinguished Engineering Principles

### 1. Unified Failure Taxonomy
- Single source of truth for failure categorization
- Consistent terminology across analysis
- Extensible for new failure types

### 2. Actionable Insights
- Every failure includes remediation path
- Recovery potential guides prioritization
- Specific strategies for each layer

### 3. Progressive Disclosure
- Basic → Deep → Comprehensive levels
- Users choose analysis depth
- Prevents information overload

### 4. Pattern Recognition
- Systemic vs one-off classification
- Percentage-based thresholds (20%)
- Prioritizes infrastructure fixes

### 5. Geographic Awareness
- Domestic/international classification
- Appropriate geocoding strategy per region
- Out-of-scope detection

## Migration Guide

### For Script Users

If you were using `analyze-remaining-failures.ts`:
```bash
# Old
npx tsx src/scripts/analyze-remaining-failures.ts

# New
shadow-atlas diagnose coverage 0666000 --categorize --limit 302
```

If you were using `analyze-unresolved.ts`:
```bash
# Old
npx tsx src/scripts/analyze-unresolved.ts

# New
shadow-atlas diagnose coverage 0666000 --layer-diagnostics --recovery-potential
```

### Script Deprecation

The following scripts can now be removed:
- `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/src/scripts/analyze-remaining-failures.ts`
- `/Users/noot/Documents/voter-protocol/packages/shadow-atlas/src/scripts/analyze-unresolved.ts`

All functionality is now available through:
```bash
shadow-atlas diagnose coverage
```

## Future Enhancements

### Potential Additions
1. **Historical Trend Analysis**: Compare recovery potential over time
2. **Batch Processing**: Analyze multiple FIPS codes in parallel
3. **Automated Retry**: Execute recovery strategies automatically
4. **Provider Health**: Track ArcGIS endpoint availability
5. **Custom Categorization**: User-defined failure patterns

## Conclusion

The enhanced `shadow-atlas diagnose coverage` command provides:
- ✅ **Unified interface** for all coverage analysis
- ✅ **Deep failure analysis** with pattern recognition
- ✅ **Actionable insights** with specific remediation paths
- ✅ **Progressive disclosure** from basic to comprehensive
- ✅ **Recovery assessment** to prioritize fixes
- ✅ **Geographic classification** for appropriate strategies

**Both analysis scripts are now fully subsumed and can be deprecated.**
