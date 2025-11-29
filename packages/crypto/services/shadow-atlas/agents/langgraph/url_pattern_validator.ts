#!/usr/bin/env tsx
/**
 * URL Pattern Validator for ArcGIS REST API Dataset Classification
 *
 * Analyzes URL structure to extract strong signals about dataset purpose.
 * Web architecture expertise applied to government GIS portal conventions.
 */

import { readFileSync, writeFileSync } from 'fs';
import { URL } from 'url';

interface TrainingSample {
  url: string;
  title: string;
  fields?: Record<string, string>;
  is_council_district: boolean;
  llm_reasoning?: string;
  llm_confidence?: number;
  field_score?: number;
}

interface URLAnalysis {
  domain: string;
  isDotGov: boolean;
  isOpenData: boolean;
  servicePath: string[];
  serviceName: string;
  layerNumber: number | null;

  // URL-based signals
  hasCouncilInURL: boolean;
  hasWardInURL: boolean;
  hasPoliticalInURL: boolean;
  hasNegativeSignal: boolean;

  // Pattern strength
  urlIsCouncil: boolean | 'uncertain';
  urlConfidence: number;
  urlReasoning: string[];
}

interface ValidationResult {
  sample: TrainingSample;
  urlAnalysis: URLAnalysis;
  agreesWithLabel: boolean;
  agreesWithLLM: boolean;
  urlCorrection?: 'url_says_true' | 'url_says_false';
}

interface PatternLibrary {
  positivePatterns: Map<string, number>;
  negativePatterns: Map<string, number>;
  ambiguousPatterns: Map<string, number>;
}

// Strong positive URL patterns (IS council district)
const POSITIVE_PATTERNS = [
  /council.*district/i,
  /city.*council/i,
  /ward.*bound/i,
  /electoral.*district/i,
  /political.*bound/i,
  /legislative.*district/i,
  /\/council\//i,
  /\/wards\//i,
  /\/districts\//i,
];

// Strong negative URL patterns (NOT council district)
const NEGATIVE_PATTERNS = [
  /fire.*district/i,
  /school.*district/i,
  /census/i,
  /parcel/i,
  /zoning/i,
  /demographic/i,
  /congressional/i,
  /precinct/i,
  /voting.*precinct/i,
  /police.*district/i,
  /neighborhood/i,
];

function parseArcGISURL(urlString: string): URLAnalysis {
  const analysis: URLAnalysis = {
    domain: '',
    isDotGov: false,
    isOpenData: false,
    servicePath: [],
    serviceName: '',
    layerNumber: null,
    hasCouncilInURL: false,
    hasWardInURL: false,
    hasPoliticalInURL: false,
    hasNegativeSignal: false,
    urlIsCouncil: 'uncertain',
    urlConfidence: 0,
    urlReasoning: [],
  };

  try {
    const url = new URL(urlString);
    analysis.domain = url.hostname;
    analysis.isDotGov = url.hostname.endsWith('.gov');
    analysis.isOpenData = url.hostname.includes('opendata') ||
                          url.hostname.includes('gis.') ||
                          url.hostname.includes('maps.');

    // Parse ArcGIS REST path
    const pathParts = url.pathname.split('/').filter(p => p.length > 0);

    // Extract service path and layer number
    const mapServerIndex = pathParts.findIndex(p =>
      p.toLowerCase() === 'mapserver' ||
      p.toLowerCase() === 'featureserver'
    );

    if (mapServerIndex > 0) {
      analysis.servicePath = pathParts.slice(0, mapServerIndex);
      analysis.serviceName = pathParts[mapServerIndex - 1] || '';

      // Layer number comes after MapServer/FeatureServer
      const layerPart = pathParts[mapServerIndex + 1];
      if (layerPart && /^\d+$/.test(layerPart)) {
        analysis.layerNumber = parseInt(layerPart, 10);
      }
    }

    // Check for keyword signals in full path
    const fullPath = url.pathname.toLowerCase();
    analysis.hasCouncilInURL = /council/i.test(fullPath);
    analysis.hasWardInURL = /ward/i.test(fullPath);
    analysis.hasPoliticalInURL = /political/i.test(fullPath);

    // Check for negative signals
    analysis.hasNegativeSignal = NEGATIVE_PATTERNS.some(pattern =>
      pattern.test(fullPath)
    );

    // Analyze URL patterns
    const reasoning: string[] = [];
    let score = 50; // Start neutral

    // Domain trust
    if (analysis.isDotGov) {
      score += 10;
      reasoning.push('.gov domain (+10)');
    }
    if (analysis.isOpenData) {
      score += 5;
      reasoning.push('Official open data portal (+5)');
    }

    // Service name analysis
    const serviceLower = analysis.serviceName.toLowerCase();
    if (/council.*district/i.test(serviceLower)) {
      score += 30;
      reasoning.push(`Service name contains "council district" (+30)`);
    } else if (/council/i.test(serviceLower)) {
      score += 20;
      reasoning.push(`Service name contains "council" (+20)`);
    } else if (/ward/i.test(serviceLower)) {
      score += 20;
      reasoning.push(`Service name contains "ward" (+20)`);
    }

    // Path hierarchy analysis
    if (analysis.servicePath.some(p => /political/i.test(p))) {
      score += 15;
      reasoning.push('Political folder in path (+15)');
    }
    if (analysis.servicePath.some(p => /administrative/i.test(p))) {
      score += 10;
      reasoning.push('Administrative folder in path (+10)');
    }

    // Layer number significance
    if (analysis.layerNumber === 0) {
      score += 5;
      reasoning.push('Layer 0 (primary boundaries) (+5)');
    } else if (analysis.layerNumber !== null && analysis.layerNumber > 10) {
      score -= 10;
      reasoning.push(`Layer ${analysis.layerNumber} (deeply nested) (-10)`);
    }

    // Negative signals
    if (analysis.hasNegativeSignal) {
      score -= 30;
      reasoning.push('Negative keyword detected (fire/school/census) (-30)');
    }

    // Check positive patterns
    const positiveMatch = POSITIVE_PATTERNS.some(pattern =>
      pattern.test(fullPath)
    );
    if (positiveMatch && !analysis.hasNegativeSignal) {
      score += 15;
      reasoning.push('Positive pattern match (+15)');
    }

    // Final classification
    analysis.urlConfidence = Math.max(0, Math.min(100, score));
    analysis.urlReasoning = reasoning;

    if (score >= 70) {
      analysis.urlIsCouncil = true;
    } else if (score <= 30) {
      analysis.urlIsCouncil = false;
    } else {
      analysis.urlIsCouncil = 'uncertain';
    }

  } catch (error) {
    analysis.urlReasoning = [`URL parse error: ${(error as Error).message}`];
  }

  return analysis;
}

function validateDataset(inputPath: string): {
  results: ValidationResult[];
  patternLibrary: PatternLibrary;
  stats: {
    total: number;
    urlAgreeWithLabel: number;
    urlAgreeWithLLM: number;
    urlCorrections: number;
    highConfidenceCorrections: number;
  };
} {
  const lines = readFileSync(inputPath, 'utf-8').split('\n').filter(l => l.trim());
  const samples: TrainingSample[] = lines.map(line => JSON.parse(line));

  const results: ValidationResult[] = [];
  const patternLibrary: PatternLibrary = {
    positivePatterns: new Map(),
    negativePatterns: new Map(),
    ambiguousPatterns: new Map(),
  };

  const stats = {
    total: samples.length,
    urlAgreeWithLabel: 0,
    urlAgreeWithLLM: 0,
    urlCorrections: 0,
    highConfidenceCorrections: 0,
  };

  for (const sample of samples) {
    const urlAnalysis = parseArcGISURL(sample.url);

    const result: ValidationResult = {
      sample,
      urlAnalysis,
      agreesWithLabel: false,
      agreesWithLLM: false,
    };

    // Check agreement with ground truth label
    if (urlAnalysis.urlIsCouncil === sample.is_council_district) {
      result.agreesWithLabel = true;
      stats.urlAgreeWithLabel++;
    } else if (urlAnalysis.urlIsCouncil !== 'uncertain') {
      // URL suggests different classification
      result.urlCorrection = urlAnalysis.urlIsCouncil ? 'url_says_true' : 'url_says_false';
      stats.urlCorrections++;

      if (urlAnalysis.urlConfidence >= 80) {
        stats.highConfidenceCorrections++;
      }
    }

    // Check agreement with LLM (if available)
    if (sample.llm_confidence !== undefined) {
      const llmPrediction = sample.llm_confidence >= 50;
      if (urlAnalysis.urlIsCouncil === llmPrediction) {
        result.agreesWithLLM = true;
        stats.urlAgreeWithLLM++;
      }
    }

    results.push(result);

    // Build pattern library
    const patternKey = `${urlAnalysis.serviceName}`;
    if (sample.is_council_district) {
      patternLibrary.positivePatterns.set(
        patternKey,
        (patternLibrary.positivePatterns.get(patternKey) || 0) + 1
      );
    } else {
      patternLibrary.negativePatterns.set(
        patternKey,
        (patternLibrary.negativePatterns.get(patternKey) || 0) + 1
      );
    }

    if (urlAnalysis.urlIsCouncil === 'uncertain') {
      patternLibrary.ambiguousPatterns.set(
        patternKey,
        (patternLibrary.ambiguousPatterns.get(patternKey) || 0) + 1
      );
    }
  }

  return { results, patternLibrary, stats };
}

function generateReport(
  results: ValidationResult[],
  patternLibrary: PatternLibrary,
  stats: any
): string {
  const lines: string[] = [];

  lines.push('# URL Pattern Validation Report');
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`**Total Samples**: ${stats.total}`);
  lines.push(`**URL-Label Agreement**: ${stats.urlAgreeWithLabel} (${((stats.urlAgreeWithLabel / stats.total) * 100).toFixed(1)}%)`);
  lines.push(`**URL-LLM Agreement**: ${stats.urlAgreeWithLLM} (${((stats.urlAgreeWithLLM / stats.total) * 100).toFixed(1)}%)`);
  lines.push(`**URL Corrections Suggested**: ${stats.urlCorrections}`);
  lines.push(`**High Confidence Corrections**: ${stats.highConfidenceCorrections} (≥80% confidence)`);
  lines.push('');

  // Top positive patterns
  lines.push('## URL Pattern Library');
  lines.push('');
  lines.push('### Top Positive Patterns (TRUE council districts)');
  lines.push('');
  const sortedPositive = Array.from(patternLibrary.positivePatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  lines.push('| Service Name | Count |');
  lines.push('|--------------|-------|');
  for (const [pattern, count] of sortedPositive) {
    lines.push(`| ${pattern || '(empty)'} | ${count} |`);
  }
  lines.push('');

  // Top negative patterns
  lines.push('### Top Negative Patterns (FALSE - not council districts)');
  lines.push('');
  const sortedNegative = Array.from(patternLibrary.negativePatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  lines.push('| Service Name | Count |');
  lines.push('|--------------|-------|');
  for (const [pattern, count] of sortedNegative) {
    lines.push(`| ${pattern || '(empty)'} | ${count} |`);
  }
  lines.push('');

  // High confidence corrections
  lines.push('## High Confidence URL Corrections (≥80%)');
  lines.push('');
  const highConfCorrections = results.filter(r =>
    r.urlCorrection && r.urlAnalysis.urlConfidence >= 80
  );

  if (highConfCorrections.length > 0) {
    lines.push('These URLs strongly suggest a different classification than the label:');
    lines.push('');
    for (const result of highConfCorrections.slice(0, 10)) {
      lines.push(`### ${result.sample.title}`);
      lines.push('');
      lines.push(`- **URL**: ${result.sample.url}`);
      lines.push(`- **Labeled As**: ${result.sample.is_council_district ? 'TRUE' : 'FALSE'}`);
      lines.push(`- **URL Suggests**: ${result.urlCorrection === 'url_says_true' ? 'TRUE' : 'FALSE'}`);
      lines.push(`- **URL Confidence**: ${result.urlAnalysis.urlConfidence}%`);
      lines.push(`- **Reasoning**:`);
      for (const reason of result.urlAnalysis.urlReasoning) {
        lines.push(`  - ${reason}`);
      }
      lines.push('');
    }
  } else {
    lines.push('No high confidence corrections found.');
    lines.push('');
  }

  // URL-Title mismatches
  lines.push('## URL-Title Mismatches (Anomalies)');
  lines.push('');
  const mismatches = results.filter(r => {
    const titleHasCouncil = /council/i.test(r.sample.title);
    const urlHasCouncil = r.urlAnalysis.hasCouncilInURL;
    return titleHasCouncil !== urlHasCouncil;
  });

  if (mismatches.length > 0) {
    lines.push(`Found ${mismatches.length} URL-title mismatches:`);
    lines.push('');
    for (const result of mismatches.slice(0, 10)) {
      lines.push(`- **${result.sample.title}**`);
      lines.push(`  - URL has "council": ${result.urlAnalysis.hasCouncilInURL}`);
      lines.push(`  - Title has "council": ${/council/i.test(result.sample.title)}`);
      lines.push(`  - Service: ${result.urlAnalysis.serviceName}`);
      lines.push('');
    }
  } else {
    lines.push('No significant URL-title mismatches found.');
    lines.push('');
  }

  // Domain distribution
  lines.push('## Domain Distribution');
  lines.push('');
  const domainStats = new Map<string, { total: number; true: number; false: number }>();
  for (const result of results) {
    const domain = result.urlAnalysis.domain;
    if (!domainStats.has(domain)) {
      domainStats.set(domain, { total: 0, true: 0, false: 0 });
    }
    const stats = domainStats.get(domain)!;
    stats.total++;
    if (result.sample.is_council_district) {
      stats.true++;
    } else {
      stats.false++;
    }
  }

  const sortedDomains = Array.from(domainStats.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15);

  lines.push('| Domain | Total | TRUE | FALSE | .gov |');
  lines.push('|--------|-------|------|-------|------|');
  for (const [domain, stats] of sortedDomains) {
    const isDotGov = domain.endsWith('.gov') ? 'Yes' : 'No';
    lines.push(`| ${domain} | ${stats.total} | ${stats.true} | ${stats.false} | ${isDotGov} |`);
  }
  lines.push('');

  // Layer number distribution
  lines.push('## Layer Number Distribution');
  lines.push('');
  const layerStats = new Map<number, { total: number; true: number; false: number }>();
  for (const result of results) {
    const layer = result.urlAnalysis.layerNumber;
    if (layer !== null) {
      if (!layerStats.has(layer)) {
        layerStats.set(layer, { total: 0, true: 0, false: 0 });
      }
      const stats = layerStats.get(layer)!;
      stats.total++;
      if (result.sample.is_council_district) {
        stats.true++;
      } else {
        stats.false++;
      }
    }
  }

  const sortedLayers = Array.from(layerStats.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15);

  lines.push('| Layer | Total | TRUE | FALSE | TRUE % |');
  lines.push('|-------|-------|------|-------|--------|');
  for (const [layer, stats] of sortedLayers) {
    const truePercent = ((stats.true / stats.total) * 100).toFixed(1);
    lines.push(`| ${layer} | ${stats.total} | ${stats.true} | ${stats.false} | ${truePercent}% |`);
  }
  lines.push('');

  return lines.join('\n');
}

// Main execution
const inputPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/data/ml_training_data_enriched.jsonl';
const outputPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_report.md';
const detailsPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl';

console.log('Analyzing URL patterns in training dataset...');
const { results, patternLibrary, stats } = validateDataset(inputPath);

console.log('\nGenerating report...');
const report = generateReport(results, patternLibrary, stats);
writeFileSync(outputPath, report, 'utf-8');

console.log('\nSaving detailed results...');
const detailsLines = results.map(r => JSON.stringify({
  url: r.sample.url,
  title: r.sample.title,
  label: r.sample.is_council_district,
  url_classification: r.urlAnalysis.urlIsCouncil,
  url_confidence: r.urlAnalysis.urlConfidence,
  url_reasoning: r.urlAnalysis.urlReasoning,
  agrees_with_label: r.agreesWithLabel,
  agrees_with_llm: r.agreesWithLLM,
  correction: r.urlCorrection,
  domain: r.urlAnalysis.domain,
  is_dot_gov: r.urlAnalysis.isDotGov,
  service_name: r.urlAnalysis.serviceName,
  layer_number: r.urlAnalysis.layerNumber,
})).join('\n');
writeFileSync(detailsPath, detailsLines, 'utf-8');

console.log(`\n✓ Report saved to: ${outputPath}`);
console.log(`✓ Details saved to: ${detailsPath}`);
console.log('\n' + report);
