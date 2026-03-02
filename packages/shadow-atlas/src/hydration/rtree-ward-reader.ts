/**
 * R-tree Ward Reader — Load Ward Boundaries from shadow-atlas.db
 *
 * Reads ward rows (id prefix `ward-`) from the unified R-tree database
 * and converts them to CityWardBoundaries[] for the supplemental overlay
 * engine. This eliminates duplicate ward downloads between the R-tree
 * build and Tree 2 build pipelines.
 *
 * Ward ID format in R-tree: `ward-{cityFips}-{wardNum:02d}`
 * Example: `ward-0667000-01` → San Francisco Ward 1
 *
 * @packageDocumentation
 */

import Database from 'better-sqlite3';
import type { Polygon, MultiPolygon } from 'geojson';
import type { CityWardBoundaries, WardBoundary } from './ward-boundary-loader.js';

/**
 * Load ward boundaries from the R-tree SQLite database.
 *
 * Queries all district rows with `ward-` prefixed IDs, groups by city FIPS,
 * and returns them in the CityWardBoundaries[] format expected by
 * overlaySupplementalDistricts().
 *
 * @param dbPath - Path to shadow-atlas.db
 * @param stateFipsFilter - Optional set of state FIPS codes to filter by
 * @returns Array of city ward boundaries
 */
export function loadWardsFromRTree(
  dbPath: string,
  stateFipsFilter?: Set<string>,
): CityWardBoundaries[] {
  const db = new Database(dbPath, { readonly: true });

  try {
    // Query all ward rows
    const rows = db.prepare(
      `SELECT id, name, jurisdiction, geometry FROM districts WHERE id LIKE 'ward-%'`
    ).all() as Array<{
      id: string;
      name: string;
      jurisdiction: string;
      geometry: string;
    }>;

    // Group by city FIPS
    const cityMap = new Map<string, {
      cityName: string;
      state: string;
      wards: WardBoundary[];
    }>();

    for (const row of rows) {
      // Parse ward ID: ward-{cityFips}-{wardNum}
      const match = row.id.match(/^ward-(\d+)-(\d+)$/);
      if (!match) continue;

      const cityFips = match[1];
      const wardNumber = parseInt(match[2], 10);

      // Filter by state if requested
      if (stateFipsFilter) {
        const stateCode = cityFips.length >= 2 ? cityFips.slice(0, 2) : '';
        if (!stateFipsFilter.has(stateCode)) continue;
      }

      let geometry: Polygon | MultiPolygon;
      try {
        const parsed = JSON.parse(row.geometry);
        if (parsed.type !== 'Polygon' && parsed.type !== 'MultiPolygon') continue;
        geometry = parsed as Polygon | MultiPolygon;
      } catch {
        continue; // Skip rows with corrupt geometry
      }

      // Extract state from jurisdiction. DB stores USA/{FIPS} (e.g. USA/06) or USA/{abbr} (e.g. USA/CA).
      // supplemental-overlay.ts never reads CityWardBoundaries.state, so this is informational only.
      const jurisMatch = row.jurisdiction.match(/^USA\/(.+)$/);
      const state = jurisMatch ? jurisMatch[1] : '';

      // Extract city name from ward name (e.g. "San Francisco Ward 1" → "San Francisco")
      const cityName = row.name.replace(/\s+Ward\s+\d+$/i, '');

      if (!cityMap.has(cityFips)) {
        cityMap.set(cityFips, { cityName, state, wards: [] });
      }

      cityMap.get(cityFips)!.wards.push({
        wardNumber,
        wardGeoid: cityFips + String(wardNumber).padStart(2, '0'),
        geometry,
        properties: {},
      });
    }

    // Convert to CityWardBoundaries[]
    const result: CityWardBoundaries[] = [];
    for (const [cityFips, city] of cityMap) {
      // Sort wards by number
      city.wards.sort((a, b) => a.wardNumber - b.wardNumber);

      result.push({
        cityFips,
        cityName: city.cityName,
        state: city.state,
        wards: city.wards,
      });
    }

    return result;
  } finally {
    db.close();
  }
}
