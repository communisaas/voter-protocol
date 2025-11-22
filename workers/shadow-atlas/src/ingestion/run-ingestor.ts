import path from 'path';

import { createAuthorityIngestor } from './factory';
import { resolveIngestorId } from './registry';
import type { IngestOptions } from './types';

function parseArgs(argv: string[]): IngestOptions {
  const options: Record<string, string | boolean> = {};

  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      const normalized = key.slice(2);
      if (value === undefined) {
        options[normalized] = true;
      } else {
        options[normalized] = value;
      }
    }
  }

  const state = (options.state as string | undefined)?.toUpperCase();
  const dataset = (options.dataset as string | undefined)?.toLowerCase() ?? 'fire';

  if (!state) {
    throw new Error('Missing required --state=<STATE> argument');
  }

  return {
    state,
    dataset,
    force: Boolean(options.force),
    outputPath: typeof options.output === 'string' ? options.output : undefined
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const ingestorId = resolveIngestorId(options.state, options.dataset);
  if (!ingestorId) {
    throw new Error(`No ingestion entry configured for ${options.state} (${options.dataset})`);
  }

  const ingestor = createAuthorityIngestor(ingestorId);

  if (!ingestor) {
    throw new Error(`Ingestor implementation missing for id ${ingestorId}`);
  }

  console.log(`[ingest] Running ${ingestor.id} (${options.state} ${options.dataset})...`);
  const result = await ingestor.ingest(options);
  console.log(`[ingest] Wrote ${result.featuresWritten} features → ${path.relative(process.cwd(), result.outputPath)}`);
}

run().catch((error) => {
  console.error('[ingest] Failed:', error);
  process.exit(1);
});
