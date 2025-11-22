import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';

export interface ArcGISQueryOptions {
  readonly where?: string;
  readonly outFields?: string;
  readonly pageSize?: number;
  readonly token?: string;
  readonly headers?: Record<string, string>;
}

export async function fetchArcGISFeatures<T extends Geometry = Geometry>(
  serviceUrl: string,
  options: ArcGISQueryOptions = {}
): Promise<Array<Feature<T, GeoJsonProperties>>> {
  const features: Array<Feature<T, GeoJsonProperties>> = [];
  const pageSize = options.pageSize ?? 2000;
  let offset = 0;

  while (true) {
    const page = await fetchFeaturePage<T>(serviceUrl, offset, pageSize, options);
    if (page.length === 0) {
      break;
    }

    features.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return features;
}

async function fetchFeaturePage<T extends Geometry>(
  serviceUrl: string,
  offset: number,
  pageSize: number,
  options: ArcGISQueryOptions
): Promise<Array<Feature<T, GeoJsonProperties>>> {
  const params = new URLSearchParams({
    where: options.where ?? '1=1',
    outFields: options.outFields ?? '*',
    returnGeometry: 'true',
    f: 'geojson',
    outSR: '4326',
    resultOffset: offset.toString(),
    resultRecordCount: pageSize.toString()
  });

  if (options.token) {
    params.set('token', options.token);
  }

  const queryUrl = normalizeQueryUrl(serviceUrl, params);
  const response = await fetch(queryUrl, {
    headers: options.headers
  });

  if (!response.ok) {
    throw new Error(`ArcGIS FeatureServer query failed (${response.status} ${response.statusText})`);
  }

  const data = (await response.json()) as FeatureCollection;
  return (data.features ?? []) as Array<Feature<T, GeoJsonProperties>>;
}

function normalizeQueryUrl(serviceUrl: string, params: URLSearchParams): string {
  const base = serviceUrl.replace(/\/query$/, '');
  return `${base}/query?${params.toString()}`;
}
