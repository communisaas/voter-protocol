#!/usr/bin/env tsx
/**
 * Discover Results Validation Command
 *
 * Audits discovery outputs by combining EdgeCaseAnalyzer classification
 * with city attribution to separate true council districts from false positives.
 *
 * WORKFLOW:
 *   1. Load validated layers from JSONL
 *   2. Run EdgeCaseAnalyzer on all layers
 *   3. Classify into categories (TRUE_POSITIVE, FALSE_POSITIVE_*, AMBIGUOUS_*, etc.)
 *   4. (Optional) Run city attribution on ambiguous layers
 *   5. Generate classification report with recommendations
 *
 * CLASSIFICATION CATEGORIES:
 *   TRUE_POSITIVE           - High confidence council districts
 *   FALSE_POSITIVE_SERVICE  - Fire, police, utility districts
 *   FALSE_POSITIVE_PROPERTY - Parcels, subdivisions
 *   FALSE_POSITIVE_INFRA    - Hydrology, roads, facilities
 *   FALSE_POSITIVE_CENSUS   - VTDs, tracts, blocks
 *   FALSE_POSITIVE_SCHOOL   - School districts
 *   AMBIGUOUS_BOS           - Board of Supervisors (context-dependent)
 *   AMBIGUOUS_WARD          - Wards without clear city context
 *   HISTORICAL_VERSION      - Outdated data vintage
 *   AGGREGATED_DATA         - Statistics by district, not boundaries
 *   DUPLICATE               - Same data from different URL
 *   UNKNOWN                 - Needs manual review
 *
 * ACTIONS:
 *   ACCEPT               - Ready for Merkle commitment
 *   REJECT               - False positives filtered out
 *   NEEDS_CITY_CONTEXT   - Requires city attribution
 *   NEEDS_MANUAL_REVIEW  - Low confidence, manual inspection required
 *
 * Usage:
 *   shadow-atlas validate discover-results
 *   shadow-atlas validate discover-results --input validated_layers.jsonl
 *   shadow-atlas validate discover-results --threshold 80 --attribute-cities
 *   shadow-atlas validate discover-results --report results.json --show-samples
 *   shadow-atlas validate discover-results --format json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  EdgeCaseAnalyzer,
  type EdgeCaseAnalysis,
  type EdgeCaseType,
} from '../../../validators/council/edge-cases.js';
import {
  attributeCity,
  batchAttributeCities,
  ATTRIBUTION_STATS,
  type CityAttribution,
} from '../../../validators/utils/city-attribution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Types
// =============================================================================

interface ValidatedLayer {
  service_url: string;
  layer_number: number;
  layer_url: string;
  layer_name: string;
  geometry_type: string;
  feature_count: number;
  fields: string[];
  validation_score: number;
  is_council_district: boolean;
  confidence: number;
  validation_reasons: string[];
}

interface AnalysisResult extends EdgeCaseAnalysis {
  originalLayer: ValidatedLayer;
}

interface AttributedLayer {
  url: string;
  name: string;
  city: CityAttribution;
  features: number;
  confidence: number;
}

interface CommandOptions {
  input: string;
  threshold: number;
  attributeCities: boolean;
  report?: string;
  showSamples: boolean;
  format: 'summary' | 'detailed' | 'json';
  verbose: boolean;
}

interface ValidationReport {
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    needsReview: number;
    needsCityContext: number;
    byClassification: Record<EdgeCaseType, number>;
    byAction: Record<string, number>;
  };
  accepted: Array<{
    url: string;
    name: string;
    cityFips?: string;
    cityName?: string;
    features: number;
    confidence: number;
    classification: EdgeCaseType;
  }>;
  rejected: Array<{
    url: string;
    name: string;
    classification: EdgeCaseType;
    reason: string;
    confidence: number;
  }>;
  needsReview: Array<{
    url: string;
    name: string;
    classification: EdgeCaseType;
    action: string;
    features: number;
    confidence: number;
    warnings: string[];
  }>;
  attribution?: {
    summary: {
      attributed: number;
      unattributed: number;
      byMethod: Record<string, number>;
    };
    layers: AttributedLayer[];
  };
}

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): CommandOptions {
  const args = process.argv.slice(2);
  const options: CommandOptions = {
    input: 'validated_layers.jsonl',
    threshold: 80,
    attributeCities: false,
    showSamples: false,
    format: 'summary',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--input':
        options.input = args[++i];
        break;
      case '--threshold':
        options.threshold = parseInt(args[++i], 10);
        break;
      case '--attribute-cities':
        options.attributeCities = true;
        break;
      case '--report':
        options.report = args[++i];
        break;
      case '--show-samples':
        options.showSamples = true;
        break;
      case '--format':
        options.format = args[++i] as 'summary' | 'detailed' | 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          console.error('Use --help for usage information');
          process.exit(1);
        }
    }
  }

  return options;
}

// =============================================================================
// Help Text
// =============================================================================

function printHelp(): void {
  console.log(`
Discover Results Validation Command

Audits discovery outputs by classifying layers and optionally attributing cities.

Usage:
  shadow-atlas validate discover-results [options]

Options:
  --input <jsonl>         Input validated layers file (default: validated_layers.jsonl)
  --threshold <num>       Confidence threshold for ACCEPT (default: 80)
  --attribute-cities      Run city attribution on ambiguous layers
  --report <path>         Write detailed report to JSON file
  --show-samples          Include sample layers in each category
  --format <fmt>          Output format: summary|detailed|json (default: summary)
  --verbose, -v           Verbose output with detailed reasoning
  --help, -h              Show this help

Output Formats:
  summary    - High-level statistics and recommendations
  detailed   - Include classification breakdowns and samples
  json       - Machine-readable JSON output

Classification Categories:
  TRUE_POSITIVE           High confidence council districts
  FALSE_POSITIVE_SERVICE  Fire, police, utility districts
  FALSE_POSITIVE_PROPERTY Parcels, subdivisions
  FALSE_POSITIVE_INFRA    Hydrology, roads, facilities
  FALSE_POSITIVE_CENSUS   VTDs, tracts, blocks
  FALSE_POSITIVE_SCHOOL   School districts
  AMBIGUOUS_BOS           Board of Supervisors (context-dependent)
  AMBIGUOUS_WARD          Wards without clear city context
  HISTORICAL_VERSION      Outdated data vintage
  AGGREGATED_DATA         Statistics by district, not boundaries
  DUPLICATE               Same data from different URL
  UNKNOWN                 Needs manual review

Examples:
  shadow-atlas validate discover-results
  shadow-atlas validate discover-results --threshold 70 --attribute-cities
  shadow-atlas validate discover-results --report audit.json --format detailed
  shadow-atlas validate discover-results --show-samples --verbose
`);
}

// =============================================================================
// Data Loading
// =============================================================================

async function loadValidatedLayers(inputPath: string): Promise<ValidatedLayer[]> {
  // Resolve path relative to agents/data if not absolute
  const resolvedPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(__dirname, '../../../agents/data', inputPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Input file not found: ${resolvedPath}`);
  }

  const fileStream = fs.createReadStream(resolvedPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const layers: ValidatedLayer[] = [];

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const layer = JSON.parse(line) as ValidatedLayer;
        if (layer.is_council_district) {
          layers.push(layer);
        }
      } catch (error) {
        // Skip malformed lines
        console.warn(`Skipping malformed line: ${line.substring(0, 50)}...`);
      }
    }
  }

  return layers;
}

// =============================================================================
// Analysis
// =============================================================================

function analyzeDiscoveryResults(
  layers: ValidatedLayer[],
  threshold: number
): AnalysisResult[] {
  const analyzer = new EdgeCaseAnalyzer();
  const results: AnalysisResult[] = [];

  for (const layer of layers) {
    const analysis = analyzer.analyze(
      layer.layer_url,
      layer.layer_name,
      layer.feature_count,
      layer.fields,
      layer.confidence
    );
    results.push({ ...analysis, originalLayer: layer });
  }

  return results;
}

// =============================================================================
// City Attribution
// =============================================================================

function performCityAttribution(results: AnalysisResult[]): {
  attributed: AttributedLayer[];
  unattributed: Array<{ url: string; name: string }>;
} {
  // Extract layers that need city context
  const needsContext = results.filter(
    r => r.action === 'NEEDS_CITY_CONTEXT' || r.action === 'NEEDS_MANUAL_REVIEW'
  );

  const layers = needsContext.map(r => ({
    url: r.url,
    name: r.name,
    features: r.originalLayer.feature_count,
    confidence: r.confidence,
    warnings: r.warnings,
  }));

  const { attributed, unattributed } = batchAttributeCities(layers);

  return {
    attributed: attributed.map(a => ({
      url: a.url,
      name: a.name,
      city: a.city,
      features: layers.find(l => l.url === a.url)?.features ?? 0,
      confidence: layers.find(l => l.url === a.url)?.confidence ?? 0,
    })),
    unattributed,
  };
}

// =============================================================================
// Report Generation
// =============================================================================

function buildValidationReport(
  results: AnalysisResult[],
  options: CommandOptions,
  attributionResult?: ReturnType<typeof performCityAttribution>
): ValidationReport {
  const byClassification: Record<EdgeCaseType, number> = {
    TRUE_POSITIVE: 0,
    FALSE_POSITIVE_SERVICE: 0,
    FALSE_POSITIVE_PROPERTY: 0,
    FALSE_POSITIVE_INFRA: 0,
    FALSE_POSITIVE_CENSUS: 0,
    FALSE_POSITIVE_SCHOOL: 0,
    AMBIGUOUS_BOS: 0,
    AMBIGUOUS_WARD: 0,
    HISTORICAL_VERSION: 0,
    AGGREGATED_DATA: 0,
    DUPLICATE: 0,
    UNKNOWN: 0,
  };

  const byAction: Record<string, number> = {
    ACCEPT: 0,
    REJECT: 0,
    NEEDS_CITY_CONTEXT: 0,
    NEEDS_MANUAL_REVIEW: 0,
  };

  for (const result of results) {
    byClassification[result.classification]++;
    byAction[result.action]++;
  }

  const accepted = results
    .filter(r => r.action === 'ACCEPT')
    .map(r => ({
      url: r.url,
      name: r.name,
      cityFips: r.suggestedCityFips,
      cityName: r.suggestedCityFips ? 'Unknown' : undefined,
      features: r.originalLayer.feature_count,
      confidence: r.confidence,
      classification: r.classification,
    }));

  const rejected = results
    .filter(r => r.action === 'REJECT')
    .map(r => ({
      url: r.url,
      name: r.name,
      classification: r.classification,
      reason: r.reasoning[0] || 'No reason provided',
      confidence: r.confidence,
    }));

  const needsReview = results
    .filter(r => r.action === 'NEEDS_CITY_CONTEXT' || r.action === 'NEEDS_MANUAL_REVIEW')
    .map(r => ({
      url: r.url,
      name: r.name,
      classification: r.classification,
      action: r.action,
      features: r.originalLayer.feature_count,
      confidence: r.confidence,
      warnings: r.warnings,
    }));

  const report: ValidationReport = {
    summary: {
      total: results.length,
      accepted: byAction.ACCEPT,
      rejected: byAction.REJECT,
      needsReview: byAction.NEEDS_MANUAL_REVIEW,
      needsCityContext: byAction.NEEDS_CITY_CONTEXT,
      byClassification,
      byAction,
    },
    accepted,
    rejected,
    needsReview,
  };

  // Add attribution data if performed
  if (attributionResult) {
    const byMethod: Record<string, number> = {};
    for (const layer of attributionResult.attributed) {
      byMethod[layer.city.method] = (byMethod[layer.city.method] || 0) + 1;
    }

    report.attribution = {
      summary: {
        attributed: attributionResult.attributed.length,
        unattributed: attributionResult.unattributed.length,
        byMethod,
      },
      layers: attributionResult.attributed,
    };
  }

  return report;
}

// =============================================================================
// Output Formatters
// =============================================================================

function printSummaryReport(report: ValidationReport, options: CommandOptions): void {
  console.log('='.repeat(80));
  console.log('DISCOVER RESULTS VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const { summary } = report;
  const total = summary.total;

  console.log(`\nInput: ${total} layers flagged as potential council districts`);
  console.log('');

  // Action breakdown
  console.log('ACTION SUMMARY:');
  console.log(`  ACCEPT:              ${summary.accepted.toString().padStart(5)} (${((summary.accepted / total) * 100).toFixed(1)}%)`);
  console.log(`  REJECT:              ${summary.rejected.toString().padStart(5)} (${((summary.rejected / total) * 100).toFixed(1)}%)`);
  console.log(`  NEEDS_CITY_CONTEXT:  ${summary.needsCityContext.toString().padStart(5)} (${((summary.needsCityContext / total) * 100).toFixed(1)}%)`);
  console.log(`  NEEDS_MANUAL_REVIEW: ${summary.needsReview.toString().padStart(5)} (${((summary.needsReview / total) * 100).toFixed(1)}%)`);

  // Classification breakdown
  console.log('\nCLASSIFICATION BREAKDOWN:');
  for (const [classification, count] of Object.entries(summary.byClassification)) {
    if (count > 0) {
      const pct = ((count / total) * 100).toFixed(1);
      console.log(`  ${classification.padEnd(28)} ${count.toString().padStart(6)} (${pct}%)`);
    }
  }

  // False positive breakdown
  const falsePositives = summary.byClassification.FALSE_POSITIVE_SERVICE +
    summary.byClassification.FALSE_POSITIVE_PROPERTY +
    summary.byClassification.FALSE_POSITIVE_INFRA +
    summary.byClassification.FALSE_POSITIVE_CENSUS +
    summary.byClassification.FALSE_POSITIVE_SCHOOL;

  if (falsePositives > 0) {
    console.log('\nFALSE POSITIVE BREAKDOWN:');
    console.log(`  Service Districts:   ${summary.byClassification.FALSE_POSITIVE_SERVICE}`);
    console.log(`  Property/Parcels:    ${summary.byClassification.FALSE_POSITIVE_PROPERTY}`);
    console.log(`  Infrastructure:      ${summary.byClassification.FALSE_POSITIVE_INFRA}`);
    console.log(`  Census/Electoral:    ${summary.byClassification.FALSE_POSITIVE_CENSUS}`);
    console.log(`  School Districts:    ${summary.byClassification.FALSE_POSITIVE_SCHOOL}`);
  }

  // Attribution results if available
  if (report.attribution) {
    const { attribution } = report;
    const attributionRate = ((attribution.summary.attributed / (attribution.summary.attributed + attribution.summary.unattributed)) * 100).toFixed(1);

    console.log('\n' + '='.repeat(80));
    console.log('CITY ATTRIBUTION RESULTS');
    console.log('='.repeat(80));
    console.log(`\nAttribution resources:`);
    console.log(`  Known org IDs: ${ATTRIBUTION_STATS.knownOrgIds}`);
    console.log(`  City patterns: ${ATTRIBUTION_STATS.cityPatterns}`);
    console.log(`\nAttribution success rate: ${attributionRate}%`);
    console.log(`  Attributed:   ${attribution.summary.attributed} layers`);
    console.log(`  Unattributed: ${attribution.summary.unattributed} layers`);

    console.log('\nBy attribution method:');
    for (const [method, count] of Object.entries(attribution.summary.byMethod)) {
      console.log(`  ${method.padEnd(20)} ${count}`);
    }
  }

  // Recommendations
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log(`  1. Review ${summary.accepted} ACCEPTED layers before Merkle commitment`);
  console.log(`  2. Verify ${summary.rejected} REJECTED classifications are correct`);
  if (summary.needsCityContext > 0) {
    console.log(`  3. Run city attribution on ${summary.needsCityContext} layers (--attribute-cities)`);
  }
  if (summary.needsReview > 0) {
    console.log(`  4. Manual review required for ${summary.needsReview} layers`);
  }

  if (options.report) {
    console.log(`\nDetailed report written to: ${options.report}`);
  }
}

function printDetailedReport(report: ValidationReport, options: CommandOptions): void {
  printSummaryReport(report, options);

  if (options.showSamples) {
    // Sample accepted layers
    console.log('\n' + '='.repeat(80));
    console.log('SAMPLE ACCEPTED LAYERS (up to 10)');
    console.log('='.repeat(80));
    for (const layer of report.accepted.slice(0, 10)) {
      console.log(`\n  [${layer.confidence}%] ${layer.name}`);
      console.log(`    URL: ${layer.url}`);
      if (layer.cityFips) {
        console.log(`    City FIPS: ${layer.cityFips}`);
      }
      console.log(`    Features: ${layer.features}`);
      console.log(`    Classification: ${layer.classification}`);
    }

    // Sample rejected layers by type
    console.log('\n' + '='.repeat(80));
    console.log('SAMPLE REJECTED LAYERS (up to 10)');
    console.log('='.repeat(80));
    const rejectedByType: Record<string, typeof report.rejected> = {};
    for (const layer of report.rejected) {
      if (!rejectedByType[layer.classification]) {
        rejectedByType[layer.classification] = [];
      }
      if (rejectedByType[layer.classification].length < 2) {
        rejectedByType[layer.classification].push(layer);
      }
    }

    for (const [type, layers] of Object.entries(rejectedByType)) {
      console.log(`\n  ${type}:`);
      for (const layer of layers) {
        console.log(`    - ${layer.name}`);
        console.log(`      Reason: ${layer.reason}`);
      }
    }

    // Sample needs review
    console.log('\n' + '='.repeat(80));
    console.log('SAMPLE LAYERS NEEDING REVIEW (up to 10)');
    console.log('='.repeat(80));
    for (const layer of report.needsReview.slice(0, 10)) {
      console.log(`\n  [${layer.confidence}%] ${layer.name}`);
      console.log(`    URL: ${layer.url}`);
      console.log(`    Action: ${layer.action}`);
      console.log(`    Classification: ${layer.classification}`);
      if (layer.warnings.length > 0) {
        console.log(`    Warnings: ${layer.warnings.slice(0, 2).join(', ')}`);
      }
    }

    // Sample attributed layers if available
    if (report.attribution && report.attribution.layers.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('SAMPLE ATTRIBUTED LAYERS (up to 15)');
      console.log('='.repeat(80));
      for (const layer of report.attribution.layers.slice(0, 15)) {
        console.log(`\n  ${layer.name}`);
        console.log(`    → ${layer.city.name}, ${layer.city.state} (FIPS: ${layer.city.fips})`);
        console.log(`    Method: ${layer.city.method}, Confidence: ${layer.city.confidence}%`);
      }
    }
  }
}

function printJsonReport(report: ValidationReport): void {
  console.log(JSON.stringify(report, null, 2));
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  try {
    const options = parseArgs();

    if (options.verbose) {
      console.log('Loading validated layers...');
      console.log(`  Input: ${options.input}`);
      console.log(`  Threshold: ${options.threshold}`);
      console.log(`  Attribute cities: ${options.attributeCities}`);
      console.log('');
    }

    // Load data
    const layers = await loadValidatedLayers(options.input);

    if (layers.length === 0) {
      console.error('No council district layers found in input file');
      process.exit(1);
    }

    if (options.verbose) {
      console.log(`Loaded ${layers.length} council district candidates`);
      console.log('Running edge case analysis...\n');
    }

    // Run analysis
    const results = analyzeDiscoveryResults(layers, options.threshold);

    // Optionally run city attribution
    let attributionResult: ReturnType<typeof performCityAttribution> | undefined;
    if (options.attributeCities) {
      if (options.verbose) {
        console.log('Running city attribution...\n');
      }
      attributionResult = performCityAttribution(results);
    }

    // Build report
    const report = buildValidationReport(results, options, attributionResult);

    // Write detailed JSON report if requested
    if (options.report) {
      fs.writeFileSync(options.report, JSON.stringify(report, null, 2));
    }

    // Output formatted report
    switch (options.format) {
      case 'json':
        printJsonReport(report);
        break;
      case 'detailed':
        printDetailedReport(report, options);
        break;
      case 'summary':
      default:
        printSummaryReport(report, options);
        break;
    }

    // Exit with appropriate code
    const hasIssues = report.summary.needsReview > 0 || report.summary.needsCityContext > 0;
    process.exit(hasIssues ? 1 : 0);

  } catch (error) {
    console.error('Error running discover results validation:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for programmatic use
export {
  analyzeDiscoveryResults,
  performCityAttribution,
  buildValidationReport,
  type CommandOptions,
  type ValidationReport,
  type AnalysisResult,
  type AttributedLayer,
};
