# Coverage CLI Quick Reference

## One-Line Summary

```bash
shadow-atlas diagnose coverage <fips> [options]
```

Enhanced coverage analysis with deep failure diagnosis, pattern recognition, and recovery assessment.

## Common Commands

### Basic Coverage Check
```bash
shadow-atlas diagnose coverage 0666000
```
Shows coverage ratio, verdict, and basic notes.

### Pattern Analysis
```bash
shadow-atlas diagnose coverage 0666000 --categorize
```
Identifies systemic vs one-off failure patterns.

### Recovery Assessment
```bash
shadow-atlas diagnose coverage 0666000 --recovery-potential
```
Finds high-recovery candidates and strategies.

### Deep Dive
```bash
shadow-atlas diagnose coverage 0666000 --layer-diagnostics
```
Per-layer details with metadata and geocoding.

### Comprehensive (Recommended)
```bash
shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential --layer-diagnostics
```
Complete analysis with all insights.

### Large Analysis
```bash
shadow-atlas diagnose coverage 0666000 --deep --limit 300
```
Analyze more layers (default: 50).

### JSON Export
```bash
shadow-atlas diagnose coverage 0666000 --deep --json > analysis.json
```
Machine-readable output for automation.

## Options Reference

| Option | Short | Effect | Use When |
|--------|-------|--------|----------|
| `--deep` | - | Enable deep analysis | Want failure insights |
| `--categorize` | - | Pattern breakdown | Identifying systemic issues |
| `--recovery-potential` | - | Recovery assessment | Prioritizing fixes |
| `--layer-diagnostics` | - | Per-layer details | Deep debugging |
| `--limit <n>` | - | Analyze N layers | Customizing depth |
| `--include-water` | - | Water area analysis | Coastal cities |
| `--vintage-compare` | - | TIGER vintage comparison | Historical analysis |
| `--verbose` | `-v` | Detailed output | More context |
| `--json` | - | JSON output | Automation |
| `--help` | `-h` | Show help | Learn more |

## Output Sections

### Always Shown
- City name, state, FIPS
- Coverage ratio (%)
- Verdict (PASS/FAIL/WARN)

### With `--deep`
- Total analyzed
- Unresolved count
- Geographic distribution

### With `--categorize`
- Systemic issues (>20%)
- One-off issues (<20%)
- Remediation paths
- Examples per category

### With `--recovery-potential`
- Recovery distribution (HIGH/MEDIUM/LOW/NONE)
- Top recovery candidates
- Specific strategies

### With `--layer-diagnostics`
- Per-layer failure details
- Metadata analysis
- Centroid results
- Geocoding results
- Recovery strategy

## Failure Categories

### Infrastructure (Systemic)
- `METADATA_TIMEOUT` - Service timeouts
- `QUERY_TIMEOUT` - Query execution timeout
- `GEOCODE_TIMEOUT` - Geocoding timeout

### Data Issues (One-off)
- `NO_FEATURES` - Empty result set
- `NO_GEOMETRY` - Missing geometry
- `NO_EXTENT` - Missing extent metadata

### Geographic (Special)
- `NOT_INCORPORATED_PLACE` - County but not city
- `OUTSIDE_CONUS` - International/territories
- `NO_CENSUS_PLACE` - Not in Census

### Errors (Investigation)
- `METADATA_HTTP_ERROR` - HTTP 4xx/5xx
- `QUERY_HTTP_ERROR` - Query HTTP error
- `QUERY_ERROR` - Query execution error
- `GEOMETRY_PARSE_ERROR` - Cannot parse geometry

## Recovery Potential

| Level | Meaning | Action |
|-------|---------|--------|
| **HIGH** | Quick wins | Retry with adjustments |
| **MEDIUM** | Alternative strategy | Try different geocoder |
| **LOW** | Manual work | Investigate individually |
| **NONE** | Out of scope | Mark as excluded |

## Systemic Detection

**Threshold:** 20%

If a failure category affects >20% of layers, it's marked **SYSTEMIC** and should be prioritized.

Example:
```
SYSTEMIC ISSUES (>20% of failures):

  QUERY_TIMEOUT - 87 occurrences (28.8%)
    Remediation: SYSTEMIC: Increase timeout, reduce query complexity
                 - affects >20% of layers, prioritize fix
```

## Progressive Disclosure

```
Level 1: Basic         shadow-atlas diagnose coverage <fips>
         ↓
Level 2: Deep          + --deep
         ↓
Level 3: Categorized   + --categorize
         ↓
Level 4: Recovery      + --recovery-potential
         ↓
Level 5: Comprehensive + --layer-diagnostics
```

Choose the level that matches your needs.

## Script Replacement

### Replace analyze-remaining-failures.ts
```bash
# Old
npx tsx src/scripts/analyze-remaining-failures.ts

# New
shadow-atlas diagnose coverage 0666000 --categorize --limit 302
```

### Replace analyze-unresolved.ts
```bash
# Old
npx tsx src/scripts/analyze-unresolved.ts

# New
shadow-atlas diagnose coverage 0666000 --layer-diagnostics --recovery-potential
```

## JSON Queries (jq)

```bash
# Get systemic issues
jq '.deepAnalysis.failurePatterns[] | select(.isSystemic)' analysis.json

# Get high-recovery candidates
jq '.deepAnalysis.recoveryAssessment.topCandidates[]' analysis.json

# Get category counts
jq '.deepAnalysis.failurePatterns[] | {category, count}' analysis.json

# Get geographic distribution
jq '.deepAnalysis.geographicClassification' analysis.json
```

## Performance

| Layers | Time | Network Requests |
|--------|------|------------------|
| 50 (default) | ~30s | ~140 |
| 100 | ~1min | ~280 |
| 300 | ~3-5min | ~840 |

Use `--limit` to control.

## Tips

1. **Start small**: Use default limit (50) for initial analysis
2. **Identify patterns**: Use `--categorize` to find systemic issues
3. **Prioritize fixes**: Use `--recovery-potential` to find quick wins
4. **Deep dive**: Use `--layer-diagnostics` for specific investigations
5. **Export results**: Use `--json` for analysis and tracking

## Examples

### Daily Operations
```bash
# Quick check
shadow-atlas diagnose coverage 0666000

# Weekly review
shadow-atlas diagnose coverage 0666000 --categorize > weekly-report.txt

# Recovery planning
shadow-atlas diagnose coverage 0666000 --recovery-potential --json > recovery.json
```

### Debugging
```bash
# Investigate specific category
shadow-atlas diagnose coverage 0666000 --layer-diagnostics --limit 10

# Full analysis
shadow-atlas diagnose coverage 0666000 --categorize --recovery-potential --layer-diagnostics
```

### Automation
```bash
# CI/CD check
shadow-atlas diagnose coverage 0666000 --categorize --json | \
  jq -e '.deepAnalysis.failurePatterns[] | select(.isSystemic) | .count > 50' && \
  echo "Alert: High systemic failure count"

# Metric tracking
shadow-atlas diagnose coverage 0666000 --recovery-potential --json | \
  jq '.deepAnalysis.recoveryAssessment.high' > metrics/recovery.txt
```

## Help

```bash
shadow-atlas diagnose coverage --help
```

Full documentation: `docs/ENHANCED-COVERAGE-CLI.md`

---

**Quick Start:** `shadow-atlas diagnose coverage <fips> --categorize --recovery-potential`
