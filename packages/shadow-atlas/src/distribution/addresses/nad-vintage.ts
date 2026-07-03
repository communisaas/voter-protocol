/**
 * NAD vintage gate for the address-index manifest.
 *
 * Validates the `nadVintage` stamped into `US/manifest.json` by the
 * address-index publish (SEAM-CONTRACT v1 §4). Mirrors the gate shape of
 * `resolveTigerVintage` (src/distribution/snapshots/tiger-vintage.ts): the
 * parse-arg default is `'unknown'`, and a real (non-dry) build THROWS on any
 * value that is not an ISO calendar date — so `'unknown'` can never land in
 * a produced manifest. Consumer side degrades to null instead (honestly
 * unknown), never fabricates.
 *
 * The NAD quarterly text releases are stamped by compilation date
 * (e.g. 2026-06-30 for release 23), hence a date rather than a release
 * number: the date orders releases and survives DOT renumbering.
 */

export const NAD_VINTAGE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the publish-manifest `nadVintage` string.
 *
 * @param raw  The candidate vintage (e.g. from `--nad-vintage`).
 * @param opts.dryRun  When true, pass the raw value through untouched so a
 *   dry-run plan can preview any label without failing.
 * @returns the validated vintage string.
 * @throws when not a dry run and `raw` is not a plausible ISO date.
 */
export function resolveNadVintage(raw: string, opts: { dryRun: boolean }): string {
	if (isValidNadVintage(raw)) return raw;
	if (opts.dryRun) return raw;
	throw new Error(
		`refusing to publish: nadVintage must be an ISO date (YYYY-MM-DD), got "${raw}"`
	);
}

function isValidNadVintage(raw: string): boolean {
	if (!NAD_VINTAGE_PATTERN.test(raw)) return false;
	const [y, m, d] = raw.split('-').map((p) => Number.parseInt(p, 10));
	if (y < 2015 || y > 2100) return false;
	if (m < 1 || m > 12) return false;
	if (d < 1 || d > 31) return false;
	return true;
}
