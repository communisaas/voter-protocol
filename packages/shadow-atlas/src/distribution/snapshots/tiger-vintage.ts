/**
 * TIGER vintage gate for the source publish manifest.
 *
 * Validates the STRING publish-manifest form of `tigerVintage` — the
 * canonical `TIGER20YY` provenance tag stamped into `manifest.json` by the
 * source-publish path. Mirrors `EXPECTED_TIGER_VINTAGE` in
 * scripts/measure-boundary-population.ts and the gate shape of
 * `VERSION_PATTERN` in scripts/publish-source.ts, so a real publish can
 * never silently emit `'unknown'` (the parse-arg default) or any
 * malformed label.
 *
 * DISTINCT from the NUMBER-shaped `tigerVintage` used by the co-located
 * snapshot subsystem (snapshot-schema.ts, types.ts), which carries a bare
 * year integer (e.g. 2024). Do NOT import or wire this validator into the
 * snapshot/number path — the two fields share a name but not a shape.
 */

export const TIGER_VINTAGE_PATTERN = /^TIGER20\d{2}$/;

/**
 * Resolve the publish-manifest `tigerVintage` string.
 *
 * @param raw  The candidate vintage label (e.g. from `--tiger-vintage`).
 * @param opts.dryRun  When true, pass the raw value through untouched so a
 *   dry-run plan can preview any label without failing.
 * @returns the validated vintage string.
 * @throws when not a dry run and `raw` does not match `TIGER20YY`.
 */
export function resolveTigerVintage(raw: string, opts: { dryRun: boolean }): string {
	if (TIGER_VINTAGE_PATTERN.test(raw)) return raw;
	if (opts.dryRun) return raw;
	throw new Error(`refusing to publish: tigerVintage must match TIGER20YY, got "${raw}"`);
}
