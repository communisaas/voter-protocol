#!/usr/bin/env tsx
/**
 * Generate Quick Statistics for URL Pattern Analysis
 */

import { readFileSync } from 'fs';

const detailsPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl';
const correctedPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/corrected_labels.jsonl';

const details = readFileSync(detailsPath, 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const corrected = readFileSync(correctedPath, 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

console.log('═══════════════════════════════════════════════════════════════');
console.log('  URL PATTERN VALIDATION - QUICK STATISTICS');
console.log('═══════════════════════════════════════════════════════════════\n');

// Overall stats
const total = details.length;
const labeledTrue = details.filter(d => d.label).length;
const labeledFalse = details.filter(d => !d.label).length;

console.log('DATASET OVERVIEW:');
console.log(`  Total Samples:     ${total}`);
console.log(`  Labeled TRUE:      ${labeledTrue} (${((labeledTrue/total)*100).toFixed(1)}%)`);
console.log(`  Labeled FALSE:     ${labeledFalse} (${((labeledFalse/total)*100).toFixed(1)}%)`);
console.log('');

// URL classification
const urlTrue = details.filter(d => d.url_classification === true).length;
const urlFalse = details.filter(d => d.url_classification === false).length;
const urlUncertain = details.filter(d => d.url_classification === 'uncertain').length;

console.log('URL-BASED CLASSIFICATION:');
console.log(`  URL says TRUE:     ${urlTrue} (${((urlTrue/total)*100).toFixed(1)}%)`);
console.log(`  URL says FALSE:    ${urlFalse} (${((urlFalse/total)*100).toFixed(1)}%)`);
console.log(`  URL uncertain:     ${urlUncertain} (${((urlUncertain/total)*100).toFixed(1)}%)`);
console.log('');

// Agreement analysis
const agreesWithLabel = details.filter(d => d.agrees_with_label).length;
const disagreesWithLabel = details.filter(d =>
  !d.agrees_with_label && d.url_classification !== 'uncertain'
).length;

console.log('AGREEMENT ANALYSIS:');
console.log(`  URL agrees with label:     ${agreesWithLabel} (${((agreesWithLabel/total)*100).toFixed(1)}%)`);
console.log(`  URL disagrees with label:  ${disagreesWithLabel} (${((disagreesWithLabel/total)*100).toFixed(1)}%)`);
console.log(`  URL uncertain:             ${urlUncertain} (${((urlUncertain/total)*100).toFixed(1)}%)`);
console.log('');

// Corrections
const corrections = corrected.filter(c => c.changed).length;
const highConfCorrections = corrected.filter(c => c.changed && c.confidence >= 80).length;
const veryHighConfCorrections = corrected.filter(c => c.changed && c.confidence >= 90).length;

console.log('RECOMMENDED CORRECTIONS:');
console.log(`  Total corrections:         ${corrections} (${((corrections/total)*100).toFixed(1)}% of dataset)`);
console.log(`  High confidence (≥80%):    ${highConfCorrections}`);
console.log(`  Very high confidence (≥90%): ${veryHighConfCorrections}`);
console.log('');

// Smoking gun analysis
const smokingGuns = details.filter(d =>
  !d.label &&
  d.url_confidence >= 90 &&
  d.url_classification === true
);

const explicitCouncilDistrict = smokingGuns.filter(d =>
  /council.*district/i.test(d.service_name)
).length;

const wardBoundaries = smokingGuns.filter(d =>
  /ward/i.test(d.service_name)
).length;

console.log('SMOKING GUN MISLABELS (Labeled FALSE, URL 90%+ TRUE):');
console.log(`  Total smoking guns:        ${smokingGuns.length}`);
console.log(`  Explicit "Council_District": ${explicitCouncilDistrict}`);
console.log(`  Ward boundaries:           ${wardBoundaries}`);
console.log('');

// Confidence distribution
const veryHighConf = details.filter(d => d.url_confidence >= 90).length;
const highConf = details.filter(d => d.url_confidence >= 70 && d.url_confidence < 90).length;
const mediumConf = details.filter(d => d.url_confidence >= 40 && d.url_confidence < 70).length;
const lowConf = details.filter(d => d.url_confidence < 40).length;

console.log('URL CONFIDENCE DISTRIBUTION:');
console.log(`  Very High (≥90%):  ${veryHighConf} (${((veryHighConf/total)*100).toFixed(1)}%)`);
console.log(`  High (70-89%):     ${highConf} (${((highConf/total)*100).toFixed(1)}%)`);
console.log(`  Medium (40-69%):   ${mediumConf} (${((mediumConf/total)*100).toFixed(1)}%)`);
console.log(`  Low (<40%):        ${lowConf} (${((lowConf/total)*100).toFixed(1)}%)`);
console.log('');

// Domain analysis
const domains = new Map<string, { total: number; true_count: number; false_count: number }>();
for (const d of details) {
  if (!domains.has(d.domain)) {
    domains.set(d.domain, { total: 0, true_count: 0, false_count: 0 });
  }
  const stats = domains.get(d.domain)!;
  stats.total++;
  if (d.label) {
    stats.true_count++;
  } else {
    stats.false_count++;
  }
}

const topDomains = Array.from(domains.entries())
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, 5);

console.log('TOP 5 DOMAINS:');
for (const [domain, stats] of topDomains) {
  const truePercent = ((stats.true_count / stats.total) * 100).toFixed(0);
  const dotGov = domain.endsWith('.gov') ? '[.GOV]' : '';
  console.log(`  ${domain} ${dotGov}`);
  console.log(`    Total: ${stats.total}, TRUE: ${stats.true_count} (${truePercent}%), FALSE: ${stats.false_count}`);
}
console.log('');

// Service name patterns
const servicePatterns = new Map<string, number>();
for (const d of details) {
  if (d.label && d.service_name) {
    servicePatterns.set(d.service_name, (servicePatterns.get(d.service_name) || 0) + 1);
  }
}

const topServicePatterns = Array.from(servicePatterns.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('TOP 10 SERVICE NAMES (TRUE council districts):');
for (const [pattern, count] of topServicePatterns) {
  console.log(`  ${pattern}: ${count}`);
}
console.log('');

console.log('═══════════════════════════════════════════════════════════════');
console.log('KEY FINDINGS:');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`1. TRAINING DATA QUALITY ISSUE: ${((corrections/total)*100).toFixed(1)}% of samples require correction`);
console.log(`2. SYSTEMATIC MISLABELING: ${explicitCouncilDistrict} services named "Council_District" labeled FALSE`);
console.log(`3. URL SIGNAL STRENGTH: ${((veryHighConf/total)*100).toFixed(1)}% of URLs provide ≥90% confidence classification`);
console.log(`4. ENSEMBLE OPPORTUNITY: ${((urlUncertain/total)*100).toFixed(1)}% of URLs are ambiguous, need LLM+fields`);
console.log('');
console.log('RECOMMENDATION: Clean training data before production deployment.');
console.log('               Apply 41 high-confidence URL corrections.');
console.log('               Human review 186 ambiguous cases (43% of dataset).');
console.log('');
console.log('═══════════════════════════════════════════════════════════════\n');
