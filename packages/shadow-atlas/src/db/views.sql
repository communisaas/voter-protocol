-- Derived Views: Recompute on read, no storage

-- v_status: current status per municipality
CREATE VIEW v_status AS
SELECT
  m.id AS muni_id,
  m.name,
  m.state,
  m.population,
  CASE
    WHEN h.muni_id IS NOT NULL THEN 'FOUND_LAYER'
    WHEN sel.muni_id IS NOT NULL THEN 'SELECTED_NOT_FETCHED'
    WHEN src.muni_id IS NOT NULL THEN 'SOURCES_FOUND'
    ELSE 'NOT_ATTEMPTED'
  END AS status,
  sel.confidence,
  sel.decided_by,
  sel.decided_at,
  a.record_count AS district_count,
  a.content_sha256,
  h.updated_at AS data_updated_at
FROM municipalities m
LEFT JOIN heads h ON h.muni_id = m.id
LEFT JOIN selections sel ON sel.muni_id = m.id
LEFT JOIN artifacts a ON a.id = h.artifact_id
LEFT JOIN (
  SELECT DISTINCT muni_id FROM sources
) src ON src.muni_id = m.id;

-- v_coverage: state-level coverage metrics
CREATE VIEW v_coverage AS
SELECT
  state,
  COUNT(*) AS total_munis,
  SUM(CASE WHEN status = 'FOUND_LAYER' THEN 1 ELSE 0 END) AS found,
  SUM(CASE WHEN status = 'SELECTED_NOT_FETCHED' THEN 1 ELSE 0 END) AS selected,
  SUM(CASE WHEN status = 'SOURCES_FOUND' THEN 1 ELSE 0 END) AS sources,
  SUM(CASE WHEN status = 'NOT_ATTEMPTED' THEN 1 ELSE 0 END) AS pending,
  ROUND(100.0 * SUM(CASE WHEN status = 'FOUND_LAYER' THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct_complete
FROM v_status
GROUP BY state
ORDER BY pct_complete DESC, total_munis DESC;

-- v_errors: recent errors for debugging
CREATE VIEW v_errors AS
SELECT
  ts,
  muni_id,
  kind,
  error,
  json_extract(payload, '$.source_url') AS url,
  duration_ms
FROM events
WHERE kind = 'ERROR'
ORDER BY ts DESC
LIMIT 100;

-- v_llm_usage: token/call tracking
CREATE VIEW v_llm_usage AS
SELECT
  DATE(ts) AS date,
  model,
  COUNT(*) AS calls,
  SUM(json_extract(payload, '$.batch_size')) AS cities_processed,
  ROUND(AVG(duration_ms), 2) AS avg_duration_ms
FROM events
WHERE model IS NOT NULL
GROUP BY DATE(ts), model
ORDER BY date DESC;
