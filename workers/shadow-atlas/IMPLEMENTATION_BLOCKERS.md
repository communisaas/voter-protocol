# Shadow Atlas Implementation Blockers

**Last Updated:** 2025-11-12

This document tracks active blockers preventing state authority ingestion and provides clear resolution paths for each.

---

## Active Blockers

### 🔴 BLOCKER-001: Virginia NG911 Fire/EMS Boundaries — Credentials Required

**Status:** BLOCKED
**Priority:** HIGH (3.2% US population, 8.6M residents)
**Blocking Since:** 2025-11-12
**Owner:** TBD

#### Problem Statement

Virginia does not publish a statewide fire/EMS boundary dataset publicly. Fire district boundaries are:
- Maintained locally by 130+ counties/cities
- Aggregated by VGIN for NG911 program
- **Accessible only via authenticated VGIN NG911 services**

**Research Completed:**
- ✅ No public statewide dataset on VGIN Clearinghouse
- ✅ County-level data exists but fragmented:
  - Albemarle County: Fire Station Response Areas (shapefile, 403 blocking automated access)
  - Fairfax County: FRD Battalion boundaries (MapServer, "Agency Use Only")
  - ~130 total jurisdictions, each requiring individual portal access
- ✅ VGIN NG911 services confirmed to contain fire/EMS boundaries per NENA standard
- ✅ HIFLD has fire stations only, not district boundaries

#### Resolution Path

**Option 1: VGIN NG911 Access (RECOMMENDED)**

**Action:** Request access to VGIN NG911 aggregated fire/EMS service boundaries

**Contact:**
- **Email:** vbmp@vdem.virginia.gov (VGIN staff)
- **Organization:** Virginia Geographic Information Network (VGIN)
- **Department:** Virginia Department of Emergency Management (VDEM)

**What to Request:**
```
Subject: Access Request - NG911 Fire/EMS Service Boundaries for Civic Infrastructure

Hi VGIN Team,

We're building Shadow Atlas, a civic infrastructure project that provides
granular boundary discovery for democratic participation (open source:
https://github.com/voter-protocol/shadow-atlas).

We're requesting access to the statewide aggregated fire and EMS service
boundaries maintained under the Virginia NG911 program. We understand these
are compiled from local jurisdictions per NENA NG911 GIS Data Model standards.

Use case: Enable residents to identify their fire/EMS service district for
civic engagement purposes (contacting their service provider, understanding
jurisdictional boundaries).

Technical requirements:
- ArcGIS FeatureServer or shapefile access
- Statewide coverage (all 130+ jurisdictions aggregated)
- Updated quarterly or as available

We're happy to sign any required data sharing agreements or MOUs. Our
platform is non-commercial civic infrastructure.

Thank you,
[Name]
Shadow Atlas / VOTER Protocol
```

**Expected Timeline:** 2-4 weeks (credential approval process)

**Alternate Contact:** https://vgin.vdem.virginia.gov/pages/co-vgin

---

**Option 2: County-by-County Aggregation (FALLBACK)**

**Effort:** High (~40-80 hours)
**Risk:** Moderate (data access varies by jurisdiction, incomplete coverage likely)

**Approach:**
1. Prioritize high-population counties first:
   - Fairfax (1.15M) — "Agency Use Only", likely requires credentials
   - Virginia Beach (459K) — investigate open data portal
   - Chesapeake (249K) — investigate open data portal
   - Arlington (238K) — investigate open data portal
   - Norfolk (238K) — investigate open data portal
2. Build individual county adapters for those with public access
3. Accept incomplete coverage, document gaps

**Known Counties with Fire District Data:**
- ✅ Albemarle: Fire Station Response Areas (website access restricted)
- ✅ Fairfax: FRD Battalion (authentication required)
- ✅ Fluvanna: Fire & Rescue boundaries (format TBD)
- ✅ Accomack: Fire/EMS service areas (ESRI shapefile)

**Not Recommended:** High effort, uncertain outcome, incomplete coverage.

---

**Option 3: Maintain NIFC Baseline (CURRENT STATE)**

**Status:** Live (score 88, federal baseline)
**Coverage:** Statewide via NIFC Jurisdictional Units
**Trade-off:** Lower fidelity than state/local sources

Keep NIFC as fallback until credentials obtained.

---

#### Next Actions

- [ ] Send credential request email to vbmp@vdem.virginia.gov
- [ ] Document response timeline and requirements
- [ ] If approved: Build Virginia NG911 adapter (mirror Utah pattern)
- [ ] If denied: Evaluate county-by-county feasibility for top 10 counties

#### Related Documents
- Implementation Plan: `SPECIAL_DISTRICTS_IMPLEMENTATION_PLAN.md` (line 270)
- Implementation Status: `IMPLEMENTATION_STATUS.md` (line 42)
- Registry Entry: `data/special-districts/registry.json` (Virginia authority)

---

## Resolved Blockers

### ✅ RESOLVED-001: Utah Fire Response Areas — Network Access

**Resolved:** 2025-11-12
**Issue:** Sandbox DNS blocked services1.arcgis.com
**Solution:** Ran `npm run ingest:authority -- --state=UT --dataset=fire` from environment with network access
**Result:** 231 fire response areas ingested successfully (17MB GeoJSON, registry live)

---

## Blocker Severity Levels

- 🔴 **HIGH**: Blocks >1M population, urgent resolution needed
- 🟡 **MEDIUM**: Blocks 250K-1M population, resolve when feasible
- 🟢 **LOW**: Blocks <250K population, defer to future sprints

---

## Review Cadence

- **Daily:** Check for responses to outreach emails
- **Weekly:** Review active blockers, update status and next actions
- **Monthly:** Reassess priority and resolution paths

---

**Last Review:** 2025-11-12
**Next Review:** 2025-11-19

---

### 🟡 BLOCKER-002: Kansas Public Water Supply System Boundaries — Geometry Suppressed

**Status:** BLOCKED  
**Priority:** MEDIUM (0.9% US population, 2.9M residents)  
**Blocking Since:** 2025-11-13  
**Owner:** TBD

#### Problem Statement
- The statewide “Public Water Supply System (DASC 2023)” layer published by Douglas County GIS / Kansas Water Office only exposes attributes (utility names) when queried anonymously; geometry is omitted even with `returnGeometry=true`, so the ingestion pipeline writes zero features.  
- DASC confirms the service is hosted at `https://gis.dgcoks.gov/server/rest/services/Utilities/MapServer/23`, but the ArcGIS server is configured to suppress geometry for public requests, requiring direct shapefile delivery or authenticated access for the polygons.citeturn0search0

#### Resolution Path
1. **Request dataset package from DASC/Kansas Water Office**
   - Email: `dasc@ku.edu` (Data Access & Support Center) and `kwo@kwo.ks.gov`
   - Ask for the statewide Public Water Supply System boundaries (RWD/Municipal/PWWS districts) as zipped shapefile or FeatureServer credentials.
   - Clarify that Shadow Atlas only needs read-only access for civic transparency; we can accept quarterly refreshes.
2. **Alternate:** Coordinate with Kansas Rural Water Association (KRWA) to obtain the same dataset they compiled for DASC (2004-2006 updates). KRWA staff can share current service-area updates on request.
3. **If access granted:** Add ingestor `kansas-public-water-supply-system`, wire registry path `data/special-districts/ks/water.geojson`, rerun audits/tests, flip Kansas water column to `authority_live`.

#### Notes
- No public substitute exists; EPA CWS polygons remain the temporary baseline for Kansas water districts until geometry access is resolved.
- Blocker severity is medium because transit + fire already have authority sources; remaining gap only affects water/utility metadata for Kansas.

---

### 🟡 BLOCKER-003: DC Retail Water Service Areas — Download Forbidden

**Status:** BLOCKED  
**Priority:** MEDIUM (0.2% US population)  
**Blocking Since:** 2025-11-13  
**Owner:** TBD

#### Problem Statement
- The District publishes “Retail Water Service Areas” on Open Data DC, but Hub/API requests to `https://opendata.arcgis.com/datasets/DCGISopendata::retail-water-service-areas` and the underlying ArcGIS dataset return HTTP 403 “Forbidden,” which prevents automated ingestion (no datasetId exposed in the page source, and the Hub API refuses dataset lookups by slug).  
- Without a downloadable GeoJSON/FeatureServer endpoint, we remain stuck on the EPA baseline for DC’s water column even though an authoritative dataset exists.

#### Resolution Path
1. Contact OCTO/Open Data DC (opendata@dc.gov) and DC Water to request either:
   - Direct FeatureServer URL (with anonymous access) for the Retail Water Service Areas layer, or
   - Static GeoJSON/shapefile package updated alongside the portal.
2. If access requires credentials, request a service account or signed data-sharing agreement similar to NG911 feeds; document login flow so the ingestion CLI can use a token header.

#### Notes
- We confirmed the dataset landing page exists (`https://opendata.dc.gov/datasets/DCGISopendata::retail-water-service-areas/about`), but every attempt to fetch JSON via ArcGIS Hub API returns 403.  
- Once access is granted, add a `dc-water` ingestor mirroring the Delaware/Utah pattern, update the registry row, and rerun the coverage tracker so DC water switches to `authority_live`.

### 🟡 BLOCKER-004: Florida TDSP Transit Boundaries — FGDL Download Redirects

**Status:** BLOCKED  
**Priority:** MEDIUM (statewide transit coverage)  
**Blocking Since:** 2025-11-13  
**Owner:** TBD

#### Problem Statement
- The Florida Geographic Data Library (FGDL) advertises the statewide Transportation Disadvantaged Service Provider dataset (`tdsp_aug17.zip`), but the official download endpoint now returns a 308 redirect to `https://fgdl.org/`, so no shapefile or FeatureServer can be retrieved for ingestion.citeturn0search1
- Without those polygons, Florida’s transit column must remain on the NTAD baseline even though an authoritative source covering every CTD project area exists.

#### Resolution Path
1. Email GeoPlan/FGDL support (support@geoplan.ufl.edu) with the failing URL and request a working ZIP link or REST endpoint for TDSP_AUG17.
2. If FGDL can’t restore the download promptly, ask the Florida Commission for the Transportation Disadvantaged (CTD) / FDOT for a direct dataset export so we can ingest it while hosting issues are resolved.
3. Once access is available, add a `florida-tdsp-transit` ingestor, regenerate `data/special-districts/fl/transit.geojson`, rerun audits/tests, and flip Florida’s transit status to `authority_live`.

#### Notes
- No alternative statewide dataset provides CTD boundaries, so NTAD remains the fallback until FGDL or CTD provides the TDSP geometries.

### 🟡 BLOCKER-005: Rhode Island statewide fire districts — RI E-911 credentials required

**Status:** BLOCKED  
**Priority:** MEDIUM (1.1% US population)  
**Blocking Since:** 2025-11-14  
**Owner:** Rhode Island special-district sweep

#### Problem Statement
- Rhode Island Enhanced 9-1-1 (RI E-911) captures statewide GIS layers (structures, hydrants, jurisdictional boundaries) for its NG911 console, but those services are internal-only; no anonymous FeatureServer or download endpoint exists for fire districts.citeturn1search0
- Without E-911 credentials, Rhode Island’s fire column must remain on the NIFC baseline even though a higher-fidelity dataset exists.

#### Resolution Path
1. Request NG911 GIS access from RI E-911 / RI Department of Public Safety (311 Danielson Pike, North Scituate, RI 02857; 401-459-0911).citeturn2search0
2. Provide Shadow Atlas project overview, civic use case, and data-handling controls; sign any required MOUs or APRA agreements.
3. Once credentials arrive, build `rhode-island-fire-districts` ingestor mirroring other NG911 adapters, update registry/docs/tests, and rerun coverage report.

#### Next Actions
- [ ] Draft credential request email + phone script; contact RI E-911 GIS lead.  
- [ ] Track follow-ups weekly until access is granted or denied.  
- [ ] Document granted/denied decision here and in `docs/SPECIAL-DISTRICT-COVERAGE.md`.

### 🟡 BLOCKER-006: Connecticut statewide fire districts — DESPP / DSET NG911 credentials

**Status:** BLOCKED  
**Priority:** MEDIUM (3.6M residents)  
**Blocking Since:** 2025-11-14  
**Owner:** Connecticut special-district sweep

#### Problem Statement
- The Division of Statewide Emergency Telecommunications (DSET) inside Connecticut DESPP operates the NG911 GIS program that maintains statewide emergency response boundaries, but their data portal requires direct coordination—no anonymous FeatureServer is exposed.citeturn13view0
- Without DSET credentials, Connecticut’s fire column remains stuck on the NIFC baseline even though DESPP already aggregates those polygons for PSAP routing.

#### Resolution Path
1. Request NG911 GIS access from DSET (despp.dset@ct.gov / 860-685-8155) citing Shadow Atlas’ civic mission and data-handling controls.citeturn13view0
2. Execute any DESPP data-use agreement or MOU that governs NG911 exports.
3. Once access is approved, build `connecticut-fire-districts`, update registry/docs, rerun fire coverage report.

#### Next Actions
- [ ] Draft credential request package for DESPP/DSET.  
- [ ] Follow up weekly until approval/denial.  
- [ ] Log final disposition here + coverage tracker when resolved.

### 🟡 BLOCKER-007: North Carolina statewide fire districts — NC 911 Board NG911 access

**Status:** BLOCKED  
**Priority:** MEDIUM (10.7M residents)  
**Blocking Since:** 2025-11-14  
**Owner:** North Carolina special-district sweep

#### Problem Statement
- The NC 911 Board and the Department of Information Technology’s 911 GIS program manage statewide NG911 datasets (PSAP/service boundaries) and only distribute them through the managed portal; public FeatureServers are not available.citeturn1search0
- Without NC 911 Board credentials we cannot replace the NIFC fire polygons even though statewide fire response areas already exist inside the NG911 system.

#### Resolution Path
1. Request read-only NG911 GIS access from the NC 911 Board / DIT 911 office (contact 919-754-6347 or submit the NG911 support form).citeturn1search0
2. Provide Shadow Atlas’ civic mission + data handling controls; sign any NC 911 Board sharing agreements.
3. When access is granted, build `north-carolina-fire-districts`, update registry/docs, and rerun `npm run report:fire-coverage`.

#### Next Actions
- [ ] Draft credential request + security summary for the NC 911 Board GIS team.  
- [ ] Track weekly follow-ups until access is approved or denied.  
- [ ] Document outcome in this blocker entry and in `docs/SPECIAL-DISTRICT-COVERAGE.md`.

### 🟡 BLOCKER-008: Tennessee transit districts — TDOT Locally Coordinated Plan polygons unavailable

**Status:** BLOCKED  
**Priority:** MEDIUM (statewide transit column)  
**Blocking Since:** 2025-11-15  
**Owner:** Tennessee special-district sweep

#### Problem Statement
- TDOT’s Locally Coordinated Plan (LCP) districts define statewide transit regions for Section 5310/5311 coordination, but the polygons are not exposed on TNMap or any public FeatureServer—the TDOT “Mapping & GIS Support” page returns 404, so no downloadable feed exists.
- Without those boundaries, Tennessee transit remains stuck on the NTAD baseline even though TDOT maintains official shapes internally.

#### Resolution Path
1. Contact TDOT Long-Range Planning / Mapping & GIS Support to request the 2025–2029 LCP district geodatabase or FeatureServer. Provide Shadow Atlas’ civic use case and ask for ongoing read-only access.
2. Once TDOT shares the dataset, add `tennessee-lcp-transit-districts`, update registry/docs, rerun coverage tests, and flip Tennessee transit to `authority_live`.

#### Next Actions
- [ ] Draft outreach email + phone script for TDOT GIS support and log the ticket/reference.  
- [ ] Follow up weekly until TDOT delivers the dataset or declines.  
- [ ] Record final disposition here and in the coverage tracker.

### 🟡 BLOCKER-009: South Carolina water service areas — DHEC Hub requires credentials

**Status:** BLOCKED  
**Priority:** MEDIUM (statewide water column)  
**Blocking Since:** 2025-11-15  
**Owner:** South Carolina special-district sweep

#### Problem Statement
- South Carolina DHEC’s Open Data Hub hosts “Water Systems Service Areas,” but API searches return `401 Unauthorized` (“private org id … not accessible”), so the FeatureServer cannot be queried anonymously.
- Without access, South Carolina’s water column stays on the EPA baseline despite the existence of a higher-fidelity state dataset.

#### Resolution Path
1. Request dataset access from DHEC GIS/Open Data (hub contact form or DHEC GIS email) asking for public sharing or service-account credentials, and outline the required attributes (PWSID, system name, population, source type).  
2. Once DHEC grants access, implement `south-carolina-water-systems`, update registry/docs, rerun audits, and mark SC water as `authority_live`.

#### Next Actions
- [ ] Send access request to DHEC GIS/Open Data and track follow-ups.  
- [ ] Document granted/denied status here and in `docs/SPECIAL-DISTRICT-COVERAGE.md`.  
- [ ] Ingest the dataset immediately once credentials arrive.
