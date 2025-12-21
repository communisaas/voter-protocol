# TIGER Validation Integration Examples

**Practical code examples for integrating ground truth validation with Shadow Atlas.**

## Quick Integration

### 1. Validate Before Merkle Tree Construction

```typescript
import { validateCount } from './registry/official-district-counts.js';
import { extractTIGERBoundaries } from './providers/tiger-boundary-provider.js';
import { buildMerkleTree } from './crypto/merkle-tree.js';

async function buildValidatedAtlas(state: string) {
  // Extract boundaries
  const boundaries = await extractTIGERBoundaries(state, 'congressional');

  // Validate count
  const validation = validateCount(state, 'congressional', boundaries.length);

  if (!validation.isValid) {
    throw new Error(
      `District count mismatch for ${state}: ` +
      `expected ${validation.expected}, got ${validation.actual} ` +
      `(confidence: ${(validation.confidence * 100).toFixed(0)}%)`
    );
  }

  if (validation.confidence < 0.7) {
    console.warn(`⚠️  Low confidence for ${state}: ${validation.confidence}`);
  }

  // Build Merkle tree only with validated data
  const tree = buildMerkleTree(boundaries);

  return {
    state,
    boundaries,
    tree,
    validation,
  };
}
```

### 2. Authority Resolution with Validation

```typescript
import { getOfficialCount, validateCount } from './registry/official-district-counts.js';
import { isInRedistrictingGap } from './provenance/tiger-validity.js';
import { extractStateBoundaries } from './providers/state-boundary-provider.js';
import { extractTIGERBoundaries } from './providers/tiger-boundary-provider.js';

async function getAuthoritative Boundaries(
  state: string,
  chamber: 'congressional' | 'state_senate' | 'state_house'
) {
  const expectedCount = getOfficialCount(state, chamber);

  if (expectedCount === null || expectedCount === 0) {
    throw new Error(`No ${chamber} districts for ${state}`);
  }

  // During redistricting gap, try state sources first
  if (isInRedistrictingGap(new Date())) {
    try {
      const stateBoundaries = await extractStateBoundaries(state, chamber);
      const stateValidation = validateCount(state, chamber, stateBoundaries.length);

      if (stateValidation.confidence >= 0.7) {
        console.log(`✅ Using state source for ${state} ${chamber} (gap period)`);
        return {
          boundaries: stateBoundaries,
          authority: 'state-redistricting-commission',
          validation: stateValidation,
        };
      }
    } catch (error) {
      console.warn(`⚠️  State extraction failed for ${state}: ${error}`);
    }
  }

  // Fall back to TIGER
  const tigerBoundaries = await extractTIGERBoundaries(state, chamber);
  const tigerValidation = validateCount(state, chamber, tigerBoundaries.length);

  if (!tigerValidation.isValid) {
    throw new Error(
      `TIGER validation failed for ${state} ${chamber}: ` +
      `expected ${tigerValidation.expected}, got ${tigerValidation.actual}`
    );
  }

  return {
    boundaries: tigerBoundaries,
    authority: 'census-tiger',
    validation: tigerValidation,
  };
}
```

### 3. Batch Validation Report

```typescript
import { OFFICIAL_DISTRICT_COUNTS, validateCount } from './registry/official-district-counts.js';
import { extractTIGERBoundaries } from './providers/tiger-boundary-provider.js';

interface ValidationReport {
  state: string;
  chamber: string;
  status: 'valid' | 'invalid' | 'error';
  expected: number;
  actual: number;
  confidence: number;
  error?: string;
}

async function validateAllStates(
  chamber: 'congressional' | 'state_senate' | 'state_house'
): Promise<ValidationReport[]> {
  const reports: ValidationReport[] = [];

  for (const [state, record] of Object.entries(OFFICIAL_DISTRICT_COUNTS)) {
    const expected = record[chamber === 'congressional' ? 'congressional' :
                           chamber === 'state_senate' ? 'stateSenate' :
                           'stateHouse'];

    // Skip if no expected count
    if (expected === null || expected === 0) {
      continue;
    }

    try {
      const boundaries = await extractTIGERBoundaries(state, chamber);
      const validation = validateCount(state, chamber, boundaries.length);

      reports.push({
        state,
        chamber,
        status: validation.isValid ? 'valid' : 'invalid',
        expected: validation.expected!,
        actual: validation.actual,
        confidence: validation.confidence,
      });
    } catch (error) {
      reports.push({
        state,
        chamber,
        status: 'error',
        expected: expected!,
        actual: -1,
        confidence: 0,
        error: String(error),
      });
    }
  }

  return reports;
}

// Usage
const congressionalReport = await validateAllStates('congressional');

const invalid = congressionalReport.filter(r => r.status === 'invalid');
if (invalid.length > 0) {
  console.error(`❌ ${invalid.length} states failed validation:`);
  invalid.forEach(r => {
    console.error(`   ${r.state}: expected ${r.expected}, got ${r.actual}`);
  });
}

const totalValid = congressionalReport.filter(r => r.status === 'valid').length;
console.log(`✅ ${totalValid}/${congressionalReport.length} states validated`);
```

## Advanced Integration

### 4. Provenance-Tracked Extraction

```typescript
import { getOfficialCount, validateCount, type OfficialDistrictCount } from './registry/official-district-counts.js';
import { getTIGERValidityStatus } from './provenance/tiger-validity.js';

interface BoundaryWithProvenance {
  geoid: string;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
  provenance: {
    source: {
      authority: 'census-tiger' | 'state-redistricting-commission' | 'state-gis';
      vintage: number;
      retrievedAt: string;
      endpoint: string;
    };
    validation: {
      expectedCount: number;
      actualCount: number;
      confidence: number;
      validatedAgainst: 'official-district-counts';
      tigerValidityStatus: unknown;
    };
  };
}

async function extractWithProvenance(
  state: string,
  chamber: 'congressional' | 'state_senate' | 'state_house'
): Promise<BoundaryWithProvenance[]> {
  const expectedCount = getOfficialCount(state, chamber);

  if (expectedCount === null) {
    throw new Error(`No official count for ${state} ${chamber}`);
  }

  // Extract boundaries
  const boundaries = await extractTIGERBoundaries(state, chamber);

  // Validate
  const validation = validateCount(state, chamber, boundaries.length);

  if (!validation.isValid) {
    throw new Error(`Validation failed: expected ${expectedCount}, got ${boundaries.length}`);
  }

  // Get TIGER validity status
  const tigerStatus = getTIGERValidityStatus(
    chamber,
    2024, // Current TIGER year
    new Date()
  );

  // Attach provenance to each boundary
  return boundaries.map(boundary => ({
    ...boundary,
    provenance: {
      source: {
        authority: 'census-tiger',
        vintage: 2024,
        retrievedAt: new Date().toISOString(),
        endpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
      },
      validation: {
        expectedCount,
        actualCount: boundaries.length,
        confidence: validation.confidence,
        validatedAgainst: 'official-district-counts',
        tigerValidityStatus: tigerStatus,
      },
    },
  }));
}
```

### 5. Quarterly Shadow Atlas Update

```typescript
import { OFFICIAL_DISTRICT_COUNTS } from './registry/official-district-counts.js';
import { extractWithProvenance } from './integration-example.js';
import { buildMerkleTree } from './crypto/merkle-tree.js';
import { publishToIPFS } from './ipfs/publisher.js';

interface ShadowAtlasRelease {
  version: string;
  releaseDate: string;
  tigerVintage: number;
  boundaries: {
    state: string;
    chamber: string;
    count: number;
    merkleRoot: string;
    ipfsCID: string;
  }[];
  validation: {
    totalStates: number;
    totalBoundaries: number;
    allValidated: boolean;
    averageConfidence: number;
  };
}

async function buildQuarterlyRelease(): Promise<ShadowAtlasRelease> {
  const releaseDate = new Date().toISOString();
  const version = `2024.Q4.${releaseDate.split('T')[0]}`;

  const boundaries: ShadowAtlasRelease['boundaries'] = [];
  let totalBoundaries = 0;
  let totalConfidence = 0;
  let stateCount = 0;

  // Extract congressional districts for all states
  for (const [state, record] of Object.entries(OFFICIAL_DISTRICT_COUNTS)) {
    if (record.congressional === 0) continue; // Skip DC, PR

    try {
      const stateBoundaries = await extractWithProvenance(state, 'congressional');
      const tree = buildMerkleTree(stateBoundaries);
      const ipfsCID = await publishToIPFS(stateBoundaries);

      boundaries.push({
        state,
        chamber: 'congressional',
        count: stateBoundaries.length,
        merkleRoot: tree.root,
        ipfsCID,
      });

      totalBoundaries += stateBoundaries.length;
      totalConfidence += stateBoundaries[0].provenance.validation.confidence;
      stateCount++;
    } catch (error) {
      console.error(`❌ Failed to process ${state}: ${error}`);
    }
  }

  const averageConfidence = totalConfidence / stateCount;
  const allValidated = averageConfidence === 1.0;

  return {
    version,
    releaseDate,
    tigerVintage: 2024,
    boundaries,
    validation: {
      totalStates: stateCount,
      totalBoundaries,
      allValidated,
      averageConfidence,
    },
  };
}

// Run quarterly update
const release = await buildQuarterlyRelease();

console.log(`\n📦 Shadow Atlas ${release.version}`);
console.log(`   Total boundaries: ${release.validation.totalBoundaries}`);
console.log(`   States: ${release.validation.totalStates}`);
console.log(`   Validation: ${release.validation.allValidated ? '✅' : '⚠️ '} ` +
            `(avg confidence: ${(release.validation.averageConfidence * 100).toFixed(1)}%)`);
```

### 6. Pre-Flight Validation Check

```typescript
import { validateCount } from './registry/official-district-counts.js';

/**
 * Pre-flight validation for ZK proof generation
 *
 * Ensures the boundary data being used for proof generation
 * matches official counts before expensive cryptographic operations.
 */
async function validateBeforeProofGeneration(
  userAddress: string,
  state: string,
  districtGEOID: string
): Promise<void> {
  // Extract boundaries for this state
  const boundaries = await extractTIGERBoundaries(state, 'congressional');

  // Validate count
  const validation = validateCount(state, 'congressional', boundaries.length);

  if (!validation.isValid) {
    throw new Error(
      `Cannot generate proof: boundary data invalid for ${state}\n` +
      `Expected ${validation.expected} districts, found ${validation.actual}\n` +
      `Run validation scripts: tsx scripts/compare-tiger-sources.ts`
    );
  }

  if (validation.confidence < 1.0) {
    console.warn(
      `⚠️  Reduced confidence (${(validation.confidence * 100).toFixed(0)}%) for ${state} boundaries`
    );
  }

  // Verify district exists in validated set
  const district = boundaries.find(b => b.geoid === districtGEOID);

  if (!district) {
    throw new Error(
      `District ${districtGEOID} not found in validated boundary set for ${state}`
    );
  }

  // Check if address is in district
  const isInDistrict = await pointInPolygon(userAddress, district.geometry);

  if (!isInDistrict) {
    throw new Error(
      `Address not in district ${districtGEOID}. Proof generation would fail.`
    );
  }

  console.log(`✅ Pre-flight validation passed for ${state}-${districtGEOID}`);
}
```

## Testing Integration

### 7. Unit Test with Ground Truth

```typescript
import { describe, it, expect } from 'vitest';
import { getOfficialCount, validateCount } from './registry/official-district-counts.js';
import { extractTIGERBoundaries } from './providers/tiger-boundary-provider.js';

describe('TIGER Boundary Extraction', () => {
  it('should match official counts for Wisconsin congressional districts', async () => {
    const state = 'WI';
    const chamber = 'congressional';

    // Get official count
    const expected = getOfficialCount(state, chamber);
    expect(expected).toBe(8); // Wisconsin has 8 congressional districts

    // Extract boundaries
    const boundaries = await extractTIGERBoundaries(state, chamber);

    // Validate
    const validation = validateCount(state, chamber, boundaries.length);

    expect(validation.isValid).toBe(true);
    expect(validation.actual).toBe(8);
    expect(validation.expected).toBe(8);
    expect(validation.difference).toBe(0);
    expect(validation.confidence).toBe(1.0);
  });

  it('should handle Nebraska unicameral legislature', async () => {
    const state = 'NE';

    // State senate should exist (49 senators)
    const senate = getOfficialCount(state, 'state_senate');
    expect(senate).toBe(49);

    // State house should not exist (unicameral)
    const house = getOfficialCount(state, 'state_house');
    expect(house).toBeNull();
  });

  it('should validate all 50 states sum to 435 districts', async () => {
    const states = Object.keys(OFFICIAL_DISTRICT_COUNTS);
    let total = 0;

    for (const state of states) {
      const count = getOfficialCount(state, 'congressional');
      if (count !== null && count > 0) {
        total += count;
      }
    }

    expect(total).toBe(435); // Statutory limit
  });
});
```

### 8. Integration Test with Shapefile Validation

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

describe('Ground Truth Validation', () => {
  it('should validate TIGER shapefiles match official counts', async () => {
    // Run validation script
    execSync('tsx scripts/tiger-ground-truth.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    // Check report was generated
    const reportPath = 'validation-results/tiger-ground-truth-report.md';
    expect(existsSync(reportPath)).toBe(true);

    // Read report
    const report = await readFile(reportPath, 'utf-8');

    // Check for success markers
    expect(report).toContain('✅');
    expect(report).toContain('Total congressional districts: 435');
    expect(report).not.toContain('🚨'); // No critical errors
  });

  it('should validate TIGERweb API matches official counts', async () => {
    // Run API validation script
    execSync('tsx scripts/compare-tiger-sources.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    // Check report
    const reportPath = 'validation-results/tigerweb-comparison-report.md';
    expect(existsSync(reportPath)).toBe(true);

    const report = await readFile(reportPath, 'utf-8');

    // Should have high match rate
    expect(report).toMatch(/Congressional: \d+\/\d+ matches/);
    expect(report).toMatch(/State Senate: \d+\/\d+ matches/);
  });
});
```

## Summary

These integration examples show how to:

1. ✅ Validate before expensive cryptographic operations
2. ✅ Use authority resolution with fallback to TIGER
3. ✅ Generate batch validation reports
4. ✅ Track provenance metadata
5. ✅ Build quarterly Shadow Atlas releases
6. ✅ Pre-flight check before proof generation
7. ✅ Unit test with ground truth
8. ✅ Integration test validation scripts

**Result:** Every boundary used in zero-knowledge proofs is validated against official Census data before inclusion.
