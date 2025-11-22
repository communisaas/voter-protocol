#!/usr/bin/env node
/**
 * Bootstrap CLI
 *
 * Usage: tsx packages/crypto/services/shadow-atlas/cli/bootstrap.ts <db-path>
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPath = args[0] || 'shadow-atlas.db';

  const { SQLiteAdapter } = await import('../db/sqlite-adapter.js');
  const { bootstrap } = await import('../workers/bootstrap.js');

  const schemaPath = join(__dirname, '../db/schema.sql');
  const viewsPath = join(__dirname, '../db/views.sql');

  const schemaSQL = readFileSync(schemaPath, 'utf-8');
  const viewsSQL = readFileSync(viewsPath, 'utf-8');

  console.log(`Bootstrapping database: ${dbPath}`);

  const db = new SQLiteAdapter(dbPath);
  await db.initialize(schemaSQL, viewsSQL);

  await bootstrap(db);

  await db.close();

  console.log('✓ Bootstrap complete');
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
