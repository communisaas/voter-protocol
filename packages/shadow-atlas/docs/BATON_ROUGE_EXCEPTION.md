# Baton Rouge (FIPS 2205000) - Consolidated City-Parish Exception

## Classification: LEGITIMATE EXCEPTION (NOT quarantined)

**Date**: 2026-01-16
**Analysis**: WS-3 Containment Failure Remediation

## Summary

Baton Rouge (FIPS 2205000) shows 81.1% containment overflow (987.65 sq km outside city boundary) but is **NOT** a data curation error. This is a **legitimate consolidated city-parish government** where the governing body represents a geographic area larger than the Census city boundary.

## Government Structure

- **Entity**: City of Baton Rouge and Parish of East Baton Rouge
- **Consolidation Date**: January 1, 2019 (city-parish consolidation)
- **Governing Body**: Metro Council (12 districts)
- **Coverage**: Full East Baton Rouge Parish (not just city limits)

## Why This Is Not a Data Error

1. **Consolidated Government**: City and parish merged governance in 2019
2. **Metro Council Authority**: 12 districts cover entire parish jurisdiction
3. **Expected Overflow**: Census "place" boundary is city proper; Metro Council represents parish
4. **Correct Data**: Registry correctly contains Metro Council districts (parish-wide)

## Comparison to Similar Cases

### Legitimate Consolidations (NOT quarantined):
- **Baton Rouge, LA** (2205000): City-Parish Metro Council (81.1% overflow expected)
- **Louisville, KY** (2148000): City-County consolidated (78.4% overflow expected)
- **Indianapolis, IN** (1836003): Unigov consolidated city-county

### Wrong Data (Quarantined):
- **Morgan City, LA** (2252040): St. Mary Parish data, NOT consolidated (99.5% overflow)
- **Cool Valley, MO** (2916228): St. Louis County data, separate city (99.9% overflow)

## Remediation Decision

**Action**: KEEP in known-portals registry
**Rationale**: Overflow reflects accurate representation of consolidated governance structure
**Note**: Should be added to `CONSOLIDATED_CITY_COUNTY_EXCEPTIONS` list in codebase

## Data Source

- **URL**: https://services2.arcgis.com/82iS1Pc7dgs3LFZv/arcgis/rest/services/Council_District/FeatureServer/0/
- **Features**: 12 districts
- **Authority**: East Baton Rouge Parish Metro Council
- **Confidence**: 63 (automated discovery)
- **Last Verified**: 2026-01-15

## References

- Louisiana Revised Statutes Title 33, Chapter 7 (Parish and Municipal Governmental Structure)
- Baton Rouge City-Parish Charter (consolidated government structure)
- WS-3 Containment Failure Analysis (containment-failure-analysis.md)
