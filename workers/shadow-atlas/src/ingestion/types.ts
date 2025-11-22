import type { FeatureCollection } from 'geojson';

export interface IngestOptions {
  readonly state: string;
  readonly dataset: string;
  readonly force?: boolean;
  readonly outputPath?: string;
}

export interface IngestResult {
  readonly state: string;
  readonly dataset: string;
  readonly featuresWritten: number;
  readonly outputPath: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuthorityIngestor {
  readonly id: string;
  readonly state: string;
  readonly dataset: string;
  readonly categories: string[];

  ingest(options: IngestOptions): Promise<IngestResult>;
}

export type FeatureCollectionWriter = (collection: FeatureCollection) => Promise<void>;
