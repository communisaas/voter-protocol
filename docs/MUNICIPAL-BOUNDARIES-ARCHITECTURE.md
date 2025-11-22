# Municipal Boundaries: Event-Sourced, Content-Addressed Architecture

**Date:** 2025-11-09
**Status:** Design Complete - Ready for Implementation
**Philosophy:** Zero repo bloat, graceful unicorn scaling, systematic coverage with provenance

---

## Executive Summary

**The Problem**: No free API for city council districts. Google Civic deprecated. Manual GIS curation from thousands of portals.

**The Solution**: Event-sourced system with content-addressed storage that:
- Maps EVERY US municipality systematically (not just "top 50")
- Uses Gemini 2.5 Flash (1,000 req/day) token-efficiently for judgment calls only
- Stores zero data files in git (DB + object storage)
- Provides complete provenance without bloat
- Scales to unicorn without tech debt

---

## Architecture Principles

### 1. Event Sourcing
- **All state changes** = append-only events
- **Current state** = derived views (recompute on read)
- **Provenance** = event log is complete audit trail
- **Time travel** = replay events to any point

### 2. Content-Addressed Storage (CAS)
- **Immutable blobs**: GeoJSON stored by SHA-256
- **Pointers**: `heads` table points to current artifact
- **Deduplication**: Same content = same hash = one blob
- **Versioning**: Free (old versions just exist as historical blobs)

### 3. Zero Git Bloat
- **No CSVs** committed (municipality inventory from Census API once)
- **No GeoJSON files** in repo (blobs in R2/S3)
- **No generated reports** (SQL views recompute)
- **Code only** in git

### 4. Token Efficiency (Gemini 1k/day)
- **Deterministic scanners** do heavy lifting (no LLM)
- **Batched LLM calls** (30 cities per request)
- **Micro prompts** (JSON-only, no prose)
- **Coverage**: 450-900 cities/day on 1k budget

---

## Database Schema

### Core Tables

```sql
-- municipalities: finite universe (19k US incorporated places)
CREATE TABLE municipalities (
  id TEXT PRIMARY KEY,              -- "ca-los_angeles"
  name TEXT NOT NULL,               -- "Los Angeles, CA"
  state TEXT NOT NULL,              -- "CA"
  fips_place TEXT,                  -- Census FIPS code
  population INTEGER,
  county_fips TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_muni_state ON municipalities(state);
CREATE INDEX idx_muni_pop ON municipalities(population DESC);

-- sources: discovered portal endpoints per municipality
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  kind TEXT NOT NULL CHECK (kind IN ('arcgis','socrata','ckan','geojson')),
  url TEXT NOT NULL,
  layer_hint TEXT,                  -- layer index or name
  title TEXT,
  description TEXT,
  discovered_at TEXT NOT NULL,
  score REAL,                       -- ranking score from heuristics
  UNIQUE (muni_id, kind, url)
);

CREATE INDEX idx_sources_muni ON sources(muni_id);

-- selections: chosen source per municipality (LLM or heuristic decision)
CREATE TABLE selections (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  district_field TEXT,              -- e.g., "DISTRICT", "WARD"
  member_field TEXT,                -- e.g., "COUNCILMEM", "MEMBER"
  at_large INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
  confidence REAL,                  -- 0.0-1.0
  decided_by TEXT NOT NULL,         -- 'heuristic' | 'llm' | 'manual'
  decided_at TEXT NOT NULL,
  model TEXT                        -- e.g., "gemini-2.5-flash" if llm
);

CREATE INDEX idx_selections_confidence ON selections(confidence);
CREATE INDEX idx_selections_decided_by ON selections(decided_by);

-- artifacts: normalized GeoJSON blobs (content-addressed)
CREATE TABLE artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  muni_id TEXT NOT NULL REFERENCES municipalities(id),
  content_sha256 TEXT NOT NULL,     -- key into R2/S3
  record_count INTEGER NOT NULL,
  bbox TEXT,                        -- JSON array [minLon, minLat, maxLon, maxLat]
  etag TEXT,
  last_modified TEXT,
  last_edit_date INTEGER,           -- ArcGIS editingInfo.lastEditDate (epoch ms)
  created_at TEXT NOT NULL,
  UNIQUE (content_sha256)           -- deduplication
);

CREATE INDEX idx_artifacts_muni ON artifacts(muni_id);
CREATE INDEX idx_artifacts_sha ON artifacts(content_sha256);

-- heads: pointers to current artifact per municipality
CREATE TABLE heads (
  muni_id TEXT PRIMARY KEY REFERENCES municipalities(id),
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id),
  updated_at TEXT NOT NULL
);

-- events: append-only provenance log
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  run_id TEXT NOT NULL,             -- batch/cron run identifier
  muni_id TEXT,
  kind TEXT NOT NULL,               -- 'DISCOVER','SELECT','FETCH','UPDATE','ERROR','SKIP'
  payload JSON NOT NULL,            -- small JSON blob with details
  model TEXT,                       -- if LLM involved
  duration_ms INTEGER,              -- operation timing
  error TEXT                        -- error message if kind='ERROR'
);

CREATE INDEX idx_events_ts ON events(ts DESC);
CREATE INDEX idx_events_muni ON events(muni_id);
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_run ON events(run_id);
```

### Derived Views (Recompute, No Storage)

```sql
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
```

---

## Object Storage Contract

### Blob Structure

**Path**: `council/v1/{sha256}.geojson`

**Content**: Normalized GeoJSON (WGS84, RFC 7946)

**Metadata Headers**:
```json
{
  "x-muni-id": "ca-los_angeles",
  "x-source-url": "https://...",
  "x-record-count": "15",
  "x-proj": "EPSG:4326",
  "x-created-at": "2025-11-09T20:30:00Z"
}
```

**Immutability**: Never overwrite. New version = new SHA-256 = new blob.

---

## Event Types

### DISCOVER
```json
{
  "kind": "DISCOVER",
  "muni_id": "ca-los_angeles",
  "payload": {
    "sources_found": 3,
    "platforms": ["arcgis", "socrata"],
    "top_score": 8.5
  },
  "duration_ms": 1234
}
```

### SELECT
```json
{
  "kind": "SELECT",
  "muni_id": "ca-los_angeles",
  "model": "gemini-2.5-flash",
  "payload": {
    "source_id": 42,
    "source_type": "arcgis",
    "source_url": "https://...",
    "district_field": "CD",
    "member_field": "MEMBER",
    "confidence": 0.92,
    "decision": "ok"
  },
  "duration_ms": 850
}
```

### FETCH
```json
{
  "kind": "FETCH",
  "muni_id": "ca-los_angeles",
  "payload": {
    "artifact_id": 123,
    "content_sha256": "2b2ee...",
    "record_count": 15,
    "etag": "\"abc123\"",
    "last_modified": "Fri, 01 Nov 2025 12:00:00 GMT"
  },
  "duration_ms": 3456
}
```

### UPDATE
```json
{
  "kind": "UPDATE",
  "muni_id": "ca-los_angeles",
  "payload": {
    "old_sha": "abc...",
    "new_sha": "def...",
    "changed": true,
    "reason": "last_edit_date_changed"
  },
  "duration_ms": 2345
}
```

### SKIP
```json
{
  "kind": "SKIP",
  "muni_id": "wy-cheyenne",
  "payload": {
    "reason": "at_large",
    "note": "City boundary only, no districts"
  }
}
```

### ERROR
```json
{
  "kind": "ERROR",
  "muni_id": "tx-austin",
  "error": "HTTP 403: Forbidden",
  "payload": {
    "source_url": "https://...",
    "source_type": "arcgis",
    "retry_count": 2
  },
  "duration_ms": 567
}
```

---

## Token-Efficient LLM Strategy

### Batched Selection Prompt (30 cities/call)

**Input** (compact JSON):
```json
{
  "task": "pick best municipal council POLYGON layer or SKIP",
  "rules": [
    "Must be polygons of city council/ward/aldermanic districts",
    "Prefer official city portals; county only if city publishes via county",
    "Output JSONL rows with: muni_id, source_type, source_url, layer_hint, district_field, member_field, at_large, decision, confidence"
  ],
  "glossary": {"WARD": "district", "ALDER": "member", "COUNCIL": "district"},
  "batch": [
    {
      "city": {"id": "il-springfield", "name": "Springfield", "state": "IL"},
      "cand": [
        {
          "ty": "arcgis",
          "ti": "Aldermanic Wards",
          "u": "https://.../MapServer",
          "ly": [
            {"i": 0, "n": "Wards", "f": ["WARD", "ALDERMAN", "SHAPE"]},
            {"i": 1, "n": "Precincts", "f": ["PCT", "SHAPE"]}
          ]
        },
        {
          "ty": "socrata",
          "ti": "City Council Districts",
          "u": "https://data.../resource/abcd.geojson",
          "f": ["district", "member"]
        }
      ]
    }
    // ... 29 more cities
  ]
}
```

**Output** (JSONL, one line per city):
```json
{"muni_id":"il-springfield","source_type":"arcgis","source_url":"https://.../MapServer/0","layer_hint":0,"district_field":"WARD","member_field":"ALDERMAN","at_large":false,"decision":"ok","confidence":0.91}
{"muni_id":"ca-sunnyvale","decision":"skip","confidence":0.65}
```

**Token Efficiency**:
- Abbreviated keys (`ty`, `ti`, `u`, `ly`, `f`)
- Top 3 candidates only per city
- Field names truncated to 6 per layer
- No prose, JSON-only response

### Daily Budget Allocation

| Phase | Calls/day | Cities/call | Total Cities/day |
|-------|-----------|-------------|------------------|
| Discovery (batched) | 15 | 30 | 450 |
| Ambiguity resolution | 50 | 1 | 50 |
| Field sniffing | 100 | 1 | 100 |
| QC spot-check (10%) | 50 | 1 | 50 |
| **Total** | **215** | - | **~600-650** |

**Coverage Timeline**:
- 19,000 municipalities ÷ 600/day = **32 days bulk build**
- Steady state: <150 calls/day for updates

---

## Deterministic Scanners (Zero LLM)

### ArcGIS Hub/Portal Search

```typescript
async function searchArcgis(city: {name: string; state: string}) {
  const query = `("council" OR "ward" OR "aldermanic") AND (district OR boundary) AND (${city.name})`;
  const url = `https://hub.arcgis.com/api/v3/search?q=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  const data = await resp.json();

  return data.results
    .filter((item: any) => item.type === 'Feature Service' || item.type === 'Map Service')
    .map((item: any) => ({
      kind: 'arcgis',
      title: item.title,
      description: item.snippet,
      url: item.url,
      score: scoreCandidate(item, city),
      discovered_at: new Date().toISOString()
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

### Socrata Discovery

```typescript
async function searchSocrata(city: {name: string; state: string}) {
  const query = `council district ${city.name} ${city.state}`;
  const url = `https://api.us.socrata.com/api/catalog/v1?q=${encodeURIComponent(query)}&only=datasets`;

  const resp = await fetch(url);
  const data = await resp.json();

  return data.results
    .filter((ds: any) => ds.resource.columns_datatype?.includes('multipolygon'))
    .map((ds: any) => ({
      kind: 'socrata',
      title: ds.resource.name,
      description: ds.resource.description,
      url: `${ds.link}/resource/${ds.resource.id}.geojson`,
      score: scoreCandidate(ds, city),
      discovered_at: new Date().toISOString()
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

### Scoring Heuristics

```typescript
function scoreCandidate(item: any, city: {name: string; state: string}): number {
  let score = 0;

  const text = `${item.title} ${item.description}`.toLowerCase();

  // Geometry type
  if (text.includes('polygon')) score += 3;

  // Keywords
  if (/council|ward|alder/i.test(text)) score += 3;
  if (/district|boundary/i.test(text)) score += 2;

  // City name match
  if (text.includes(city.name.toLowerCase())) score += 2;

  // Recency (if available)
  if (item.modified && isRecent(item.modified, 365)) score += 1;

  // Feature count hint (3-80 typical)
  if (item.recordCount >= 3 && item.recordCount <= 100) score += 1;

  return score;
}
```

---

## Worker Implementation

### Bootstrap (Run Once)

```typescript
// bootstrap.ts - populate municipalities table from Census API
async function bootstrap() {
  const url = 'https://api.census.gov/data/2020/dec/pl?get=NAME&for=place:*';
  const resp = await fetch(url);
  const data = await resp.json();

  const rows = data.slice(1).map((row: string[]) => {
    const name = row[0];
    const state = row[1];
    const fips = row[2];
    const id = slugify(`${state}-${name}`);

    return {
      id,
      name: `${name}, ${state}`,
      state,
      fips_place: fips,
      population: null  // fetch separately if needed
    };
  });

  await db.batchInsert('municipalities', rows);
  console.log(`Bootstrapped ${rows.length} municipalities`);
}
```

### Discovery (Hourly Cron)

```typescript
// discover.ts - deterministic portal search
async function discoverBatch(munis: Municipality[]) {
  for (const muni of munis) {
    const arcgis = await searchArcgis(muni);
    const socrata = await searchSocrata(muni);
    const ckan = await searchCKAN(muni);

    const sources = [...arcgis, ...socrata, ...ckan];

    await db.batchInsert('sources', sources.map(s => ({
      ...s,
      muni_id: muni.id
    })));

    await db.insert('events', {
      run_id: RUN_ID,
      muni_id: muni.id,
      kind: 'DISCOVER',
      payload: JSON.stringify({
        sources_found: sources.length,
        platforms: [...new Set(sources.map(s => s.kind))],
        top_score: sources[0]?.score || 0
      })
    });
  }
}
```

### Decide (Hourly Cron)

```typescript
// decide.ts - batched LLM selection
async function decideBatch(munis: Municipality[]) {
  const candidatesByMuni = await db.query(`
    SELECT muni_id, json_group_array(json_object(
      'kind', kind,
      'title', title,
      'url', url,
      'score', score
    )) AS candidates
    FROM sources
    WHERE muni_id IN (${munis.map(m => `'${m.id}'`).join(',')})
    GROUP BY muni_id
  `);

  const llmInput = buildLLMBatch(munis, candidatesByMuni);
  const decisions = await geminiJSON('municipality_selector_v1', llmInput);

  for (const dec of decisions) {
    if (dec.decision === 'skip') {
      await db.insert('events', {
        run_id: RUN_ID,
        muni_id: dec.muni_id,
        kind: 'SKIP',
        model: 'gemini-2.5-flash',
        payload: JSON.stringify({ reason: 'no_suitable_layer', confidence: dec.confidence })
      });
      continue;
    }

    const source = await db.findOrCreateSource(dec);

    await db.insert('selections', {
      muni_id: dec.muni_id,
      source_id: source.id,
      district_field: dec.district_field,
      member_field: dec.member_field,
      at_large: dec.at_large ? 1 : 0,
      confidence: dec.confidence,
      decided_by: 'llm',
      decided_at: new Date().toISOString(),
      model: 'gemini-2.5-flash'
    });

    await db.insert('events', {
      run_id: RUN_ID,
      muni_id: dec.muni_id,
      kind: 'SELECT',
      model: 'gemini-2.5-flash',
      payload: JSON.stringify({
        source_id: source.id,
        confidence: dec.confidence
      })
    });
  }
}
```

### Ingest (Hourly Cron)

```typescript
// ingest.ts - fetch & normalize → CAS
async function ingestSelection(muni_id: string) {
  const sel = await db.getSelection(muni_id);
  if (!sel) throw new Error('No selection');

  const { data, meta } = await fetchAny(sel.source_type, sel.source_url, sel.layer_hint);
  const norm = normalize(data, sel);

  const bytes = new TextEncoder().encode(JSON.stringify(norm));
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  await putBlob(R2_BUCKET, bytes, {
    'x-muni-id': muni_id,
    'x-source-url': sel.source_url,
    'x-record-count': String(norm.features.length)
  });

  const artifactId = await db.insert('artifacts', {
    muni_id,
    content_sha256: sha,
    record_count: norm.features.length,
    etag: meta.etag,
    last_modified: meta.last_modified,
    last_edit_date: meta.lastEditDate,
    created_at: new Date().toISOString()
  });

  await db.upsert('heads', {
    muni_id,
    artifact_id: artifactId,
    updated_at: new Date().toISOString()
  });

  await db.insert('events', {
    run_id: RUN_ID,
    muni_id,
    kind: 'FETCH',
    payload: JSON.stringify({
      artifact_id: artifactId,
      content_sha256: sha,
      record_count: norm.features.length
    })
  });
}
```

### Update (Nightly Cron)

```typescript
// update.ts - metadata sweep, update only if changed
async function updateSelection(muni_id: string) {
  const sel = await db.getSelection(muni_id);
  const head = await db.getHead(muni_id);
  const oldArtifact = await db.getArtifact(head.artifact_id);

  const meta = await fetchMetadataOnly(sel.source_type, sel.source_url);

  const changed = (
    meta.etag !== oldArtifact.etag ||
    meta.last_modified !== oldArtifact.last_modified ||
    meta.lastEditDate !== oldArtifact.last_edit_date
  );

  if (changed) {
    await ingestSelection(muni_id);  // Re-fetch and store new version

    await db.insert('events', {
      run_id: RUN_ID,
      muni_id,
      kind: 'UPDATE',
      payload: JSON.stringify({
        old_sha: oldArtifact.content_sha256,
        new_sha: '...',  // from ingest
        changed: true,
        reason: 'metadata_changed'
      })
    });
  } else {
    console.log(`No change for ${muni_id}`);
  }
}
```

---

## Point-in-Polygon API

```typescript
// pip.ts - Fastify service
import Fastify from 'fastify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

const app = Fastify();

app.get('/pip', async (req, reply) => {
  const { address, muni_id } = req.query as { address: string; muni_id?: string };

  if (!address) return reply.code(400).send({ error: 'address required' });

  // Geocode
  const [lon, lat] = await geocode(address);
  const pt = point([lon, lat]);

  // Determine municipality (or use provided)
  const targetMuni = muni_id || await identifyMunicipality(address);

  // Load blob from R2
  const head = await db.getHead(targetMuni);
  const artifact = await db.getArtifact(head.artifact_id);
  const blob = await getBlob(R2_BUCKET, artifact.content_sha256);
  const fc = JSON.parse(blob);

  // Point-in-polygon
  for (const feature of fc.features) {
    if (booleanPointInPolygon(pt, feature)) {
      return reply.send({
        address,
        coordinates: [lon, lat],
        muni_id: targetMuni,
        district: feature.properties
      });
    }
  }

  return reply.code(404).send({ address, coordinates: [lon, lat], match: null });
});

app.listen({ port: 8787, host: '0.0.0.0' });
```

---

## Deployment (Cloudflare Workers + D1 + R2)

```typescript
// wrangler.toml
name = "council-boundaries"
main = "src/index.ts"
compatibility_date = "2025-11-09"

[[d1_databases]]
binding = "DB"
database_name = "council"
database_id = "..."

[[r2_buckets]]
binding = "R2"
bucket_name = "council-blobs"

[triggers]
crons = [
  "0 * * * *",   # discover (hourly)
  "15 * * * *",  # decide (hourly)
  "30 * * * *",  # ingest (hourly)
  "0 2 * * *"    # update (daily 2am)
]
```

---

## Coverage Guarantees

### Systematic Progress

```sql
-- Municipalities never attempted
SELECT COUNT(*) FROM municipalities
WHERE id NOT IN (SELECT DISTINCT muni_id FROM events);

-- Coverage by state
SELECT * FROM v_coverage ORDER BY pct_complete DESC;

-- Recent errors
SELECT * FROM v_errors;

-- LLM usage
SELECT * FROM v_llm_usage;
```

### CI Audits

```bash
# Ensure every muni has been attempted in last 90 days
npm run audit:coverage

# Ensure all FOUND_LAYER munis have valid artifacts
npm run audit:artifacts

# Check for regressions (coverage decreased)
npm run audit:regression
```

---

## Why This Unicorns

**Immutable Blobs**: Safe, CDN-cacheable, debuggable
**Event Sourcing**: Complete provenance, replayable, auditable
**Zero Git Bloat**: No CSVs/JSON in repo, just code
**Token Efficient**: 32 days to map 19k municipalities on 1k/day budget
**Scalable**: D1↔Postgres, R2↔S3 with thin adapters
**Provenance**: Every decision traceable to event + confidence score

**Cost at 1M lookups/day**:
- D1: $0.50 (first 5M reads free)
- R2: $4.50 (Class A ops + storage)
- Cloudflare Workers: $5 (first 10M requests free)
- **Total**: ~$10/month

---

## Next Steps

1. **Create Workers project** with schema + fetchers
2. **Bootstrap municipalities** from Census API (one-time)
3. **Run discovery** on 600 cities/day
4. **Deploy PIP API** for address → district lookups
5. **Integrate with Shadow Atlas** Merkle tree generation

Full implementation at `/Users/noot/Documents/voter-protocol/docs/MUNICIPAL-BOUNDARIES-ARCHITECTURE.md:1`
