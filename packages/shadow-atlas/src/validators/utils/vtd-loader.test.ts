/**
 * VTD Loader (validators-facing) Tests
 *
 * Pins the getStatesWithVTDData()/hasVTDData() consistency property: every
 * state that satisfies hasVTDData() must appear in getStatesWithVTDData(),
 * and vice versa. This regressed silently when the loader was rewritten to
 * delegate to the JSON-backed dataset (getStatesWithVTDData started
 * iterating the VEST-derived expectedByState table, which omits Utah, while
 * hasVTDData continued to reflect real GEOID presence).
 */

import { describe, it, expect } from 'vitest';
import {
  hasVTDData,
  getStatesWithVTDData,
  getNationalVTDTotal,
  loadVTDGEOIDs,
} from './vtd-loader';
import { getAllVTDGeoids } from '../../data/loaders/vtd-geoids-loader';

describe('VTD Loader (validators-facing)', () => {
  it('getStatesWithVTDData() is consistent with hasVTDData() for every state', () => {
    const states = getStatesWithVTDData();

    for (const state of states) {
      expect(hasVTDData(state)).toBe(true);
    }

    // And the converse: every state with real GEOID data appears in the list.
    for (const state of Object.keys(getAllVTDGeoids())) {
      expect(states).toContain(state);
    }
  });

  it('includes Utah (49), which has real GEOID data despite no expectedByState entry', () => {
    expect(hasVTDData('49')).toBe(true);
    expect(getStatesWithVTDData()).toContain('49');
    expect(loadVTDGEOIDs('49')).not.toBeNull();
  });

  it('covers all 50 states with GEOID data', () => {
    expect(getStatesWithVTDData()).toHaveLength(50);
  });

  it('getNationalVTDTotal() equals the dataset-actual total (124,179), including Utah', () => {
    expect(getNationalVTDTotal()).toBe(124179);
  });
});
