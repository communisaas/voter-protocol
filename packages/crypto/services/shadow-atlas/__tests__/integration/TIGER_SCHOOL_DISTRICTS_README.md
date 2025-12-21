# TIGER School District Integration Tests

Comprehensive test suite for TIGER school district data integration.

## Overview

School districts are **critical for civic participation** because:
- School boards are directly elected by voters
- School districts manage ~14,000 unified, elementary, and secondary districts nationwide
- Districts often transcend city/county boundaries, requiring precise geospatial verification

## Test Structure

### Integration Tests (`tiger-school-districts.test.ts`)

**Runtime**: ~3-5 minutes
**Environment**: Requires network access to TIGERweb API
**Skip Control**: Set `RUN_INTEGRATION=true` to enable in CI

#### Test Coverage

1. **Point-in-Polygon Queries**
   - Validate known school district coordinates
   - Test major urban districts (Seattle, Los Angeles, Chicago, NYC)
   - Verify consistent results across multiple queries

2. **State-Wide Queries**
   - Fetch all districts for representative states
   - Validate feature counts against expected totals
   - Test unified, elementary, and secondary district types

3. **Data Quality Validation**
   - GeoJSON structure validation
   - GEOID format verification (SSLLLLL pattern)
   - Required properties completeness
   - Coordinate range validation

4. **District Type Handling**
   - Unified districts (K-12, single board)
   - Elementary districts (K-8, paired with secondary)
   - Secondary districts (9-12, paired with elementary)

### Unit Tests (`validators/school-district-validator.test.ts`)

**Runtime**: <1 second
**Environment**: No external dependencies (uses fixtures)

#### Test Coverage

1. **GEOID Validation**
   - Format: `SSLLLLL` (2-digit state FIPS + 5-digit LEA code)
   - State FIPS matching
   - Length and character validation

2. **Property Validation**
   - Required fields: `GEOID`, `NAME`, `STATEFP`
   - Optional fields: `LOGRADE`, `HIGRADE`, `SCSDLEA`, `ELSDLEA`, `SDLEA`
   - Edge cases: empty names, null properties

3. **District Type Detection**
   - Unified: has `SCSDLEA`
   - Elementary: has `ELSDLEA`
   - Secondary: has `SDLEA`

4. **Grade Range Validation**
   - Valid range: `PK` → `12`
   - Elementary range: `KG` → `08`
   - Secondary range: `09` → `12`

5. **Coordinate Validation**
   - WGS84 bounds: longitude [-180, 180], latitude [-90, 90]
   - Polygon ring closure
   - MultiPolygon support

### Test Fixtures (`__tests__/fixtures/school-district-fixtures.ts`)

Strongly-typed test data for validation and mocking.

#### Available Fixtures

**Urban Unified Districts**:
- Seattle Public Schools (`5303780`)
- Los Angeles Unified (`0622710`)
- Chicago Public Schools (`1709930`)
- New York City Geographic District #1 (`3620580`)

**Rural Unified Districts**:
- Pullman School District, WA (`5339630`)

**Split Districts** (Illinois):
- Example Elementary CCSD (`1712345`)
- Example Secondary CHSD (`1767890`)

**Edge Cases**:
- Empty name district
- Very large area (North Slope Borough, AK - 230,000 sq km)
- District with more water than land (Bristol Bay, AK)

## Expected Counts

### States with Unified Districts Only

| State | FIPS | Unified | Elementary | Secondary |
|-------|------|---------|------------|-----------|
| Washington | 53 | 295 | 0 | 0 |
| California | 06 | 1,037 | 0 | 0 |
| Florida | 12 | 75 | 0 | 0 |
| Texas | 48 | 1,217 | 0 | 0 |

### States with Split Districts

| State | FIPS | Unified | Elementary | Secondary |
|-------|------|---------|------------|-----------|
| Illinois | 17 | 862 | 426 | 96 |

**Note**: Some Illinois areas have elementary (K-8) and secondary (9-12) districts overlapping the same geography, while others have unified (K-12) districts.

## TIGERweb API Endpoints

### Unified School Districts (SCSD)
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/0
```

### Elementary School Districts (ELSD)
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/1
```

### Secondary School Districts (SECSD)
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School_Districts/MapServer/2
```

## Running Tests

### All Tests (Unit + Integration)
```bash
cd packages/crypto/services/shadow-atlas
RUN_INTEGRATION=true npm test -- __tests__/integration/tiger-school-districts.test.ts --run
```

### Unit Tests Only
```bash
npm test -- validators/school-district-validator.test.ts --run
```

### Integration Tests in CI
```bash
CI=true RUN_INTEGRATION=true npm test -- __tests__/integration/tiger-school-districts.test.ts --run
```

## Known Issues

### API Rate Limiting
- TIGERweb API enforces rate limits
- Tests include 500ms delay between requests (`API_RATE_LIMIT_MS`)
- Retry with exponential backoff on failure

### State-Specific Edge Cases

**Illinois**:
- Complex mix of unified and split districts
- Some areas have overlapping elementary + secondary districts
- Expected counts: 862 unified, 426 elementary, 96 secondary

**Alaska**:
- Very large districts (North Slope: 230,000 sq km)
- Some districts more water than land
- Arctic coordinates near edge of valid latitude range

**New York**:
- 32 geographic districts within NYC
- Each district has multiple schools
- Some districts share boundaries

## Data Sources

### Official Sources
- **TIGER/Line Shapefiles**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
- **TIGERweb REST API**: https://tigerweb.geo.census.gov/
- **NCES Database**: https://nces.ed.gov/ccd/schoolsearch/ (National Center for Education Statistics)

### Data Vintage
- Tests use **TIGER 2024** data
- School districts update annually
- Major boundary changes occur after redistricting

## Future Enhancements

### Phase 1.5 (Deferred)
- [ ] Add school district counts to `tiger-expected-counts.ts`
- [ ] Validate against NCES official counts
- [ ] Test TIGER/Line FTP shapefile download and parsing
- [ ] Cross-validate TIGERweb API vs FTP shapefiles

### Phase 2 (12-18 months)
- [ ] Add international school district equivalents
- [ ] Test school board election dates
- [ ] Integrate with voter registration data
- [ ] Add point-in-polygon performance benchmarks

## Contributing

### Adding New Test States

1. Add state to `TEST_STATES` in `tiger-school-districts.test.ts`
2. Add expected counts to `EXPECTED_SCHOOL_DISTRICT_COUNTS` in fixtures
3. Verify counts against official NCES database
4. Run tests: `RUN_INTEGRATION=true npm test`

### Adding New Fixtures

1. Add fixture to `school-district-fixtures.ts`
2. Include all required properties: `GEOID`, `NAME`, `STATEFP`
3. Verify coordinates with TIGERweb API
4. Document source and date in comments

## References

- **TIGER Technical Documentation**: https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2024/TGRSHP2024_TechDoc.pdf
- **NCES School District Search**: https://nces.ed.gov/ccd/schoolsearch/
- **Census School District FAQ**: https://www.census.gov/programs-surveys/geography/about/faq/school-districts.html

## License

Test data derived from public domain U.S. Census Bureau TIGER/Line data.
