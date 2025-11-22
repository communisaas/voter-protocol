import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

export async function createTempDir(prefix: string): Promise<string> {
  const base = path.join(tmpdir(), prefix);
  return fs.mkdtemp(base);
}

export async function downloadToFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url} (status ${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destination, Buffer.from(arrayBuffer));
}

export async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
