import { promises as fs } from 'fs';
import path from 'path';

interface DownloadOptions {
  readonly url: string;
  readonly destinationPath: string;
  readonly headers?: Record<string, string>;
}

export async function downloadToFile(options: DownloadOptions): Promise<void> {
  const { url, destinationPath, headers } = options;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(45_000)
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}
