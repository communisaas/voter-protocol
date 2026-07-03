/**
 * USPS Publication 28 normalization tables for the atlas-native address index.
 *
 * SEAM-CONTRACT v1 (atlas-address-index) §3: the TABLE is shipped data, the
 * ALGORITHM is the contract text (see normalize.ts). These tables are emitted
 * at build time as `US/addresses/normalization.json` inside the published
 * artifact, sha256-pinned in the manifest (`addressIndex.normTable`). The
 * consumer fetches THAT file — it never vendors its own copy — and hard-asserts
 * `normVersion === 1` against its algorithm version. Table skew is impossible
 * by construction; algorithm skew fails loudly.
 *
 * Source: USPS Publication 28 — Postal Addressing Standards, November 2015
 * edition (the current edition as of this table's authoring):
 *   - Appendix B:  directionals (NORTH→N … NORTHWEST→NW)
 *   - Appendix C1: street suffix abbreviations (long/variant → standard)
 *   - Appendix C2: secondary unit designators (APT, STE, UNIT, …)
 *
 * Any change to these tables (or to the §3 algorithm) is a `normVersion` bump,
 * never a silent edit — both producer chunks and consumer lookups key streets
 * through this exact data.
 */

/** Bumped on ANY change to the tables below or the §3 algorithm. */
export const NORM_VERSION = 1 as const;

/**
 * Appendix B directionals: token → standard abbreviation.
 * Identity entries (N→N) are included so mapping is a plain table lookup on
 * the leading/trailing token with no special-casing on either side of the seam.
 */
export const DIRECTIONALS: Readonly<Record<string, string>> = {
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
  N: 'N',
  S: 'S',
  E: 'E',
  W: 'W',
  NE: 'NE',
  NW: 'NW',
  SE: 'SE',
  SW: 'SW',
};

/**
 * Appendix C1 street suffixes: variant (commonly-used long form or
 * misspelling listed by Pub 28) → USPS standard abbreviation.
 *
 * Standard abbreviations map to themselves so an already-normalized street
 * key is a fixed point (norm idempotence, §3 rule 7).
 */
export const SUFFIXES: Readonly<Record<string, string>> = {
  // A
  ALLEE: 'ALY', ALLEY: 'ALY', ALLY: 'ALY', ALY: 'ALY',
  ANEX: 'ANX', ANNEX: 'ANX', ANNX: 'ANX', ANX: 'ANX',
  ARC: 'ARC', ARCADE: 'ARC',
  AV: 'AVE', AVE: 'AVE', AVEN: 'AVE', AVENU: 'AVE', AVENUE: 'AVE', AVN: 'AVE', AVNUE: 'AVE',
  // B
  BAYOO: 'BYU', BAYOU: 'BYU', BYU: 'BYU',
  BCH: 'BCH', BEACH: 'BCH',
  BEND: 'BND', BND: 'BND',
  BLF: 'BLF', BLUF: 'BLF', BLUFF: 'BLF',
  BLUFFS: 'BLFS', BLFS: 'BLFS',
  BOT: 'BTM', BTM: 'BTM', BOTTM: 'BTM', BOTTOM: 'BTM',
  BLVD: 'BLVD', BOUL: 'BLVD', BOULEVARD: 'BLVD', BOULV: 'BLVD',
  BR: 'BR', BRNCH: 'BR', BRANCH: 'BR',
  BRDGE: 'BRG', BRG: 'BRG', BRIDGE: 'BRG',
  BRK: 'BRK', BROOK: 'BRK',
  BROOKS: 'BRKS', BRKS: 'BRKS',
  BURG: 'BG', BG: 'BG',
  BURGS: 'BGS', BGS: 'BGS',
  BYP: 'BYP', BYPA: 'BYP', BYPAS: 'BYP', BYPASS: 'BYP', BYPS: 'BYP',
  // C
  CAMP: 'CP', CP: 'CP', CMP: 'CP',
  CANYN: 'CYN', CANYON: 'CYN', CNYN: 'CYN', CYN: 'CYN',
  CAPE: 'CPE', CPE: 'CPE',
  CAUSEWAY: 'CSWY', CAUSWA: 'CSWY', CSWY: 'CSWY',
  CEN: 'CTR', CENT: 'CTR', CENTER: 'CTR', CENTR: 'CTR', CENTRE: 'CTR', CNTER: 'CTR', CNTR: 'CTR', CTR: 'CTR',
  CENTERS: 'CTRS', CTRS: 'CTRS',
  CIR: 'CIR', CIRC: 'CIR', CIRCL: 'CIR', CIRCLE: 'CIR', CRCL: 'CIR', CRCLE: 'CIR',
  CIRCLES: 'CIRS', CIRS: 'CIRS',
  CLF: 'CLF', CLIFF: 'CLF',
  CLFS: 'CLFS', CLIFFS: 'CLFS',
  CLB: 'CLB', CLUB: 'CLB',
  COMMON: 'CMN', CMN: 'CMN',
  COMMONS: 'CMNS', CMNS: 'CMNS',
  COR: 'COR', CORNER: 'COR',
  CORNERS: 'CORS', CORS: 'CORS',
  COURSE: 'CRSE', CRSE: 'CRSE',
  COURT: 'CT', CT: 'CT',
  COURTS: 'CTS', CTS: 'CTS',
  COVE: 'CV', CV: 'CV',
  COVES: 'CVS', CVS: 'CVS',
  CREEK: 'CRK', CRK: 'CRK',
  CRESCENT: 'CRES', CRES: 'CRES', CRSENT: 'CRES', CRSNT: 'CRES',
  CREST: 'CRST', CRST: 'CRST',
  CROSSING: 'XING', CRSSNG: 'XING', XING: 'XING',
  CROSSROAD: 'XRD', XRD: 'XRD',
  CROSSROADS: 'XRDS', XRDS: 'XRDS',
  CURVE: 'CURV', CURV: 'CURV',
  // D
  DALE: 'DL', DL: 'DL',
  DAM: 'DM', DM: 'DM',
  DIV: 'DV', DIVIDE: 'DV', DV: 'DV', DVD: 'DV',
  DR: 'DR', DRIV: 'DR', DRIVE: 'DR', DRV: 'DR',
  DRIVES: 'DRS', DRS: 'DRS',
  // E
  EST: 'EST', ESTATE: 'EST',
  ESTATES: 'ESTS', ESTS: 'ESTS',
  EXP: 'EXPY', EXPR: 'EXPY', EXPRESS: 'EXPY', EXPRESSWAY: 'EXPY', EXPW: 'EXPY', EXPY: 'EXPY',
  EXT: 'EXT', EXTENSION: 'EXT', EXTN: 'EXT', EXTNSN: 'EXT',
  EXTS: 'EXTS', EXTENSIONS: 'EXTS',
  // F
  FALL: 'FALL',
  FALLS: 'FLS', FLS: 'FLS',
  FERRY: 'FRY', FRRY: 'FRY', FRY: 'FRY',
  FIELD: 'FLD', FLD: 'FLD',
  FIELDS: 'FLDS', FLDS: 'FLDS',
  FLAT: 'FLT', FLT: 'FLT',
  FLATS: 'FLTS', FLTS: 'FLTS',
  FORD: 'FRD', FRD: 'FRD',
  FORDS: 'FRDS', FRDS: 'FRDS',
  FOREST: 'FRST', FORESTS: 'FRST', FRST: 'FRST',
  FORG: 'FRG', FORGE: 'FRG', FRG: 'FRG',
  FORGES: 'FRGS', FRGS: 'FRGS',
  FORK: 'FRK', FRK: 'FRK',
  FORKS: 'FRKS', FRKS: 'FRKS',
  FORT: 'FT', FRT: 'FT', FT: 'FT',
  FREEWAY: 'FWY', FREEWY: 'FWY', FRWAY: 'FWY', FRWY: 'FWY', FWY: 'FWY',
  // G
  GARDEN: 'GDN', GARDN: 'GDN', GRDEN: 'GDN', GRDN: 'GDN', GDN: 'GDN',
  GARDENS: 'GDNS', GDNS: 'GDNS', GRDNS: 'GDNS',
  GATEWAY: 'GTWY', GATEWY: 'GTWY', GATWAY: 'GTWY', GTWAY: 'GTWY', GTWY: 'GTWY',
  GLEN: 'GLN', GLN: 'GLN',
  GLENS: 'GLNS', GLNS: 'GLNS',
  GREEN: 'GRN', GRN: 'GRN',
  GREENS: 'GRNS', GRNS: 'GRNS',
  GROV: 'GRV', GROVE: 'GRV', GRV: 'GRV',
  GROVES: 'GRVS', GRVS: 'GRVS',
  // H
  HARB: 'HBR', HARBOR: 'HBR', HARBR: 'HBR', HBR: 'HBR', HRBOR: 'HBR',
  HARBORS: 'HBRS', HBRS: 'HBRS',
  HAVEN: 'HVN', HVN: 'HVN',
  HT: 'HTS', HTS: 'HTS', HEIGHTS: 'HTS',
  HIGHWAY: 'HWY', HIGHWY: 'HWY', HIWAY: 'HWY', HIWY: 'HWY', HWAY: 'HWY', HWY: 'HWY',
  HILL: 'HL', HL: 'HL',
  HILLS: 'HLS', HLS: 'HLS',
  HLLW: 'HOLW', HOLLOW: 'HOLW', HOLLOWS: 'HOLW', HOLW: 'HOLW', HOLWS: 'HOLW',
  // I
  INLT: 'INLT', INLET: 'INLT',
  IS: 'IS', ISLAND: 'IS', ISLND: 'IS',
  ISLANDS: 'ISS', ISLNDS: 'ISS', ISS: 'ISS',
  ISLE: 'ISLE', ISLES: 'ISLE',
  // J
  JCT: 'JCT', JCTION: 'JCT', JCTN: 'JCT', JUNCTION: 'JCT', JUNCTN: 'JCT', JUNCTON: 'JCT',
  JCTNS: 'JCTS', JCTS: 'JCTS', JUNCTIONS: 'JCTS',
  // K
  KEY: 'KY', KY: 'KY',
  KEYS: 'KYS', KYS: 'KYS',
  KNL: 'KNL', KNOL: 'KNL', KNOLL: 'KNL',
  KNLS: 'KNLS', KNOLLS: 'KNLS',
  // L
  LK: 'LK', LAKE: 'LK',
  LKS: 'LKS', LAKES: 'LKS',
  LAND: 'LAND',
  LANDING: 'LNDG', LNDG: 'LNDG', LNDNG: 'LNDG',
  LANE: 'LN', LN: 'LN',
  LGT: 'LGT', LIGHT: 'LGT',
  LIGHTS: 'LGTS', LGTS: 'LGTS',
  LF: 'LF', LOAF: 'LF',
  LCK: 'LCK', LOCK: 'LCK',
  LCKS: 'LCKS', LOCKS: 'LCKS',
  LDG: 'LDG', LDGE: 'LDG', LODG: 'LDG', LODGE: 'LDG',
  LOOP: 'LOOP', LOOPS: 'LOOP',
  // M
  MALL: 'MALL',
  MNR: 'MNR', MANOR: 'MNR',
  MANORS: 'MNRS', MNRS: 'MNRS',
  MDW: 'MDW', MEADOW: 'MDW',
  MDWS: 'MDWS', MEADOWS: 'MDWS', MEDOWS: 'MDWS',
  MEWS: 'MEWS',
  MILL: 'ML', ML: 'ML',
  MILLS: 'MLS', MLS: 'MLS',
  MISSN: 'MSN', MSSN: 'MSN', MSN: 'MSN', MISSION: 'MSN',
  MOTORWAY: 'MTWY', MTWY: 'MTWY',
  MNT: 'MT', MT: 'MT', MOUNT: 'MT',
  MNTAIN: 'MTN', MNTN: 'MTN', MOUNTAIN: 'MTN', MOUNTIN: 'MTN', MTIN: 'MTN', MTN: 'MTN',
  MNTNS: 'MTNS', MOUNTAINS: 'MTNS', MTNS: 'MTNS',
  // N
  NCK: 'NCK', NECK: 'NCK',
  // O
  ORCH: 'ORCH', ORCHARD: 'ORCH', ORCHRD: 'ORCH',
  OVAL: 'OVAL', OVL: 'OVAL',
  OVERPASS: 'OPAS', OPAS: 'OPAS',
  // P
  PARK: 'PARK', PRK: 'PARK', PARKS: 'PARK',
  PARKWAY: 'PKWY', PARKWY: 'PKWY', PKWAY: 'PKWY', PKWY: 'PKWY', PKY: 'PKWY',
  PARKWAYS: 'PKWY', PKWYS: 'PKWY',
  PASS: 'PASS',
  PASSAGE: 'PSGE', PSGE: 'PSGE',
  PATH: 'PATH', PATHS: 'PATH',
  PIKE: 'PIKE', PIKES: 'PIKE',
  PINE: 'PNE', PNE: 'PNE',
  PINES: 'PNES', PNES: 'PNES',
  PL: 'PL', PLACE: 'PL',
  PLAIN: 'PLN', PLN: 'PLN',
  PLAINS: 'PLNS', PLNS: 'PLNS',
  PLAZA: 'PLZ', PLZ: 'PLZ', PLZA: 'PLZ',
  POINT: 'PT', PT: 'PT',
  POINTS: 'PTS', PTS: 'PTS',
  PORT: 'PRT', PRT: 'PRT',
  PORTS: 'PRTS', PRTS: 'PRTS',
  PR: 'PR', PRAIRIE: 'PR', PRR: 'PR',
  // R
  RAD: 'RADL', RADIAL: 'RADL', RADIEL: 'RADL', RADL: 'RADL',
  RAMP: 'RAMP',
  RANCH: 'RNCH', RANCHES: 'RNCH', RNCH: 'RNCH', RNCHS: 'RNCH',
  RAPID: 'RPD', RPD: 'RPD',
  RAPIDS: 'RPDS', RPDS: 'RPDS',
  REST: 'RST', RST: 'RST',
  RDG: 'RDG', RDGE: 'RDG', RIDGE: 'RDG',
  RDGS: 'RDGS', RIDGES: 'RDGS',
  RIV: 'RIV', RIVER: 'RIV', RVR: 'RIV', RIVR: 'RIV',
  RD: 'RD', ROAD: 'RD',
  ROADS: 'RDS', RDS: 'RDS',
  ROUTE: 'RTE', RTE: 'RTE',
  ROW: 'ROW',
  RUE: 'RUE',
  RUN: 'RUN',
  // S
  SHL: 'SHL', SHOAL: 'SHL',
  SHLS: 'SHLS', SHOALS: 'SHLS',
  SHOAR: 'SHR', SHORE: 'SHR', SHR: 'SHR',
  SHOARS: 'SHRS', SHORES: 'SHRS', SHRS: 'SHRS',
  SKYWAY: 'SKWY', SKWY: 'SKWY',
  SPG: 'SPG', SPNG: 'SPG', SPRING: 'SPG', SPRNG: 'SPG',
  SPGS: 'SPGS', SPNGS: 'SPGS', SPRINGS: 'SPGS', SPRNGS: 'SPGS',
  SPUR: 'SPUR', SPURS: 'SPUR',
  SQ: 'SQ', SQR: 'SQ', SQRE: 'SQ', SQU: 'SQ', SQUARE: 'SQ',
  SQRS: 'SQS', SQUARES: 'SQS', SQS: 'SQS',
  STA: 'STA', STATION: 'STA', STATN: 'STA', STN: 'STA',
  STRA: 'STRA', STRAV: 'STRA', STRAVEN: 'STRA', STRAVENUE: 'STRA', STRAVN: 'STRA', STRVN: 'STRA', STRVNUE: 'STRA',
  STREAM: 'STRM', STREME: 'STRM', STRM: 'STRM',
  STREET: 'ST', STRT: 'ST', ST: 'ST', STR: 'ST',
  STREETS: 'STS', STS: 'STS',
  SMT: 'SMT', SUMIT: 'SMT', SUMITT: 'SMT', SUMMIT: 'SMT',
  // T
  TER: 'TER', TERR: 'TER', TERRACE: 'TER',
  THROUGHWAY: 'TRWY', TRWY: 'TRWY',
  TRACE: 'TRCE', TRACES: 'TRCE', TRCE: 'TRCE',
  TRACK: 'TRAK', TRACKS: 'TRAK', TRAK: 'TRAK', TRK: 'TRAK', TRKS: 'TRAK',
  TRAFFICWAY: 'TRFY', TRFY: 'TRFY',
  TRAIL: 'TRL', TRAILS: 'TRL', TRL: 'TRL', TRLS: 'TRL',
  TRAILER: 'TRLR', TRLR: 'TRLR', TRLRS: 'TRLR',
  TUNEL: 'TUNL', TUNL: 'TUNL', TUNLS: 'TUNL', TUNNEL: 'TUNL', TUNNELS: 'TUNL', TUNNL: 'TUNL',
  TRNPK: 'TPKE', TURNPIKE: 'TPKE', TURNPK: 'TPKE', TPKE: 'TPKE',
  // U
  UNDERPASS: 'UPAS', UPAS: 'UPAS',
  UN: 'UN', UNION: 'UN',
  UNIONS: 'UNS', UNS: 'UNS',
  // V
  VALLEY: 'VLY', VALLY: 'VLY', VLLY: 'VLY', VLY: 'VLY',
  VALLEYS: 'VLYS', VLYS: 'VLYS',
  VDCT: 'VIA', VIA: 'VIA', VIADCT: 'VIA', VIADUCT: 'VIA',
  VIEW: 'VW', VW: 'VW',
  VIEWS: 'VWS', VWS: 'VWS',
  VILL: 'VLG', VILLAG: 'VLG', VILLAGE: 'VLG', VILLG: 'VLG', VILLIAGE: 'VLG', VLG: 'VLG',
  VILLAGES: 'VLGS', VLGS: 'VLGS',
  VILLE: 'VL', VL: 'VL',
  VIS: 'VIS', VIST: 'VIS', VISTA: 'VIS', VST: 'VIS', VSTA: 'VIS',
  // W
  WALK: 'WALK', WALKS: 'WALK',
  WALL: 'WALL',
  WY: 'WAY', WAY: 'WAY',
  WAYS: 'WAYS',
  WELL: 'WL', WL: 'WL',
  WELLS: 'WLS', WLS: 'WLS',
};

/**
 * Appendix C2 secondary unit designators — every recognized token form
 * (standard abbreviation AND spelled-out form). Shipped as a flat array per
 * the contract shape (`"units": [...]`); the §3 algorithm strips a TRAILING
 * designator (+ its value, when the designator takes one) from the street
 * line so units never enter the street key.
 */
export const UNITS: readonly string[] = [
  'APARTMENT', 'APT',
  'BASEMENT', 'BSMT',
  'BUILDING', 'BLDG',
  'DEPARTMENT', 'DEPT',
  'FLOOR', 'FL',
  'FRONT', 'FRNT',
  'HANGAR', 'HNGR',
  'KEY',
  'LOBBY', 'LBBY',
  'LOT',
  'LOWER', 'LOWR',
  'OFFICE', 'OFC',
  'PENTHOUSE', 'PH',
  'PIER',
  'REAR',
  'ROOM', 'RM',
  'SIDE',
  'SLIP',
  'SPACE', 'SPC',
  'STOP',
  'SUITE', 'STE',
  'TRAILER', 'TRLR',
  'UNIT',
  'UPPER', 'UPPR',
  '#',
];

/**
 * Pub 28 C2 designators that do NOT take a secondary range (value). A trailing
 * occurrence of one of these is stripped alone; all other designators are
 * stripped only together with a following value token.
 *
 * Ships in `normalization.json` as `unitsWithoutValue` (§3 amended step 4) —
 * this constant is the table SOURCE at emit time only. The consumer reads the
 * set from the fetched artifact via `tablesFromJson`, never from a vendored
 * copy, exactly like directionals/suffixes/units.
 */
export const UNITS_WITHOUT_VALUE: ReadonlySet<string> = new Set([
  'BASEMENT', 'BSMT',
  'FRONT', 'FRNT',
  'LOBBY', 'LBBY',
  'LOWER', 'LOWR',
  'OFFICE', 'OFC',
  'PENTHOUSE', 'PH',
  'REAR',
  'SIDE',
  'UPPER', 'UPPR',
]);

/** JSON-shape of `US/addresses/normalization.json` per SEAM-CONTRACT v1 §3. */
export interface NormalizationJson {
  normVersion: number;
  directionals: Record<string, string>;
  suffixes: Record<string, string>;
  units: string[];
  /** §3 amended step 4: trailing bare value-less designators (Pub 28 C2). */
  unitsWithoutValue: string[];
}

/**
 * Build the exact object serialized to `US/addresses/normalization.json`.
 * Key order is fixed (normVersion, directionals, suffixes, units,
 * unitsWithoutValue) so the emitted bytes — and therefore the manifest-pinned
 * sha256 — are deterministic across builds of the same normVersion.
 */
export function buildNormalizationJson(): NormalizationJson {
  return {
    normVersion: NORM_VERSION,
    directionals: { ...DIRECTIONALS },
    suffixes: { ...SUFFIXES },
    units: [...UNITS],
    unitsWithoutValue: [...UNITS_WITHOUT_VALUE],
  };
}
