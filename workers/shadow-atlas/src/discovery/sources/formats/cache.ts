import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

const ROOT_CACHE_DIR = process.env.SHADOW_ATLAS_CACHE_DIR
  ? path.resolve(process.env.SHADOW_ATLAS_CACHE_DIR)
  : path.join('/tmp', 'shadow-atlas-cache');

export async function ensureCacheNamespace(namespace: string): Promise<string> {
  const dir = path.join(ROOT_CACHE_DIR, namespace);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function hashKey(parts: Array<string | number | boolean>): string {
  const hash = crypto.createHash('sha1');
  for (const part of parts) {
    hash.update(String(part));
    hash.update('|');
  }
  return hash.digest('hex');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function touchFile(filePath: string): Promise<void> {
  const time = new Date();
  await fs.utimes(filePath, time, time).catch(async () => {
    await fs.writeFile(filePath, '');
  });
}
