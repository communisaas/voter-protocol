/**
 * Engagement Tree Builder Tests
 *
 * Tests metrics derivation from on-chain nullifier events.
 * Pure logic — no Poseidon2 hashing, no async, fast tests.
 *
 * Category resolution uses ActionCategoryRegistry (server-side map of
 * action domain hash → category). Action domains are keccak256 hashes
 * with no structured prefix byte.
 *
 * diversityScore is Shannon diversity encoded as floor(H × 1000).
 */

import { describe, it, expect } from 'vitest';
import {
  EngagementTreeBuilder,
  createActionCategoryRegistry,
  type NullifierEvent,
  type ActionCategoryRegistry,
} from '../../../engagement-tree-builder';

// Fixed reference timestamp: Jan 1 2027 00:00:00 UTC
const REF_TIME = Math.floor(new Date('2027-01-01T00:00:00Z').getTime() / 1000);
const SECONDS_PER_MONTH = 30 * 86400;

// Sample action domain hashes (simulating keccak256 output)
const DOMAIN_CONGRESSIONAL = '0xabcdef0000000000000000000000000000000000000000000000000000000001';
const DOMAIN_TEMPLATE      = '0xabcdef0000000000000000000000000000000000000000000000000000000002';
const DOMAIN_CHALLENGE     = '0xabcdef0000000000000000000000000000000000000000000000000000000003';
const DOMAIN_CAMPAIGN      = '0xabcdef0000000000000000000000000000000000000000000000000000000004';
const DOMAIN_GOVERNANCE    = '0xabcdef0000000000000000000000000000000000000000000000000000000005';
const DOMAIN_UNKNOWN       = '0xffff000000000000000000000000000000000000000000000000000000000099';

// Additional domains in the same category (different hashes, same category)
const DOMAIN_CONGRESSIONAL_2 = '0xabcdef0000000000000000000000000000000000000000000000000000000011';
const DOMAIN_CONGRESSIONAL_3 = '0xabcdef0000000000000000000000000000000000000000000000000000000012';

/** Test registry mapping domain hashes to categories */
function makeRegistry(): ActionCategoryRegistry {
  const r = createActionCategoryRegistry();
  r.set(DOMAIN_CONGRESSIONAL.toLowerCase(), 1);
  r.set(DOMAIN_CONGRESSIONAL_2.toLowerCase(), 1);
  r.set(DOMAIN_CONGRESSIONAL_3.toLowerCase(), 1);
  r.set(DOMAIN_TEMPLATE.toLowerCase(), 2);
  r.set(DOMAIN_CHALLENGE.toLowerCase(), 3);
  r.set(DOMAIN_CAMPAIGN.toLowerCase(), 4);
  r.set(DOMAIN_GOVERNANCE.toLowerCase(), 5);
  return r;
}

/** Helper: create a nullifier event with defaults */
function makeEvent(overrides: Partial<NullifierEvent> = {}): NullifierEvent {
  return {
    signer: '0xAlice',
    nullifier: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'),
    actionDomain: DOMAIN_CONGRESSIONAL,
    blockNumber: 100,
    timestamp: REF_TIME - 7 * SECONDS_PER_MONTH, // 7 months ago
    ...overrides,
  };
}

// Shannon H for equal distribution across N categories = ln(N)
const SHANNON_1_CAT = 0;                      // ln(1) = 0
const SHANNON_2_CAT = Math.floor(Math.log(2) * 1000); // 693
const SHANNON_3_CAT = Math.floor(Math.log(3) * 1000); // 1098
const SHANNON_4_CAT = Math.floor(Math.log(4) * 1000); // 1386
const SHANNON_5_CAT = Math.floor(Math.log(5) * 1000); // 1609

describe('EngagementTreeBuilder', () => {
  const registry = makeRegistry();

  // ========================================================================
  // getActionCategory
  // ========================================================================

  describe('getActionCategory', () => {
    it('returns category from registry lookup', () => {
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_CONGRESSIONAL, registry)).toBe(1);
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_TEMPLATE, registry)).toBe(2);
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_CHALLENGE, registry)).toBe(3);
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_CAMPAIGN, registry)).toBe(4);
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_GOVERNANCE, registry)).toBe(5);
    });

    it('returns 0 for domain not in registry', () => {
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_UNKNOWN, registry)).toBe(0);
    });

    it('returns 0 when no registry is provided', () => {
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_CONGRESSIONAL)).toBe(0);
    });

    it('is case-insensitive', () => {
      expect(EngagementTreeBuilder.getActionCategory(DOMAIN_CONGRESSIONAL.toUpperCase(), registry)).toBe(1);
    });
  });

  // ========================================================================
  // computeMetricsForSigner
  // ========================================================================

  describe('computeMetricsForSigner', () => {
    it('returns zeros for empty events', () => {
      const metrics = EngagementTreeBuilder.computeMetricsForSigner([], REF_TIME, registry);
      expect(metrics.actionCount).toBe(0);
      expect(metrics.diversityScore).toBe(0);
      expect(metrics.tenureMonths).toBe(0);
    });

    it('counts distinct nullifiers as actionCount', () => {
      const events = [
        makeEvent({ nullifier: '0xaaa' }),
        makeEvent({ nullifier: '0xbbb' }),
        makeEvent({ nullifier: '0xccc' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.actionCount).toBe(3);
    });

    it('deduplicates same nullifier', () => {
      const events = [
        makeEvent({ nullifier: '0xaaa' }),
        makeEvent({ nullifier: '0xaaa' }),
        makeEvent({ nullifier: '0xbbb' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.actionCount).toBe(2);
    });

    it('deduplicates nullifiers case-insensitively', () => {
      const events = [
        makeEvent({ nullifier: '0xAAA' }),
        makeEvent({ nullifier: '0xaaa' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.actionCount).toBe(1);
    });

    it('computes Shannon diversity for 3 equal categories', () => {
      const events = [
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
        makeEvent({ actionDomain: DOMAIN_TEMPLATE, nullifier: '0x2' }),
        makeEvent({ actionDomain: DOMAIN_CHALLENGE, nullifier: '0x3' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      // 3 equal categories → Shannon H = ln(3) ≈ 1.099 → encoded = 1098
      expect(metrics.diversityScore).toBe(SHANNON_3_CAT);
    });

    it('computes Shannon diversity for uneven distribution', () => {
      const events = [
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL_2, nullifier: '0x2' }),
        makeEvent({ actionDomain: DOMAIN_TEMPLATE, nullifier: '0x3' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      // 2/3 in cat 1, 1/3 in cat 2 → H = -(2/3 * ln(2/3) + 1/3 * ln(1/3)) ≈ 0.637
      const expectedH = -(2/3 * Math.log(2/3) + 1/3 * Math.log(1/3));
      expect(metrics.diversityScore).toBe(Math.floor(expectedH * 1000));
    });

    it('returns diversityScore=0 for single category', () => {
      const events = [
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL_2, nullifier: '0x2' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      // All in category 1 → Shannon H = 0 → encoded = 0
      expect(metrics.diversityScore).toBe(0);
    });

    it('ignores unrecognized domains (diversity stays 0)', () => {
      const events = [
        makeEvent({ actionDomain: DOMAIN_UNKNOWN, nullifier: '0x1' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.actionCount).toBe(1);
      expect(metrics.diversityScore).toBe(0);
    });

    it('diversityScore is 0 when no registry is provided', () => {
      const events = [
        makeEvent({ actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
        makeEvent({ actionDomain: DOMAIN_TEMPLATE, nullifier: '0x2' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME);
      expect(metrics.actionCount).toBe(2);
      expect(metrics.diversityScore).toBe(0);
    });

    it('computes tenure in months from earliest event', () => {
      const events = [
        makeEvent({ timestamp: REF_TIME - 7 * SECONDS_PER_MONTH, nullifier: '0x1' }),
        makeEvent({ timestamp: REF_TIME - 3 * SECONDS_PER_MONTH, nullifier: '0x2' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.tenureMonths).toBe(7);
    });

    it('tenure is 0 for events at reference time', () => {
      const events = [
        makeEvent({ timestamp: REF_TIME, nullifier: '0x1' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.tenureMonths).toBe(0);
    });

    it('tenure floors partial months', () => {
      // 6.5 months → 6
      const events = [
        makeEvent({ timestamp: REF_TIME - Math.floor(6.5 * SECONDS_PER_MONTH), nullifier: '0x1' }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.tenureMonths).toBe(6);
    });

    it('ignores duplicate nullifiers for category and tenure', () => {
      // Same nullifier with different timestamps — second is ignored
      const events = [
        makeEvent({ nullifier: '0xaaa', timestamp: REF_TIME - 12 * SECONDS_PER_MONTH, actionDomain: DOMAIN_CONGRESSIONAL }),
        makeEvent({ nullifier: '0xaaa', timestamp: REF_TIME - 1 * SECONDS_PER_MONTH, actionDomain: DOMAIN_TEMPLATE }),
      ];
      const metrics = EngagementTreeBuilder.computeMetricsForSigner(events, REF_TIME, registry);
      expect(metrics.actionCount).toBe(1);
      expect(metrics.diversityScore).toBe(0); // Single category → H = 0
      expect(metrics.tenureMonths).toBe(12); // From first event
    });
  });

  // ========================================================================
  // buildFromEvents — Tier Integration
  // ========================================================================

  describe('buildFromEvents', () => {
    it('produces no entries for no events', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const result = EngagementTreeBuilder.buildFromEvents([], identityMap, REF_TIME, registry);
      expect(result.entries).toHaveLength(0);
      expect(result.totalEvents).toBe(0);
    });

    it('produces Tier 1 (Active) for single action', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events = [
        makeEvent({ signer: '0xAlice', actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
      ];
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.entries).toHaveLength(1);
      // Single category → diversityScore = 0 (Shannon H = 0)
      expect(result.entries[0].diversityScore).toBe(0);
      // E = log2(2) × 1 × (1+sqrt(7/12)) × 1 = 1.764 → tier 1
      expect(result.entries[0].tier).toBe(1);
      expect(result.entries[0].actionCount).toBe(1);
    });

    it('produces Tier 2 (Established) with moderate engagement', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events: NullifierEvent[] = [];
      // 10 actions: 8 congressional + 2 template, 7 months tenure
      for (let i = 0; i < 8; i++) {
        events.push(makeEvent({
          signer: '0xAlice',
          actionDomain: DOMAIN_CONGRESSIONAL,
          nullifier: '0x' + (i + 1).toString(16).padStart(64, '0'),
        }));
      }
      for (let i = 0; i < 2; i++) {
        events.push(makeEvent({
          signer: '0xAlice',
          actionDomain: DOMAIN_TEMPLATE,
          nullifier: '0x' + (i + 9).toString(16).padStart(64, '0'),
        }));
      }
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.entries[0].actionCount).toBe(10);
      // 8/10 cat 1 + 2/10 cat 2 → Shannon H ≈ 0.500
      expect(result.entries[0].diversityScore).toBeGreaterThan(0);
      // E = log2(11) × (1+0.5) × (1+sqrt(7/12)) × 1 ≈ 9.15 → tier 2
      expect(result.entries[0].tier).toBe(2);
    });

    it('produces Tier 3 (Veteran) with diverse sustained engagement', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events: NullifierEvent[] = [];
      // 50 actions evenly across 3 categories, 7 months tenure
      const domains = [DOMAIN_CONGRESSIONAL, DOMAIN_TEMPLATE, DOMAIN_CHALLENGE];
      for (let i = 0; i < 50; i++) {
        events.push(makeEvent({
          signer: '0xAlice',
          actionDomain: domains[i % 3],
          nullifier: '0x' + (i + 1).toString(16).padStart(64, '0'),
          timestamp: REF_TIME - 7 * SECONDS_PER_MONTH,
        }));
      }
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      // Shannon H ≈ ln(3) = 1.099, E ≈ 21 → tier 3
      expect(result.entries[0].tier).toBe(3);
    });

    it('produces Tier 4 (Pillar) with deep diverse engagement', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events: NullifierEvent[] = [];
      // 200 actions evenly across 4 categories, 13 months tenure
      const domains = [DOMAIN_CONGRESSIONAL, DOMAIN_TEMPLATE, DOMAIN_CHALLENGE, DOMAIN_CAMPAIGN];
      for (let i = 0; i < 200; i++) {
        events.push(makeEvent({
          signer: '0xAlice',
          actionDomain: domains[i % 4],
          nullifier: '0x' + (i + 1).toString(16).padStart(64, '0'),
          timestamp: REF_TIME - 13 * SECONDS_PER_MONTH,
        }));
      }
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      // Shannon H ≈ ln(4) = 1.386, E ≈ 37.3 → tier 4
      expect(result.entries[0].tier).toBe(4);
    });

    it('skips signers not in identityMap', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events = [
        makeEvent({ signer: '0xAlice', nullifier: '0x1' }),
        makeEvent({ signer: '0xBob', nullifier: '0x2' }),
      ];
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.entries).toHaveLength(1);
      expect(result.skippedSigners).toContain('0xbob');
    });

    it('handles multiple signers', () => {
      const identityMap = new Map([
        ['0xalice', 100n],
        ['0xbob', 200n],
      ]);
      const events = [
        makeEvent({ signer: '0xAlice', nullifier: '0x1', actionDomain: DOMAIN_CONGRESSIONAL }),
        makeEvent({ signer: '0xBob', nullifier: '0x2', actionDomain: DOMAIN_TEMPLATE }),
      ];
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.entries).toHaveLength(2);
      expect(result.uniqueSigners).toBe(2);
    });

    it('normalizes signer addresses to lowercase for map lookup', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events = [
        makeEvent({ signer: '0xALICE', nullifier: '0x1', actionDomain: DOMAIN_CONGRESSIONAL }),
      ];
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].identityCommitment).toBe(100n);
    });

    it('returns correct totalEvents count', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events = [
        makeEvent({ signer: '0xAlice', nullifier: '0x1' }),
        makeEvent({ signer: '0xAlice', nullifier: '0x2' }),
        makeEvent({ signer: '0xBob', nullifier: '0x3' }),
      ];
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME, registry);
      expect(result.totalEvents).toBe(3);
    });

    it('produces diversityScore=0 without registry, still tier 1 for nonzero actions', () => {
      const identityMap = new Map([['0xalice', 100n]]);
      const events = [
        makeEvent({ signer: '0xAlice', actionDomain: DOMAIN_CONGRESSIONAL, nullifier: '0x1' }),
        makeEvent({ signer: '0xAlice', actionDomain: DOMAIN_TEMPLATE, nullifier: '0x2' }),
      ];
      // No registry passed — diversityScore should be 0
      const result = EngagementTreeBuilder.buildFromEvents(events, identityMap, REF_TIME);
      expect(result.entries[0].actionCount).toBe(2);
      expect(result.entries[0].diversityScore).toBe(0);
      // Under composite score, any nonzero actionCount → E > 0 → tier 1
      expect(result.entries[0].tier).toBe(1);
    });
  });
});
