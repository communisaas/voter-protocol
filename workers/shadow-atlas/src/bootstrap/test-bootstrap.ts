/**
 * Local Bootstrap Test
 *
 * Purpose: Test bootstrap functionality locally without downloading 200MB shapefile
 * Strategy: Use hardcoded test data for 5 major cities
 */

interface Municipality {
  id: string;
  name: string;
  state: string;
  geoid: string;
  population: number;
  bbox_min_lng: number;
  bbox_min_lat: number;
  bbox_max_lng: number;
  bbox_max_lat: number;
}

/**
 * Test municipalities (hardcoded with real data)
 *
 * Source: Manual extraction from Census TIGER/Line for validation
 */
const TEST_MUNICIPALITIES: Municipality[] = [
  {
    id: 'ca-san-francisco',
    name: 'San Francisco',
    state: 'CA',
    geoid: '0667000',
    population: 873965,
    bbox_min_lng: -122.514,
    bbox_min_lat: 37.708,
    bbox_max_lng: -122.357,
    bbox_max_lat: 37.833
  },
  {
    id: 'tx-austin',
    name: 'Austin',
    state: 'TX',
    geoid: '4805000',
    population: 961855,
    bbox_min_lng: -97.939,
    bbox_min_lat: 30.012,
    bbox_max_lng: -97.555,
    bbox_max_lat: 30.598
  },
  {
    id: 'il-chicago',
    name: 'Chicago',
    state: 'IL',
    geoid: '1714000',
    population: 2746388,
    bbox_min_lng: -87.940,
    bbox_min_lat: 41.645,
    bbox_max_lng: -87.524,
    bbox_max_lat: 42.023
  },
  {
    id: 'ny-new-york',
    name: 'New York',
    state: 'NY',
    geoid: '3651000',
    population: 8336817,
    bbox_min_lng: -74.257,
    bbox_min_lat: 40.496,
    bbox_max_lng: -73.700,
    bbox_max_lat: 40.915
  },
  {
    id: 'ca-los-angeles',
    name: 'Los Angeles',
    state: 'CA',
    geoid: '0644000',
    population: 3898747,
    bbox_min_lng: -118.668,
    bbox_min_lat: 33.703,
    bbox_max_lng: -118.155,
    bbox_max_lat: 34.337
  }
];

/**
 * Generate SQL INSERT statements for test municipalities
 */
function generateTestBootstrapSQL(municipalities: Municipality[]): string {
  const values = municipalities.map(m => {
    const id = m.id.replace(/'/g, "''");
    const name = m.name.replace(/'/g, "''");
    const geoid = m.geoid.replace(/'/g, "''");

    return `('${id}', '${name}', '${m.state}', '${geoid}', ${m.population}, ${m.bbox_min_lng}, ${m.bbox_min_lat}, ${m.bbox_max_lng}, ${m.bbox_max_lat})`;
  });

  const sql = `
-- Test Bootstrap SQL (5 municipalities for local development)
-- Generated: ${new Date().toISOString()}

INSERT INTO municipalities (id, name, state, geoid, population, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat)
VALUES
${values.join(',\n')}
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  geoid = excluded.geoid,
  population = excluded.population,
  bbox_min_lng = excluded.bbox_min_lng,
  bbox_min_lat = excluded.bbox_min_lat,
  bbox_max_lng = excluded.bbox_max_lng,
  bbox_max_lat = excluded.bbox_max_lat,
  updated_at = datetime('now');

-- Initialize state table for new municipalities
INSERT INTO municipality_state (muni_id)
SELECT id FROM municipalities
WHERE id NOT IN (SELECT muni_id FROM municipality_state)
ON CONFLICT (muni_id) DO NOTHING;

-- Verify data loaded
SELECT
  id,
  name,
  state,
  population,
  printf('%.3f', bbox_min_lng) as min_lng,
  printf('%.3f', bbox_min_lat) as min_lat,
  printf('%.3f', bbox_max_lng) as max_lng,
  printf('%.3f', bbox_max_lat) as max_lat
FROM municipalities
ORDER BY population DESC;
`;

  return sql;
}

/**
 * Print test bootstrap SQL to stdout
 *
 * Usage: npx tsx src/bootstrap/test-bootstrap.ts > test-bootstrap.sql
 */
function main(): void {
  console.log('-- =============================================================================');
  console.log('-- SHADOW ATLAS TEST BOOTSTRAP');
  console.log('-- =============================================================================');
  console.log('-- Purpose: Local development testing with 5 major cities');
  console.log('-- Usage: wrangler d1 execute shadow-atlas --local --file=test-bootstrap.sql');
  console.log('-- =============================================================================\n');

  const sql = generateTestBootstrapSQL(TEST_MUNICIPALITIES);
  console.log(sql);

  console.log('\n-- =============================================================================');
  console.log('-- Expected output from SELECT query:');
  console.log('-- =============================================================================');
  console.log('-- id                | name          | state | population | min_lng   | min_lat | max_lng   | max_lat');
  console.log('-- ny-new-york       | New York      | NY    | 8336817    | -74.257   | 40.496  | -73.700   | 40.915');
  console.log('-- ca-los-angeles    | Los Angeles   | CA    | 3898747    | -118.668  | 33.703  | -118.155  | 34.337');
  console.log('-- il-chicago        | Chicago       | IL    | 2746388    | -87.940   | 41.645  | -87.524   | 42.023');
  console.log('-- tx-austin         | Austin        | TX    | 961855     | -97.939   | 30.012  | -97.555   | 30.598');
  console.log('-- ca-san-francisco  | San Francisco | CA    | 873965     | -122.514  | 37.708  | -122.357  | 37.833');
  console.log('-- =============================================================================\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { TEST_MUNICIPALITIES, generateTestBootstrapSQL };
