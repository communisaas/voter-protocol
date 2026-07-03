/**
 * Loader for the committed real-county ADDRFEAT extract.
 *
 * The fixture is produced by scripts/extract-addrfeat-fixture.ts from a REAL
 * downloaded TIGER county file (provenance block records the source URL and
 * its computed sha256) — address-index tests are driven by real source rows,
 * never hand-typed ones.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface FixtureFeature {
  type: 'Feature';
  properties: {
    TLID: number | string | null;
    FULLNAME: string | null;
    LFROMHN: string | null;
    LTOHN: string | null;
    RFROMHN: string | null;
    RTOHN: string | null;
    ZIPL: string | null;
    ZIPR: string | null;
    PARITYL: string | null;
    PARITYR: string | null;
  };
  geometry: { type: string; coordinates: unknown };
  selectedBecause: string;
}

export interface AddrfeatFixture {
  provenance: {
    sourceUrl: string;
    sourceSha256: string;
    countyFips: string;
    vintage: string;
    totalFeaturesInSource: number;
    extractedFeatures: number;
    selectionCounts: Record<string, number>;
  };
  type: 'FeatureCollection';
  features: FixtureFeature[];
}

export function loadFixture(): AddrfeatFixture {
  const path = fileURLToPath(new URL('./fixtures/addrfeat-extract.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as AddrfeatFixture;
}

/** Both DBF sides of a feature in emitSideRange input shape. */
export function sidesOf(f: FixtureFeature): Array<{
  fromHn: string;
  toHn: string;
  zip: string;
  parity: string;
  fullname: string;
}> {
  const p = f.properties;
  const fullname = (p.FULLNAME ?? '').trim();
  return [
    {
      fromHn: (p.LFROMHN ?? '').trim(),
      toHn: (p.LTOHN ?? '').trim(),
      zip: (p.ZIPL ?? '').trim(),
      parity: (p.PARITYL ?? '').trim(),
      fullname,
    },
    {
      fromHn: (p.RFROMHN ?? '').trim(),
      toHn: (p.RTOHN ?? '').trim(),
      zip: (p.ZIPR ?? '').trim(),
      parity: (p.PARITYR ?? '').trim(),
      fullname,
    },
  ].filter((s) => s.fromHn.length > 0 || s.toHn.length > 0);
}
