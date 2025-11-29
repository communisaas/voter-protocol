#!/usr/bin/env tsx
/**
 * Deep Investigation: Training Data Labeling Errors
 *
 * CRITICAL FINDING: Many samples labeled FALSE contain explicit "Council_District" in URL
 * This suggests systematic mislabeling in the ground truth dataset.
 */

import { readFileSync, writeFileSync } from 'fs';

interface Sample {
  url: string;
  title: string;
  label: boolean;
  url_classification: boolean | 'uncertain';
  url_confidence: number;
  url_reasoning: string[];
  correction?: string;
  service_name: string;
}

const detailsPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl';
const lines = readFileSync(detailsPath, 'utf-8').split('\n').filter(l => l.trim());
const samples: Sample[] = lines.map(line => JSON.parse(line));

// Category 1: SMOKING GUN - Labeled FALSE but URL screams TRUE
const smokingGuns = samples.filter(s =>
  !s.label &&
  s.url_confidence >= 90 &&
  (
    /council.*district/i.test(s.service_name) ||
    /ward.*bound/i.test(s.service_name) ||
    s.service_name === 'CouncilDistricts'
  )
);

console.log('## SMOKING GUN MISLABELS (Labeled FALSE, URL 90%+ TRUE)');
console.log(`Found ${smokingGuns.length} high-confidence mislabels\n`);

// Group by pattern type
const councilDistrictExplicit = smokingGuns.filter(s => /council.*district/i.test(s.service_name));
const wardExplicit = smokingGuns.filter(s => /ward/i.test(s.service_name));
const councilOnly = smokingGuns.filter(s => /^council/i.test(s.service_name) && !/district/i.test(s.service_name));

console.log('### Explicit "Council_District" in URL (labeled FALSE):');
console.log(`Count: ${councilDistrictExplicit.length}\n`);
for (const s of councilDistrictExplicit.slice(0, 10)) {
  console.log(`**${s.title}**`);
  console.log(`Service: \`${s.service_name}\``);
  console.log(`Confidence: ${s.url_confidence}%`);
  console.log(`URL: ${s.url}\n`);
}

console.log('\n### Ward Boundaries (labeled FALSE):');
console.log(`Count: ${wardExplicit.length}\n`);
for (const s of wardExplicit.slice(0, 5)) {
  console.log(`**${s.title}**`);
  console.log(`Service: \`${s.service_name}\``);
  console.log(`Confidence: ${s.url_confidence}%\n`);
}

// Category 2: Thematic overlays (correctly labeled FALSE)
const thematicOverlays = samples.filter(s =>
  !s.label &&
  s.url_classification === false &&
  (
    /crime/i.test(s.service_name) ||
    /fire/i.test(s.service_name) ||
    /park/i.test(s.service_name) ||
    /census/i.test(s.service_name) ||
    /demographic/i.test(s.service_name)
  )
);

console.log('\n## CORRECTLY LABELED FALSE (Thematic overlays)');
console.log(`Count: ${thematicOverlays.length}\n`);
console.log('Examples:');
for (const s of thematicOverlays.slice(0, 5)) {
  console.log(`- ${s.title} (${s.service_name})`);
}

// Category 3: Ambiguous cases
const ambiguous = samples.filter(s =>
  s.url_classification === 'uncertain' &&
  s.url_confidence > 40 &&
  s.url_confidence < 60
);

console.log('\n## AMBIGUOUS (Need Human Review)');
console.log(`Count: ${ambiguous.length}\n`);
for (const s of ambiguous.slice(0, 5)) {
  console.log(`**${s.title}**`);
  console.log(`Label: ${s.label}, URL confidence: ${s.url_confidence}%`);
  console.log(`Service: ${s.service_name}\n`);
}

// Category 4: Potential FALSE positives (labeled TRUE but URL suggests FALSE)
const falsePositives = samples.filter(s =>
  s.label &&
  s.url_classification === false &&
  s.url_confidence <= 30
);

console.log('\n## POTENTIAL FALSE POSITIVES (Labeled TRUE, URL suggests FALSE)');
console.log(`Count: ${falsePositives.length}\n`);
for (const s of falsePositives.slice(0, 10)) {
  console.log(`**${s.title}**`);
  console.log(`URL confidence: ${s.url_confidence}%`);
  console.log(`Service: ${s.service_name}`);
  console.log(`Reasoning: ${s.url_reasoning.join(', ')}\n`);
}

// Statistics
const totalCorrections = samples.filter(s => s.correction).length;
const highConfCorrections = samples.filter(s => s.correction && s.url_confidence >= 80).length;
const labeledFalse = samples.filter(s => !s.label).length;
const labeledTrue = samples.filter(s => s.label).length;

console.log('\n## SUMMARY STATISTICS');
console.log(`Total samples: ${samples.length}`);
console.log(`Labeled TRUE: ${labeledTrue} (${((labeledTrue/samples.length)*100).toFixed(1)}%)`);
console.log(`Labeled FALSE: ${labeledFalse} (${((labeledFalse/samples.length)*100).toFixed(1)}%)`);
console.log(`URL corrections suggested: ${totalCorrections} (${((totalCorrections/samples.length)*100).toFixed(1)}%)`);
console.log(`High-confidence corrections (≥80%): ${highConfCorrections}`);
console.log(`\nSmoking gun mislabels: ${smokingGuns.length}`);
console.log(`  - Explicit council_district: ${councilDistrictExplicit.length}`);
console.log(`  - Ward boundaries: ${wardExplicit.length}`);

// Export corrected labels
const correctedLabels = samples.map(s => {
  let correctedLabel = s.label;
  let confidence = 50;
  let source = 'original';

  // Apply high-confidence URL corrections
  if (s.url_confidence >= 90 && s.url_classification !== 'uncertain') {
    correctedLabel = s.url_classification as boolean;
    confidence = s.url_confidence;
    source = 'url_correction';
  }

  return {
    url: s.url,
    title: s.title,
    original_label: s.label,
    corrected_label: correctedLabel,
    confidence,
    source,
    changed: correctedLabel !== s.label,
  };
});

const correctedPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/corrected_labels.jsonl';
writeFileSync(
  correctedPath,
  correctedLabels.map(l => JSON.stringify(l)).join('\n'),
  'utf-8'
);

console.log(`\n✓ Corrected labels saved to: ${correctedPath}`);
console.log(`Changed labels: ${correctedLabels.filter(l => l.changed).length}`);

// Specific examples for documentation
console.log('\n## DOCUMENTATION EXAMPLES (Include in report)');
console.log('\n### Example 1: Clear Mislabel');
const example1 = smokingGuns.find(s => s.service_name === 'CouncilDistricts');
if (example1) {
  console.log('**Title**: ' + example1.title);
  console.log('**URL**: ' + example1.url);
  console.log('**Service Name**: CouncilDistricts');
  console.log('**Original Label**: FALSE');
  console.log('**Corrected Label**: TRUE');
  console.log('**Confidence**: 100%');
  console.log('**Evidence**: Service literally named "CouncilDistricts"\n');
}

console.log('### Example 2: Thematic Overlay (Correct FALSE)');
const example2 = samples.find(s =>
  !s.label &&
  s.url_classification === false &&
  /crime/i.test(s.title)
);
if (example2) {
  console.log('**Title**: ' + example2.title);
  console.log('**Service Name**: ' + example2.service_name);
  console.log('**Label**: FALSE (CORRECT)');
  console.log('**Reasoning**: Crime data overlaid on council districts, not the districts themselves\n');
}
