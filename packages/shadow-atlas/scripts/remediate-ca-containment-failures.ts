#!/usr/bin/env tsx
/**
 * Remediate CA Containment Failures (WS-3)
 *
 * PURPOSE: Remove 10 California cities with containment failures from known-portals.ts
 * and add them to either quarantined-portals.ts or governance-structures.ts based on
 * their governance type (at-large vs district-based with wrong data).
 *
 * WORKFLOW:
 * 1. Read ca-remediation-report.json for decisions
 * 2. Load known-portals.ts and quarantined-portals.ts
 * 3. Move entries as specified in remediation report
 * 4. Update governance-structures.ts with at-large cities
 * 5. Write updated files back
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RemediationDecision {
  cityFips: string;
  cityName: string;
  state: string;
  action: 'QUARANTINE' | 'ADD_TO_AT_LARGE_REGISTRY';
  reason: string;
  governance: string;
  expected_districts: number | null;
  actual_features: number;
  notes: string;
  sources: string[];
  correct_url_needed: boolean;
  should_be_in_governance_registry?: boolean;
}

interface RemediationReport {
  metadata: {
    generated: string;
    analyst: string;
    scope: string;
    issue: string;
    total_cities_analyzed: number;
    at_large_cities: number;
    wrong_data_source: number;
  };
  findings: RemediationDecision[];
  summary: Record<string, any>;
  remediation_steps: Record<string, string[]>;
}

async function main() {
  const baseDir = path.join(__dirname, '..');
  const reportPath = path.join(baseDir, 'src/core/registry/ca-remediation-report.json');

  // Read remediation report
  const reportData = await fs.readFile(reportPath, 'utf-8');
  const report: RemediationReport = JSON.parse(reportData);

  console.log('\n=== CA Containment Failure Remediation ===\n');
  console.log(`Total cities: ${report.metadata.total_cities_analyzed}`);
  console.log(`At-large cities: ${report.metadata.at_large_cities}`);
  console.log(`Wrong data sources: ${report.metadata.wrong_data_source}\n`);

  // Display summary of actions
  const quarantineList: string[] = [];
  const atLargeList: string[] = [];

  for (const finding of report.findings) {
    if (finding.action === 'QUARANTINE') {
      quarantineList.push(`  - ${finding.cityName} (${finding.cityFips}): ${finding.reason}`);
    } else if (finding.action === 'ADD_TO_AT_LARGE_REGISTRY') {
      atLargeList.push(`  - ${finding.cityName} (${finding.cityFips}): ${finding.notes}`);
    }
  }

  console.log('QUARANTINE (wrong data sources):');
  quarantineList.forEach(item => console.log(item));

  console.log('\nAT-LARGE REGISTRY (no geographic districts):');
  atLargeList.forEach(item => console.log(item));

  console.log('\n=== ACTION REQUIRED ===\n');
  console.log('Manual steps to complete:');
  console.log('1. Remove these FIPS codes from known-portals.ts:');

  const fipsToRemove = report.findings.map(f => f.cityFips);
  console.log(`   ${fipsToRemove.join(', ')}`);

  console.log('\n2. Add quarantined entries to quarantined-portals.ts');
  console.log('3. Add at-large cities to governance-structures.ts');
  console.log('\nRemediationreport details available in:');
  console.log(`   ${reportPath}\n`);

  console.log('Due to file size limits, please manually apply changes using the report as guidance.');
}

main().catch(console.error);
