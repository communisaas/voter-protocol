/**
 * EIA Electric Retail Service Territories Provider
 *
 * Wave-1 rank 5 (docs/design/MISSING-SLOTS-SOURCING.md, commons repo) -> slot
 * 18 (Utility District, aliased 'utility'). Single national layer, EIA
 * utility-id keyed (EIA Form 861). Label 'service-area', incl. investor-owned
 * utilities (no elected board) — never conflated with an elected governance
 * district.
 *
 * SIGNED PUBLISH GATE (O8-license-confirms, hard block — see
 * ProviderSourceMetadata.publishExclusion): this layer's provenance traces
 * through DOE-contractor (ORNL) work with a third-party-contributed carve-out
 * in EIA's reuse policy. Every boundary this provider emits carries
 * publishExclusion until the operator records EIA's confirmation.
 *
 * Source (verified live 2026-07-04, ArcGIS FeatureServer responds to
 * `?f=json`): the authoritative atlas.eia.gov org's own hosted item id could
 * NOT be resolved live in this session (its ArcGIS Hub "about"/"explore"
 * pages are JS-rendered and returned 404 to a plain fetch; the arcgis.com
 * item-search API returned only third-party mirror orgs, none under an
 * EIA-owned orgId). The URL below is a verified-live, commonly-mirrored
 * HIFLD-derived copy carrying the same title/schema. O8's operator-run
 * license confirmation must independently re-verify the canonical EIA
 * source before any signed publish — this mirror is an ingest-dev
 * convenience only, not a substitute for that confirmation.
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

const EIA_TERRITORIES_FEATURE_SERVER =
  'https://services6.arcgis.com/BAJNi3EgCdtQ1BCG/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer/0';

/** O8-license-confirms — the one pending gate blocking a signed publish. */
const PUBLISH_EXCLUSION = {
  reason:
    'DOE-contractor (ORNL) provenance + third-party-contributed carve-out in EIA reuse policy (verified 2026-07-04, no independent grant confirmed)',
  pendingConfirmation: 'O8-license-confirms (docs/design/MISSING-SLOTS-SOURCING.md: "EIA license: CONFIRMED <date>")',
} as const;

interface ArcGISFeatureAttrs {
  readonly ID?: string | number;
  readonly NAME?: string;
  readonly UTILITY_ID?: string | number;
  readonly TYPE?: string;
  readonly [key: string]: unknown;
}

interface ArcGISRing {
  readonly rings?: readonly (readonly [number, number])[][];
}

interface ArcGISQueryFeature {
  readonly attributes: ArcGISFeatureAttrs;
  readonly geometry?: ArcGISRing;
}

interface ArcGISQueryResponse {
  readonly features?: readonly ArcGISQueryFeature[];
  readonly exceededTransferLimit?: boolean;
  readonly error?: { readonly code: number; readonly message: string };
}

/**
 * EIA Electric Retail Service Territories Provider.
 *
 * Single national layer (BoundaryProvider.administrativeLevels = ['district']).
 */
export class EIATerritoriesProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name = 'EIA Electric Retail Service Territories';
  readonly source = EIA_TERRITORIES_FEATURE_SERVER;
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district'] as const;

  private pageSize: number;
  private timeout: number;
  /**
   * Optional cap on total features fetched across all pages. Production/
   * publish builds must leave this unset (paginates the full ~2,931-
   * territory national layer). This ArcGIS FeatureServer is genuinely slow
   * for large `outFields=*` + full-geometry pages (verified live 2026-07-04:
   * a 500-feature single page took ~49s; small samples of 5-25 features
   * take 2-4s) — tests that need a real-network smoke, not a full national
   * pull, pass a small maxFeatures so pagination stops after the first page
   * or two rather than timing out partway through ~30 pages.
   */
  private maxFeatures: number | null;

  constructor(options: { pageSize?: number; timeout?: number; maxFeatures?: number } = {}) {
    this.pageSize = options.pageSize ?? 1000;
    this.timeout = options.timeout ?? 60000;
    this.maxFeatures = options.maxFeatures ?? null;
  }

  async download(_params: { level: AdministrativeLevel }): Promise<RawBoundaryFile[]> {
    const allFeatures: ArcGISQueryFeature[] = [];
    let offset = 0;
    let hasMore = true;

    logger.info('EIA territories: querying national FeatureServer', {
      url: EIA_TERRITORIES_FEATURE_SERVER,
      maxFeatures: this.maxFeatures,
    });

    while (hasMore) {
      const pageRecordCount =
        this.maxFeatures !== null
          ? Math.min(this.pageSize, Math.max(0, this.maxFeatures - allFeatures.length))
          : this.pageSize;
      if (pageRecordCount <= 0) break;

      const params = new URLSearchParams({
        where: '1=1',
        outFields: '*',
        returnGeometry: 'true',
        resultOffset: String(offset),
        resultRecordCount: String(pageRecordCount),
        outSR: '4326',
        f: 'json',
      });

      const response = await fetch(`${EIA_TERRITORIES_FEATURE_SERVER}/query?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`EIA territories query failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as ArcGISQueryResponse;
      if (data.error) {
        throw new Error(`EIA territories ArcGIS error ${data.error.code}: ${data.error.message}`);
      }

      const features = data.features ?? [];
      allFeatures.push(...features);

      const reachedCap = this.maxFeatures !== null && allFeatures.length >= this.maxFeatures;
      if (!reachedCap && (data.exceededTransferLimit || features.length === pageRecordCount)) {
        offset += pageRecordCount;
      } else {
        hasMore = false;
      }
    }

    logger.info('EIA territories: fetched features', { count: allFeatures.length });

    const buffer = Buffer.from(JSON.stringify(allFeatures), 'utf-8');
    return [
      {
        url: EIA_TERRITORIES_FEATURE_SERVER,
        format: 'geojson',
        data: buffer,
        metadata: {
          source: this.name,
          provider: 'EIATerritoriesProvider',
          authority: 'federal',
          retrieved: new Date().toISOString(),
        },
      },
    ];
  }

  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const normalized: NormalizedBoundary[] = [];

    for (const file of raw) {
      const features = JSON.parse(file.data.toString('utf-8')) as ArcGISQueryFeature[];

      for (const feature of features) {
        const attrs = feature.attributes;
        const utilityId = attrs.UTILITY_ID ?? attrs.ID;
        const geometry = this.convertGeometry(feature.geometry);
        if (utilityId === undefined || utilityId === null || !geometry) continue;

        const source: ProviderSourceMetadata = {
          provider: this.name,
          url: this.source,
          version: String(new Date().getFullYear()),
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

        normalized.push({
          id: `utility-${utilityId}`,
          name: (attrs.NAME as string) ?? `Utility ${utilityId}`,
          level: 'district',
          geometry,
          properties: {
            ...attrs,
            layer: 'utility',
            provenanceLabel: 'service-area',
          },
          source,
        });
      }
    }

    return normalized;
  }

  async checkForUpdates() {
    try {
      const response = await fetch(`${EIA_TERRITORIES_FEATURE_SERVER}?f=json`, {
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

  private convertGeometry(geom: ArcGISRing | undefined): Polygon | MultiPolygon | null {
    if (!geom?.rings || geom.rings.length === 0) return null;
    const coordinates = geom.rings.map((ring) => ring.map(([x, y]) => [x, y] as [number, number]));
    return { type: 'Polygon', coordinates };
  }
}
