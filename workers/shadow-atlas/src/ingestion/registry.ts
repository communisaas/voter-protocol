import ingestorsJson from '../../data/special-districts/ingestors.json' with { type: 'json' };

interface IngestorEntry {
  readonly state: string;
  readonly dataset: string;
  readonly ingestor: string;
}

interface IngestionRegistry {
  readonly entries: IngestorEntry[];
}

const REGISTRY = ingestorsJson as IngestionRegistry;

export function resolveIngestorId(state: string, dataset: string): string | undefined {
  const entry = REGISTRY.entries.find(
    (candidate) =>
      candidate.state.toUpperCase() === state.toUpperCase() &&
      candidate.dataset.toLowerCase() === dataset.toLowerCase()
  );
  return entry?.ingestor;
}
