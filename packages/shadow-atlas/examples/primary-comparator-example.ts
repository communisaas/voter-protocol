/**
 * Primary Source Comparator - Usage Examples
 *
 * Demonstrates how to use the Primary Source Comparator to detect
 * when Census TIGER is stale during redistricting cycles.
 */

import { primaryComparator, PrimarySourceComparator } from '../src/provenance/primary-comparator.js';

/**
 * Example 1: Check single state for freshness
 */
async function checkSingleState(): Promise<void> {
  console.log('=== Example 1: Single State Check ===\n');

  const comparison = await primaryComparator.compareTigerFreshness(
    'congressional',
    'CA'
  );

  console.log(`Jurisdiction: ${comparison.jurisdiction}`);
  console.log(`Boundary Type: ${comparison.boundaryType}`);
  console.log(`TIGER is Fresh: ${comparison.tigerIsFresh}`);
  console.log(`Recommendation: ${comparison.recommendation}`);
  console.log(`Reason: ${comparison.reason}`);

  if (comparison.primarySource) {
    console.log(`\nPrimary Source: ${comparison.primarySource.name}`);
    console.log(`Primary URL: ${comparison.primarySource.url}`);
    console.log(`Machine Readable: ${comparison.primarySource.machineReadable}`);
  }

  if (comparison.lagDays !== undefined) {
    console.log(`\nLag: ${comparison.lagDays} days`);
  }

  if (comparison.tigerLastModified) {
    console.log(`TIGER Last Modified: ${comparison.tigerLastModified.toISOString()}`);
  }

  if (comparison.primaryLastModified) {
    console.log(`Primary Last Modified: ${comparison.primaryLastModified.toISOString()}`);
  }

  if (comparison.warning) {
    console.log(`\n⚠️  Warning: ${comparison.warning}`);
  }
}

/**
 * Example 2: Batch check all states with primary sources
 */
async function checkAllStates(): Promise<void> {
  console.log('\n=== Example 2: Batch Check All States ===\n');

  const results = await primaryComparator.compareAllStates('congressional');

  console.log(`Checked ${results.size} states\n`);

  // Find states where TIGER is stale
  const staleStates = Array.from(results.entries()).filter(
    ([_, comp]) => !comp.tigerIsFresh
  );

  if (staleStates.length > 0) {
    console.log(`⚠️  ${staleStates.length} states have fresher primary sources:\n`);

    for (const [state, comparison] of staleStates) {
      console.log(`${state}:`);
      console.log(`  Lag: ${comparison.lagDays} days`);
      console.log(`  Primary: ${comparison.primarySource?.name}`);
      console.log(`  Recommendation: ${comparison.recommendation}\n`);
    }
  } else {
    console.log('✓ All states: TIGER is current with primary sources');
  }

  // Find states with warnings
  const warnings = Array.from(results.entries()).filter(
    ([_, comp]) => comp.warning
  );

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} states have warnings:\n`);

    for (const [state, comparison] of warnings) {
      console.log(`${state}: ${comparison.warning}`);
    }
  }
}

/**
 * Example 3: Get states with primary sources
 */
function listPrimarySources(): void {
  console.log('\n=== Example 3: List Available Primary Sources ===\n');

  const sources = PrimarySourceComparator.getPrimarySources();

  console.log(`Total states with primary sources: ${sources.size}\n`);

  for (const [state, source] of Array.from(sources.entries())) {
    console.log(`${state}: ${source.name}`);
    console.log(`  URL: ${source.url}`);
    console.log(`  Machine Readable: ${source.machineReadable}`);
    console.log(`  Boundary Types: ${source.boundaryTypes.join(', ')}`);
    if (source.notes) {
      console.log(`  Notes: ${source.notes}`);
    }
    console.log();
  }
}

/**
 * Example 4: Check specific boundary types
 */
async function checkStateSenate(): Promise<void> {
  console.log('\n=== Example 4: Check State Senate Districts ===\n');

  const comparison = await primaryComparator.compareTigerFreshness(
    'state_senate',
    'TX'
  );

  console.log(`Texas State Senate:`);
  console.log(`  TIGER is Fresh: ${comparison.tigerIsFresh}`);
  console.log(`  Recommendation: ${comparison.recommendation}`);
  console.log(`  Reason: ${comparison.reason}`);
}

/**
 * Example 5: Find states with primary sources for specific boundary type
 */
function findStatesWithPrimarySources(): void {
  console.log('\n=== Example 5: States with Congressional Primaries ===\n');

  const states = PrimarySourceComparator.getStatesWithPrimarySources('congressional');

  console.log(`States with congressional primary sources (${states.length}):`);
  console.log(states.join(', '));
}

/**
 * Example 6: Handle errors gracefully
 */
async function handleErrors(): Promise<void> {
  console.log('\n=== Example 6: Error Handling ===\n');

  // Try a state without primary source
  const noSource = await primaryComparator.compareTigerFreshness(
    'congressional',
    'ZZ' // Non-existent state
  );

  console.log('Non-existent state:');
  console.log(`  Recommendation: ${noSource.recommendation}`);
  console.log(`  Reason: ${noSource.reason}\n`);

  // Try a boundary type not covered by primary source
  const notCovered = await primaryComparator.compareTigerFreshness(
    'county', // Not covered by redistricting commissions
    'CA'
  );

  console.log('Boundary type not covered by primary:');
  console.log(`  Recommendation: ${notCovered.recommendation}`);
  console.log(`  Reason: ${notCovered.reason}`);
}

/**
 * Example 7: Quarterly freshness audit
 */
async function quarterlyAudit(): Promise<void> {
  console.log('\n=== Example 7: Quarterly Freshness Audit ===\n');

  const boundaryTypes: Array<'congressional' | 'state_senate' | 'state_house'> = [
    'congressional',
    'state_senate',
    'state_house',
  ];

  for (const boundaryType of boundaryTypes) {
    console.log(`\nChecking ${boundaryType}...`);

    const results = await primaryComparator.compareAllStates(boundaryType);
    const stale = Array.from(results.values()).filter((comp) => !comp.tigerIsFresh);

    console.log(`  Total states: ${results.size}`);
    console.log(`  Stale: ${stale.length}`);
    console.log(`  Fresh: ${results.size - stale.length}`);

    if (stale.length > 0) {
      const maxLag = Math.max(...stale.map((comp) => comp.lagDays || 0));
      console.log(`  Maximum lag: ${maxLag} days`);
    }
  }
}

/**
 * Main function - run all examples
 */
async function main(): Promise<void> {
  try {
    // Example 1: Single state check
    await checkSingleState();

    // Example 2: Batch check (commented out to avoid network spam)
    // await checkAllStates();

    // Example 3: List primary sources
    listPrimarySources();

    // Example 4: Check state senate
    // await checkStateSenate();

    // Example 5: Find states
    findStatesWithPrimarySources();

    // Example 6: Error handling
    await handleErrors();

    // Example 7: Quarterly audit (commented out - slow)
    // await quarterlyAudit();

    console.log('\n✓ Examples completed successfully');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
// Note: Uncomment if running as standalone script
// if (import.meta.url === `file://${process.argv[1]}`) {
//   main();
// }

export {
  checkSingleState,
  checkAllStates,
  listPrimarySources,
  checkStateSenate,
  findStatesWithPrimarySources,
  handleErrors,
  quarterlyAudit,
};
