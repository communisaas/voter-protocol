process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { pointOnFeature } from '@turf/turf';
import type GeoJSON from 'geojson';

import { discoverBoundary } from './orchestrator';
import { SPECIAL_DISTRICT_REGISTRY, type SpecialDistrictSourceEntry } from './special-districts/registry';

interface RegistryTestCase {
  state: string;
  lat: number;
  lng: number;
  expectedSource: string;
  category?: string;
}

function extractFirstFeatureString(buffer: string): string | null {
  const featuresIdx = buffer.indexOf('"features"');
  if (featuresIdx === -1) {
    return null;
  }

  const arrayStart = buffer.indexOf('[', featuresIdx);
  if (arrayStart === -1) {
    return null;
  }

  let pointer = arrayStart + 1;
  while (pointer < buffer.length && /\s|,/.test(buffer[pointer])) {
    pointer++;
  }

  if (pointer >= buffer.length || buffer[pointer] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let prevChar = '';
  const start = pointer;

  for (let i = pointer; i < buffer.length; i++) {
    const char = buffer[i];

    if (inString) {
      if (char === '"' && prevChar !== '\\') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return buffer.slice(start, i + 1);
        }
      }
    }

    prevChar = char;
  }

  return null;
}

function readFirstFeatureFromFile(filePath: string): GeoJSON.Feature | null {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(262144); // 256 KB chunks
  let accumulator = '';

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      accumulator += buffer.toString('utf8', 0, bytesRead);
      const featureString = extractFirstFeatureString(accumulator);
      if (featureString) {
        return JSON.parse(featureString) as GeoJSON.Feature;
      }

      if (accumulator.length > 1_000_000) {
        accumulator = accumulator.slice(-500_000);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return null;
}

function getSamplePointFromFile(filePath: string): { lat: number; lng: number } | null {
  const feature = readFirstFeatureFromFile(filePath);
  if (!feature || !feature.geometry) {
    return null;
  }

  try {
    const point = pointOnFeature(feature);
    const [lng, lat] = point.geometry.coordinates;
    return { lat, lng };
  } catch {
    return null;
  }
}

function selectSources(entry: { sources: readonly SpecialDistrictSourceEntry[] }): SpecialDistrictSourceEntry[] {
  const geoSources = entry.sources.filter(
    source => source.datasetType === 'geojson_local' && !!source.path
  );

  const deduped: SpecialDistrictSourceEntry[] = [];
  const seen = new Set<string>();
  for (const source of geoSources) {
    const key = `${source.path}:${source.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }

  if (deduped.length === 0) {
    return [];
  }

  const selected: SpecialDistrictSourceEntry[] = [deduped[0]];
  const fireSource = deduped.find(source => source.categories?.includes('fire'));
  if (fireSource && fireSource !== deduped[0]) {
    selected.push(fireSource);
  }

  return selected;
}

async function run() {
  const cases: RegistryTestCase[] = [];

  for (const entry of SPECIAL_DISTRICT_REGISTRY.states) {
    const sources = selectSources(entry);
    if (sources.length === 0) {
      continue;
    }

    for (const source of sources) {
      if (!source.path) {
        continue;
      }

      const absolutePath = path.resolve(source.path);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      const sample = getSamplePointFromFile(absolutePath);
      if (!sample) {
        continue;
      }

      cases.push({
        state: entry.state,
        lat: sample.lat,
        lng: sample.lng,
        expectedSource: source.name,
        category: source.categories?.join(', ')
      });
    }
  }

  console.log('='.repeat(80));
  console.log(`Registry Authority Coverage Tests (${cases.length} states)`);
  console.log('='.repeat(80));

  for (const test of cases) {
    const result = await discoverBoundary({
      location: { lat: test.lat, lng: test.lng, state: test.state },
      boundaryType: 'special_district'
    });

    assert.ok(result.success, `Expected discovery success for ${test.state}`);

    const matches =
      result.source === test.expectedSource ||
      (test.state === 'CA' && result.source?.includes('LAFCo')) ||
      (test.state === 'TX' && result.source?.includes('TCEQ')) ||
      (test.state === 'FL' && result.source?.includes('Florida DEO')) ||
      (result.source?.includes(test.state));

    assert.ok(matches, `Unexpected source for ${test.state}: ${result.source} (expected ${test.expectedSource})`);

    console.log(
      `→ ${test.state}: ${result.source} [${test.category ?? 'general'}] → ${result.metadata?.districtName}`
    );
  }

  console.log('\nAll registry authority tests passed!');
}

run().catch((error) => {
  console.error('\n❌ Registry authority tests failed');
  console.error(error);
  process.exit(1);
});
