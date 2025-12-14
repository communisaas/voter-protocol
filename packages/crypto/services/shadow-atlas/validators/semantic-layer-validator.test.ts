/**
 * Semantic Validator Tests
 *
 * Validates semantic analysis of GIS layer titles to identify council districts.
 *
 * Test Strategy:
 * 1. High-confidence title patterns: "Council Districts" → score 40
 * 2. Medium-confidence patterns: "Ward Boundaries" → score 30
 * 3. Low-confidence patterns: "Districts" → score 20
 * 4. Negative keywords: "Voting Precincts" → score 0 (rejected)
 * 5. City name matching with aliases
 * 6. Governance structure validation
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import { SemanticValidator } from '../validation/semantic-validator.js';
import type { SemanticScore } from '../validation/semantic-validator.js';

describe('SemanticValidator', () => {
  describe('scoreTitle() - High-Confidence Patterns (40 points)', () => {
    it('should score "City Council Districts" highly (40 points)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('City Council Districts');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
      expect(result.reasons[0]).toContain('Name matches high-confidence pattern');
      expect(result.negativeMatches).toHaveLength(0);
    });

    it('should score "District Council Boundaries" highly (40 points)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('District Council Boundaries');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
      expect(result.reasons[0]).toContain('Name matches high-confidence pattern');
    });

    it('should score "Municipal Districts" highly (40 points)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Municipal Districts');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
      expect(result.reasons[0]).toContain('Name matches high-confidence pattern');
    });

    it('should score "Citizens Council Districts" (Helena pattern) highly', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Citizens Council Districts');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
    });

    it('should score "Billings Wards" highly (city + ward pattern)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Billings Wards');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
    });
  });

  describe('scoreTitle() - Medium-Confidence Patterns (30 points)', () => {
    it('should score "Ward Boundaries" with medium confidence (30 points)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Ward Boundaries');

      expect(result.score).toBe(30);
      expect(result.passed).toBe(true);
      expect(result.reasons[0]).toContain('Name matches medium-confidence pattern');
    });

    it('should score "Wards" with medium confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Wards');

      expect(result.score).toBe(30);
      expect(result.passed).toBe(true);
    });

    it('should score "Civic Districts" with medium confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Civic Districts');

      expect(result.score).toBe(30);
      expect(result.passed).toBe(true);
    });

    it('should score "City Boundaries" with medium confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('City Boundaries');

      expect(result.score).toBe(30);
      expect(result.passed).toBe(true);
    });

    it('should score "Commission Districts" with medium confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Commission Districts');

      expect(result.score).toBe(30);
      expect(result.passed).toBe(true);
    });
  });

  describe('scoreTitle() - Low-Confidence Patterns (20 points)', () => {
    it('should score "Council" with low confidence (20 points)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Council');

      expect(result.score).toBe(20);
      expect(result.passed).toBe(false); // Below 30 threshold
      expect(result.reasons[0]).toContain('Name matches low-confidence pattern');
    });

    it('should score "District" (singular) with low confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('District');

      expect(result.score).toBe(20);
      expect(result.passed).toBe(false);
    });

    it('should score "Representation" with low confidence', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Representation');

      expect(result.score).toBe(20);
      expect(result.passed).toBe(false);
    });
  });

  describe('scoreTitle() - Negative Keyword Filtering', () => {
    it('should reject "Voting Precincts 2024" (contains negative keywords)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Voting Precincts 2024');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      // Should match either "voting" or "precinct" (whichever comes first in the check)
      expect(result.negativeMatches.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain('negative keyword');
    });

    it('should reject "Election Precincts" (contains "election" and "precincts")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Election Precincts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches.length).toBeGreaterThan(0);
    });

    it('should reject "Tree Canopy Cover" (contains "canopy")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Tree Canopy Cover');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('canopy');
    });

    it('should reject "Zoning Overlay Districts" (contains "zoning")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Zoning Overlay Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('zoning');
    });

    it('should reject "Polling Locations" (contains "polling")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Polling Locations');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('polling');
    });

    it('should reject "Parcel Boundaries" (contains "parcel")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Parcel Boundaries');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('parcel');
    });

    it('should reject "School Districts" (contains "school")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('School Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('school');
    });

    it('should reject "Fire Districts" (contains "fire")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Fire Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('fire');
    });

    it('should reject "Congressional Districts" (contains "congressional")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Congressional Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('congressional');
    });

    it('should reject "State Senate Districts" (contains "state senate")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('State Senate Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('state senate');
    });

    it('should reject "Police Districts" (contains "police")', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Police Districts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('police');
    });
  });

  describe('scoreTitle() - Non-matches', () => {
    it('should score "Parks and Recreation" as 0 (no patterns)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Parks and Recreation');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches).toContain('park');
    });

    it('should score "Random Layer" as 0 (no patterns)', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Random Layer');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Name does not match known patterns');
    });
  });

  describe('hasNegativeKeywords()', () => {
    it('should detect negative keywords', () => {
      const validator = new SemanticValidator();

      expect(validator.hasNegativeKeywords('Voting Precincts')).toBe(true);
      expect(validator.hasNegativeKeywords('Election Data')).toBe(true);
      expect(validator.hasNegativeKeywords('Tree Canopy')).toBe(true);
      expect(validator.hasNegativeKeywords('Zoning Map')).toBe(true);
    });

    it('should not flag legitimate council district titles', () => {
      const validator = new SemanticValidator();

      expect(validator.hasNegativeKeywords('City Council Districts')).toBe(false);
      expect(validator.hasNegativeKeywords('Ward Boundaries')).toBe(false);
      expect(validator.hasNegativeKeywords('Municipal Districts')).toBe(false);
    });
  });

  describe('matchCityName()', () => {
    it('should match exact city name (100% confidence)', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('Kansas City', 'Kansas City', 'MO');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(100);
      expect(result.matchedAlias).toBeNull();
    });

    it('should match case-insensitively', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('kansas city', 'Kansas City', 'MO');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(100);
    });

    it('should match partial substring (70% confidence)', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('City of Portland', 'Portland', 'OR');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(70);
      expect(result.matchedAlias).toBeNull();
    });

    it('should match Honolulu alias (90% confidence)', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('City and County of Honolulu', 'Urban Honolulu', 'HI');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(90);
      expect(result.matchedAlias).not.toBeNull();
    });

    it('should match Indianapolis alias', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('Indianapolis Marion County', 'Indianapolis city (balance)', 'IN');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(70);
    });

    it('should match Nashville alias', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('Metro Nashville', 'Nashville-Davidson metropolitan government (balance)', 'TN');

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(70);
    });

    it('should not match unrelated city names', () => {
      const validator = new SemanticValidator();
      const result = validator.matchCityName('Seattle', 'Portland', 'OR');

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.matchedAlias).toBeNull();
    });
  });

  describe('validateGovernanceStructure()', () => {
    it('should validate district number field', () => {
      const validator = new SemanticValidator();
      const properties = {
        DISTRICT: 1,
        NAME: 'District 1',
      };

      expect(validator.validateGovernanceStructure(properties, 6)).toBe(true);
    });

    it('should validate council member field', () => {
      const validator = new SemanticValidator();
      const properties = {
        COUNCIL: 2,
        MEMBER: 'John Smith',
      };

      expect(validator.validateGovernanceStructure(properties, 8)).toBe(true);
    });

    it('should validate ward field', () => {
      const validator = new SemanticValidator();
      const properties = {
        WARD: 'A',
        ward_name: 'Ward A',
      };

      expect(validator.validateGovernanceStructure(properties, 5)).toBe(true);
    });

    it('should validate lowercase field names', () => {
      const validator = new SemanticValidator();
      const properties = {
        district: 3,
        council: 'Council District 3',
      };

      expect(validator.validateGovernanceStructure(properties, 10)).toBe(true);
    });

    it('should validate numeric string values', () => {
      const validator = new SemanticValidator();
      const properties = {
        DISTRICT: '5',
      };

      expect(validator.validateGovernanceStructure(properties, 8)).toBe(true);
    });

    it('should validate letter district identifiers', () => {
      const validator = new SemanticValidator();
      const properties = {
        DISTRICT: 'C',
      };

      expect(validator.validateGovernanceStructure(properties, 5)).toBe(true);
    });

    it('should reject properties with no district fields', () => {
      const validator = new SemanticValidator();
      const properties = {
        NAME: 'Some Feature',
        TYPE: 'Polygon',
      };

      expect(validator.validateGovernanceStructure(properties, 6)).toBe(false);
    });

    it('should reject properties with invalid district values', () => {
      const validator = new SemanticValidator();
      const properties = {
        DISTRICT: 'Not a valid district identifier',
      };

      expect(validator.validateGovernanceStructure(properties, 6)).toBe(false);
    });
  });

  describe('getSearchNames()', () => {
    it('should return default name for cities without aliases', () => {
      const validator = new SemanticValidator();
      const searchNames = validator.getSearchNames('2938000', 'Kansas City');

      expect(searchNames).toEqual(['Kansas City']);
    });

    it('should return alias search names for Honolulu', () => {
      const validator = new SemanticValidator();
      const searchNames = validator.getSearchNames('1571550', 'Urban Honolulu');

      expect(searchNames).toContain('Honolulu');
      expect(searchNames).toContain('City and County of Honolulu');
    });

    it('should return alias search names for Indianapolis', () => {
      const validator = new SemanticValidator();
      const searchNames = validator.getSearchNames('1836003', 'Indianapolis city (balance)');

      expect(searchNames).toContain('Indianapolis');
      expect(searchNames).toContain('Indianapolis Marion County');
    });

    it('should return alias search names for Nashville', () => {
      const validator = new SemanticValidator();
      const searchNames = validator.getSearchNames('4752006', 'Nashville-Davidson metropolitan government (balance)');

      expect(searchNames).toContain('Nashville');
      expect(searchNames).toContain('Nashville Davidson');
      expect(searchNames).toContain('Metro Nashville');
    });
  });

  describe('needsAlias()', () => {
    it('should return false for cities without aliases', () => {
      const validator = new SemanticValidator();

      expect(validator.needsAlias('2938000')).toBe(false); // Kansas City
      expect(validator.needsAlias('4159000')).toBe(false); // Portland
    });

    it('should return true for cities with aliases', () => {
      const validator = new SemanticValidator();

      expect(validator.needsAlias('1571550')).toBe(true); // Honolulu
      expect(validator.needsAlias('1836003')).toBe(true); // Indianapolis
      expect(validator.needsAlias('4752006')).toBe(true); // Nashville
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string title', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Name does not match known patterns');
    });

    it('should handle whitespace-only title', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('   ');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
    });

    it('should handle very long title', () => {
      const validator = new SemanticValidator();
      const longTitle = 'City Council Districts for the Municipality of Kansas City in the State of Missouri';
      const result: SemanticScore = validator.scoreTitle(longTitle);

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
    });

    it('should handle mixed case patterns', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('COUNCIL DISTRICTS');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
    });

    it('should prioritize negative keywords over positive patterns', () => {
      const validator = new SemanticValidator();
      const result: SemanticScore = validator.scoreTitle('Council District Voting Precincts');

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.negativeMatches.length).toBeGreaterThan(0);
    });
  });

  describe('Pattern Priority', () => {
    it('should prefer high-confidence pattern over medium-confidence', () => {
      const validator = new SemanticValidator();

      // "Council Districts" should match high-confidence (40) not medium-confidence ward pattern (30)
      const result: SemanticScore = validator.scoreTitle('Council Districts Ward');

      expect(result.score).toBe(40);
      expect(result.passed).toBe(true);
    });

    it('should prefer medium-confidence pattern over low-confidence', () => {
      const validator = new SemanticValidator();

      // "Ward" should match medium-confidence (30) not low-confidence "district" pattern (20)
      const result: SemanticScore = validator.scoreTitle('Ward District');

      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.passed).toBe(true);
    });
  });
});
