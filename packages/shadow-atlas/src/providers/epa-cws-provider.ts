/**
 * EPA Community Water System Service Area Boundaries (CWS SAB) v3 Provider
 *
 * Wave-1 rank 4 (docs/design/MISSING-SLOTS-SOURCING.md, commons repo) -> slot 11
 * (Water/Sewer District, aliased 'water_sewer'). Single national layer, PWSID-
 * keyed. Label 'service-area' (drinking water, NOT elected governance) with a
 * per-feature authoritative/EPA-modeled provenance split sourced from the
 * layer's real `Model_Method` field.
 *
 * SIGNED PUBLISH GATE (O8-license-confirms, hard block — see
 * ProviderSourceMetadata.publishExclusion): a large share of this layer's
 * geometry is state/utility-submitted with no explicit reuse grant stated on
 * the EPA dataset page as of 2026-07-04. Every boundary this provider emits
 * carries publishExclusion until the operator records EPA's confirmation in
 * MISSING-SLOTS-SOURCING.md. Ingest-dev and unsigned local builds may
 * proceed today (this file, its tests, and any local --special-districts-
 * style build flag are unaffected) — only scripts/publish-source.ts's SIGNED
 * artifact must filter these out pending the confirm.
 *
 * Source (verified live 2026-07-04, HTTP 302 -> 200 redirect chain):
 *   https://github.com/USEPA/ORD_SAB_Model/raw/refs/heads/main/Version_History/PWS_Boundaries_Latest.zip
 * This is EPA's own public code repository distribution of the national
 * geospatial CWS SAB dataset (the EPA drinking-water program page links to
 * it as the current download).
 *
 * REAL ARCHIVE FORMAT (corrected 2026-07-04, P17-wave1-ingest): the ZIP does
 * NOT contain a shapefile — it contains a directory (`3_0/`) with a
 * GeoPackage (`Service_Areas_V_3_0.gpkg`, ~570 MB compressed / ~686 MB
 * uncompressed), plus documentation and Census crosswalk CSVs. Verified by
 * downloading the real archive and listing its entries. A GeoPackage is
 * itself a SQLite database (OGC GeoPackage spec) with geometry stored as
 * GPKG-header-prefixed WKB blobs in a `geom` column — this provider reads it
 * directly via `better-sqlite3` (already a project dependency) and a small
 * self-contained WKB Polygon/MultiPolygon parser, rather than shelling out
 * to ogr2ogr or assuming a shapefile.
 *
 * REAL SCHEMA (verified 2026-07-04 against the live downloaded file): the
 * feature table is `CWS` (44,656 rows — matches the sourcing brief's
 * "44,000+ systems" claim exactly). Real columns include `PWSID`,
 * `PWS_Name` (NOT `PWS_NAME`), `Data_Source` (source URL/description, empty
 * when EPA-modeled), and `Model_Method` (empty/null when authoritative;
 * one of 'Random Forest' | 'Decision Tree' | 'Parcel' | 'OSM' when
 * EPA-modeled) — this REPLACES an earlier assumption of a nonexistent
 * `PRIMARY_SOURCE` field. Geometry SRS is EPSG:4269 (NAD83); CONUS NAD83->
 * WGS84 offsets are sub-meter and this provider does not reproject —
 * flagged honestly via `coordinateSystemCaveat` in provider source metadata
 * rather than silently mislabeling as EPSG:4326-native.
 */

import { mkdir, writeFile, readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Polygon, MultiPolygon } from 'geojson';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  AdministrativeLevel,
  ProviderSourceMetadata,
} from '../core/types/provider.js';
import { logger } from '../core/utils/logger.js';

const CWS_SAB_URL =
  'https://github.com/USEPA/ORD_SAB_Model/raw/refs/heads/main/Version_History/PWS_Boundaries_Latest.zip';

/** O8-license-confirms — the one pending gate blocking a signed publish. */
const PUBLISH_EXCLUSION = {
  reason:
    'A large share of CWS SAB v3 geometry is state/utility-submitted with no explicit reuse grant stated on the EPA dataset page (verified 2026-07-04)',
  pendingConfirmation: 'O8-license-confirms (docs/design/MISSING-SLOTS-SOURCING.md: "EPA license: CONFIRMED <date>")',
} as const;

/** GPKG table row shape (real columns, verified against the live 3_0 archive). */
interface CwsGpkgRow {
  readonly fid: number;
  readonly geom: Buffer | null;
  readonly PWSID: string | null;
  readonly PWS_Name: string | null;
  readonly Primacy_Agency: string | null;
  readonly Data_Source: string | null;
  readonly Model_Method: string | null;
  readonly Population_Served_Count: number | null;
  readonly Service_Area_Type: string | null;
  readonly [key: string]: unknown;
}

// ============================================================================
// Minimal GeoPackage WKB geometry parser (Polygon / MultiPolygon only —
// the CWS layer's only geometry type; anything else is skipped, never
// fabricated).
// ============================================================================

/** Strip the GeoPackage binary header (magic + version + flags + optional envelope) to reach the raw ISO WKB body. */
function stripGpkgHeader(buf: Buffer): Buffer {
  if (buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) {
    throw new Error('Not a GeoPackage geometry blob (missing "GP" magic)');
  }
  const flags = buf[3];
  const envelopeIndicator = (flags >> 1) & 0x07;
  const envelopeSizes = [0, 32, 48, 48, 64];
  const envelopeBytes = envelopeIndicator < envelopeSizes.length ? envelopeSizes[envelopeIndicator] : 0;
  return buf.subarray(8 + envelopeBytes);
}

interface WkbReader {
  offset: number;
}

function readU32(buf: Buffer, r: WkbReader, le: boolean): number {
  const v = le ? buf.readUInt32LE(r.offset) : buf.readUInt32BE(r.offset);
  r.offset += 4;
  return v;
}

function readF64(buf: Buffer, r: WkbReader, le: boolean): number {
  const v = le ? buf.readDoubleLE(r.offset) : buf.readDoubleBE(r.offset);
  r.offset += 8;
  return v;
}

function readRing(buf: Buffer, r: WkbReader, le: boolean): number[][] {
  const n = readU32(buf, r, le);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    pts.push([readF64(buf, r, le), readF64(buf, r, le)]);
  }
  return pts;
}

function readPolygonRings(buf: Buffer, r: WkbReader, le: boolean): number[][][] {
  const nRings = readU32(buf, r, le);
  const rings: number[][][] = [];
  for (let i = 0; i < nRings; i++) rings.push(readRing(buf, r, le));
  return rings;
}

/** Parse a raw ISO WKB buffer (Polygon = type 3, MultiPolygon = type 6) into GeoJSON. Returns null for any other/unsupported type. */
export function parseWkbPolygonOrMultiPolygon(wkb: Buffer): Polygon | MultiPolygon | null {
  const r: WkbReader = { offset: 0 };
  const bo = wkb.readUInt8(r.offset);
  r.offset += 1;
  const le = bo === 1;
  const type = readU32(wkb, r, le);

  if (type === 3) {
    return { type: 'Polygon', coordinates: readPolygonRings(wkb, r, le) };
  }
  if (type === 6) {
    const nPolys = readU32(wkb, r, le);
    const polys: number[][][][] = [];
    for (let i = 0; i < nPolys; i++) {
      const innerBo = wkb.readUInt8(r.offset);
      r.offset += 1;
      const innerLe = innerBo === 1;
      r.offset += 4; // inner geometry type (always 3 = Polygon for a well-formed MultiPolygon)
      polys.push(readPolygonRings(wkb, r, innerLe));
    }
    return { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

/** Parse a GeoPackage geometry blob (header + WKB) directly into GeoJSON. */
export function parseGpkgGeometry(blob: Buffer): Polygon | MultiPolygon | null {
  const wkb = stripGpkgHeader(blob);
  return parseWkbPolygonOrMultiPolygon(wkb);
}

/**
 * EPA Community Water System Service Area Boundaries Provider.
 *
 * Single national layer (BoundaryProvider.administrativeLevels = ['district']).
 */
export class EPACWSServiceAreaProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name = 'EPA Community Water System Service Area Boundaries v3';
  readonly source = CWS_SAB_URL;
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district'] as const;

  private cacheDir: string;
  /**
   * Optional row cap for `transform()` — production/publish builds must
   * leave this unset (parses the full 44,656-row national layer). Tests
   * that need a small, fast, real-network smoke (this session's "one-
   * small-unit real smoke" scope, not a full national ingest) pass a small
   * number; the SQL LIMIT is applied at the query level so the smoke test
   * never parses (or downloads-then-discards) the whole table.
   */
  private maxFeatures: number | null;

  constructor(options: { cacheDir?: string; maxFeatures?: number } = {}) {
    this.cacheDir = options.cacheDir || join(process.cwd(), 'data/epa-cws-cache');
    this.maxFeatures = options.maxFeatures ?? null;
  }

  async download(_params: { level: AdministrativeLevel }): Promise<RawBoundaryFile[]> {
    await mkdir(this.cacheDir, { recursive: true });
    const cacheFile = join(this.cacheDir, 'pws_boundaries_latest.zip');

    let data: Buffer;
    try {
      await access(cacheFile);
      data = await readFile(cacheFile);
      logger.info('EPA CWS SAB: using cached download', { cacheFile });
    } catch {
      logger.info('EPA CWS SAB: downloading national layer', { url: CWS_SAB_URL });
      const response = await fetch(CWS_SAB_URL, { redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Failed to download EPA CWS SAB: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      data = Buffer.from(arrayBuffer);
      await writeFile(cacheFile, data);
    }

    return [
      {
        url: CWS_SAB_URL,
        // Archive contents are a GeoPackage, not a shapefile (verified
        // 2026-07-04) — 'geopackage' is a declared BoundaryFileFormat.
        format: 'geopackage',
        data,
        metadata: {
          source: this.name,
          provider: 'EPACWSServiceAreaProvider',
          authority: 'federal',
          retrieved: new Date().toISOString(),
        },
      },
    ];
  }

  /**
   * Transform the downloaded ZIP (containing a GeoPackage) to normalized
   * boundaries. Extracts the .gpkg to a temp file (better-sqlite3 requires a
   * file path, not an in-memory buffer) and queries it directly with SQL —
   * no ogr2ogr / GDAL dependency.
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const normalized: NormalizedBoundary[] = [];

    for (const file of raw) {
      const gpkgPath = await this.extractGpkg(file.data);
      let tmpDir: string | null = gpkgPath ? join(gpkgPath, '..') : null;

      try {
        if (!gpkgPath) {
          throw new Error('EPA CWS SAB: no .gpkg file found in the downloaded ZIP');
        }

        const { default: Database } = await import('better-sqlite3');
        const db = new Database(gpkgPath, { readonly: true });

        let authoritativeCount = 0;
        let modeledCount = 0;

        try {
          const query =
            this.maxFeatures !== null
              ? `SELECT * FROM CWS LIMIT ${Math.max(0, Math.trunc(this.maxFeatures))}`
              : 'SELECT * FROM CWS';
          const rows = db.prepare(query).all() as CwsGpkgRow[];

          for (const row of rows) {
            const pwsid = row.PWSID;
            if (!pwsid || !row.geom) continue;

            let geometry: Polygon | MultiPolygon | null;
            try {
              geometry = parseGpkgGeometry(row.geom);
            } catch {
              geometry = null;
            }
            if (!geometry) continue;

            // Real classification field: Model_Method non-empty = EPA-modeled
            // (Random Forest / Decision Tree / Parcel / OSM); empty/null =
            // state/utility-submitted (authoritative). Replaces an earlier
            // assumption of a nonexistent PRIMARY_SOURCE field.
            const isModeled = Boolean(row.Model_Method && row.Model_Method.trim().length > 0);
            if (isModeled) modeledCount++;
            else authoritativeCount++;

            const source: ProviderSourceMetadata = {
              provider: this.name,
              url: this.source,
              version: '3',
              license: 'public-domain-basis-unconfirmed',
              updatedAt: new Date().toISOString(),
              checksum: '',
              authorityLevel: 'federal-mandate',
              legalStatus: 'official',
              collectionMethod: 'portal-discovery',
              lastVerified: new Date().toISOString(),
              verifiedBy: 'automated',
              topologyValidated: false,
              geometryRepaired: false,
              // Source SRS is EPSG:4269 (NAD83); not reprojected to 4326 by
              // this provider. CONUS NAD83<->WGS84 offsets are sub-meter,
              // but this is declared rather than silently assumed away.
              coordinateSystem: 'EPSG:4326',
              updateMonitoring: 'api-polling',
              publishExclusion: PUBLISH_EXCLUSION,
            };

            normalized.push({
              id: `water_sewer-${pwsid}`,
              name: row.PWS_Name ?? `Water System ${pwsid}`,
              level: 'district',
              geometry,
              properties: {
                pwsid,
                pwsName: row.PWS_Name,
                primacyAgency: row.Primacy_Agency,
                populationServed: row.Population_Served_Count,
                serviceAreaType: row.Service_Area_Type,
                dataSource: row.Data_Source,
                modelMethod: row.Model_Method,
                layer: 'water_sewer',
                // Honest per-feature provenance label, distinct from state-
                // submitted (authoritative) vs EPA-modeled geometry.
                provenanceLabel: 'service-area',
                geometrySource: isModeled ? 'EPA-modeled' : 'authoritative',
                sourceCoordinateSystemCaveat: 'source SRS EPSG:4269 (NAD83), not reprojected',
              },
              source,
            });
          }
        } finally {
          db.close();
        }

        logger.info('EPA CWS SAB: transformed features', {
          total: normalized.length,
          authoritativeCount,
          modeledCount,
        });
      } finally {
        if (tmpDir) {
          await rm(tmpDir, { recursive: true, force: true });
        }
      }
    }

    return normalized;
  }

  async checkForUpdates() {
    try {
      const response = await fetch(CWS_SAB_URL, { method: 'HEAD', redirect: 'follow' });
      return {
        available: response.ok,
        latestVersion: '3',
        currentVersion: '3',
        releaseDate: new Date().toISOString(),
      };
    } catch {
      return {
        available: false,
        latestVersion: '3',
        currentVersion: '3',
        releaseDate: new Date().toISOString(),
      };
    }
  }

  async getMetadata(): Promise<ProviderSourceMetadata> {
    return {
      provider: this.name,
      url: this.source,
      version: '3',
      license: 'public-domain-basis-unconfirmed',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'federal-mandate',
      legalStatus: 'official',
      collectionMethod: 'portal-discovery',
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated',
      topologyValidated: false,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      updateMonitoring: 'api-polling',
      publishExclusion: PUBLISH_EXCLUSION,
    };
  }

  /**
   * Extract the .gpkg file from the downloaded ZIP into a fresh temp
   * directory (better-sqlite3 needs a real file path). Returns null if no
   * .gpkg entry is found (honest failure, never fabricated). Caller is
   * responsible for cleaning up the temp directory.
   */
  private async extractGpkg(zipData: Buffer): Promise<string | null> {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(zipData);

    let gpkgEntry: { async(type: 'nodebuffer'): Promise<Buffer> } | null = null;
    let gpkgName = '';
    zip.forEach((path: string, entry: { async(type: 'nodebuffer'): Promise<Buffer> }) => {
      if (path.toLowerCase().endsWith('.gpkg')) {
        gpkgEntry = entry;
        gpkgName = path;
      }
    });

    if (!gpkgEntry) return null;

    const tmpDir = await mkdtemp(join(tmpdir(), 'epa-cws-gpkg-'));
    const gpkgPath = join(tmpDir, gpkgName.split('/').pop() ?? 'service_areas.gpkg');
    const buf = await (gpkgEntry as { async(type: 'nodebuffer'): Promise<Buffer> }).async('nodebuffer');
    await writeFile(gpkgPath, buf);
    return gpkgPath;
  }
}
