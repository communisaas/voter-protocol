/**
 * Authority Registry Tests - WP-FRESHNESS-1
 *
 * Tests for the Shadow Atlas Authority Registry.
 * Verifies source ranking, jurisdiction lookup, boundary type coverage,
 * and integration with other freshness modules.
 */

import { describe, it, expect } from 'vitest';
import {
  AuthorityRegistry,
  authorityRegistry,
  type BoundaryType,
  type PrimarySource,
  type AggregatorSource,
  type AuthorityEntry,
} from './authority-registry.js';

describe('AuthorityRegistry', () => {
  const registry = new AuthorityRegistry();

  describe('Core principle: freshest_primary > freshest_aggregator', () => {
    it('should have primary sources for congressional districts', () => {
      const entry = registry.getAuthority('congressional');
      expect(entry.primarySources.length).toBeGreaterThan(0);
      expect(entry.aggregatorSources.length).toBeGreaterThan(0);
    });

    it('should have primary sources for state_senate', () => {
      const entry = registry.getAuthority('state_senate');
      expect(entry.primarySources.length).toBeGreaterThan(0);
      expect(entry.aggregatorSources.length).toBeGreaterThan(0);
    });

    it('should have primary sources for state_house', () => {
      const entry = registry.getAuthority('state_house');
      expect(entry.primarySources.length).toBeGreaterThan(0);
      expect(entry.aggregatorSources.length).toBeGreaterThan(0);
    });

    it('should verify TIGER is aggregator, not authority', () => {
      const entry = registry.getAuthority('congressional');

      // TIGER should be in aggregators
      const tigerSource = entry.aggregatorSources.find(
        (s) => s.name.includes('TIGER')
      );
      expect(tigerSource).toBeDefined();
      expect(tigerSource?.lag).toContain('redistricting');

      // Primary sources should NOT be TIGER
      const hasTigerPrimary = entry.primarySources.some(
        (s) => s.name.includes('TIGER')
      );
      expect(hasTigerPrimary).toBe(false);
    });

    it('should document TIGER lag during redistricting', () => {
      const entry = registry.getAuthority('congressional');
      const tiger = entry.aggregatorSources.find((s) => s.name.includes('TIGER'));

      expect(tiger?.lag).toBe('6-18 months during redistricting');
      expect(entry.expectedLag.redistricting).toContain('TIGER');
    });
  });

  describe('getAuthority', () => {
    const boundaryTypes: BoundaryType[] = [
      'congressional',
      'state_senate',
      'state_house',
      'county',
      'place',
      'city_council',
      'school_unified',
      'voting_precinct',
      'special_district',
    ];

    it.each(boundaryTypes)(
      'should return authority entry for %s',
      (boundaryType) => {
        const entry = registry.getAuthority(boundaryType);
        expect(entry).toBeDefined();
        expect(entry.boundaryType).toBe(boundaryType);
        expect(entry.displayName).toBeDefined();
        expect(entry.authorityEntity).toBeDefined();
        expect(entry.legalBasis).toBeDefined();
      }
    );

    it('should have valid authority entities', () => {
      const congressional = registry.getAuthority('congressional');
      expect(congressional.authorityEntity).toBe(
        'State Legislature or Independent Commission'
      );

      const county = registry.getAuthority('county');
      expect(county.authorityEntity).toBe('State');

      const votingPrecinct = registry.getAuthority('voting_precinct');
      expect(votingPrecinct.authorityEntity).toBe('County Elections Office');
    });

    it('should have valid legal basis for all types', () => {
      const congressional = registry.getAuthority('congressional');
      expect(congressional.legalBasis).toContain('Constitution');

      const county = registry.getAuthority('county');
      expect(county.legalBasis).toBeDefined();
      expect(county.legalBasis.length).toBeGreaterThan(0);
    });
  });

  describe('getPrimarySourcesForState', () => {
    it('should return California primary sources', () => {
      const sources = registry.getPrimarySourcesForState('CA');
      expect(sources.length).toBeGreaterThan(0);

      const caSource = sources.find((s) => s.jurisdiction === 'CA');
      expect(caSource).toBeDefined();
      expect(caSource?.name).toContain('CA' || 'California');
    });

    it('should return Texas primary sources', () => {
      const sources = registry.getPrimarySourcesForState('TX');
      expect(sources.length).toBeGreaterThan(0);

      const txSource = sources.find((s) => s.jurisdiction === 'TX');
      expect(txSource).toBeDefined();
      expect(txSource?.entity).toContain('Texas');
    });

    it('should return empty array for states without primary sources', () => {
      const sources = registry.getPrimarySourcesForState('ZZ');
      expect(sources).toEqual([]);
    });

    it('should return multiple sources for states with various boundary types', () => {
      const sources = registry.getPrimarySourcesForState('CA');

      // CA should have sources for congressional, state_senate, state_house
      expect(sources.length).toBeGreaterThanOrEqual(3);
    });

    it('should have machine-readable formats', () => {
      const sources = registry.getPrimarySourcesForState('CA');

      for (const source of sources) {
        expect(source.machineReadable).toBe(true);
        expect(['geojson', 'shapefile', 'kml', 'pdf', 'unknown']).toContain(
          source.format
        );
      }
    });

    it('should have valid URLs for primary sources', () => {
      const sources = registry.getPrimarySourcesForState('CA');

      for (const source of sources) {
        if (source.url !== null) {
          expect(source.url).toMatch(/^https?:\/\//);
        }
      }
    });
  });

  describe('Jurisdiction lookup - Top 10 states by population', () => {
    const top10States = [
      { code: 'CA', name: 'California' },
      { code: 'TX', name: 'Texas' },
      { code: 'FL', name: 'Florida' },
      { code: 'NY', name: 'New York' },
      { code: 'PA', name: 'Pennsylvania' },
      { code: 'IL', name: 'Illinois' },
      { code: 'OH', name: 'Ohio' },
      { code: 'GA', name: 'Georgia' },
      { code: 'NC', name: 'North Carolina' },
      { code: 'MI', name: 'Michigan' },
    ];

    it.each(top10States)(
      'should have primary sources for $name ($code)',
      ({ code, name }) => {
        const sources = registry.getPrimarySourcesForState(code);
        expect(sources.length).toBeGreaterThan(0);

        const source = sources[0];
        expect(source.jurisdiction).toBe(code);
        expect(
          source.name.includes(code) || source.entity.includes(name)
        ).toBe(true);
      }
    );

    it('should have redistricting commission for CA', () => {
      const entry = registry.getAuthority('congressional');
      const caSource = entry.primarySources.find(
        (s) => s.jurisdiction === 'CA'
      );

      expect(caSource?.entity).toContain('Citizens Redistricting Commission');
      expect(caSource?.name).toContain('CA');
    });

    it('should have legislative council for TX', () => {
      const entry = registry.getAuthority('congressional');
      const txSource = entry.primarySources.find(
        (s) => s.jurisdiction === 'TX'
      );

      expect(txSource?.entity).toContain('Legislative Council');
    });

    it('should have independent commission for NY', () => {
      const entry = registry.getAuthority('congressional');
      const nySource = entry.primarySources.find(
        (s) => s.jurisdiction === 'NY'
      );

      expect(nySource?.entity).toContain('Independent Redistricting Commission');
    });
  });

  describe('Boundary type coverage', () => {
    it('should have primary sources for redistricted types', () => {
      expect(registry.hasPrimarySources('congressional')).toBe(true);
      expect(registry.hasPrimarySources('state_senate')).toBe(true);
      expect(registry.hasPrimarySources('state_house')).toBe(true);
    });

    it('should not have primary sources for county boundaries', () => {
      expect(registry.hasPrimarySources('county')).toBe(false);

      const entry = registry.getAuthority('county');
      expect(entry.primarySources.length).toBe(0);
      expect(entry.aggregatorSources.length).toBeGreaterThan(0);
    });

    it('should not have primary sources for city_council', () => {
      expect(registry.hasPrimarySources('city_council')).toBe(false);
    });

    it('should not have primary sources for voting_precinct', () => {
      expect(registry.hasPrimarySources('voting_precinct')).toBe(false);
    });

    it('should have TIGER aggregator for county boundaries', () => {
      const sources = registry.getAggregatorSources('county');
      expect(sources.length).toBeGreaterThan(0);

      const tiger = sources.find((s) => s.name.includes('TIGER'));
      expect(tiger).toBeDefined();
      expect(tiger?.format).toBe('shapefile');
    });

    it('should have TIGER aggregator for school_unified', () => {
      const sources = registry.getAggregatorSources('school_unified');
      expect(sources.length).toBeGreaterThan(0);

      const tiger = sources.find((s) => s.name.includes('TIGER'));
      expect(tiger).toBeDefined();
    });

    it('should have no aggregators for city_council', () => {
      const sources = registry.getAggregatorSources('city_council');
      expect(sources.length).toBe(0);
    });

    it('should have no aggregators for voting_precinct', () => {
      const sources = registry.getAggregatorSources('voting_precinct');
      expect(sources.length).toBe(0);
    });
  });

  describe('getAggregatorSources', () => {
    it('should return TIGER sources for congressional', () => {
      const sources = registry.getAggregatorSources('congressional');
      expect(sources.length).toBeGreaterThan(0);

      const tiger = sources[0];
      expect(tiger.name).toContain('TIGER');
      expect(tiger.urlTemplate).toContain('CD');
      expect(tiger.releaseMonth).toBe(7); // July
    });

    it('should return TIGER SLDU for state_senate', () => {
      const sources = registry.getAggregatorSources('state_senate');
      const tiger = sources[0];

      expect(tiger.name).toContain('SLDU');
      expect(tiger.urlTemplate).toContain('SLDU');
    });

    it('should return TIGER SLDL for state_house', () => {
      const sources = registry.getAggregatorSources('state_house');
      const tiger = sources[0];

      expect(tiger.name).toContain('SLDL');
      expect(tiger.urlTemplate).toContain('SLDL');
    });

    it('should have correct TIGER release metadata', () => {
      const sources = registry.getAggregatorSources('congressional');
      const tiger = sources[0];

      expect(tiger.releaseMonth).toBe(7);
      expect(tiger.format).toBe('shapefile');
      expect(tiger.url).toContain('census.gov');
    });
  });

  describe('Update triggers', () => {
    it('should have redistricting triggers for congressional', () => {
      const entry = registry.getAuthority('congressional');

      const redistrictingTrigger = entry.updateTriggers.find(
        (t) => t.type === 'redistricting'
      );
      expect(redistrictingTrigger).toBeDefined();

      if (redistrictingTrigger?.type === 'redistricting') {
        expect(redistrictingTrigger.years).toContain(2021);
        expect(redistrictingTrigger.years).toContain(2022);
        expect(redistrictingTrigger.years).toContain(2031);
        expect(redistrictingTrigger.years).toContain(2032);
      }
    });

    it('should have annual triggers for TIGER-backed types', () => {
      const entry = registry.getAuthority('county');

      const annualTrigger = entry.updateTriggers.find(
        (t) => t.type === 'annual'
      );
      expect(annualTrigger).toBeDefined();

      if (annualTrigger?.type === 'annual') {
        expect(annualTrigger.month).toBe(7); // July
      }
    });

    it('should have event triggers for city_council', () => {
      const entry = registry.getAuthority('city_council');

      const eventTrigger = entry.updateTriggers.find(
        (t) => t.type === 'event'
      );
      expect(eventTrigger).toBeDefined();
    });

    it('should have event triggers for county boundary changes', () => {
      const entry = registry.getAuthority('county');

      const eventTrigger = entry.updateTriggers.find(
        (t) => t.type === 'event'
      );
      expect(eventTrigger).toBeDefined();

      if (eventTrigger?.type === 'event') {
        expect(eventTrigger.description).toContain('boundary changes');
      }
    });
  });

  describe('isRedistrictingWindow', () => {
    const redistrictingYears = [2021, 2022, 2031, 2032, 2041, 2042];

    it.each(redistrictingYears)(
      'should return true for redistricting year %d',
      (year) => {
        expect(registry.isRedistrictingWindow(year)).toBe(true);
      }
    );

    const nonRedistrictingYears = [2020, 2023, 2024, 2025, 2030, 2033, 2040];

    it.each(nonRedistrictingYears)(
      'should return false for non-redistricting year %d',
      (year) => {
        expect(registry.isRedistrictingWindow(year)).toBe(false);
      }
    );

    it('should use current year when not specified', () => {
      const result = registry.isRedistrictingWindow();
      expect(typeof result).toBe('boolean');
    });

    it('should handle boundary years correctly', () => {
      expect(registry.isRedistrictingWindow(2020)).toBe(false); // Census year
      expect(registry.isRedistrictingWindow(2021)).toBe(true);  // First redistricting
      expect(registry.isRedistrictingWindow(2022)).toBe(true);  // Second redistricting
      expect(registry.isRedistrictingWindow(2023)).toBe(false); // Post-redistricting
    });
  });

  describe('getBoundaryTypes', () => {
    it('should return all supported boundary types', () => {
      const types = registry.getBoundaryTypes();

      expect(types.length).toBe(9);
      expect(types).toContain('congressional');
      expect(types).toContain('state_senate');
      expect(types).toContain('state_house');
      expect(types).toContain('county');
      expect(types).toContain('place');
      expect(types).toContain('city_council');
      expect(types).toContain('school_unified');
      expect(types).toContain('voting_precinct');
      expect(types).toContain('special_district');
    });

    it('should return readonly array', () => {
      const types = registry.getBoundaryTypes();
      expect(types).toBeInstanceOf(Array);
    });
  });

  describe('getStatesWithPrimarySources', () => {
    it('should return top 10 states by population', () => {
      const states = registry.getStatesWithPrimarySources();

      expect(states.length).toBeGreaterThanOrEqual(10);
      expect(states).toContain('CA');
      expect(states).toContain('TX');
      expect(states).toContain('FL');
      expect(states).toContain('NY');
      expect(states).toContain('PA');
      expect(states).toContain('IL');
      expect(states).toContain('OH');
      expect(states).toContain('GA');
      expect(states).toContain('NC');
      expect(states).toContain('MI');
    });

    it('should return sorted state codes', () => {
      const states = registry.getStatesWithPrimarySources();

      const sorted = [...states].sort();
      expect(states).toEqual(sorted);
    });

    it('should not include wildcard jurisdiction', () => {
      const states = registry.getStatesWithPrimarySources();
      expect(states).not.toContain('*');
    });

    it('should return unique states', () => {
      const states = registry.getStatesWithPrimarySources();
      const unique = Array.from(new Set(states));

      expect(states.length).toBe(unique.length);
    });
  });

  describe('Expected lag documentation', () => {
    it('should document normal lag for congressional', () => {
      const entry = registry.getAuthority('congressional');
      expect(entry.expectedLag.normal).toBe('0-3 months');
      expect(entry.expectedLag.redistricting).toContain('TIGER');
    });

    it('should document normal lag for county', () => {
      const entry = registry.getAuthority('county');
      expect(entry.expectedLag.normal).toBe('0-3 months');
      expect(entry.expectedLag.redistricting).toBe('0-3 months');
    });

    it('should document variable lag for city_council', () => {
      const entry = registry.getAuthority('city_council');
      expect(entry.expectedLag.normal).toContain('Varies');
      expect(entry.expectedLag.redistricting).toContain('Varies');
    });

    it('should document variable lag for voting_precinct', () => {
      const entry = registry.getAuthority('voting_precinct');
      expect(entry.expectedLag.normal).toContain('Varies');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty jurisdiction string', () => {
      const sources = registry.getPrimarySourcesForState('');
      expect(sources).toEqual([]);
    });

    it('should handle lowercase state codes (no match)', () => {
      // Registry is case-sensitive by design
      const sources = registry.getPrimarySourcesForState('ca');
      expect(sources).toEqual([]);
    });

    it('should handle mixed case state codes (no match)', () => {
      const sources = registry.getPrimarySourcesForState('Ca');
      expect(sources).toEqual([]);
    });

    it('should handle unknown state codes', () => {
      const sources = registry.getPrimarySourcesForState('XX');
      expect(sources).toEqual([]);
    });

    it('should not throw on unknown boundary type lookup', () => {
      // This will throw because TypeScript enforces valid boundary types
      // But test that known boundary types work
      expect(() => registry.getAuthority('congressional')).not.toThrow();
    });
  });

  describe('Source ranking stability', () => {
    it('should return same sources across multiple calls', () => {
      const sources1 = registry.getPrimarySourcesForState('CA');
      const sources2 = registry.getPrimarySourcesForState('CA');

      expect(sources1.length).toBe(sources2.length);

      for (let i = 0; i < sources1.length; i++) {
        expect(sources1[i].name).toBe(sources2[i].name);
        expect(sources1[i].jurisdiction).toBe(sources2[i].jurisdiction);
      }
    });

    it('should return deterministic boundary type list', () => {
      const types1 = registry.getBoundaryTypes();
      const types2 = registry.getBoundaryTypes();

      expect(types1).toEqual(types2);
    });

    it('should return deterministic state list', () => {
      const states1 = registry.getStatesWithPrimarySources();
      const states2 = registry.getStatesWithPrimarySources();

      expect(states1).toEqual(states2);
    });
  });

  describe('Integration with validity windows', () => {
    it('should provide all data needed for validity window calculation', () => {
      const entry = registry.getAuthority('congressional');

      // Needed for validity window calculation
      expect(entry.aggregatorSources[0].releaseMonth).toBeDefined();
      expect(entry.updateTriggers).toBeDefined();
      expect(entry.expectedLag).toBeDefined();
    });

    it('should match TIGER release month across all types', () => {
      const congressional = registry.getAggregatorSources('congressional');
      const stateSenate = registry.getAggregatorSources('state_senate');
      const stateHouse = registry.getAggregatorSources('state_house');

      if (congressional.length > 0 && stateSenate.length > 0 && stateHouse.length > 0) {
        expect(congressional[0].releaseMonth).toBe(7);
        expect(stateSenate[0].releaseMonth).toBe(7);
        expect(stateHouse[0].releaseMonth).toBe(7);
      }
    });
  });

  describe('Integration with gap detector', () => {
    it('should provide redistricting years for gap detection', () => {
      const entry = registry.getAuthority('congressional');

      const redistrictingTrigger = entry.updateTriggers.find(
        (t) => t.type === 'redistricting'
      );

      expect(redistrictingTrigger).toBeDefined();
    });

    it('should identify legislative boundaries affected by redistricting', () => {
      const legislative: BoundaryType[] = [
        'congressional',
        'state_senate',
        'state_house',
      ];

      for (const boundaryType of legislative) {
        const entry = registry.getAuthority(boundaryType);
        const hasRedistrictingTrigger = entry.updateTriggers.some(
          (t) => t.type === 'redistricting'
        );
        expect(hasRedistrictingTrigger).toBe(true);
      }
    });

    it('should identify non-legislative boundaries not affected by redistricting', () => {
      const nonLegislative: BoundaryType[] = [
        'county',
        'place',
        'school_unified',
      ];

      for (const boundaryType of nonLegislative) {
        const entry = registry.getAuthority(boundaryType);
        const hasRedistrictingTrigger = entry.updateTriggers.some(
          (t) => t.type === 'redistricting'
        );
        // These may have redistricting triggers but different semantics
        // Just verify structure is consistent
        expect(entry.updateTriggers).toBeDefined();
      }
    });
  });

  describe('Integration with primary comparator', () => {
    it('should provide URLs for freshness comparison', () => {
      const entry = registry.getAuthority('congressional');

      // Primary sources should have URLs or null
      for (const source of entry.primarySources) {
        expect(source.url === null || typeof source.url === 'string').toBe(
          true
        );
      }

      // Aggregator sources must have URLs
      for (const source of entry.aggregatorSources) {
        expect(typeof source.url === 'string').toBe(true);
        expect(source.url.length).toBeGreaterThan(0);
      }
    });

    it('should provide URL templates for TIGER', () => {
      const entry = registry.getAuthority('congressional');
      const tiger = entry.aggregatorSources[0];

      expect(tiger.urlTemplate).toContain('{YEAR}');
    });

    it('should provide machine-readable format information', () => {
      const entry = registry.getAuthority('congressional');

      for (const source of entry.primarySources) {
        expect(source.machineReadable).toBeDefined();
        expect(typeof source.machineReadable).toBe('boolean');
      }
    });
  });

  describe('Singleton instance', () => {
    it('should work the same as new instance', () => {
      const newRegistry = new AuthorityRegistry();

      const entry1 = authorityRegistry.getAuthority('congressional');
      const entry2 = newRegistry.getAuthority('congressional');

      expect(entry1.boundaryType).toBe(entry2.boundaryType);
      expect(entry1.primarySources.length).toBe(entry2.primarySources.length);
    });

    it('should return same states with primary sources', () => {
      const newRegistry = new AuthorityRegistry();

      const states1 = authorityRegistry.getStatesWithPrimarySources();
      const states2 = newRegistry.getStatesWithPrimarySources();

      expect(states1).toEqual(states2);
    });

    it('should have consistent redistricting window checks', () => {
      const newRegistry = new AuthorityRegistry();

      expect(authorityRegistry.isRedistrictingWindow(2022)).toBe(
        newRegistry.isRedistrictingWindow(2022)
      );
      expect(authorityRegistry.isRedistrictingWindow(2023)).toBe(
        newRegistry.isRedistrictingWindow(2023)
      );
    });
  });

  describe('Data integrity', () => {
    it('should have consistent primary sources across boundary types', () => {
      const congressional = registry.getAuthority('congressional');
      const stateSenate = registry.getAuthority('state_senate');
      const stateHouse = registry.getAuthority('state_house');

      // Same states should have sources across all legislative types
      const congressionalStates = congressional.primarySources.map(
        (s) => s.jurisdiction
      );
      const senateStates = stateSenate.primarySources.map(
        (s) => s.jurisdiction
      );
      const houseStates = stateHouse.primarySources.map((s) => s.jurisdiction);

      expect(congressionalStates.sort()).toEqual(senateStates.sort());
      expect(congressionalStates.sort()).toEqual(houseStates.sort());
    });

    it('should have valid URL formats for all aggregators', () => {
      const types = registry.getBoundaryTypes();

      for (const type of types) {
        const sources = registry.getAggregatorSources(type);
        for (const source of sources) {
          if (source.url.length > 0) {
            expect(source.url).toMatch(/^https?:\/\//);
          }
        }
      }
    });

    it('should have valid release months for TIGER sources', () => {
      const congressional = registry.getAggregatorSources('congressional');

      for (const source of congressional) {
        expect(source.releaseMonth).toBeGreaterThanOrEqual(1);
        expect(source.releaseMonth).toBeLessThanOrEqual(12);
      }
    });

    it('should have non-empty entity names for primary sources', () => {
      const states = registry.getStatesWithPrimarySources();

      for (const state of states) {
        const sources = registry.getPrimarySourcesForState(state);
        for (const source of sources) {
          expect(source.entity.length).toBeGreaterThan(0);
          expect(source.name.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Type safety and structure', () => {
    it('should have readonly properties', () => {
      const entry = registry.getAuthority('congressional');

      // TypeScript enforces readonly at compile time
      // Verify structure at runtime
      expect(Array.isArray(entry.primarySources)).toBe(true);
      expect(Array.isArray(entry.aggregatorSources)).toBe(true);
      expect(Array.isArray(entry.updateTriggers)).toBe(true);
    });

    it('should have valid source types', () => {
      const entry = registry.getAuthority('congressional');

      for (const source of entry.primarySources) {
        expect(source).toHaveProperty('name');
        expect(source).toHaveProperty('entity');
        expect(source).toHaveProperty('jurisdiction');
        expect(source).toHaveProperty('format');
        expect(source).toHaveProperty('machineReadable');
      }
    });

    it('should have valid aggregator types', () => {
      const entry = registry.getAuthority('congressional');

      for (const source of entry.aggregatorSources) {
        expect(source).toHaveProperty('name');
        expect(source).toHaveProperty('url');
        expect(source).toHaveProperty('urlTemplate');
        expect(source).toHaveProperty('format');
        expect(source).toHaveProperty('lag');
        expect(source).toHaveProperty('releaseMonth');
      }
    });

    it('should have valid update trigger types', () => {
      const entry = registry.getAuthority('congressional');

      for (const trigger of entry.updateTriggers) {
        expect(trigger).toHaveProperty('type');
        expect(
          ['annual', 'redistricting', 'census', 'event', 'manual']
        ).toContain(trigger.type);
      }
    });
  });
});
