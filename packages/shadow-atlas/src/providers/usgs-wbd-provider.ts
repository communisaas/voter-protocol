/**
 * USGS Watershed Boundary Dataset (WBD) Provider
 *
 * Wave-1 addendum rank (docs/design/MISSING-SLOTS-SOURCING.md, commons repo,
 * 2026-07-04 Cicero-parity enumeration directive) -> slot 17 (Conservation
 * slot, aliased 'hydrologic'/'huc'/'watershed'). Single national layer,
 * public domain (US federal work), no O8-style license gate — NOT subject to
 * publishExclusion.
 *
 * Label 'hydrologic' — hydrologic units (HUC-8/10/12), explicitly NOT
 * governance districts. Closes Cicero's WATERSHED type (parity ledger:
 * docs/research/CICERO-DATA-COMPARISON.md, commons repo).
 *
 * Source (verified live 2026-07-04, national MapServer, layers enumerated by
 * a live `?f=json` call):
 *   https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer
 *   layer 4 = 8-digit HU (Subbasin)   -> HUC-8
 *   layer 5 = 10-digit HU (Watershed) -> HUC-10
 *   layer 6 = 12-digit HU (Subwatershed) -> HUC-12
 * A live smoke query against layer 4 for Rhode Island (`states LIKE '%RI%'`)
 * returned a real feature (HUC8 "02030203", "Long Island Sound") with
 * geometry, confirming the endpoint and query shape work end-to-end.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  AdministrativeLevel,
  ProviderSourceMetadata,
} from '../core/types/provider.js';
import { logger } from '../core/utils/logger.js';

const WBD_MAPSERVER = 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer';

/** HUC digit-level -> (MapServer layer id, GeoJSON id field, alias prefix). */
export const WBD_HUC_LAYERS = {
  huc8: { layerId: 4, field: 'huc8', prefix: 'huc' },
  huc10: { layerId: 5, field: 'huc10', prefix: 'huc' },
  huc12: { layerId: 6, field: 'huc12', prefix: 'huc' },
} as const;

export type WBDHucLevel = keyof typeof WBD_HUC_LAYERS;

interface ArcGISRing {
  readonly rings?: readonly (readonly [number, number])[][];
}

interface ArcGISQueryFeature {
  readonly attributes: Record<string, unknown>;
  readonly geometry?: ArcGISRing;
}

interface ArcGISQueryResponse {
  readonly features?: readonly ArcGISQueryFeature[];
  readonly exceededTransferLimit?: boolean;
  readonly error?: { readonly code: number; readonly message: string };
}

/**
 * USGS Watershed Boundary Dataset Provider.
 *
 * `hucLevel` selects which digit-level layer to query — HUC-8 is the default
 * (matches the node spec's "HUC-8/10/12" primary emphasis and is small
 * enough — ~2,300 national units — for a full-national pull without
 * per-state chunking).
 */
export class USGSWatershedBoundaryProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name = 'USGS Watershed Boundary Dataset';
  readonly source = WBD_MAPSERVER;
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district'] as const;

  private hucLevel: WBDHucLevel;
  private pageSize: number;
  private timeout: number;

  constructor(options: { hucLevel?: WBDHucLevel; pageSize?: number; timeout?: number } = {}) {
    this.hucLevel = options.hucLevel ?? 'huc8';
    this.pageSize = options.pageSize ?? 1000;
    this.timeout = options.timeout ?? 60000;
  }

  /**
   * Query one state's worth of HUCs (smoke-test / scoped-ingest entry
   * point — avoids a full-national pull in dev). `stateAbbr` matches the
   * layer's `states` field (comma-joined 2-letter codes, e.g. "CT,NY,RI").
   */
  async downloadForState(stateAbbr: string): Promise<RawBoundaryFile[]> {
    const layer = WBD_HUC_LAYERS[this.hucLevel];
    const where = `states LIKE '%${stateAbbr.toUpperCase()}%'`;
    const features = await this.queryLayer(layer.layerId, where);

    logger.info('USGS WBD: fetched state-scoped features', {
      hucLevel: this.hucLevel,
      stateAbbr,
      count: features.length,
    });

    const buffer = Buffer.from(JSON.stringify(features), 'utf-8');
    return [
      {
        url: `${WBD_MAPSERVER}/${layer.layerId}`,
        format: 'geojson',
        data: buffer,
        metadata: {
          source: this.name,
          provider: 'USGSWatershedBoundaryProvider',
          authority: 'federal',
          retrieved: new Date().toISOString(),
          hucLevel: this.hucLevel,
          stateAbbr,
        },
      },
    ];
  }

  async download(_params: { level: AdministrativeLevel }): Promise<RawBoundaryFile[]> {
    const layer = WBD_HUC_LAYERS[this.hucLevel];
    const features = await this.queryLayer(layer.layerId, '1=1');

    logger.info('USGS WBD: fetched national features', {
      hucLevel: this.hucLevel,
      count: features.length,
    });

    const buffer = Buffer.from(JSON.stringify(features), 'utf-8');
    return [
      {
        url: `${WBD_MAPSERVER}/${layer.layerId}`,
        format: 'geojson',
        data: buffer,
        metadata: {
          source: this.name,
          provider: 'USGSWatershedBoundaryProvider',
          authority: 'federal',
          retrieved: new Date().toISOString(),
          hucLevel: this.hucLevel,
        },
      },
    ];
  }

  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const normalized: NormalizedBoundary[] = [];
    const layer = WBD_HUC_LAYERS[this.hucLevel];

    for (const file of raw) {
      const features = JSON.parse(file.data.toString('utf-8')) as ArcGISQueryFeature[];

      for (const feature of features) {
        const attrs = feature.attributes;
        const hucId = attrs[layer.field] as string | undefined;
        const geometry = this.convertGeometry(feature.geometry);
        if (!hucId || !geometry) continue;

        const source: ProviderSourceMetadata = {
          provider: this.name,
          url: `${WBD_MAPSERVER}/${layer.layerId}`,
          version: String(new Date().getFullYear()),
          license: 'public-domain',
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
          // No publishExclusion — US federal work, public domain, not O8-gated.
        };

        normalized.push({
          id: `${layer.prefix}-${hucId}`,
          name: (attrs.name as string) ?? `${this.hucLevel.toUpperCase()} ${hucId}`,
          level: 'district',
          geometry,
          properties: {
            ...attrs,
            layer: layer.prefix,
            provenanceLabel: 'hydrologic',
            hucLevel: this.hucLevel,
          },
          source,
        });
      }
    }

    return normalized;
  }

  async checkForUpdates() {
    try {
      const response = await fetch(`${WBD_MAPSERVER}?f=json`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      return {
        available: response.ok,
        latestVersion: String(new Date().getFullYear()),
        currentVersion: String(new Date().getFullYear()),
        releaseDate: new Date().toISOString(),
      };
    } catch {
      return {
        available: false,
        latestVersion: String(new Date().getFullYear()),
        currentVersion: String(new Date().getFullYear()),
        releaseDate: new Date().toISOString(),
      };
    }
  }

  async getMetadata(): Promise<ProviderSourceMetadata> {
    return {
      provider: this.name,
      url: this.source,
      version: String(new Date().getFullYear()),
      license: 'public-domain',
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
    };
  }

  private async queryLayer(layerId: number, where: string): Promise<ArcGISQueryFeature[]> {
    const allFeatures: ArcGISQueryFeature[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        where,
        outFields: '*',
        returnGeometry: 'true',
        resultOffset: String(offset),
        resultRecordCount: String(this.pageSize),
        outSR: '4326',
        f: 'json',
      });

      const response = await fetch(`${WBD_MAPSERVER}/${layerId}/query?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`USGS WBD query failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as ArcGISQueryResponse;
      if (data.error) {
        throw new Error(`USGS WBD ArcGIS error ${data.error.code}: ${data.error.message}`);
      }

      const features = data.features ?? [];
      allFeatures.push(...features);

      if (data.exceededTransferLimit || features.length === this.pageSize) {
        offset += this.pageSize;
      } else {
        hasMore = false;
      }
    }

    return allFeatures;
  }

  private convertGeometry(geom: ArcGISRing | undefined): Polygon | MultiPolygon | null {
    if (!geom?.rings || geom.rings.length === 0) return null;
    const coordinates = geom.rings.map((ring) => ring.map(([x, y]) => [x, y] as [number, number]));
    return { type: 'Polygon', coordinates };
  }
}
