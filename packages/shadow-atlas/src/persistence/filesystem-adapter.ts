/**
 * Filesystem Storage Adapter
 *
 * CRITICAL TYPE SAFETY: Content-addressed blob storage with SHA-256 keys.
 * Type errors here can corrupt GeoJSON artifacts.
 *
 * LOCAL MVP: Uses filesystem with SHA-256 directory sharding (e.g., 2b/2ee/2b2ee...).
 * PRODUCTION: Can swap to R2 adapter with zero business logic changes.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import type { StorageAdapter } from '../types';

export class FilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly basePath: string) {}

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  /**
   * Get sharded path for SHA-256
   * Example: 2b2ee... -> {basePath}/2b/2ee/2b2ee...geojson
   */
  private getPath(sha256: string): string {
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`Invalid SHA-256 hash: ${sha256}`);
    }
    const shard1 = sha256.slice(0, 2);
    const shard2 = sha256.slice(2, 5);
    return join(this.basePath, shard1, shard2, `${sha256}.geojson`);
  }

  /**
   * Get metadata path (JSON sidecar)
   */
  private getMetaPath(sha256: string): string {
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`Invalid SHA-256 hash: ${sha256}`);
    }
    const shard1 = sha256.slice(0, 2);
    const shard2 = sha256.slice(2, 5);
    return join(this.basePath, shard1, shard2, `${sha256}.meta.json`);
  }

  async put(sha256: string, data: Buffer, metadata: Record<string, string>): Promise<void> {
    // Verify content matches the SHA-256 key — enforce content-addressing.
    const actualHash = createHash('sha256').update(data).digest('hex');
    if (actualHash !== sha256.toLowerCase()) {
      throw new Error(`Content hash mismatch: expected ${sha256}, got ${actualHash}`);
    }

    const path = this.getPath(sha256);
    const metaPath = this.getMetaPath(sha256);

    // Create directory
    await fs.mkdir(dirname(path), { recursive: true });

    // R68-F4: Atomic writes — write to.tmp then rename to prevent partial
    // reads on crash. rename() is atomic on POSIX within the same filesystem.
    const tmpPath = `${path}.tmp`;
    const tmpMetaPath = `${metaPath}.tmp`;

    // Write blob atomically
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, path);

    // Write metadata atomically
    await fs.writeFile(tmpMetaPath, JSON.stringify(metadata, null, 2));
    await fs.rename(tmpMetaPath, metaPath);
  }

  async get(sha256: string): Promise<Buffer | null> {
    const path = this.getPath(sha256);

    try {
      return await fs.readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async exists(sha256: string): Promise<boolean> {
    const path = this.getPath(sha256);

    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async delete(sha256: string): Promise<void> {
    const path = this.getPath(sha256);
    const metaPath = this.getMetaPath(sha256);

    try {
      await fs.unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.unlink(metaPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get metadata
   */
  async getMetadata(sha256: string): Promise<Record<string, string> | null> {
    const metaPath = this.getMetaPath(sha256);

    try {
      const data = await fs.readFile(metaPath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Invalid metadata format for ${sha256}: expected a plain object`);
      }
      return parsed as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
