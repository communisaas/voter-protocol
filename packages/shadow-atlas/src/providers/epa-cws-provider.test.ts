/**
 * EPA CWS provider — GeoPackage WKB parser unit tests (P17-wave1-ingest)
 *
 * Regression guard for the real bug this session found: the provider's
 * first version assumed the EPA archive contained a shapefile (.shp/.dbf)
 * and threw "shapefile components not found in ZIP" against the REAL
 * downloaded archive, which contains a GeoPackage (Service_Areas_V_3_0.gpkg)
 * instead. These tests exercise the GPKG-header-stripping + WKB-decoding
 * logic with small synthetic geometry blobs (no network, no 570 MB
 * download) built the same way better-sqlite3 + the GeoPackage spec
 * actually encode them (verified against the real live archive
 * 2026-07-04 — see wave1-ingest.test.ts's network-gated smoke for the
 * real-data round trip).
 */

import { describe, test, expect } from 'vitest';
import { parseGpkgGeometry, parseWkbPolygonOrMultiPolygon } from './epa-cws-provider.js';

/** Build a raw ISO WKB Polygon (single ring) buffer, little-endian. */
function wkbPolygon(ring: readonly (readonly [number, number])[]): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(5);
  header[0] = 1; // little-endian
  header.writeUInt32LE(3, 1); // Polygon
  parts.push(header);
  const nRings = Buffer.alloc(4);
  nRings.writeUInt32LE(1, 0);
  parts.push(nRings);
  const nPts = Buffer.alloc(4);
  nPts.writeUInt32LE(ring.length, 0);
  parts.push(nPts);
  for (const [x, y] of ring) {
    const pt = Buffer.alloc(16);
    pt.writeDoubleLE(x, 0);
    pt.writeDoubleLE(y, 8);
    parts.push(pt);
  }
  return Buffer.concat(parts);
}

/** Build a raw ISO WKB MultiPolygon (one polygon, one ring each) buffer, little-endian. */
function wkbMultiPolygon(polys: readonly (readonly (readonly [number, number])[])[]): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(5);
  header[0] = 1;
  header.writeUInt32LE(6, 1); // MultiPolygon
  parts.push(header);
  const nPolys = Buffer.alloc(4);
  nPolys.writeUInt32LE(polys.length, 0);
  parts.push(nPolys);
  for (const ring of polys) {
    parts.push(wkbPolygon(ring));
  }
  return Buffer.concat(parts);
}

/** Wrap a raw WKB body in a real GeoPackage geometry header (magic + version + flags [+ envelope]). */
function wrapGpkg(wkb: Buffer, envelopeIndicator: 0 | 1 = 0): Buffer {
  const envelopeSizes = [0, 32, 48, 48, 64];
  const envelopeBytes = envelopeSizes[envelopeIndicator];
  const header = Buffer.alloc(8 + envelopeBytes);
  header.write('GP', 0, 'ascii');
  header[2] = 0; // version
  header[3] = 0b00000001 | (envelopeIndicator << 1); // little-endian, envelope indicator bits 1-3
  header.writeInt32LE(4269, 4); // srs_id (NAD83, matches the real CWS layer)
  if (envelopeIndicator === 1) {
    // minx, maxx, miny, maxy — filled with plausible values; parser doesn't
    // validate envelope contents, only its byte length, so any doubles work.
    header.writeDoubleLE(-71, 8);
    header.writeDoubleLE(-70, 16);
    header.writeDoubleLE(41, 24);
    header.writeDoubleLE(42, 32);
  }
  return Buffer.concat([header, wkb]);
}

describe('parseWkbPolygonOrMultiPolygon (raw WKB, no GPKG header)', () => {
  test('parses a single-ring Polygon', () => {
    const ring = [
      [-71, 41],
      [-70, 41],
      [-70, 42],
      [-71, 41],
    ] as const;
    const wkb = wkbPolygon(ring);
    const geom = parseWkbPolygonOrMultiPolygon(wkb);
    expect(geom?.type).toBe('Polygon');
    expect(geom?.coordinates).toEqual([ring.map((p) => [...p])]);
  });

  test('parses a MultiPolygon with multiple parts (real CWS layer shape — verified live 2026-07-04)', () => {
    const polyA = [
      [-71, 41],
      [-70, 41],
      [-70, 42],
      [-71, 41],
    ] as const;
    const polyB = [
      [-72, 43],
      [-71, 43],
      [-71, 44],
      [-72, 43],
    ] as const;
    const wkb = wkbMultiPolygon([polyA, polyB]);
    const geom = parseWkbPolygonOrMultiPolygon(wkb);
    expect(geom?.type).toBe('MultiPolygon');
    expect(geom?.coordinates).toHaveLength(2);
    expect(geom?.coordinates[0]).toEqual([polyA.map((p) => [...p])]);
    expect(geom?.coordinates[1]).toEqual([polyB.map((p) => [...p])]);
  });

  test('returns null for an unsupported geometry type (Point = 1)', () => {
    const buf = Buffer.alloc(5);
    buf[0] = 1;
    buf.writeUInt32LE(1, 1); // Point
    expect(parseWkbPolygonOrMultiPolygon(buf)).toBeNull();
  });
});

describe('parseGpkgGeometry (GeoPackage header + WKB body)', () => {
  test('parses a Polygon blob with no envelope (indicator 0)', () => {
    const wkb = wkbPolygon([
      [-71, 41],
      [-70, 41],
      [-70, 42],
      [-71, 41],
    ]);
    const blob = wrapGpkg(wkb, 0);
    const geom = parseGpkgGeometry(blob);
    expect(geom?.type).toBe('Polygon');
  });

  test('parses a Polygon blob WITH a 32-byte envelope (indicator 1) — the real CWS layer format', () => {
    const wkb = wkbPolygon([
      [-71, 41],
      [-70, 41],
      [-70, 42],
      [-71, 41],
    ]);
    const blob = wrapGpkg(wkb, 1);
    const geom = parseGpkgGeometry(blob);
    expect(geom?.type).toBe('Polygon');
    expect(geom?.coordinates[0]).toHaveLength(4);
  });

  test('throws on a non-GeoPackage blob (missing "GP" magic) rather than silently misparsing', () => {
    const notGpkg = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(() => parseGpkgGeometry(notGpkg)).toThrow(/GeoPackage/);
  });

  test('round-trips real-shaped coordinates (Iowa PWSID example, verified live 2026-07-04)', () => {
    const wkb = wkbMultiPolygon([
      [
        [-94.9532519, 42.7711615],
        [-94.9532499, 42.7708125],
        [-94.9532489, 42.7706636],
        [-94.9532519, 42.7711615],
      ],
    ]);
    const blob = wrapGpkg(wkb, 1);
    const geom = parseGpkgGeometry(blob);
    expect(geom?.type).toBe('MultiPolygon');
    expect(geom?.coordinates[0][0][0]).toEqual([-94.9532519, 42.7711615]);
  });
});
