/**
 * Officials Schema DDL — single source of truth.
 *
 * The canonical schema lives in officials-schema.sql (same directory).
 * This module reads it at import time so both the ingestion script
 * and the serving layer reference the same DDL.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Full DDL from officials-schema.sql (CREATE TABLE + indexes). */
export const OFFICIALS_SCHEMA_DDL = readFileSync(
  join(__dirname, 'officials-schema.sql'),
  'utf-8',
);
