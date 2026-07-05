/**
 * Statewide Current-Precinct Overlay Provider
 *
 * Serves the most current statewide precinct/ward/VTD boundary that
 * verifiably exists per state, layered ADDITIVELY over the frozen 2020
 * TIGER PL 94-171 VTD baseline (tiger-boundary-provider.ts's `vtd` config,
 * untouched by this module) -> slot 21 (aliased 'voting_precinct'/'vtd',
 * jurisdiction.ts:330). The baseline is never replaced: this provider tags
 * every boundary it emits with `properties.provenanceLabel:
 * 'current-precinct-overlay'` (mirroring the EPA CWS provider's
 * `provenanceLabel: 'service-area'` split at epa-cws-provider.ts:322-325)
 * plus `properties.overlayState` / `overlayVintage` / `overlayCadence`, so a
 * downstream merge step can layer overlay-over-baseline per state FIPS
 * rather than a global replace.
 *
 * One provider class, parameterized by `PRECINCT_OVERLAY_CONFIGS` (one row
 * per state) -- not 23 provider classes. Every URL, format, cadence, and
 * license-gate field traces verbatim to docs/design/PRECINCT-CURRENCY-
 * LANE.md (commons repo) §2.1 (per-state full record) or §3/§4 (ranked
 * wave table / SOURCE_REGISTRY rows), independently re-verified there
 * 2026-07. Only the 23 CONFIRMED states get a row; the 4 PLAUSIBLE states
 * (AK, DE, LA, MN) are barred by absence -- see
 * precinct-overlay-config.test.ts's explicit `.not.toContain` assertions.
 *
 * SIGNED PUBLISH GATE (O8-license-confirms pattern, same contract as
 * ProviderSourceMetadata.publishExclusion / epa-cws-provider.ts:66-71): the
 * 6 license-review states (CA, NC, MD, SC, IA, ND -- `licenseGate: 'review'`
 * in the config below) have every boundary they produce carry
 * `publishExclusion` until the operator records that state's license
 * confirmation in PRECINCT-CURRENCY-LANE.md. filterPublishExclusions()
 * (publish-exclusion-filter.ts, untouched by this module) already enforces
 * this at the signed-publish build step with zero new logic -- it only
 * needs `publishExclusion` set on the boundary, which this provider does.
 * Ingest-dev and unsigned local builds are unaffected.
 *
 * Format routing (no new HTTP/shapefile/GeoPackage libraries): each config
 * row's `format` selects one of the parse paths already proven elsewhere in
 * this package --
 *   - 'arcgis-featureserver': REST `/query?f=json` JSON, the same shape
 *     USGSWatershedBoundaryProvider (usgs-wbd-provider.ts) already parses.
 *   - 'ckan-api': CKAN `package_show` JSON pointing at a shapefile-zip
 *     resource (TX's WAF-blocked HTML page has a CKAN API sibling, per
 *     PRECINCT-CURRENCY-LANE.md §3 row 2's "ingest via CKAN API/mirror
 *     path" note); the returned zip is handed to the same shapefile path
 *     tiger-boundary-provider.ts already uses (batch-orchestrator.ts:493's
 *     shapefile-to-GeoJSON conversion), not re-implemented here.
 *   - 's3-listing': plain S3 `list-type=2` ListObjectsV2 bucket listing --
 *     reserved for the one state (NC) whose primary source genuinely is a
 *     raw S3 bucket ("cheapest change-detection endpoint in the whole lane"
 *     per §2.1); the listing itself is JSON/XML, no new client needed
 *     (global `fetch`). A config-lint (precinct-overlay-config.test.ts)
 *     enforces that every 's3-listing' URL literally carries `list-type=2`,
 *     so this format can never silently regress to a non-listing page.
 *   - 'direct-fetch': any other non-ArcGIS, non-CKAN primary source (a
 *     direct shapefile/zip download, an FTP file, or an HTML
 *     listing/product page) resolved to a concrete downloadable resource --
 *     handed to the same shapefile-conversion path as ckan-api/s3-listing.
 *     Distinct from 's3-listing' precisely so the S3-only lint rule below
 *     never has to (and never does) apply to a URL that isn't S3.
 * A provider constructed with an injectable `fetchImpl` never makes a real
 * network call in unit tests (same pattern as the EPA/WBD providers'
 * network-gated smokes) -- see precinct-overlay-provider.test.ts.
 */

import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  AdministrativeLevel,
  ProviderSourceMetadata,
} from '../core/types/provider.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type PrecinctOverlayFormat = 'arcgis-featureserver' | 'ckan-api' | 's3-listing' | 'direct-fetch';

export type PrecinctLicenseGate = 'clear' | 'review';

/**
 * One CONFIRMED state's overlay ingest configuration. Every field here
 * traces verbatim to a specific PRECINCT-CURRENCY-LANE.md quote -- never
 * guessed or re-derived.
 */
export interface PrecinctOverlayConfig {
  /** Two-letter USPS state code (DC included, per the lane doc's 51-jurisdiction sweep). */
  readonly state: string;
  readonly stateName: string;
  /** Primary portal/query URL used by download(), verbatim from §2.1. */
  readonly url: string;
  readonly format: PrecinctOverlayFormat;
  /** Human-readable cadence string, verbatim from the §2.1/§3 "Cadence"/"Notes" text. */
  readonly cadence: string;
  readonly licenseGate: PrecinctLicenseGate;
  /** Verbatim license text or pointer, from §2.1's "License" field. */
  readonly licenseNote: string;
  /** Vintage label surfaced in provenance (e.g. "2026-06-17 (rolling)", "June 2023"). Never fabricated beyond the lane doc's own dated evidence. */
  readonly overlayVintage: string;
  /** 2020 Census resident population this state covers, from §3's "2020 pop" column (population-weighted tranching only -- not re-derived). */
  readonly population2020: number;
  /** Direct pointer to the §2.1 subsection this row traces to, for auditability. */
  readonly laneDocAnchor: string;
}

/**
 * ArcGIS REST `/query` response shape (subset), matching the shape already
 * consumed by USGSWatershedBoundaryProvider.
 */
interface ArcGISRing {
  readonly rings?: readonly (readonly [number, number])[][];
}

interface ArcGISQueryFeature {
  readonly attributes: Record<string, unknown>;
  readonly geometry?: ArcGISRing;
}

interface ArcGISQueryResponse {
  readonly features?: readonly ArcGISQueryFeature[];
  readonly exceededTransferLimit?: boolean;
  readonly error?: { readonly code: number; readonly message: string };
}

export type FetchImpl = typeof fetch;

// ============================================================================
// Config: one row per CONFIRMED state (23 total)
//
// Ranked exactly per PRECINCT-CURRENCY-LANE.md §3 (2020 pop descending).
// TRANCHE A (14 states, clear-license/machine-friendly-first) followed by
// TRANCHE B (9 states, license-review-heavy + lower-population) -- matching
// the lane doc's own suggested tranching (§3, "Suggested tranching within
// the wave").
// ============================================================================

export const PRECINCT_OVERLAY_CONFIGS: Record<string, PrecinctOverlayConfig> = {
  // ---- TRANCHE A: deep adapters + fixture tests (14 states, ~117M people) ----
  TX: {
    state: 'TX',
    stateName: 'Texas',
    url: 'https://data.capitol.texas.gov/api/3/action/package_show?id=vtds',
    format: 'ckan-api',
    cadence: 'per-election-cycle (2022 and 2024 vintages both present; historical retained)',
    licenseGate: 'clear',
    licenseNote: 'CC-BY (CKAN dataset page License module: "Creative Commons Attribution")',
    overlayVintage: '2024 Primary & General Elections VTDs (VTDs_24PG.zip)',
    population2020: 29_145_505,
    laneDocAnchor: '§2.1 #TX -- Texas',
  },
  NY: {
    state: 'NY',
    stateName: 'New York',
    // Layer index verified live 2026-07-04 by enumerating the FeatureServer:
    // layer 0 = "Early Voting Polling Sites Non NYC" (esriGeometryPoint,
    // NOT precinct polygons); layer 4 = "Election Districts"
    // (esriGeometryPolygon, 13,335 features live). Layer 4 is the correct
    // precinct-equivalent boundary layer -- never 0.
    url: 'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Elections_Districts_and_Polling_Locations/FeatureServer/4',
    format: 'arcgis-featureserver',
    cadence: 'rolling/irregular; modified 2026-06-16',
    licenseGate: 'clear',
    licenseNote: '"as is" disclaimer, no reuse restriction (item JSON licenseInfo, verbatim)',
    overlayVintage: '2026-06-16 (item modified epoch 1781652183000)',
    population2020: 20_201_249,
    laneDocAnchor: '§2.1 #NY -- New York',
  },
  NC: {
    state: 'NC',
    stateName: 'North Carolina',
    // The dl.ncsbe.gov custom-domain URL (with or without a query string)
    // is a static HTML/JS shell (S3BL bucket-listing webapp) that renders
    // the listing client-side -- it never returns the XML listing itself
    // (live-verified 2026-07-04, HTTP 200 text/html either way). The direct
    // `s3.amazonaws.com/<bucket>?list-type=2&...` ListObjectsV2 form
    // returns real <ListBucketResult> XML (live-verified: 152 keys under
    // this prefix). Same underlying bucket, correct REST endpoint.
    url: 'https://s3.amazonaws.com/dl.ncsbe.gov?list-type=2&prefix=ShapeFiles/Precinct/',
    format: 's3-listing',
    cadence: 'irregular/as-needed, ~2-4x/year (release history back to 2012)',
    licenseGate: 'review',
    licenseNote: 'not extractable dataset-specific text; NC OneMap terms page is a client-rendered SPA -- flag for human license review',
    overlayVintage: 'SBE_PRECINCTS_20251212.zip (LastModified 2026-01-12T16:21:54Z)',
    population2020: 10_439_388,
    laneDocAnchor: '§2.1 #NC -- North Carolina',
  },
  MI: {
    state: 'MI',
    stateName: 'Michigan',
    // Direct FeatureServer endpoint (re-derived and live-verified 2026-07-04
    // from AGOL item 02d40893317d46569017beeb14f9c63e's own `url` field --
    // the lane doc's Hub "datasets/..." page is a client-rendered wrapper
    // that returns text/html, not JSON, and a /query against it 404s/parses
    // as HTML. Layer 9 confirmed the correct polygon layer.
    url: 'https://gisagocss.state.mi.us/arcgis/rest/services/OpenData/boundaries/MapServer/9',
    format: 'arcgis-featureserver',
    cadence: 'per-even-year election cycle; ingest newest active cycle item, not a pinned year',
    licenseGate: 'clear',
    licenseNote: '"no restrictions on the use, reproduction, or distribution of this dataset" (verbatim leading text)',
    overlayVintage: '2024 Voting Precincts (item 02d40893317d46569017beeb14f9c63e, modified 2026-04-13)',
    population2020: 10_077_331,
    laneDocAnchor: '§2.1 #MI -- Michigan',
  },
  WA: {
    state: 'WA',
    stateName: 'Washington',
    url: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Statewide_Precincts_2019General_SPS/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'annual, per general election',
    licenseGate: 'clear',
    licenseNote: 'as-is; explicitly invites self-hosting/extraction (item licenseInfo, verbatim)',
    overlayVintage: 'December 2025 (item modified epoch 1766076860000)',
    population2020: 7_705_281,
    laneDocAnchor: '§2.1 #WA -- Washington',
  },
  MA: {
    state: 'MA',
    stateName: 'Massachusetts',
    // Direct FeatureServer endpoint (re-derived and live-verified 2026-07-04
    // via AGOL item search -> item 6d4ae7efad4f4c77907db7cbfb012e64
    // "Wards and Precincts (2022) (Feature Service)" -> its own `url`
    // field. The lane doc's "gis.data.mass.gov/datasets/..." page is a Hub
    // page that returns text/html, not JSON. Layer 0 confirmed the correct
    // polygon layer, 2,256 features statewide.
    url: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'irregular/event-driven (LEDRC plan approvals); 2022 plans + Feb-2024 corrections',
    licenseGate: 'clear',
    licenseNote: '"public resource and may be used by anyone for their purposes" (DCAT-US JSON record, verbatim)',
    overlayVintage: '2022 plan, modified 2024-02-21',
    population2020: 7_029_917,
    laneDocAnchor: '§2.1 #MA -- Massachusetts',
  },
  IN: {
    state: 'IN',
    stateName: 'Indiana',
    url: 'https://gisdata.in.gov/server/rest/services/Hosted/Voting_District_Boundaries_2024/FeatureServer/1',
    format: 'arcgis-featureserver',
    cadence: 'annual ("Updated annually by Indiana General Assembly through aggregated local data")',
    licenseGate: 'clear',
    licenseNote: 'as-is disclaimer (AGOL item JSON, condensed rendering)',
    overlayVintage: '2024 series, modified 2026-06-01 (item a62a17919c804676ae318f2f82cb20db)',
    population2020: 6_785_528,
    laneDocAnchor: '§2.1 #IN -- Indiana',
  },
  WI: {
    state: 'WI',
    stateName: 'Wisconsin',
    url: 'https://services1.arcgis.com/FDsAtKBk8Hy4cAH0/arcgis/rest/services/WI_Wards_Jan_2026/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'semiannual, statutory (Wis. Stat. 5.15(4)(br)1 -- Jan 15 / Jul 15 transmittal)',
    licenseGate: 'clear',
    licenseNote: '"open and publicly available data... use at your own risk" (item licenseInfo, verbatim)',
    overlayVintage: 'February 2026 collection (created 2026-02-26, modified 2026-03-09)',
    population2020: 5_893_718,
    laneDocAnchor: '§2.1 #WI -- Wisconsin (archetype)',
  },
  UT: {
    state: 'UT',
    stateName: 'Utah',
    // Direct FeatureServer endpoint (re-derived and live-verified 2026-07-04
    // from AGOL item d33f596419d74948a45070275632b8e0's own `url` field --
    // the lane doc's "products/sgid/..." page is a product-description HTML
    // page, not a queryable service (a /query against it 404s). Layer 0
    // ("VistaBallotAreas") confirmed the correct polygon layer, 3,318
    // precinct/subprecinct records statewide.
    url: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/VistaBallotAreas/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'rolling/as-needed -- county clerks submit annexation/precinct changes as they occur',
    licenseGate: 'clear',
    licenseNote: 'CC-BY-4.0 (item JSON + product page, verbatim, agreed by two independent channels)',
    overlayVintage: '2026-04-03 (item modified epoch 1783084331000; all 29 counties)',
    population2020: 3_271_616,
    laneDocAnchor: '§2.1 #UT -- Utah',
  },
  AR: {
    state: 'AR',
    stateName: 'Arkansas',
    url: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer/11',
    format: 'arcgis-featureserver',
    cadence: 'rolling/near-continuous county-by-county updates folded into one statewide layer',
    licenseGate: 'clear',
    licenseNote: '"There are no access and use limitations for this item." (metadata HTML, verbatim)',
    overlayVintage: 'Updated: 2026-06-17 08:00:00 (product page)',
    population2020: 3_011_524,
    laneDocAnchor: '§2.1 #AR -- Arkansas',
  },
  HI: {
    state: 'HI',
    stateName: 'Hawaii',
    url: 'https://geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/13',
    format: 'arcgis-featureserver',
    cadence: 'irregular/per-election-cycle (2022 edition superseded by 2024)',
    licenseGate: 'clear',
    licenseNote: '"contents of this web page are public domain" (planning.hawaii.gov/gis/download-gis-data, verbatim)',
    overlayVintage: '2024 elections (AGOL item modified epoch 1716938720000 = 2024-05-28); 250 precincts',
    population2020: 1_455_271,
    laneDocAnchor: '§2.1 #HI -- Hawaii',
  },
  RI: {
    state: 'RI',
    stateName: 'Rhode Island',
    // Direct FeatureServer endpoint (re-derived and live-verified
    // 2026-07-04 from AGOL item 9104ca2e5e9b4cdb9985e8935ef2514d's own
    // `url` field -- the lane doc's "about" page is a Hub UI wrapper
    // around this same service). Live returnCountOnly re-check: exactly
    // 416 features, matching §2.1's count exactly.
    url: 'https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/BND_Voting_Precincts_2022/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'per-redistricting-cycle base (valid 2022-2032) with real ad-hoc edits within the cycle',
    licenseGate: 'clear',
    licenseNote: '"provided \'as is\'... acknowledge both RIGIS and the primary producer(s)" (item description, verbatim)',
    overlayVintage: '2025-01-06 item modified (416 features); layer editingInfo.lastEditDate 2024-09-11',
    population2020: 1_097_379,
    laneDocAnchor: '§2.1 #RI -- Rhode Island',
  },
  MT: {
    state: 'MT',
    stateName: 'Montana',
    url: 'https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaVotingPrecincts_shp.zip',
    // Direct FTP zip download, not an S3 bucket listing -- live-verified
    // 2026-07-04 (HTTP 200, content-type application/x-zip-compressed).
    format: 'direct-fetch',
    cadence: '"as needed" (metadata update field); status In work/Complete',
    licenseGate: 'clear',
    licenseNote: 'Access Constraints: None; Use Constraints per live FGDC XML (verbatim, informational-use disclaimer)',
    overlayVintage: '2026-05-21 (FTP Last-Modified); 34 of 56 counties updated as part of 2023 redistricting',
    population2020: 1_084_225,
    laneDocAnchor: '§2.1 #MT -- Montana',
  },
  DC: {
    state: 'DC',
    stateName: 'District of Columbia',
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/0',
    format: 'arcgis-featureserver',
    cadence: 'precincts: irregular/event-driven; current layer delineated 2024, reloaded 2026-06-24',
    licenseGate: 'clear',
    licenseNote: 'CC-BY-4.0 ("Creative Commons Attribution 4.0 International License", live item JSON, verbatim)',
    overlayVintage: '2026-06-24T23:41-23:46Z (feature-level CREATED/EDITED epochs); 144 precincts',
    population2020: 689_545,
    laneDocAnchor: '§2.1 #DC -- District of Columbia',
  },

  // ---- TRANCHE B: config-stamped + shared smoke (9 states) ----
  CA: {
    state: 'CA',
    stateName: 'California',
    url: 'https://statewidedatabase.org/d20/g24_geo_conv.html',
    // HTML index page (SWDB has no listing API) -- live-verified 2026-07-04
    // (HTTP 200 text/html). Not an S3 bucket listing; already
    // publish-excluded (licenseGate: 'review'), so real ingest would need a
    // page-scrape step to resolve a concrete shapefile link, not attempted
    // here.
    format: 'direct-fetch',
    cadence: 'per-election -- new statewide precinct-boundary release per statewide election',
    licenseGate: 'review',
    licenseNote: 'no formal open-data license beyond bare UC Regents copyright -- "Treat the license as effectively not stated beyond bare copyright"',
    overlayVintage: '2025 Special Election (most recent entry on election.html)',
    population2020: 39_538_223,
    laneDocAnchor: '§2.1 #CA -- California',
  },
  MD: {
    state: 'MD',
    stateName: 'Maryland',
    url: 'https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_ElectionBoundaries/FeatureServer/2',
    format: 'arcgis-featureserver',
    cadence: 'rolling/as-needed statewide re-collection tied to election cycles',
    licenseGate: 'review',
    licenseNote: 'full MDP/MD-iMap disclaimer corroborated-but-not-page-sourced on this specific endpoint -- CONFIRMED-with-caveat on license field only',
    overlayVintage: 'Maryland Precincts 2026, Last Updated 1/12/2026 (2,091 precincts; Howard Co. lags at 2022)',
    population2020: 6_177_224,
    laneDocAnchor: '§2.1 #MD -- Maryland',
  },
  SC: {
    state: 'SC',
    stateName: 'South Carolina',
    url: 'https://rfa.sc.gov/programs-services/precinct-demographics/jurisdictional-mapping/political-gis-data',
    // HTML dataset page (no listing API); live host times out/WAF-blocks
    // automated tooling per §4's own documented reachability-unknown
    // posture. Not an S3 bucket listing; already publish-excluded
    // (licenseGate: 'review').
    format: 'direct-fetch',
    cadence: 'irregular/as-needed re-issuance under a running "Effective" date (edit bursts, not literally annual)',
    licenseGate: 'review',
    licenseNote: 'no license/terms/disclaimer/copyright/use-constraint text found on the dataset page -- flag for review',
    overlayVintage: 'SC Voting Precincts Shapefile Effective 1/1/2025 (2,310 precincts; edits through 2025-01-09)',
    population2020: 5_118_425,
    laneDocAnchor: '§2.1 #SC -- South Carolina',
  },
  IA: {
    state: 'IA',
    stateName: 'Iowa',
    url: 'https://services.arcgis.com/vPD5PVLI6sfkZ5E4/arcgis/rest/services/Iowa_Precincts/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'decennial baseline (2022 reprecincting) + incidental corrections -- NOT a regular sub-decennial refresh',
    licenseGate: 'review',
    licenseNote: 'not stated -- item JSON licenseInfo: null, description: null; only accessInformation credit',
    overlayVintage: '2024-02-02 correction event (dataLastEditDate epoch 1706896912686); 1,660 precincts',
    population2020: 3_190_369,
    laneDocAnchor: '§2.1 #IA -- Iowa',
  },
  NM: {
    state: 'NM',
    stateName: 'New Mexico',
    url: 'https://www.sos.nm.gov/voting-and-elections/data-and-maps/gis-voting-district-data/',
    // HTML clearinghouse page (redirects to a live SOS archive page,
    // live-verified 2026-07-04: 301 -> 200); the EDAC metadata record it
    // links to carries no stable query API. Not an S3 bucket listing.
    format: 'direct-fetch',
    cadence: 'as needed, county-triggered (SB304/2021 statutory clearinghouse)',
    licenseGate: 'clear',
    licenseNote: '"Users may download the data available from the voting district data clearinghouse for free." (SOS page, verbatim); Access Constraints: None (EDAC)',
    overlayVintage: 'New Mexico Voting Precincts July 2024 (publication date 2024-07-03); 1,939 precincts',
    population2020: 2_117_522,
    laneDocAnchor: '§2.1 #NM -- New Mexico',
  },
  ID: {
    state: 'ID',
    stateName: 'Idaho',
    url: 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Idaho_Voting_Precincts_Precinct_Boundaries_-_Master_Data_-_DO_NOT_SHARE_view/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'biennial, statutory (even years; county clerks submit to SOS by Jan 15)',
    licenseGate: 'clear',
    licenseNote: 'disclaimer of legal responsibility; users needing verified info should confirm with primary sources (AGOL item JSON, condensed rendering)',
    overlayVintage: '2026-05-29 (item modified epoch 1780083781000); 976 precincts',
    population2020: 1_839_106,
    laneDocAnchor: '§2.1 #ID -- Idaho',
  },
  NH: {
    state: 'NH',
    stateName: 'New Hampshire',
    url: 'https://ftp.granit.unh.edu/GRANIT_Data/Vector_Data/Administrative_and_Political_Boundaries/d-nhpolitdists/2022/NHPolitDists2022.zip',
    // Direct FTP zip download, not an S3 bucket listing -- live-verified
    // 2026-07-04 (HTTP 200).
    format: 'direct-fetch',
    cadence: 'as needed (status Complete); no vintage newer than /2022/ in the parent directory',
    licenseGate: 'clear',
    licenseNote: '<accconst>None</accconst> and <useconst>None</useconst> (FGDC metadata XML, verbatim)',
    overlayVintage: 'published 2023-06-08, ward data current through Sept 2022 (327 polygons)',
    population2020: 1_377_529,
    laneDocAnchor: '§2.1 #NH -- New Hampshire',
  },
  VT: {
    state: 'VT',
    stateName: 'Vermont',
    // Direct FeatureServer endpoint (re-derived and live-verified 2026-07-04
    // from AGOL item fae5aad934a74108812dbe8ecd6232d4's own `url` field --
    // the lane doc's "geodata.vermont.gov/datasets/.../about" page is a Hub
    // "about" wrapper that returns text/html, not JSON. Layer 0 confirmed
    // the correct polygon layer, 268 features statewide.
    url: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_VT_Municipal_Voting_Districts_SP_v1/FeatureServer/0',
    format: 'arcgis-featureserver',
    cadence: 'irregular -- updated when municipalities redraw wards/districts',
    licenseGate: 'clear',
    licenseNote: 'no-warranty/no-merchantability disclaimer, no use restriction (item JSON, verbatim)',
    overlayVintage: 'June 2023 (item modified epoch 1687964393000) -- oldest CONFIRMED vintage in the lane',
    population2020: 643_077,
    laneDocAnchor: '§2.1 #VT -- Vermont',
  },
  ND: {
    state: 'ND',
    stateName: 'North Dakota',
    url: 'https://www.sos.nd.gov/sites/default/files/documents/elections/map-shape-files/voting-shape-files-2026.zip',
    // Direct state-webserver zip download, not an S3 bucket listing --
    // live-verified 2026-07-04 (HTTP 200, content-type application/zip).
    format: 'direct-fetch',
    cadence: 'per-election-cycle/irregular; sub-annual cadence not established',
    licenseGate: 'review',
    licenseNote: 'no license/terms text accompanies the download (direct curl confirmed) -- only usage instructions',
    overlayVintage: '2026-03-31 (HTTP last-modified header); "2026 Primary Election" statewide file',
    population2020: 779_094,
    laneDocAnchor: '§2.1 #ND -- North Dakota',
  },
};

/** The 23 CONFIRMED state codes, in §3 population-descending rank order. */
export const PRECINCT_OVERLAY_STATE_CODES: readonly string[] = Object.freeze(
  Object.keys(PRECINCT_OVERLAY_CONFIGS),
);

/** States explicitly BARRED from ingest -- PLAUSIBLE, not CONFIRMED (§2.2). Re-open only via a follow-up confirm. */
export const PRECINCT_OVERLAY_BARRED_STATES: readonly string[] = Object.freeze(['AK', 'DE', 'LA', 'MN']);

/** O8-precinct-license-confirms pointer text, one per license-review state, mirroring epa-cws-provider.ts's PUBLISH_EXCLUSION shape. */
function publishExclusionFor(config: PrecinctOverlayConfig): ProviderSourceMetadata['publishExclusion'] {
  if (config.licenseGate !== 'review') return undefined;
  return {
    reason: `${config.stateName} precinct overlay license gap (verbatim, PRECINCT-CURRENCY-LANE.md ${config.laneDocAnchor}): ${config.licenseNote}`,
    pendingConfirmation: `O8-precinct-license-confirms (docs/design/PRECINCT-CURRENCY-LANE.md: "${config.state} license: CONFIRMED <date>")`,
  };
}

// ============================================================================
// Provider
// ============================================================================

/**
 * Shared statewide-precinct overlay provider, parameterized by state via
 * `PRECINCT_OVERLAY_CONFIGS`. One instance per state (mirrors
 * USGSWatershedBoundaryProvider / EPACWSServiceAreaProvider's one-class-per-
 * layer shape at the per-state grain, since the underlying portals are
 * heterogeneous rather than one national endpoint).
 */
export class PrecinctOverlayProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name: string;
  readonly source: string;
  readonly updateSchedule = 'event-driven' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district'] as const;

  readonly config: PrecinctOverlayConfig;
  private readonly fetchImpl: FetchImpl;
  private readonly timeout: number;

  constructor(stateCode: string, options: { fetchImpl?: FetchImpl; timeout?: number } = {}) {
    const config = PRECINCT_OVERLAY_CONFIGS[stateCode.toUpperCase()];
    if (!config) {
      throw new Error(
        `PrecinctOverlayProvider: "${stateCode}" is not a CONFIRMED state (see PRECINCT_OVERLAY_STATE_CODES). ` +
          `PLAUSIBLE states (${PRECINCT_OVERLAY_BARRED_STATES.join(', ')}) are barred from ingest until a follow-up confirm lands.`,
      );
    }
    this.config = config;
    this.name = `${config.stateName} Current-Precinct Overlay`;
    this.source = config.url;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeout = options.timeout ?? 60_000;
  }

  async download(_params: { level: AdministrativeLevel }): Promise<RawBoundaryFile[]> {
    const { config } = this;

    if (config.format === 'arcgis-featureserver') {
      // outSR=4326 is required, not cosmetic: several source layers (e.g.
      // RI's BND_Voting_Precincts_2022, verified live 2026-07-04) are
      // published in a state-plane-feet SRS (wkid 102730), not WGS84.
      // ArcGIS REST reprojects server-side when outSR is set, so the
      // geometry this provider receives is genuinely EPSG:4326 -- omitting
      // this param would silently mislabel state-plane-feet coordinates as
      // WGS84 (source.coordinateSystem below).
      const queryUrl = config.url.endsWith('/query')
        ? config.url
        : `${config.url.replace(/\/$/, '')}/query?where=1%3D1&outFields=*&outSR=4326&f=json`;
      const response = await this.fetchImpl(queryUrl, { signal: AbortSignal.timeout(this.timeout) });
      if (!response.ok) {
        throw new Error(`PrecinctOverlayProvider[${config.state}]: HTTP ${response.status} fetching ${queryUrl}`);
      }
      const data = Buffer.from(await response.arrayBuffer());
      return [
        {
          url: queryUrl,
          format: 'geojson',
          data,
          metadata: {
            source: this.name,
            provider: 'PrecinctOverlayProvider',
            state: config.state,
            authority: 'state',
            retrieved: new Date().toISOString(),
          },
        },
      ];
    }

    // ckan-api / s3-listing / direct-fetch: all three are plain JSON/XML/
    // HTML/zip fetches over the configured URL -- the shapefile/zip payload
    // itself is out of scope for this ingest-only wave's fixture-backed
    // unit tests (no live network call in tests; see
    // precinct-overlay-provider.test.ts). Real ingest runs would resolve
    // any listing/HTML page to a concrete resource URL and hand the
    // shapefile zip to the same conversion path tiger-boundary-provider.ts
    // already uses -- not reimplemented in this module.
    const response = await this.fetchImpl(config.url, { signal: AbortSignal.timeout(this.timeout) });
    if (!response.ok) {
      throw new Error(`PrecinctOverlayProvider[${config.state}]: HTTP ${response.status} fetching ${config.url}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    return [
      {
        url: config.url,
        // ckan-api (resolves to a shapefile-zip resource), s3-listing (a
        // directory listing whose entries are shapefile zips), and
        // direct-fetch (a direct zip/HTML resource) all ultimately hand a
        // shapefile payload to the shared conversion path -- 'shapefile' is
        // the correct declared BoundaryFileFormat for all three.
        format: 'shapefile',
        data,
        metadata: {
          source: this.name,
          provider: 'PrecinctOverlayProvider',
          state: config.state,
          authority: 'state',
          retrieved: new Date().toISOString(),
        },
      },
    ];
  }

  /**
   * Transform downloaded ArcGIS query JSON into normalized, overlay-tagged
   * boundaries. Non-ArcGIS formats (ckan-api/s3-listing/direct-fetch)
   * resolve to a concrete shapefile at real-ingest time via the shared
   * shapefile path (batch-orchestrator.ts:493) -- this transform() handles
   * the arcgis-featureserver case directly and passes through an already-
   * normalized GeoJSON FeatureCollection for the other formats, so tests
   * can inject either shape without a live network call.
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const { config } = this;
    const normalized: NormalizedBoundary[] = [];
    const gate = publishExclusionFor(config);

    for (const file of raw) {
      // Both the arcgis-featureserver ('geojson'-tagged) query response and
      // a shapefile-sourced payload arrive here as the same
      // features-array-bearing JSON shape: production ingest resolves any
      // shapefile zip to this shape via the shared shapefile-to-GeoJSON
      // path (batch-orchestrator.ts:493, matching tiger-boundary-
      // provider.ts's own hand-off) before calling transform(); fixture
      // tests inject the shape directly (no live network call).
      const parsed: unknown = JSON.parse(file.data.toString('utf-8'));
      const features = extractArcGISFeatures(parsed);

      for (const feature of features) {
        const geometry = convertArcGISGeometry(feature.geometry);
        if (!geometry) continue;

        const rawId =
          (feature.attributes.GEOID as string | undefined) ??
          (feature.attributes.PRECINCT_ID as string | undefined) ??
          (feature.attributes.OBJECTID as number | undefined)?.toString() ??
          `${config.state}-${normalized.length}`;

        const source: ProviderSourceMetadata = {
          provider: this.name,
          url: config.url,
          version: config.overlayVintage,
          license: config.licenseGate === 'clear' ? 'state-published-basis-confirmed' : 'review-pending',
          updatedAt: new Date().toISOString(),
          checksum: '',
          authorityLevel: 'state-agency',
          legalStatus: 'official',
          collectionMethod: 'portal-discovery',
          lastVerified: new Date().toISOString(),
          verifiedBy: 'automated',
          topologyValidated: false,
          geometryRepaired: false,
          coordinateSystem: 'EPSG:4326',
          updateMonitoring: 'api-polling',
          ...(gate ? { publishExclusion: gate } : {}),
        };

        normalized.push({
          id: `voting_precinct-${config.state}-${rawId}`,
          name: (feature.attributes.NAME as string | undefined) ?? `${config.stateName} Precinct ${rawId}`,
          level: 'district',
          geometry,
          properties: {
            ...feature.attributes,
            layer: 'voting_precinct',
            // Overlay semantics: additive over the frozen 2020 VTD baseline,
            // never a replacement -- see the module header + PRECINCT-
            // CURRENCY-LANE.md's "Serving contract".
            provenanceLabel: 'current-precinct-overlay',
            overlayState: config.state,
            overlayVintage: config.overlayVintage,
            overlayCadence: config.cadence,
          },
          source,
        });
      }
    }

    logger.info('Precinct overlay: transformed features', {
      state: config.state,
      count: normalized.length,
      licenseGate: config.licenseGate,
    });

    return normalized;
  }

  async checkForUpdates() {
    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.timeout),
      });
      return {
        available: response.ok,
        latestVersion: this.config.overlayVintage,
        currentVersion: this.config.overlayVintage,
        releaseDate: new Date().toISOString(),
      };
    } catch {
      return {
        available: false,
        latestVersion: this.config.overlayVintage,
        currentVersion: this.config.overlayVintage,
        releaseDate: new Date().toISOString(),
      };
    }
  }

  async getMetadata(): Promise<ProviderSourceMetadata> {
    const gate = publishExclusionFor(this.config);
    return {
      provider: this.name,
      url: this.config.url,
      version: this.config.overlayVintage,
      license: this.config.licenseGate === 'clear' ? 'state-published-basis-confirmed' : 'review-pending',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'state-agency',
      legalStatus: 'official',
      collectionMethod: 'portal-discovery',
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated',
      topologyValidated: false,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      updateMonitoring: 'api-polling',
      ...(gate ? { publishExclusion: gate } : {}),
    };
  }
}

// ============================================================================
// Shared parse helpers (format-tag-routed, no new libraries)
// ============================================================================

/** Pull a `features` array out of either a raw ArcGIS query response or a plain array-of-features fixture. */
function extractArcGISFeatures(parsed: unknown): ArcGISQueryFeature[] {
  if (Array.isArray(parsed)) return parsed as ArcGISQueryFeature[];
  const response = parsed as ArcGISQueryResponse;
  return response.features ? [...response.features] : [];
}

/** Convert an ArcGIS `rings` geometry to GeoJSON Polygon/MultiPolygon -- same shape USGSWatershedBoundaryProvider already converts. */
function convertArcGISGeometry(geometry: ArcGISRing | undefined): NormalizedBoundary['geometry'] | null {
  if (!geometry?.rings || geometry.rings.length === 0) return null;
  const rings = geometry.rings.map((ring) => ring.map(([x, y]) => [x, y]));
  if (rings.length === 1) {
    return { type: 'Polygon', coordinates: rings };
  }
  return { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) };
}
