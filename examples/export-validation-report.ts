/**
 * Example: Export Multi-State Validation Report
 *
 * Demonstrates how to use DataValidator.exportMultiStateReport() and saveReport()
 * for generating QA audit trails.
 *
 * Usage:
 * ```bash
 * tsx services/shadow-atlas/examples/export-validation-report.ts
 * ```
 */

import { DataValidator } from '../services/data-validator.js';
import type { MultiStateValidationResult } from '../services/data-validator.types.js';

async function main(): Promise<void> {
  console.log('=== Multi-State Validation Report Export Example ===\n');

  // Create validator instance
  const validator = new DataValidator();

  // Example multi-state validation result
  // In production, this would come from validator.validateMultiState()
  const validationResult: MultiStateValidationResult = {
    states: [
      {
        state: 'WI',
        stateName: 'Wisconsin',
        layer: 'congressional',
        expected: 8,
        actual: 8,
        match: true,
        geoidValid: true,
        geometryValid: true,
        duration: 1500,
        details: {
          geoids: ['5501', '5502', '5503', '5504', '5505', '5506', '5507', '5508'],
          invalidGeoids: [],
        },
      },
      {
        state: 'WI',
        stateName: 'Wisconsin',
        layer: 'state_senate',
        expected: 33,
        actual: 33,
        match: true,
        geoidValid: true,
        geometryValid: true,
        duration: 2000,
        details: {
          geoids: Array.from({ length: 33 }, (_, i) => `55${(i + 1).toString().padStart(3, '0')}`),
          invalidGeoids: [],
        },
      },
      {
        state: 'TX',
        stateName: 'Texas',
        layer: 'congressional',
        expected: 38,
        actual: 36,
        match: false,
        geoidValid: true,
        geometryValid: false,
        duration: 2500,
        details: {
          geoids: Array.from({ length: 36 }, (_, i) => `48${(i + 1).toString().padStart(2, '0')}`),
          invalidGeoids: [],
        },
      },
    ],
    summary: {
      totalValidations: 3,
      passed: 2,
      failed: 1,
      successRate: 0.6667,
    },
    validatedAt: new Date(),
    totalDurationMs: 6000,
  };

  // Export to different formats
  console.log('1. Exporting to Markdown...');
  const markdown = await validator.exportMultiStateReport(validationResult, 'markdown');
  console.log('\n--- Markdown Report ---');
  console.log(markdown.substring(0, 500) + '...\n');

  console.log('2. Exporting to JSON...');
  const json = await validator.exportMultiStateReport(validationResult, 'json');
  const parsed = JSON.parse(json);
  console.log('JSON Report Summary:', {
    totalStates: parsed.summary.totalStates,
    passedStates: parsed.summary.passedStates,
    failedStates: parsed.summary.failedStates,
    successRate: `${(parsed.summary.successRate * 100).toFixed(1)}%`,
    recommendations: parsed.recommendations.length,
  }, '\n');

  console.log('3. Exporting to CSV...');
  const csv = await validator.exportMultiStateReport(validationResult, 'csv');
  const csvLines = csv.split('\n');
  console.log('CSV Header:', csvLines[0]);
  console.log(`CSV Rows: ${csvLines.length - 1}\n`);

  // Save reports to files
  console.log('4. Saving reports to files...');
  const timestamp = Date.now();
  const outputDir = '.shadow-atlas/example-reports';

  await validator.saveReport(validationResult, `${outputDir}/validation-report-${timestamp}.md`, 'markdown');
  console.log(`✅ Saved: ${outputDir}/validation-report-${timestamp}.md`);

  await validator.saveReport(validationResult, `${outputDir}/validation-report-${timestamp}.json`, 'json');
  console.log(`✅ Saved: ${outputDir}/validation-report-${timestamp}.json`);

  await validator.saveReport(validationResult, `${outputDir}/validation-report-${timestamp}.csv`, 'csv');
  console.log(`✅ Saved: ${outputDir}/validation-report-${timestamp}.csv`);

  // Auto-inferred format from extension
  await validator.saveReport(validationResult, `${outputDir}/auto-inferred-${timestamp}.md`);
  console.log(`✅ Saved (auto-inferred format): ${outputDir}/auto-inferred-${timestamp}.md`);

  console.log('\n=== Example Complete ===');
  console.log(`\nReports saved to: ${outputDir}/`);
  console.log('Use these reports for QA audit trails, stakeholder review, or programmatic analysis.');
}

// Run example
main().catch((error) => {
  console.error('Error running example:', error);
  process.exit(1);
});
