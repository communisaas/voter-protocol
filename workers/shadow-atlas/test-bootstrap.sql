-- =============================================================================
-- SHADOW ATLAS TEST BOOTSTRAP
-- =============================================================================
-- Purpose: Local development testing with 5 major cities
-- Usage: wrangler d1 execute shadow-atlas --local --file=test-bootstrap.sql
-- =============================================================================


-- Test Bootstrap SQL (5 municipalities for local development)
-- Generated: 2025-11-09T20:29:46.849Z

INSERT INTO municipalities (id, name, state, geoid, population, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat)
VALUES
('ca-san-francisco', 'San Francisco', 'CA', '0667000', 873965, -122.514, 37.708, -122.357, 37.833),
('tx-austin', 'Austin', 'TX', '4805000', 961855, -97.939, 30.012, -97.555, 30.598),
('il-chicago', 'Chicago', 'IL', '1714000', 2746388, -87.94, 41.645, -87.524, 42.023),
('ny-new-york', 'New York', 'NY', '3651000', 8336817, -74.257, 40.496, -73.7, 40.915),
('ca-los-angeles', 'Los Angeles', 'CA', '0644000', 3898747, -118.668, 33.703, -118.155, 34.337)
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


-- =============================================================================
-- Expected output from SELECT query:
-- =============================================================================
-- id                | name          | state | population | min_lng   | min_lat | max_lng   | max_lat
-- ny-new-york       | New York      | NY    | 8336817    | -74.257   | 40.496  | -73.700   | 40.915
-- ca-los-angeles    | Los Angeles   | CA    | 3898747    | -118.668  | 33.703  | -118.155  | 34.337
-- il-chicago        | Chicago       | IL    | 2746388    | -87.940   | 41.645  | -87.524   | 42.023
-- tx-austin         | Austin        | TX    | 961855     | -97.939   | 30.012  | -97.555   | 30.598
-- ca-san-francisco  | San Francisco | CA    | 873965     | -122.514  | 37.708  | -122.357  | 37.833
-- =============================================================================

