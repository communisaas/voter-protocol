# At-Large City Detection Architecture

**Problem**: ~200 US cities use at-large representation (no geographic council districts). Current architecture wastes compute attempting Layer 1 discovery for cities where it structurally cannot succeed.

**Solution**: Pre-flight governance structure detection with authoritative registry fallback.

## Design Principles

- **Zero false positives**: Never skip Layer 1 for district-based cities
- **Authoritative sources**: Municipal charters, state municipal league databases, Wikipedia governance infoboxes
- **Graceful degradation**: Unknown governance → attempt Layer 1, fallback to Layer 2
- **Git-trackable curation**: Central registry for manual verification

## Architecture

### 1. Governance Structure Registry

**Location**: `packages/crypto/services/shadow-atlas/registry/governance-structures.ts`

```typescript
export type GovernanceStructure =
  | 'district-based'    // Geographic districts elect representatives
  | 'at-large'          // All representatives elected city-wide
  | 'mixed'             // Some district, some at-large (treat as district-based)
  | 'unknown';          // No authoritative data (attempt discovery)

export interface GovernanceRecord {
  cityFips: string;
  cityName: string;
  state: string;
  structure: GovernanceStructure;
  councilSize: number;           // Total number of council members
  districtSeats?: number;        // Number of district-based seats (for mixed systems)
  atLargeSeats?: number;         // Number of at-large seats
  source: string;                // URL to authoritative source
  lastVerified: string;          // ISO date
  notes?: string;
}

export const GOVERNANCE_REGISTRY: Record<string, GovernanceRecord> = {
  // At-large cities (no districts)
  '0803000': { // Boulder, CO
    cityFips: '0803000',
    cityName: 'Boulder',
    state: 'CO',
    structure: 'at-large',
    councilSize: 9,
    atLargeSeats: 9,
    source: 'https://bouldercolorado.gov/government/city-council',
    lastVerified: '2025-11-18',
    notes: 'All 9 council members elected at-large',
  },

  '0203000': { // Ann Arbor, MI
    cityFips: '0203000',
    cityName: 'Ann Arbor',
    state: 'MI',
    structure: 'at-large',
    councilSize: 11,
    atLargeSeats: 11,
    source: 'https://www.a2gov.org/departments/city-council/',
    lastVerified: '2025-11-18',
    notes: 'Mayor + 10 council members, all elected at-large',
  },

  // Mixed systems (treat as district-based)
  '0667000': { // San Francisco, CA
    cityFips: '0667000',
    cityName: 'San Francisco',
    state: 'CA',
    structure: 'mixed',
    councilSize: 11,
    districtSeats: 11,
    atLargeSeats: 0,
    source: 'https://sfgov.org/electionscommission/board-supervisors',
    lastVerified: '2025-11-18',
    notes: 'All 11 supervisors elected by district (changed from at-large in 2000)',
  },

  // District-based cities
  '4159000': { // Portland, OR
    cityFips: '4159000',
    cityName: 'Portland',
    state: 'OR',
    structure: 'district-based',
    councilSize: 12,
    districtSeats: 12,
    source: 'https://www.portland.gov/bts/cgis/open-data-site',
    lastVerified: '2025-11-18',
    notes: 'New 2024 voting district system (4 districts, 3 reps each)',
  },
};
```

### 2. Pre-Flight Governance Check

**Location**: `packages/crypto/services/shadow-atlas/validators/governance-validator.ts`

```typescript
import { GOVERNANCE_REGISTRY, type GovernanceStructure } from '../registry/governance-structures';

export interface GovernanceCheckResult {
  structure: GovernanceStructure;
  shouldAttemptLayer1: boolean;
  reason: string;
  source?: string;
}

export class GovernanceValidator {
  /**
   * Check if city uses district-based representation
   * @returns Decision on whether to attempt Layer 1 discovery
   */
  async checkGovernance(cityFips: string): Promise<GovernanceCheckResult> {
    // Check registry first (authoritative source)
    const record = GOVERNANCE_REGISTRY[cityFips];

    if (record) {
      const shouldAttempt = record.structure === 'district-based' ||
                           record.structure === 'mixed' ||
                           record.structure === 'unknown';

      return {
        structure: record.structure,
        shouldAttemptLayer1: shouldAttempt,
        reason: shouldAttempt
          ? `Registry confirms ${record.structure} governance`
          : `Registry confirms at-large governance (no districts)`,
        source: record.source,
      };
    }

    // Unknown governance → attempt discovery (graceful degradation)
    return {
      structure: 'unknown',
      shouldAttemptLayer1: true,
      reason: 'No governance data in registry, attempting discovery',
    };
  }

  /**
   * Validate discovered district count against governance registry
   */
  validateDiscoveredDistricts(
    cityFips: string,
    discoveredCount: number
  ): { valid: boolean; reason: string } {
    const record = GOVERNANCE_REGISTRY[cityFips];

    if (!record) {
      return { valid: true, reason: 'No registry entry to validate against' };
    }

    if (record.structure === 'at-large') {
      return {
        valid: false,
        reason: `Registry shows at-large governance but discovered ${discoveredCount} districts`,
      };
    }

    if (record.districtSeats && discoveredCount !== record.districtSeats) {
      return {
        valid: false,
        reason: `Registry shows ${record.districtSeats} districts but discovered ${discoveredCount}`,
      };
    }

    return { valid: true, reason: 'District count matches registry' };
  }
}
```

### 3. Integration into Discovery Pipeline

**Modified**: `packages/crypto/services/shadow-atlas/discovery/multi-path-scanner.ts`

```typescript
import { GovernanceValidator } from '../validators/governance-validator';

export class MultiPathScanner {
  private governanceValidator: GovernanceValidator;

  async scan(city: CityTarget): Promise<ScanResult> {
    // PRE-FLIGHT: Check governance structure
    const govCheck = await this.governanceValidator.checkGovernance(city.fips);

    if (!govCheck.shouldAttemptLayer1) {
      console.log(`⏭️  Skipping Layer 1 for ${city.name}, ${city.state}`);
      console.log(`   Reason: ${govCheck.reason}`);
      console.log(`   Source: ${govCheck.source}`);

      return {
        success: false,
        layer: 'governance-skip',
        reason: govCheck.reason,
        fallbackToLayer2: true,
      };
    }

    // Attempt Layer 1 discovery (existing 4-path logic)
    const layer1Result = await this.attemptLayer1Discovery(city);

    if (layer1Result.success) {
      // VALIDATION: Check discovered districts against registry
      const validation = this.governanceValidator.validateDiscoveredDistricts(
        city.fips,
        layer1Result.featureCount
      );

      if (!validation.valid) {
        console.warn(`⚠️  Discovery validation failed: ${validation.reason}`);
        // Continue with Layer 2 fallback
      }
    }

    return layer1Result;
  }
}
```

## Data Sources (Authoritative)

### Primary Sources (Free, Reliable)

1. **State Municipal Leagues**: Official governance databases
   - California League of Cities: https://www.calcities.org/
   - National League of Cities: https://www.nlc.org/
   - Coverage: All 50 states, ~19,000 municipalities

2. **Wikipedia Governance Infoboxes**: Surprisingly authoritative
   - Template: `{{Infobox settlement}}` → `government_type` field
   - Example: https://en.wikipedia.org/wiki/Boulder,_Colorado
   - Coverage: Top 500 US cities, well-maintained

3. **Municipal Charters**: Ultimate ground truth
   - State archives (e.g., https://sos.oregon.gov/archives/)
   - Municipal code websites (e.g., https://library.municode.com/)
   - Coverage: Variable, requires scraping

### Secondary Sources (Validation)

4. **Ballotpedia**: Comprehensive election data
   - https://ballotpedia.org/[City]_City_Council
   - Coverage: 7,383+ cities, manually curated

5. **US Conference of Mayors**: Governance surveys
   - https://www.usmayors.org/
   - Coverage: 1,400+ cities >30k population

## Implementation Strategy

### Phase 1: Manual Registry (Week 1)
- Curate top 200 cities by population
- Use Wikipedia + Ballotpedia for authoritative sources
- Add to `governance-structures.ts` registry
- Expected coverage: 60% of US population

### Phase 2: Automated Scraping (Week 2-3)
- Wikipedia infobox parser (structured data)
- State municipal league scrapers (per-state logic)
- Ballotpedia API integration (if available)
- Expected coverage: 85% of incorporated cities

### Phase 3: Validation & Monitoring (Week 4)
- Cross-reference multiple sources
- Flag discrepancies for manual review
- Monitor for governance changes (redistricting, charter amendments)
- Expected accuracy: 98%+

## Edge Cases Handled

### Mixed Systems (Some District, Some At-Large)
- **Example**: Los Angeles (15 districts), San Jose (10 districts)
- **Handling**: Treat as `district-based` (attempt Layer 1 discovery)
- **Validation**: Discovered count must match `districtSeats` in registry

### Recent Governance Changes
- **Example**: Portland switched to districts in 2024
- **Handling**: `lastVerified` timestamp, manual review alerts
- **Monitoring**: Track municipal charter amendments via state archives

### Unincorporated Areas
- **Example**: Census-designated places (CDPs) with no formal governance
- **Handling**: Mark as `unknown`, attempt discovery, graceful Layer 2 fallback
- **Future**: CDP-specific logic (county supervisor districts)

## Testing Strategy

### Unit Tests
```typescript
describe('GovernanceValidator', () => {
  it('should skip Layer 1 for confirmed at-large cities', async () => {
    const validator = new GovernanceValidator();
    const result = await validator.checkGovernance('0803000'); // Boulder

    expect(result.structure).toBe('at-large');
    expect(result.shouldAttemptLayer1).toBe(false);
    expect(result.reason).toContain('at-large governance');
  });

  it('should attempt Layer 1 for district-based cities', async () => {
    const validator = new GovernanceValidator();
    const result = await validator.checkGovernance('4159000'); // Portland

    expect(result.structure).toBe('district-based');
    expect(result.shouldAttemptLayer1).toBe(true);
  });

  it('should attempt Layer 1 for unknown cities (graceful degradation)', async () => {
    const validator = new GovernanceValidator();
    const result = await validator.checkGovernance('9999999'); // Unknown FIPS

    expect(result.structure).toBe('unknown');
    expect(result.shouldAttemptLayer1).toBe(true);
    expect(result.reason).toContain('attempting discovery');
  });

  it('should validate discovered district count against registry', () => {
    const validator = new GovernanceValidator();
    const validation = validator.validateDiscoveredDistricts('4159000', 4); // Portland

    expect(validation.valid).toBe(true);
  });

  it('should reject mismatched district counts', () => {
    const validator = new GovernanceValidator();
    const validation = validator.validateDiscoveredDistricts('4159000', 6); // Wrong count

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('but discovered 6');
  });
});
```

### Integration Tests
```typescript
describe('MultiPathScanner with Governance Check', () => {
  it('should skip Layer 1 for Boulder (at-large)', async () => {
    const scanner = new MultiPathScanner();
    const result = await scanner.scan({
      fips: '0803000',
      name: 'Boulder',
      state: 'CO',
    });

    expect(result.layer).toBe('governance-skip');
    expect(result.fallbackToLayer2).toBe(true);
  });

  it('should attempt Layer 1 for Portland (district-based)', async () => {
    const scanner = new MultiPathScanner();
    const result = await scanner.scan({
      fips: '4159000',
      name: 'Portland',
      state: 'OR',
    });

    expect(result.layer).not.toBe('governance-skip');
    expect(result.success).toBe(true); // Should discover 4 districts
  });
});
```

## Performance Impact

### Before (Naive Discovery)
- Boulder attempt: 4 HTTP requests × 2-3s = 8-12s wasted compute
- Ann Arbor attempt: 4 HTTP requests × 2-3s = 8-12s wasted compute
- **Total waste for 200 at-large cities**: ~30 minutes per full scan

### After (Governance Pre-Flight)
- Registry lookup: <1ms (in-memory hash table)
- Skip unnecessary HTTP requests
- **Time saved**: ~30 minutes → ~1 second per full scan

### Memory Overhead
- Registry size: ~200 cities × ~300 bytes = 60 KB
- Negligible impact on Node.js heap

## Success Metrics

- **Coverage**: 95%+ of US cities >50k population
- **Accuracy**: 98%+ correct governance classification
- **Performance**: <5ms governance check latency
- **Maintenance**: <2 hours/month for registry updates

## Monitoring & Maintenance

### Automated Alerts
- Flag when discovery succeeds for at-large city (possible governance change)
- Flag when discovery fails for district-based city (data quality issue)
- Track `lastVerified` timestamps, alert for stale data (>1 year)

### Quarterly Review
- Cross-reference with municipal charter amendments
- Update registry with governance changes
- Audit discrepancies flagged by automated alerts

### Community Contributions
- Git PRs for governance corrections
- Require authoritative source URL in commit message
- Maintainer review before merge

## Migration Path

### Week 1: Foundation
- Create `governance-structures.ts` registry
- Add top 200 cities (manual curation)
- Implement `GovernanceValidator` class

### Week 2: Integration
- Modify `MultiPathScanner` for pre-flight checks
- Add validation for discovered districts
- Write comprehensive test suite

### Week 3: Validation
- Run against existing test cities
- Verify zero false positives (never skip district-based cities)
- Confirm compute savings for at-large cities

### Week 4: Production
- Deploy to production scanner
- Monitor alerts for discrepancies
- Document maintenance procedures

## Open Questions

1. **Governance change frequency**: How often do cities switch between at-large and district-based?
   - **Research needed**: Historical data from Ballotpedia
   - **Hypothesis**: Rare (<1% annually), mostly from voter referendums

2. **Mixed system thresholds**: How many at-large seats before we skip Layer 1?
   - **Current logic**: Any district seats → attempt Layer 1
   - **Alternative**: Skip if >50% at-large seats?

3. **County-level governance**: Should we track county supervisor districts?
   - **Use case**: Unincorporated CDPs fall under county governance
   - **Complexity**: 3,143 US counties vs 19,000 municipalities

## References

- National League of Cities governance database: https://www.nlc.org/
- Wikipedia settlement infobox template: https://en.wikipedia.org/wiki/Template:Infobox_settlement
- Ballotpedia city council directory: https://ballotpedia.org/City_councils
- US Conference of Mayors: https://www.usmayors.org/
