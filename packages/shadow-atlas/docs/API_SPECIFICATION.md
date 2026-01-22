# Shadow Atlas REST API Specification

**Version:** 1.0.0
**Base URL:** `https://api.shadow-atlas.vote/v1`
**Philosophy:** Free forever. Kill Cicero's business model through superior developer experience.

## Design Principles

1. **Zero-cost access**: No API keys for read operations, optional keys for write-heavy usage tracking
2. **Global CDN caching**: Boundary data cached aggressively (90-day TTL), invalidated on quarterly IPFS updates
3. **Cryptographic verifiability**: Every response includes Merkle proof for trustless verification
4. **Temporal precision**: Point-in-time queries with date-specific boundary snapshots
5. **Developer-first**: OpenAPI spec, auto-generated SDKs, interactive documentation

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Core Endpoints](#core-endpoints)
  - [District Lookup](#district-lookup)
  - [Batch Lookup](#batch-lookup)
  - [Portal Metadata](#portal-metadata)
  - [Boundary Download](#boundary-download)
  - [Provenance Trail](#provenance-trail)
  - [Snapshot Management](#snapshot-management)
- [Spatial Queries](#spatial-queries)
- [Response Formats](#response-formats)
- [Error Handling](#error-handling)
- [Webhooks](#webhooks)
- [SDK Examples](#sdk-examples)

---

## Authentication

**Public Access (Recommended):**
- Read operations: No authentication required
- Rate limit: 1000 requests/hour per IP
- Sufficient for 99% of use cases

**API Key (Optional):**
- Higher rate limits (100,000 requests/hour)
- Usage analytics dashboard
- Webhook subscriptions for data updates
- Free registration: `POST /v1/auth/register`

**Header:**
```http
Authorization: Bearer <api_key>
```

---

## Rate Limiting

**Response Headers:**
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1737324000
X-RateLimit-Retry-After: 3600
```

**Status Codes:**
- `200 OK`: Request successful
- `429 Too Many Requests`: Rate limit exceeded (includes `Retry-After` header)

**Strategies:**
- Use `If-None-Match` with ETags to avoid redundant data transfer
- Batch coordinates (up to 1000) in single request via `/v1/districts/batch`
- Download full datasets once via `/v1/boundaries/download` instead of repeated point queries

---

## Core Endpoints

### District Lookup

**Endpoint:** `GET /v1/districts/lookup`

**Description:** Resolve geographic coordinates to all governing districts (council, county, congressional, state legislative).

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `lat` | number | Yes | - | Latitude (WGS84, -90 to 90) |
| `lon` | number | Yes | - | Longitude (WGS84, -180 to 180) |
| `levels` | string | No | `all` | Comma-separated: `council,county,congressional,state_upper,state_lower` |
| `date` | string | No | latest | ISO 8601 date for historical boundaries (e.g., `2024-11-05` for Election Day) |
| `include_geometry` | boolean | No | `false` | Include full GeoJSON polygons in response |
| `include_proof` | boolean | No | `true` | Include Merkle proof for verification |
| `format` | string | No | `json` | Response format: `json`, `geojson` |

**Example Request:**
```http
GET /v1/districts/lookup?lat=37.7749&lon=-122.4194&levels=council&include_geometry=true
```

**Example Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "coordinates": {
      "lat": 37.7749,
      "lon": -122.4194
    },
    "timestamp": "2026-01-18T12:34:56Z",
    "districts": [
      {
        "id": "0667000-D5",
        "name": "District 5",
        "jurisdiction": "San Francisco",
        "level": "council",
        "district_type": "supervisor_district",
        "fips": "0667000",
        "state": "CA",
        "country": "USA",
        "representative": {
          "name": "Dean Preston",
          "party": "Democratic",
          "office": "Board of Supervisors",
          "contact": {
            "email": "dean.preston@sfgov.org",
            "phone": "(415) 554-7450",
            "address": "City Hall, Room 244, 1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102"
          }
        },
        "geometry": {
          "type": "Polygon",
          "coordinates": [
            [
              [-122.4194, 37.7749],
              [-122.4195, 37.7750],
              [-122.4194, 37.7749]
            ]
          ]
        },
        "provenance": {
          "source": "https://data.sfgov.org/Geographic-Locations-and-Boundaries/Supervisor-Districts/8nkz-x4ny",
          "authority": "municipal",
          "timestamp": 1705584000000,
          "method": "ArcGIS REST API",
          "responseHash": "sha256:a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
          "effectiveDate": "2022-04-01",
          "license": "Public Domain"
        },
        "boundaries": {
          "effectiveDate": "2022-04-01",
          "expirationDate": null,
          "redistrictingCycle": "2020-Census"
        }
      }
    ],
    "merkle_proof": {
      "root": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      "leaf": "0x9f8e7d6c5b4a3928170695a4b3c2d1e0f9e8d7c6b5a4938271606958473625140",
      "path": [
        {
          "position": "left",
          "hash": "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c"
        },
        {
          "position": "right",
          "hash": "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d"
        }
      ],
      "depth": 14,
      "index": 42
    },
    "snapshot": {
      "cid": "bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8",
      "version": "2026-Q1",
      "timestamp": "2026-01-15T00:00:00Z",
      "district_count": 51234
    }
  },
  "cache": {
    "hit": true,
    "age_seconds": 120,
    "max_age_seconds": 7776000
  },
  "latency_ms": 12
}
```

**Error Response (404 Not Found):**
```json
{
  "status": "error",
  "error": {
    "code": "DISTRICT_NOT_FOUND",
    "message": "No council districts found at coordinates (37.7749, -122.4194). This location may be in an unincorporated area or at-large jurisdiction.",
    "details": {
      "lat": 37.7749,
      "lon": -122.4194,
      "searched_levels": ["council"],
      "nearby_jurisdictions": [
        {
          "name": "San Francisco",
          "fips": "0667000",
          "distance_meters": 45.2
        }
      ]
    },
    "timestamp": "2026-01-18T12:34:56Z",
    "request_id": "req_7x8y9z0a1b2c3d4e5f"
  }
}
```

---

### Batch Lookup

**Endpoint:** `POST /v1/districts/batch`

**Description:** Lookup districts for multiple coordinates in single request (up to 1000 points).

**Request Body:**
```json
{
  "coordinates": [
    { "lat": 37.7749, "lon": -122.4194 },
    { "lat": 40.7128, "lon": -74.0060 },
    { "lat": 41.8781, "lon": -87.6298 }
  ],
  "levels": ["council"],
  "date": "2024-11-05",
  "include_geometry": false,
  "include_proof": false
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "coordinates": { "lat": 37.7749, "lon": -122.4194 },
        "districts": [
          {
            "id": "0667000-D5",
            "name": "District 5",
            "jurisdiction": "San Francisco",
            "level": "council"
          }
        ]
      },
      {
        "coordinates": { "lat": 40.7128, "lon": -74.0060 },
        "districts": [
          {
            "id": "3651000-D1",
            "name": "District 1",
            "jurisdiction": "New York City",
            "level": "council"
          }
        ]
      },
      {
        "coordinates": { "lat": 41.8781, "lon": -87.6298 },
        "districts": [
          {
            "id": "1714000-W42",
            "name": "Ward 42",
            "jurisdiction": "Chicago",
            "level": "council"
          }
        ]
      }
    ],
    "snapshot": {
      "cid": "bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8",
      "version": "2026-Q1",
      "timestamp": "2026-01-15T00:00:00Z"
    }
  },
  "latency_ms": 87
}
```

---

### Portal Metadata

**Endpoint:** `GET /v1/portals/{fips}`

**Description:** Retrieve GIS data source metadata for a jurisdiction.

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fips` | string | Yes | 7-digit Census PLACE FIPS code (e.g., `0667000` for San Francisco) |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `include_discovery` | boolean | No | `false` | Include full discovery scan history |

**Example Request:**
```http
GET /v1/portals/0667000
```

**Example Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "fips": "0667000",
    "jurisdiction": {
      "name": "San Francisco",
      "state": "CA",
      "state_fips": "06",
      "country": "USA",
      "population": 873965,
      "governance_type": "district-based"
    },
    "council_districts": {
      "expected_count": 11,
      "actual_count": 11,
      "district_type": "supervisor_district",
      "last_redistricting": "2022-04-01",
      "next_redistricting": "2032-04-01"
    },
    "gis_portals": [
      {
        "url": "https://data.sfgov.org/Geographic-Locations-and-Boundaries/Supervisor-Districts/8nkz-x4ny",
        "provider": "Socrata",
        "authority": "municipal",
        "format": "GeoJSON",
        "last_updated": "2022-04-15T00:00:00Z",
        "feature_count": 11,
        "geometry_type": "MultiPolygon",
        "coordinate_system": "EPSG:4326",
        "license": "Public Domain",
        "confidence": 100
      }
    ],
    "provenance": {
      "discovered_at": "2025-11-19T00:00:00Z",
      "last_verified": "2026-01-15T00:00:00Z",
      "validation_status": "verified",
      "issues": [],
      "warnings": []
    }
  }
}
```

---

### Boundary Download

**Endpoint:** `GET /v1/boundaries/download`

**Description:** Download complete boundary dataset in multiple formats.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `level` | string | Yes | - | District level: `council`, `county`, `congressional`, `state_upper`, `state_lower` |
| `state` | string | No | - | Filter by 2-letter state code (e.g., `CA`) |
| `country` | string | No | `USA` | Filter by ISO 3166-1 alpha-3 country code |
| `fips` | string | No | - | Filter by specific FIPS code |
| `format` | string | No | `geojson` | Output format: `geojson`, `topojson`, `shapefile`, `kml`, `csv` |
| `date` | string | No | latest | ISO 8601 date for historical boundaries |
| `compression` | string | No | `gzip` | Compression: `gzip`, `zip`, `none` |

**Example Request:**
```http
GET /v1/boundaries/download?level=council&state=CA&format=geojson&compression=gzip
```

**Response (200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/geo+json
Content-Encoding: gzip
Content-Disposition: attachment; filename="california-council-districts-2026-Q1.geojson.gz"
ETag: "sha256:abc123def456..."
Last-Modified: Wed, 15 Jan 2026 00:00:00 GMT
X-Shadow-Atlas-Version: 2026-Q1
X-Shadow-Atlas-CID: bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8
X-Shadow-Atlas-District-Count: 487
X-Shadow-Atlas-Merkle-Root: 0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b

<gzipped GeoJSON FeatureCollection>
```

**GeoJSON Structure:**
```json
{
  "type": "FeatureCollection",
  "metadata": {
    "title": "California Council Districts - 2026 Q1",
    "description": "Municipal council district boundaries for California cities",
    "level": "council",
    "state": "CA",
    "country": "USA",
    "version": "2026-Q1",
    "snapshot_date": "2026-01-15",
    "district_count": 487,
    "cid": "bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8",
    "merkle_root": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "license": "CC0-1.0 (Public Domain Dedication)",
    "attribution": "Shadow Atlas - Free Municipal Boundary Data"
  },
  "features": [
    {
      "type": "Feature",
      "id": "0667000-D1",
      "properties": {
        "district_id": "0667000-D1",
        "district_name": "District 1",
        "district_number": 1,
        "jurisdiction": "San Francisco",
        "fips": "0667000",
        "state": "CA",
        "state_fips": "06",
        "country": "USA",
        "district_type": "supervisor_district",
        "representative": {
          "name": "Connie Chan",
          "party": "Democratic",
          "elected": "2020-11-03",
          "term_expires": "2028-01-08"
        },
        "population": 79451,
        "area_sq_km": 17.2,
        "effective_date": "2022-04-01",
        "provenance": {
          "source": "https://data.sfgov.org/Geographic-Locations-and-Boundaries/Supervisor-Districts/8nkz-x4ny",
          "authority": "municipal",
          "timestamp": 1705584000000,
          "responseHash": "sha256:a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
        }
      },
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [
          [
            [
              [-122.4194, 37.7749],
              [-122.4195, 37.7750],
              [-122.4194, 37.7749]
            ]
          ]
        ]
      }
    }
  ]
}
```

---

### Provenance Trail

**Endpoint:** `GET /v1/provenance/{district_id}`

**Description:** Full audit trail for a district boundary (all historical versions, data sources, validation results).

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `district_id` | string | Yes | Unique district identifier (e.g., `0667000-D5`) |

**Example Request:**
```http
GET /v1/provenance/0667000-D5
```

**Example Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "district_id": "0667000-D5",
    "current_version": {
      "effective_date": "2022-04-01",
      "source": "https://data.sfgov.org/Geographic-Locations-and-Boundaries/Supervisor-Districts/8nkz-x4ny",
      "authority": "municipal",
      "acquired_at": "2025-11-19T12:34:56Z",
      "response_hash": "sha256:a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
      "http_status": 200,
      "feature_count": 1,
      "geometry_type": "MultiPolygon",
      "coordinate_system": "EPSG:4326",
      "validation": {
        "confidence": 100,
        "issues": [],
        "warnings": [],
        "checks": [
          {
            "name": "feature_count_match",
            "status": "passed",
            "expected": 11,
            "actual": 11
          },
          {
            "name": "geometry_validity",
            "status": "passed",
            "message": "All geometries valid (no self-intersections, proper winding)"
          },
          {
            "name": "complete_tessellation",
            "status": "passed",
            "coverage": 99.98,
            "gaps": [],
            "overlaps": []
          }
        ]
      }
    },
    "history": [
      {
        "effective_date": "2012-04-01",
        "source": "https://data.sfgov.org/api/geospatial/8nkz-x4ny?method=export&format=Shapefile",
        "authority": "municipal",
        "acquired_at": "2013-01-15T00:00:00Z",
        "response_hash": "sha256:b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
        "expired_at": "2022-04-01",
        "redistricting_cycle": "2010-Census"
      },
      {
        "effective_date": "2002-04-01",
        "source": "https://sfgis.org/ftp/GISData/sfdata/shape/poldistrict.zip",
        "authority": "municipal",
        "acquired_at": "2003-05-10T00:00:00Z",
        "response_hash": "sha256:c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        "expired_at": "2012-04-01",
        "redistricting_cycle": "2000-Census"
      }
    ],
    "legal_basis": [
      {
        "type": "municipal_ordinance",
        "reference": "San Francisco Charter Section 13.110",
        "url": "https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_charter/0-0-0-742",
        "effective_date": "2022-04-01"
      }
    ],
    "changes": [
      {
        "date": "2022-04-01",
        "type": "redistricting",
        "trigger": "2020 Census",
        "description": "District 5 boundaries adjusted for population balance (deviation within ±1%)"
      }
    ]
  }
}
```

---

### Snapshot Management

**Endpoint:** `GET /v1/snapshots`

**Description:** List available quarterly snapshots with IPFS CIDs and Merkle roots.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 10 | Number of snapshots to return (max 100) |
| `offset` | integer | No | 0 | Pagination offset |

**Example Request:**
```http
GET /v1/snapshots?limit=5
```

**Example Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "snapshots": [
      {
        "version": "2026-Q1",
        "cid": "bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8",
        "merkle_root": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
        "timestamp": "2026-01-15T00:00:00Z",
        "district_count": 51234,
        "coverage": {
          "countries": 1,
          "states": 50,
          "cities": 487,
          "districts": 51234
        },
        "ipfs_gateway": "https://ipfs.io/ipfs/bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8"
      },
      {
        "version": "2025-Q4",
        "cid": "bafybeic8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
        "merkle_root": "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c",
        "timestamp": "2025-10-01T00:00:00Z",
        "district_count": 51187,
        "coverage": {
          "countries": 1,
          "states": 50,
          "cities": 485,
          "districts": 51187
        },
        "ipfs_gateway": "https://ipfs.io/ipfs/bafybeic8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"
      }
    ],
    "pagination": {
      "total": 12,
      "limit": 5,
      "offset": 0,
      "has_more": true
    }
  }
}
```

---

## Spatial Queries

### Bounding Box Query

**Endpoint:** `GET /v1/districts/bbox`

**Description:** Find all districts intersecting a bounding box.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `min_lat` | number | Yes | Minimum latitude |
| `min_lon` | number | Yes | Minimum longitude |
| `max_lat` | number | Yes | Maximum latitude |
| `max_lon` | number | Yes | Maximum longitude |
| `levels` | string | No | District levels (comma-separated) |
| `include_geometry` | boolean | No | Include full GeoJSON |

**Example Request:**
```http
GET /v1/districts/bbox?min_lat=37.7&min_lon=-122.5&max_lat=37.8&max_lon=-122.3&levels=council
```

---

### Radius Query

**Endpoint:** `GET /v1/districts/radius`

**Description:** Find all districts within radius of a point.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lat` | number | Yes | Center latitude |
| `lon` | number | Yes | Center longitude |
| `radius_km` | number | Yes | Radius in kilometers (max 100) |
| `levels` | string | No | District levels |

**Example Request:**
```http
GET /v1/districts/radius?lat=37.7749&lon=-122.4194&radius_km=5&levels=council
```

---

## Response Formats

### Standard JSON Response Envelope

All responses follow this structure:

```json
{
  "status": "success" | "error",
  "data": { ... },           // Present on success
  "error": { ... },          // Present on error
  "cache": {                 // Cache metadata
    "hit": true,
    "age_seconds": 120,
    "max_age_seconds": 7776000
  },
  "latency_ms": 12
}
```

### Conditional Requests (Caching)

**Client sends:**
```http
GET /v1/districts/lookup?lat=37.7749&lon=-122.4194
If-None-Match: "sha256:abc123..."
```

**Server responds (304 Not Modified):**
```http
HTTP/1.1 304 Not Modified
ETag: "sha256:abc123..."
Cache-Control: public, max-age=7776000, immutable
```

**Benefits:**
- Zero data transfer on cache hits
- 90-day CDN caching for boundary data
- ETags based on SHA-256 of response content

---

## Error Handling

### Error Response Structure

```json
{
  "status": "error",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "details": {
      // Context-specific error details
    },
    "timestamp": "2026-01-18T12:34:56Z",
    "request_id": "req_7x8y9z0a1b2c3d4e5f",
    "documentation_url": "https://docs.shadow-atlas.vote/errors/ERROR_CODE"
  }
}
```

### Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `INVALID_COORDINATES` | Coordinates out of range or malformed |
| 400 | `INVALID_PARAMETERS` | Missing or invalid query parameters |
| 400 | `INVALID_DATE` | Date format invalid or out of supported range |
| 404 | `DISTRICT_NOT_FOUND` | No districts found at coordinates |
| 404 | `PORTAL_NOT_FOUND` | FIPS code not in registry |
| 404 | `SNAPSHOT_NOT_FOUND` | Requested snapshot version unavailable |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests (see `Retry-After` header) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Temporary service disruption |

---

## Webhooks

**Purpose:** Real-time notifications when boundary data updates (quarterly IPFS snapshots).

### Register Webhook

**Endpoint:** `POST /v1/webhooks`

**Request Body:**
```json
{
  "url": "https://your-app.com/webhooks/shadow-atlas",
  "events": [
    "snapshot.created",
    "boundaries.updated",
    "portal.discovered"
  ],
  "filters": {
    "states": ["CA", "NY", "TX"],
    "fips": ["0667000"]
  },
  "secret": "whsec_your_webhook_secret"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "webhook_id": "wh_abc123def456",
    "url": "https://your-app.com/webhooks/shadow-atlas",
    "events": ["snapshot.created", "boundaries.updated", "portal.discovered"],
    "active": true,
    "created_at": "2026-01-18T12:34:56Z"
  }
}
```

### Webhook Event: `snapshot.created`

**Payload:**
```json
{
  "event": "snapshot.created",
  "timestamp": "2026-01-15T00:00:00Z",
  "data": {
    "version": "2026-Q1",
    "cid": "bafybeibz7qxj2z4k5y3x6w8v9u0t1s2r3q4p5o6n7m8l9k0j1i2h3g4f5e6d7c8",
    "merkle_root": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "district_count": 51234,
    "changes": {
      "added": 47,
      "updated": 12,
      "removed": 0
    }
  }
}
```

**Verification:**
- Webhook requests include `X-Shadow-Atlas-Signature` header
- HMAC-SHA256 of payload using webhook secret
- Verify signature before processing

---

## SDK Examples

### TypeScript/JavaScript

```typescript
import { ShadowAtlas } from '@shadow-atlas/client';

const client = new ShadowAtlas({
  apiKey: 'optional_api_key', // Omit for public access
  cache: true,
  timeout: 5000,
});

// District lookup
const result = await client.districts.lookup({
  lat: 37.7749,
  lon: -122.4194,
  levels: ['council'],
  includeGeometry: true,
});

console.log(result.districts[0].name); // "District 5"
console.log(result.districts[0].representative.name); // "Dean Preston"

// Batch lookup
const batch = await client.districts.batch({
  coordinates: [
    { lat: 37.7749, lon: -122.4194 },
    { lat: 40.7128, lon: -74.0060 },
  ],
  levels: ['council'],
});

// Download boundaries
const stream = await client.boundaries.download({
  level: 'council',
  state: 'CA',
  format: 'geojson',
  compression: 'gzip',
});

// Verify Merkle proof
const isValid = await client.verify.proof({
  leaf: result.merkleProof.leaf,
  path: result.merkleProof.path,
  root: result.merkleProof.root,
});
```

### Python

```python
from shadow_atlas import Client

client = Client(api_key="optional_api_key")

# District lookup
result = client.districts.lookup(
    lat=37.7749,
    lon=-122.4194,
    levels=["council"],
    include_geometry=True
)

print(result.districts[0].name)  # "District 5"
print(result.districts[0].representative.name)  # "Dean Preston"

# Batch lookup
batch = client.districts.batch([
    {"lat": 37.7749, "lon": -122.4194},
    {"lat": 40.7128, "lon": -74.0060},
], levels=["council"])

# Download boundaries
with client.boundaries.download(
    level="council",
    state="CA",
    format="geojson",
    compression="gzip"
) as f:
    boundaries = f.read()
```

### Rust

```rust
use shadow_atlas::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new("optional_api_key")?;

    let result = client
        .districts()
        .lookup(37.7749, -122.4194)
        .levels(&["council"])
        .include_geometry(true)
        .send()
        .await?;

    println!("{}", result.districts[0].name); // "District 5"

    Ok(())
}
```

### cURL

```bash
# District lookup
curl "https://api.shadow-atlas.vote/v1/districts/lookup?lat=37.7749&lon=-122.4194&levels=council"

# Download boundaries
curl -o ca-council.geojson.gz \
  "https://api.shadow-atlas.vote/v1/boundaries/download?level=council&state=CA&format=geojson&compression=gzip"

# Batch lookup
curl -X POST https://api.shadow-atlas.vote/v1/districts/batch \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": [
      {"lat": 37.7749, "lon": -122.4194},
      {"lat": 40.7128, "lon": -74.0060}
    ],
    "levels": ["council"]
  }'
```

---

## OpenAPI 3.0 Specification

Complete machine-readable spec available at:
- **JSON:** `https://api.shadow-atlas.vote/openapi.json`
- **YAML:** `https://api.shadow-atlas.vote/openapi.yaml`
- **Interactive Docs:** `https://docs.shadow-atlas.vote`

**Auto-generated SDKs:**
- TypeScript/JavaScript: `npm install @shadow-atlas/client`
- Python: `pip install shadow-atlas`
- Rust: `cargo add shadow-atlas`
- Go: `go get github.com/shadow-atlas/go-client`
- Ruby: `gem install shadow_atlas`
- Java: `implementation 'vote.shadow-atlas:client:1.0.0'`

---

## Competitive Advantages Over Cicero

| Feature | Shadow Atlas | Cicero |
|---------|-------------|--------|
| **Cost** | Free forever | Pay-per-call |
| **Rate Limits** | 1000 req/hr (public), 100k/hr (keyed) | ~500 req/day (paid tiers) |
| **Data Freshness** | Quarterly IPFS snapshots | Unknown update schedule |
| **Verifiability** | Merkle proofs on every response | No cryptographic verification |
| **Historical Data** | Point-in-time queries (any date) | Current data only |
| **Bulk Download** | Free GeoJSON/Shapefile/TopoJSON | Not offered |
| **Representative Info** | Included in district response | Separate API calls |
| **Provenance Trail** | Full audit history per district | Opaque data sources |
| **SDKs** | TypeScript, Python, Rust, Go, Ruby, Java | Limited |
| **Webhooks** | Real-time update notifications | Not offered |
| **License** | CC0-1.0 (Public Domain) | Proprietary |
| **CDN Caching** | 90-day immutable boundaries | No public caching policy |

---

## Production Deployment

**Infrastructure:**
- **CDN:** Cloudflare (global edge caching, DDoS protection)
- **Database:** PostgreSQL + PostGIS (spatial indexing)
- **Cache:** Redis (in-memory district lookups)
- **Storage:** IPFS (quarterly snapshots, content-addressed)
- **Compute:** Kubernetes (auto-scaling API servers)

**Performance Targets:**
- **P50 latency:** <50ms (cached), <200ms (uncached)
- **P99 latency:** <500ms
- **Availability:** 99.9% uptime SLA
- **Throughput:** 10,000 req/sec sustained

**Cost Efficiency:**
- CDN cache hit rate: >95% (90-day immutable boundaries)
- Database queries: <5% of total requests
- Monthly infrastructure: ~$500 at 100M requests/month
- **Zero API call charges to users**

---

## Migration Guide from Cicero

**Step 1:** Replace endpoint
```diff
- https://cicero.azavea.com/v3.1/legislative_district?lat=37.7749&lon=-122.4194
+ https://api.shadow-atlas.vote/v1/districts/lookup?lat=37.7749&lon=-122.4194&levels=council
```

**Step 2:** Update response parsing
```typescript
// Cicero format (deprecated)
const district = response.response.results.officials[0].district;

// Shadow Atlas format (new)
const district = response.data.districts[0];
```

**Step 3:** Add Merkle proof verification (optional, for trustless data)
```typescript
import { verifyMerkleProof } from '@shadow-atlas/client';

const isValid = verifyMerkleProof(
  response.data.merkle_proof,
  response.data.snapshot.merkle_root
);
```

**Step 4:** Remove API key billing logic (Shadow Atlas is free)

---

## License

Shadow Atlas API responses are released under **CC0-1.0 (Public Domain Dedication)**.

- No attribution required (though appreciated)
- Commercial use permitted
- Modify and redistribute freely
- Zero licensing fees, forever

**Source data provenance:**
- Municipal boundaries: Public domain (government works)
- Census boundaries: Public domain (federal data)
- International boundaries: Varies by source (see `/v1/provenance` endpoint)

---

## Support

- **Documentation:** https://docs.shadow-atlas.vote
- **API Status:** https://status.shadow-atlas.vote
- **GitHub:** https://github.com/voter-protocol/shadow-atlas
- **Discord:** https://discord.gg/shadow-atlas
- **Email:** api@shadow-atlas.vote

---

**Built to kill Cicero's business model. Free forever. Cryptographically verifiable. Developer-first.**
