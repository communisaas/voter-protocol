/**
 * Generate municipalities.json from Census TIGER data
 *
 * This is a convenience wrapper around census-tiger-parser.ts
 * that outputs JSON instead of SQL for use with discovery tests.
 *
 * Usage:
 *   npm run bootstrap:json
 *   npm run bootstrap:json -- --top 1000  # Top 1000 cities only
 */

import { bootstrapMunicipalitiesFromCensus } from './census-tiger-parser';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Options {
  top?: number;
}

async function generateMunicipalitiesJSON(options: Options = {}) {
  console.log('🚀 Generating municipalities.json from Census TIGER data...\n');

  // Fetch municipalities from Census
  const municipalities = await bootstrapMunicipalitiesFromCensus();

  // Limit to top N if specified
  let filteredMunicipalities = municipalities;
  if (options.top && options.top > 0) {
    filteredMunicipalities = municipalities.slice(0, options.top);
    console.log(`\n📋 Limited to top ${options.top} municipalities by population`);
  }

  // Save to data/municipalities.json
  const outputPath = path.join(__dirname, '../../data/municipalities.json');
  const outputDir = path.dirname(outputPath);

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON
  fs.writeFileSync(outputPath, JSON.stringify(filteredMunicipalities, null, 2));

  console.log(`\n✅ SUCCESS: Generated ${filteredMunicipalities.length} municipalities`);
  console.log(`📁 Saved to: ${outputPath}`);
  console.log(`📊 File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB\n`);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options: Options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top' && args[i + 1]) {
    options.top = parseInt(args[i + 1]);
    i++;
  }
}

// Run
generateMunicipalitiesJSON(options).catch(error => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});
