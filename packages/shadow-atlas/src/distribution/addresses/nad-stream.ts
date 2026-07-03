/**
 * NAD quarterly text-release stream parser (src:0 of the address index).
 *
 * The National Address Database text release is a single ~30 GB, 60-column
 * CSV (`NAD_r{N}.txt`, BOM-prefixed header, RFC-4180-style quoting). It is
 * NEVER read whole-file into memory: this module consumes any Readable
 * (file stream, `funzip` stdout in CI) line-group by line-group and yields
 * only the fields the index needs.
 *
 * Column names are resolved from the header row, not hard-coded positions,
 * so a column-order change in a future release fails loud (missing header)
 * instead of silently mis-parsing.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** The subset of NAD columns the address index consumes. */
export interface NadRow {
  /** Full house number as published (may be hyphenated/fractional). */
  houseNumber: string;
  /** Reconstructed street line (pre-directional … post-modifier). */
  streetLine: string;
  state: string;
  zip: string;
  longitude: number;
  latitude: number;
}

const REQUIRED_COLUMNS = [
  'Add_Number',
  'AddNo_Full',
  'AddNum_Pre',
  'AddNum_Suf',
  'St_PreMod',
  'St_PreDir',
  'St_PreTyp',
  'St_PreSep',
  'St_Name',
  'St_PosTyp',
  'St_PosDir',
  'St_PosMod',
  'State',
  'Zip_Code',
  'Longitude',
  'Latitude',
] as const;

/**
 * Minimal CSV field splitter with RFC-4180 quote handling. Returns null when
 * the line ends inside an open quote (caller accumulates the next physical
 * line — embedded newlines are rare in NAD but must not desync the stream).
 */
export function splitCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  if (inQuotes) return null;
  fields.push(field);
  return fields;
}

export interface NadStreamOptions {
  /** Uppercase two-letter state filter; empty = all states. */
  states?: ReadonlySet<string>;
  /** Called for rows skipped as unusable (missing hn/zip/coords). */
  onSkip?: (reason: string) => void;
}

/**
 * Stream-parse a NAD text release. Yields one NadRow per usable address
 * point; unusable rows (no house number, no ZIP5, unparseable coordinates)
 * are counted via `onSkip`, never fabricated.
 */
export async function* streamNadRows(
  input: Readable,
  opts: NadStreamOptions = {}
): AsyncGenerator<NadRow> {
  const rl = createInterface({ input, crlfDelay: Infinity });

  let header: Record<string, number> | null = null;
  let pending = '';

  for await (const rawLine of rl) {
    const line = pending.length > 0 ? `${pending}\n${rawLine}` : rawLine;
    const fields = splitCsvLine(line);
    if (fields === null) {
      // Open quote — accumulate the next physical line.
      pending = line;
      continue;
    }
    pending = '';

    if (header === null) {
      header = {};
      fields.forEach((name, idx) => {
        header![name.replace(/^\uFEFF/, '').trim()] = idx;
      });
      for (const col of REQUIRED_COLUMNS) {
        if (!(col in header)) {
          throw new Error(
            `NAD header is missing required column "${col}" — release format changed; refusing to mis-parse`
          );
        }
      }
      continue;
    }

    const get = (col: (typeof REQUIRED_COLUMNS)[number]): string =>
      (fields[header![col]] ?? '').trim();

    const state = get('State').toUpperCase();
    if (opts.states && opts.states.size > 0 && !opts.states.has(state)) continue;

    const zip = get('Zip_Code');
    if (!/^\d{5}/.test(zip)) {
      opts.onSkip?.('zip');
      continue;
    }

    const houseNumber =
      get('AddNo_Full') ||
      [get('AddNum_Pre'), get('Add_Number'), get('AddNum_Suf')]
        .filter((p) => p.length > 0)
        .join(' ');
    if (houseNumber.length === 0) {
      opts.onSkip?.('houseNumber');
      continue;
    }

    const streetLine = [
      get('St_PreMod'),
      get('St_PreDir'),
      get('St_PreTyp'),
      get('St_PreSep'),
      get('St_Name'),
      get('St_PosTyp'),
      get('St_PosDir'),
      get('St_PosMod'),
    ]
      .filter((p) => p.length > 0)
      .join(' ');
    if (streetLine.length === 0) {
      opts.onSkip?.('street');
      continue;
    }

    const longitude = Number.parseFloat(get('Longitude'));
    const latitude = Number.parseFloat(get('Latitude'));
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude === 0 ||
      latitude === 0
    ) {
      opts.onSkip?.('coords');
      continue;
    }

    yield {
      houseNumber,
      streetLine,
      state,
      zip: zip.slice(0, 5),
      longitude,
      latitude,
    };
  }

  if (pending.length > 0) {
    throw new Error('NAD stream ended inside an open quoted field — truncated input');
  }
}
