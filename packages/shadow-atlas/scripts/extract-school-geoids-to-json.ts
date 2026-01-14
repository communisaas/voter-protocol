#!/usr/bin/env tsx
/**
 * Extract school district GEOIDs from TypeScript to JSON
 * Part of WS-A3 codebase surgery
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  CANONICAL_UNSD_GEOIDS,
  CANONICAL_ELSD_GEOIDS,
  CANONICAL_SCSD_GEOIDS
} from '../src/validators/school-district-geoids.js';

interface SchoolDistrictData {
  meta: {
    source: string;
    generated: string;
    description: string;
  };
  unsd: Record<string, readonly string[]>;
  elsd: Record<string, readonly string[]>;
  scsd: Record<string, readonly string[]>;
}

const data: SchoolDistrictData = {
  meta: {
    source: 'Census TIGER/Line 2024',
    generated: new Date().toISOString().split('T')[0],
    description: 'Real administrative LEA IDs - NOT sequential numbers'
  },
  unsd: CANONICAL_UNSD_GEOIDS,
  elsd: CANONICAL_ELSD_GEOIDS,
  scsd: CANONICAL_SCSD_GEOIDS
};

const outputPath = join(
  process.cwd(),
  'src/data/canonical/school-district-geoids.json'
);

writeFileSync(outputPath, JSON.stringify(data, null, 2));

console.log(`✅ Extracted school district GEOIDs to ${outputPath}`);
console.log(`   UNSD states: ${Object.keys(data.unsd).length}`);
console.log(`   ELSD states with data: ${Object.values(data.elsd).filter(arr => arr.length > 0).length}`);
console.log(`   SCSD states with data: ${Object.values(data.scsd).filter(arr => arr.length > 0).length}`);
