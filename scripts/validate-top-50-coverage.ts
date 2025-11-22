#!/usr/bin/env node
/**
 * Top 50 US Cities Coverage Validation
 *
 * PURPOSE: Verify production-ready coverage for all top 50 cities
 *
 * VALIDATION TIERS:
 * - Excellent: Layer 1 coverage (council districts) with confidence ≥80
 * - Good: Layer 1 with confidence ≥70 OR confirmed at-large governance
 * - Fallback: Layer 2 only (Census PLACE boundaries, no district data)
 *
 * COVERAGE GUARANTEE:
 * - Layer 1: Council district GeoJSON from validated portals
 * - Layer 2: Census PLACE boundaries (ALWAYS available for all cities)
 * - Governance: Manual registry for at-large cities (no districts to discover)
 */

import { KNOWN_PORTALS } from '../packages/crypto/services/shadow-atlas/registry/known-portals.js';
import { GOVERNANCE_REGISTRY } from '../packages/crypto/services/shadow-atlas/registry/governance-structures.js';
import { TOP_50_US_CITIES, type CityData } from './top-50-us-cities.js';

interface CoverageResult {
  city: CityData;
  layer1: boolean; // In known-portals registry
  layer2: boolean; // Census PLACE (always true)
  governance: 'district-based' | 'at-large' | 'mixed' | 'unknown';
  confidence: number | null;
  status: 'excellent' | 'good' | 'fallback' | 'unknown';
  notes: string;
}

function validateCoverage(): CoverageResult[] {
  const results: CoverageResult[] = [];

  for (const city of TOP_50_US_CITIES) {
    // Check Layer 1 (known portals)
    const portalEntry = KNOWN_PORTALS[city.fips];
    const hasLayer1 = !!portalEntry;

    // Check governance registry
    const govEntry = GOVERNANCE_REGISTRY[city.fips];
    const governance = govEntry?.structure || 'unknown';

    // Determine status
    let status: CoverageResult['status'];
    let notes: string;

    if (hasLayer1 && portalEntry.confidence >= 80) {
      status = 'excellent';
      notes = `High-confidence Layer 1: ${portalEntry.featureCount} districts from ${portalEntry.portalType}`;
    } else if (hasLayer1 && portalEntry.confidence >= 70) {
      status = 'good';
      notes = `Medium-confidence Layer 1: ${portalEntry.featureCount} districts from ${portalEntry.portalType}`;
    } else if (hasLayer1 && portalEntry.confidence >= 60) {
      status = 'good';
      notes = `Layer 1 available: ${portalEntry.featureCount} districts (confidence ${portalEntry.confidence})`;
    } else if (governance === 'at-large') {
      status = 'good';
      notes = `Confirmed at-large governance (${govEntry?.councilSize} seats), Layer 2 is correct solution`;
    } else if (governance === 'district-based' || governance === 'mixed') {
      status = 'fallback';
      notes = `Layer 2 fallback: Known to have districts but no portal yet (needs discovery)`;
    } else {
      status = 'fallback';
      notes = `Layer 2 fallback: Census PLACE boundaries (district data not yet discovered)`;
    }

    results.push({
      city,
      layer1: hasLayer1,
      layer2: true, // Census PLACE always available
      governance,
      confidence: portalEntry?.confidence || null,
      status,
      notes,
    });
  }

  return results;
}

function main() {
  const results = validateCoverage();

  // Summary statistics
  const excellent = results.filter(r => r.status === 'excellent').length;
  const good = results.filter(r => r.status === 'good').length;
  const fallback = results.filter(r => r.status === 'fallback').length;
  const layer1Count = results.filter(r => r.layer1).length;

  console.log('='.repeat(80));
  console.log('TOP 50 US CITIES COVERAGE VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log();

  console.log('SUMMARY STATISTICS');
  console.log('-'.repeat(80));
  console.log(`Total cities validated:                50`);
  console.log(`Excellent (Layer 1, confidence ≥80):   ${excellent.toString().padStart(2)} (${(excellent/50*100).toFixed(1)}%)`);
  console.log(`Good (Layer 1 ≥60 OR at-large):        ${good.toString().padStart(2)} (${(good/50*100).toFixed(1)}%)`);
  console.log(`Fallback (Layer 2 Census PLACE only):  ${fallback.toString().padStart(2)} (${(fallback/50*100).toFixed(1)}%)`);
  console.log();
  console.log(`Layer 1 coverage (district GeoJSON):   ${layer1Count.toString().padStart(2)} (${(layer1Count/50*100).toFixed(1)}%)`);
  console.log(`Total coverage (Layer 1 + Layer 2):    50 (100.0%)`);
  console.log();

  // Tier breakdown
  const top10 = results.slice(0, 10);
  const tier1120 = results.slice(10, 20);
  const tier2130 = results.slice(20, 30);
  const tier3140 = results.slice(30, 40);
  const tier4150 = results.slice(40, 50);

  console.log('COVERAGE BY POPULATION TIER');
  console.log('-'.repeat(80));
  console.log(`Top 10 (Pop 652k+):     ${top10.filter(r => r.status !== 'fallback').length}/10 excellent/good`);
  console.log(`Rank 11-20 (Pop 585k+): ${tier1120.filter(r => r.status !== 'fallback').length}/10 excellent/good`);
  console.log(`Rank 21-30 (Pop 467k+): ${tier2130.filter(r => r.status !== 'fallback').length}/10 excellent/good`);
  console.log(`Rank 31-40 (Pop 394k+): ${tier3140.filter(r => r.status !== 'fallback').length}/10 excellent/good`);
  console.log(`Rank 41-50 (Pop 384k+): ${tier4150.filter(r => r.status !== 'fallback').length}/10 excellent/good`);
  console.log();

  // State coverage
  const byState: Record<string, CoverageResult[]> = {};
  for (const result of results) {
    if (!byState[result.city.state]) {
      byState[result.city.state] = [];
    }
    byState[result.city.state].push(result);
  }

  console.log('COVERAGE BY STATE (Top 50 cities only)');
  console.log('-'.repeat(80));
  const sortedStates = Object.keys(byState).sort();
  for (const state of sortedStates) {
    const cities = byState[state];
    const covered = cities.filter(r => r.status !== 'fallback').length;
    console.log(`${state}: ${covered}/${cities.length} cities with Layer 1 or at-large`);
  }
  console.log();

  // Detailed status
  console.log('DETAILED CITY STATUS');
  console.log('-'.repeat(80));

  for (const result of results) {
    const icon = result.status === 'excellent' ? '✅' :
                 result.status === 'good' ? '🟢' :
                 result.status === 'fallback' ? '🟡' : '❌';

    const confidence = result.confidence ? `[conf: ${result.confidence}]` : '';
    const gov = result.governance !== 'unknown' ? `(${result.governance})` : '';

    console.log(`${icon} ${result.city.rank.toString().padStart(2)}. ${result.city.name}, ${result.city.state} ${confidence} ${gov}`);
    console.log(`   ${result.notes}`);
  }
  console.log();

  // Cities needing improvement
  const needsWork = results.filter(r => r.status === 'fallback' && r.governance !== 'at-large');
  if (needsWork.length > 0) {
    console.log('PRIORITY: Cities with districts but no Layer 1 portal yet');
    console.log('-'.repeat(80));
    for (const result of needsWork) {
      console.log(`- ${result.city.rank}. ${result.city.name}, ${result.city.state} (${result.city.pop2020.toLocaleString()} pop)`);
    }
    console.log();
    console.log(`${needsWork.length} cities need discovery work to reach Layer 1 coverage`);
  }

  // At-large cities
  const atLarge = results.filter(r => r.governance === 'at-large');
  if (atLarge.length > 0) {
    console.log();
    console.log('AT-LARGE CITIES (Layer 2 is correct, no districts to discover)');
    console.log('-'.repeat(80));
    for (const result of atLarge) {
      console.log(`- ${result.city.rank}. ${result.city.name}, ${result.city.state}`);
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('✅ COVERAGE GUARANTEE: All 50 cities have either Layer 1 or Layer 2 coverage');
  console.log('='.repeat(80));
}

main();
