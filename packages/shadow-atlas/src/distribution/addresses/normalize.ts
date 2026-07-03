/**
 * Street-line normalizer — SEAM-CONTRACT v1 (atlas-address-index) §3.
 *
 * The ALGORITHM below is normative contract text, byte-identical on both
 * sides of the seam (producer chunks here; consumer lookups in the commons
 * resolver). The TABLES are shipped data (normalization-table.ts, emitted as
 * `US/addresses/normalization.json`). Applied to the street line only,
 * producing the `streets` key of each ZIP5 chunk:
 *
 *   1. Unicode NFD → strip combining marks → ASCII uppercase.
 *   2. Strip punctuation (`.` `,` `'`) except intra-token hyphens; collapse
 *      whitespace to single spaces; trim.
 *   3. Tokenize on spaces. Strip the leading house-number token(s)
 *      (digits, hyphenated, fractional).
 *   4. Strip trailing secondary-unit designator + its value (Pub 28 C2), plus
 *      any TRAILING bare value-less designator (the `unitsWithoutValue` set
 *      shipped in `normalization.json`) — units never enter the street key.
 *   5. Map directional tokens in leading and trailing position (Pub 28 B).
 *   6. Map the final remaining token through the suffix table (Pub 28 C1);
 *      when the final token is a mapped trailing directional and more than
 *      two tokens remain, the lookup applies to the SECOND-TO-LAST token
 *      (Pub 28 keeps the directional last: PENNSYLVANIA AVENUE NW →
 *      PENNSYLVANIA AVE NW).
 *   7. Join with single spaces. Normalization MUST be idempotent:
 *      `norm(norm(x)) === norm(x)`.
 *
 * Pure and dependency-free by design: no libpostal (its 1.8–2.2 GB model is
 * out), no hosted normalization API — addresses never leave infrastructure
 * we control.
 */

import type { NormalizationJson } from './normalization-table.js';
import {
  DIRECTIONALS,
  SUFFIXES,
  UNITS,
  UNITS_WITHOUT_VALUE,
  buildNormalizationJson,
} from './normalization-table.js';

/** House-number token: digits, hyphenated (112-10), or fractional (1/2). */
const HOUSE_NUMBER_TOKEN = /^\d+(-\d+)?$|^\d+\/\d+$/;

/**
 * A secondary-unit VALUE token: something that reads as a unit designation
 * (`5`, `200B`, `#4`, `B`), never a street word. Requiring a digit or a
 * single letter keeps `TRAILER LN` (street named Trailer Lane) from being
 * eaten as designator+value while still stripping `APT 5B` / `STE 200`.
 */
const UNIT_VALUE_TOKEN = /^#?\d[\dA-Z/-]*$|^[A-Z]$/;

interface NormTables {
  directionals: Readonly<Record<string, string>>;
  suffixes: Readonly<Record<string, string>>;
  units: ReadonlySet<string>;
  unitsWithoutValue: ReadonlySet<string>;
}

const DEFAULT_TABLES: NormTables = {
  directionals: DIRECTIONALS,
  suffixes: SUFFIXES,
  units: new Set(UNITS),
  unitsWithoutValue: UNITS_WITHOUT_VALUE,
};

/**
 * Build the table bundle from a fetched `normalization.json` — the consumer
 * path (it fetches the shipped table, never vendors its own). Exposed here so
 * tests can prove the shipped JSON round-trips into the identical normalizer.
 * ALL four tables come from the loaded JSON — including `unitsWithoutValue`
 * (§3 amended step 4). There is deliberately no fallback to the local
 * constants: a table the artifact does not ship is a table the consumer
 * does not have.
 */
export function tablesFromJson(json: NormalizationJson): NormTables {
  return {
    directionals: json.directionals,
    suffixes: json.suffixes,
    units: new Set(json.units),
    unitsWithoutValue: new Set(json.unitsWithoutValue),
  };
}

/**
 * Normalize a street line to its chunk key per §3. Idempotent:
 * `normalizeStreet(normalizeStreet(x)) === normalizeStreet(x)`.
 */
export function normalizeStreet(
  input: string,
  tables: NormTables = DEFAULT_TABLES
): string {
  // 1. NFD → strip combining marks → ASCII uppercase.
  let s = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // 2. Strip `.` `,` `'`; collapse whitespace; trim. Hyphens survive only
  //    inside tokens (leading/trailing hyphens are trimmed per token below).
  s = s.replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

  // 3. Tokenize; trim token-edge hyphens; drop empties; strip leading
  //    house-number token(s).
  let tokens = s
    .split(' ')
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);

  while (tokens.length > 1 && HOUSE_NUMBER_TOKEN.test(tokens[0])) {
    tokens = tokens.slice(1);
  }

  // 4. Strip trailing secondary-unit designator + its value. Loop: an input
  //    like `MAIN ST APT 5 REAR` sheds `REAR`, then `APT 5`.
  let stripped = true;
  while (stripped && tokens.length > 1) {
    stripped = false;
    const last = tokens[tokens.length - 1];
    const prev = tokens.length >= 2 ? tokens[tokens.length - 2] : undefined;
    if (last.startsWith('#') && last.length > 1) {
      // `#5` — designator and value fused into one token.
      tokens = tokens.slice(0, -1);
      stripped = true;
    } else if (
      prev !== undefined &&
      tokens.length > 2 &&
      tables.units.has(prev) &&
      UNIT_VALUE_TOKEN.test(last)
    ) {
      tokens = tokens.slice(0, -2);
      stripped = true;
    } else if (tables.unitsWithoutValue.has(last)) {
      tokens = tokens.slice(0, -1);
      stripped = true;
    }
  }

  // 5. Directionals in leading and trailing position.
  if (tokens.length > 1) {
    const lead = tables.directionals[tokens[0]];
    if (lead !== undefined) tokens[0] = lead;
  }
  if (tokens.length > 1) {
    const trail = tables.directionals[tokens[tokens.length - 1]];
    if (trail !== undefined) tokens[tokens.length - 1] = trail;
  }

  // 6. Final remaining token through the suffix table. When the final token
  //    is a mapped trailing directional (e.g. `BAY AVE N`), Pub 28 keeps the
  //    directional last — the suffix then sits second-to-last; map that one.
  if (tokens.length > 1) {
    const lastIdx = tokens.length - 1;
    const isTrailingDirectional =
      tables.directionals[tokens[lastIdx]] !== undefined;
    const suffixIdx = isTrailingDirectional && tokens.length > 2 ? lastIdx - 1 : lastIdx;
    if (suffixIdx > 0) {
      const mapped = tables.suffixes[tokens[suffixIdx]];
      if (mapped !== undefined) tokens[suffixIdx] = mapped;
    }
  }

  // 7. Join with single spaces.
  return tokens.join(' ');
}

/**
 * House-number key normalization for point records (§2): string keys,
 * leading zeros stripped; hyphenated (`112-10`) and fractional (`123 1/2`)
 * forms kept literally. Returns null when no usable house number exists.
 */
export function normalizeHouseNumberKey(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (t.length === 0) return null;
  // Strip leading zeros from the leading integer segment only (007 → 7,
  // 007-10 → 7-10) without disturbing hyphenated/fractional tails.
  const stripped = t.replace(/^0+(?=\d)/, '');
  return /\d/.test(stripped) ? stripped : null;
}

/**
 * Leading-integer parse for range comparison (§2: "for range comparison
 * parse the leading integer only"). Returns null for non-numeric forms.
 */
export function parseLeadingInteger(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** Re-export for producers that emit the table artifact. */
export { buildNormalizationJson };
