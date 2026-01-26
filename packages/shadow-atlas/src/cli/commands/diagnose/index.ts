/**
 * Diagnose Commands Index
 *
 * Registers all diagnostic subcommands for the shadow-atlas CLI.
 *
 * @module cli/commands/diagnose
 */

export { runContainment } from './containment.js';
export { runCoverage } from './coverage.js';
export { runOverlap } from './overlap.js';
export { runHealth } from './health.js';

/**
 * Diagnose command metadata for help display
 */
export const diagnoseCommands = {
  containment: {
    name: 'containment',
    description: 'Analyze containment failures for a city',
    usage: 'shadow-atlas diagnose containment <fips> [options]',
    options: [
      '--url <url>         Override download URL',
      '--boundary-source   Boundary source: tiger or authoritative',
      '--output <file>     Write detailed report to file',
    ],
  },
  coverage: {
    name: 'coverage',
    description: 'Analyze coverage metrics for a city',
    usage: 'shadow-atlas diagnose coverage <fips> [options]',
    options: [
      '--include-water     Include water area analysis',
      '--vintage-compare   Compare across TIGER vintages',
    ],
  },
  overlap: {
    name: 'overlap',
    description: 'Detect overlapping districts',
    usage: 'shadow-atlas diagnose overlap <fips>',
    options: [
      '--verbose, -v       Show detailed overlap information',
    ],
  },
  health: {
    name: 'health',
    description: 'Run system health checks',
    usage: 'shadow-atlas diagnose health [options]',
    options: [
      '--component <name>  Check specific component',
      '--quick             Fast checks only (skip network)',
    ],
  },
};
