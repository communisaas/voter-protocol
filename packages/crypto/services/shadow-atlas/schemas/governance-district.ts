/**
 * Shadow Atlas Governance District Schema
 *
 * VERSION: 1.1.0 (2025-11-25)
 * - Added optional `validation` field (Layer 3 geometric validation)
 * - Added optional `provenance` field (Layer 4 deduplication)
 *
 * BREAKING CHANGES: None (backward compatible via optional fields)
 *
 * Formal data contract for governance districts consumed by:
 * - VOTER Protocol frontend (TypeScript type safety)
 * - Halo2 ZK proof circuits (deterministic Poseidon hashing)
 * - IPFS publishing (versioned immutable snapshots)
 *
 * VERSIONING STRATEGY:
 * - Schema follows Semantic Versioning (SemVer)
 * - MAJOR: Breaking changes (field removal, type changes)
 * - MINOR: Backward-compatible additions (new optional fields)
 * - PATCH: Documentation/clarification only
 *
 * DETERMINISTIC FIELD ORDER:
 * Field order is CRITICAL for ZK circuits. Poseidon hash depends on:
 * 1. Stable field ordering (must not change between versions)
 * 2. Consistent serialization (same input → same hash)
 * 3. Type coercion rules (number vs string encoding)
 *
 * BREAKING CHANGE POLICY:
 * - Never reorder existing fields (breaks ZK proofs)
 * - Never change field types (breaks consumers)
 * - Deprecate fields instead of removing (mark with @deprecated)
 * - Add new fields at END only (preserves ordering)
 */

/**
 * District Type Enumeration
 *
 * Primary classification of governance district purpose.
 * Ordered by civic importance (elected representation first).
 *
 * ELECTION-FOCUSED HIERARCHY:
 * - Tier 1: Elected representation (city_council, congressional, etc.)
 * - Tier 2: Administrative boundaries (boundary, census)
 * - Tier 3: Appointed/non-governance (zoning, parcel)
 * - Tier 4: Rejected classifications (non_polygon, unknown)
 */
export enum DistrictType {
  // Elected Local Government
  CITY_COUNCIL = 'city_council',
  COUNTY_COMMISSION = 'county_commission',
  SCHOOL_BOARD = 'school_board',

  // Elected State/Federal
  STATE_LEGISLATIVE = 'state_legislative',
  CONGRESSIONAL = 'congressional',

  // Special Districts (may be elected or appointed)
  FIRE_DISTRICT = 'fire_district',
  WATER_DISTRICT = 'water_district',
  LIBRARY_DISTRICT = 'library_district',
  PARK_DISTRICT = 'park_district',
  TRANSIT_DISTRICT = 'transit_district',
  HEALTH_DISTRICT = 'health_district',

  // Administrative / Electoral Management
  PRECINCT = 'precinct',           // Voting precinct
  BOUNDARY = 'boundary',            // Administrative boundary
  CENSUS = 'census',                // Statistical boundary

  // Judicial
  JUDICIAL = 'judicial',            // Court districts

  // Police
  POLICE_DISTRICT = 'police_district',

  // Non-Governance
  ZONING = 'zoning',               // Land use planning
  PARCEL = 'parcel',               // Property parcels

  // Rejected
  NON_POLYGON = 'non_polygon',     // Not polygon geometry
  UNKNOWN = 'unknown',             // Could not classify
}

/**
 * Governance Level Enumeration
 *
 * Hierarchical level of government authority.
 * Ordered by jurisdiction size (federal → municipal).
 */
export enum GovernanceLevel {
  // Elected Governments
  FEDERAL = 'federal',              // Congressional districts
  STATE = 'state',                  // State legislative
  COUNTY = 'county',                // County commission
  MUNICIPAL = 'municipal',          // City/town council

  // Special Purpose
  SPECIAL = 'special',              // Special districts (fire, water, etc.)
  JUDICIAL = 'judicial',            // Court districts

  // Administrative
  ADMINISTRATIVE = 'administrative', // Boundaries without elected bodies
  ELECTORAL_ADMIN = 'electoral_admin', // Precincts, polling places
  PLANNING = 'planning',            // Zoning, land use
  STATISTICAL = 'statistical',      // Census tracts

  // Rejected
  NON_GOVERNANCE = 'non_governance', // Not a governance structure
  UNKNOWN = 'unknown',              // Could not determine
}

/**
 * Quality Tier Enumeration
 *
 * Classification confidence based on comprehensive analysis:
 * - Schema completeness (required fields present)
 * - Name/description patterns (keywords, naming conventions)
 * - Feature count (realistic district size)
 * - Field semantics (district ID, name, elected fields)
 *
 * TIER DEFINITIONS:
 * - GOLD: High confidence elected representation (score >= 70, elected=true)
 * - SILVER: High confidence non-elected governance (score >= 60, elected=false)
 * - BRONZE: Medium confidence classification (score 50-59)
 * - UTILITY: Administrative layers for reference (boundaries, zoning)
 * - REJECT: Low confidence or non-governance (score < 50, non-polygon, unknown)
 */
export enum QualityTier {
  GOLD = 'GOLD',       // Elected representation, high confidence
  SILVER = 'SILVER',   // Non-elected governance, high confidence
  BRONZE = 'BRONZE',   // Medium confidence
  UTILITY = 'UTILITY', // Administrative reference layers
  REJECT = 'REJECT',   // Low confidence or non-governance
}

/**
 * Geometry Type Enumeration
 *
 * ESRI geometry types from ArcGIS FeatureServer.
 * Only Polygon geometry is valid for district boundaries.
 */
export enum GeometryType {
  POLYGON = 'esriGeometryPolygon',
  POLYLINE = 'esriGeometryPolyline',
  POINT = 'esriGeometryPoint',
  MULTIPOINT = 'esriGeometryMultipoint',
  MULTIPATCH = 'esriGeometryMultiPatch',
}

/**
 * Governance District Record
 *
 * Complete metadata for a single governance district layer.
 *
 * FIELD ORDER: IMMUTABLE (DO NOT REORDER - ZK CIRCUIT DEPENDENCY)
 *
 * KNOWN LIMITATIONS:
 * 1. feature_count may be capped at 1000 or 2000 (API maxRecordCount limit)
 *    - Does NOT indicate actual feature count
 *    - Indicates layer exceeded query limit during enumeration
 *    - Actual count may be higher (requires pagination to determine)
 *
 * 2. fields array may be incomplete if layer has >100 fields
 *    - Most layers have <20 fields (complete)
 *    - Edge case: Parcel layers with 200+ attribute columns
 *
 * 3. confidence scores are ML-derived estimates, not ground truth
 *    - Trained on 4,175 human-labeled examples
 *    - Ensemble of multiple classification signals
 *    - Should be validated before production use
 */
export interface GovernanceDistrict {
  /**
   * Parent ArcGIS FeatureServer root URL
   * Example: "https://services.arcgis.com/{id}/arcgis/rest/services/Districts/FeatureServer"
   */
  readonly service_url: string;

  /**
   * Layer index within FeatureServer (0-based)
   * Example: 2 (for layer /FeatureServer/2)
   */
  readonly layer_number: number;

  /**
   * Complete layer URL (service_url + layer_number)
   * Example: "https://services.arcgis.com/{id}/arcgis/rest/services/Districts/FeatureServer/2"
   *
   * PRIMARY KEY: Use this as unique identifier for districts
   */
  readonly layer_url: string;

  /**
   * Layer name from ArcGIS metadata
   * Example: "CouncilDistricts", "Congressional_Districts_2022"
   */
  readonly layer_name: string;

  /**
   * ESRI geometry type
   * CRITICAL: Only esriGeometryPolygon is valid for district boundaries
   */
  readonly geometry_type: GeometryType;

  /**
   * Feature count from ArcGIS metadata
   *
   * LIMITATION: May be capped at API maxRecordCount (often 1000 or 2000)
   * - If feature_count === 1000 or 2000: Layer likely has MORE features
   * - Requires pagination to determine actual count
   * - Use as minimum bound, not exact count
   */
  readonly feature_count: number;

  /**
   * Field names from layer schema
   * Example: ["OBJECTID", "District", "Name", "Shape__Area", "Shape__Length"]
   *
   * LIMITATION: May be incomplete if layer has >100 fields (rare)
   */
  readonly fields: readonly string[];

  /**
   * Primary district classification
   * See DistrictType enum for valid values
   */
  readonly district_type: DistrictType;

  /**
   * Quality tier based on classification confidence
   * See QualityTier enum for tier definitions
   */
  readonly tier: QualityTier;

  /**
   * Governance level (federal, state, county, municipal, etc.)
   * See GovernanceLevel enum for valid values
   */
  readonly governance_level: GovernanceLevel;

  /**
   * Whether district represents elected officials
   * - true: Elected representation (city council, congressional, etc.)
   * - false: Appointed or non-elected (administrative, zoning, etc.)
   */
  readonly elected: boolean;

  /**
   * Classification confidence score (0.0 - 1.0)
   *
   * Derived from ensemble of signals:
   * - Schema completeness (required fields present)
   * - Name/description patterns (keywords match district type)
   * - Feature count (realistic for district type)
   * - Field semantics (has district ID, name, elected fields)
   *
   * INTERPRETATION:
   * - 0.75+: High confidence (GOLD/SILVER tier)
   * - 0.60-0.74: Medium confidence (SILVER/BRONZE tier)
   * - 0.50-0.59: Low confidence (BRONZE tier)
   * - <0.50: Reject (REJECT tier)
   */
  readonly confidence: number;

  /**
   * Integer score (confidence * 100)
   * Range: 0-100
   * Convenience field for display purposes
   */
  readonly score: number;

  /**
   * Human-readable classification reasoning
   * Array of diagnostic strings explaining classification decision
   *
   * Example: [
   *   "✓ city_council in name",
   *   "✓ District ID field",
   *   "✓ Name field",
   *   "✓ Complete schema"
   * ]
   */
  readonly classification_reasons: readonly string[];

  /**
   * Geometric validation results (added by Layer 3)
   * Optional: Only present if Layer 3 validation was run
   *
   * Quality tiers:
   * - HIGH_QUALITY: Valid geometry, reasonable area, all checks pass
   * - MEDIUM_QUALITY: Valid geometry, unusual area (flagged for review)
   * - LOW_QUALITY: Invalid geometry but repairable
   * - REJECTED: Cannot be used (unrepairable, invalid coordinates)
   */
  readonly validation?: {
    readonly quality: 'HIGH_QUALITY' | 'MEDIUM_QUALITY' | 'LOW_QUALITY' | 'REJECTED';
    readonly is_valid: boolean;
    readonly area_km2: number | null;
    readonly coordinate_bounds: {
      readonly min_lat: number;
      readonly max_lat: number;
      readonly min_lon: number;
      readonly max_lon: number;
    } | null;
    readonly checks: {
      readonly self_intersection: string;  // PASS, FAIL, REPAIRED
      readonly area_bounds: string;        // PASS, WARNING, FAIL
      readonly coordinate_validity: string; // PASS, FAIL
      readonly degeneracy: string;         // PASS, FAIL
      readonly closed_rings: string;       // PASS, FAIL
    };
    readonly issues: readonly string[];
    readonly repair_attempted?: boolean;
    readonly sample_size: number;
  };

  /**
   * Deduplication provenance (added by Layer 4)
   * Optional: Only present if Layer 4 deduplication was run
   *
   * Tracks which data sources contributed to this district record
   * and which duplicates were merged (audit trail).
   */
  readonly provenance?: {
    readonly primary_source: {
      readonly url: string;
      readonly priority: number;
      readonly discovered_date: string;
    };
    readonly duplicate_sources: readonly {
      readonly url: string;
      readonly priority: number;
      readonly iou_score?: number;        // Intersection over Union score
      readonly name_similarity?: number;  // Levenshtein similarity
    }[];
    readonly merge_decision: string;
  };
}

/**
 * Shadow Atlas Dataset Metadata
 *
 * Version and coverage statistics for complete dataset.
 * Included in published IPFS snapshot.
 */
export interface ShadowAtlasMetadata {
  /**
   * Schema version (Semantic Versioning)
   * Format: "MAJOR.MINOR.PATCH"
   * Example: "1.0.0"
   */
  readonly schema_version: string;

  /**
   * Dataset generation timestamp (ISO 8601)
   * Example: "2025-11-25T12:34:56.789Z"
   */
  readonly generated_at: string;

  /**
   * Total districts in dataset
   */
  readonly total_districts: number;

  /**
   * Coverage statistics by tier
   */
  readonly coverage_stats: {
    readonly by_tier: Record<QualityTier, number>;
    readonly by_governance_level: Record<GovernanceLevel, number>;
    readonly by_district_type: Record<DistrictType, number>;
    readonly elected_count: number;
    readonly polygon_count: number;
  };

  /**
   * Data sources and provenance
   */
  readonly provenance: {
    readonly source_file: string;
    readonly classification_method: string;
    readonly training_data_size?: number;
    readonly model_version?: string;
  };
}

/**
 * Versioned Shadow Atlas Dataset
 *
 * Complete dataset with metadata for IPFS publishing.
 */
export interface ShadowAtlasDataset {
  readonly metadata: ShadowAtlasMetadata;
  readonly districts: readonly GovernanceDistrict[];
}

/**
 * Runtime Validation Functions
 *
 * Type guards for runtime validation of data contracts.
 * Use these to validate external data before casting to types.
 */

/**
 * Validate DistrictType enum value
 */
export function isDistrictType(value: unknown): value is DistrictType {
  return typeof value === 'string' && Object.values(DistrictType).includes(value as DistrictType);
}

/**
 * Validate GovernanceLevel enum value
 */
export function isGovernanceLevel(value: unknown): value is GovernanceLevel {
  return typeof value === 'string' && Object.values(GovernanceLevel).includes(value as GovernanceLevel);
}

/**
 * Validate QualityTier enum value
 */
export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === 'string' && Object.values(QualityTier).includes(value as QualityTier);
}

/**
 * Validate GeometryType enum value
 */
export function isGeometryType(value: unknown): value is GeometryType {
  return typeof value === 'string' && Object.values(GeometryType).includes(value as GeometryType);
}

/**
 * Validate GovernanceDistrict record structure
 *
 * Performs comprehensive runtime validation:
 * - Required fields present
 * - Field types correct
 * - Enum values valid
 * - Numeric ranges valid (confidence 0-1, score 0-100)
 */
export function isGovernanceDistrict(value: unknown): value is GovernanceDistrict {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const d = value as Record<string, unknown>;

  // Required string fields
  if (typeof d.service_url !== 'string' || d.service_url.length === 0) return false;
  if (typeof d.layer_url !== 'string' || d.layer_url.length === 0) return false;
  if (typeof d.layer_name !== 'string' || d.layer_name.length === 0) return false;

  // Required number fields
  if (typeof d.layer_number !== 'number' || d.layer_number < 0) return false;
  if (typeof d.feature_count !== 'number' || d.feature_count < 0) return false;
  if (typeof d.confidence !== 'number' || d.confidence < 0 || d.confidence > 1) return false;
  if (typeof d.score !== 'number' || d.score < 0 || d.score > 100) return false;

  // Required boolean fields
  if (typeof d.elected !== 'boolean') return false;

  // Required enum fields
  if (!isGeometryType(d.geometry_type)) return false;
  if (!isDistrictType(d.district_type)) return false;
  if (!isQualityTier(d.tier)) return false;
  if (!isGovernanceLevel(d.governance_level)) return false;

  // Required array fields
  if (!Array.isArray(d.fields)) return false;
  if (!d.fields.every((f) => typeof f === 'string')) return false;

  if (!Array.isArray(d.classification_reasons)) return false;
  if (!d.classification_reasons.every((r) => typeof r === 'string')) return false;

  return true;
}

/**
 * Validate ShadowAtlasDataset structure
 */
export function isShadowAtlasDataset(value: unknown): value is ShadowAtlasDataset {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const dataset = value as Record<string, unknown>;

  // Validate metadata exists
  if (typeof dataset.metadata !== 'object' || dataset.metadata === null) {
    return false;
  }

  // Validate districts array
  if (!Array.isArray(dataset.districts)) {
    return false;
  }

  // Sample validation of first district (performance optimization)
  if (dataset.districts.length > 0 && !isGovernanceDistrict(dataset.districts[0])) {
    return false;
  }

  return true;
}

/**
 * Validation Error Details
 *
 * Structured validation error for debugging.
 */
export interface ValidationError {
  readonly field: string;
  readonly value: unknown;
  readonly expected: string;
  readonly message: string;
}

/**
 * Validate validation field structure
 */
export function hasValidation(district: GovernanceDistrict): district is GovernanceDistrict & { validation: NonNullable<GovernanceDistrict['validation']> } {
  return (
    district.validation !== undefined &&
    typeof district.validation.quality === 'string' &&
    typeof district.validation.is_valid === 'boolean' &&
    typeof district.validation.sample_size === 'number' &&
    typeof district.validation.checks === 'object'
  );
}

/**
 * Validate provenance field structure
 */
export function hasProvenance(district: GovernanceDistrict): district is GovernanceDistrict & { provenance: NonNullable<GovernanceDistrict['provenance']> } {
  return (
    district.provenance !== undefined &&
    typeof district.provenance.primary_source === 'object' &&
    Array.isArray(district.provenance.duplicate_sources) &&
    typeof district.provenance.merge_decision === 'string'
  );
}

/**
 * Check if district passed geometric validation
 */
export function isGeometricallyValid(district: GovernanceDistrict): boolean {
  if (!hasValidation(district)) {
    return false; // No validation = unknown quality
  }

  return district.validation.quality === 'HIGH_QUALITY' ||
         district.validation.quality === 'MEDIUM_QUALITY';
}

/**
 * Validate district with detailed error reporting
 *
 * Returns array of validation errors (empty if valid).
 */
export function validateGovernanceDistrict(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== 'object' || value === null) {
    errors.push({
      field: 'root',
      value,
      expected: 'object',
      message: 'District must be an object',
    });
    return errors;
  }

  const d = value as Record<string, unknown>;

  // Validate each field
  const validations: Array<{
    field: string;
    condition: boolean;
    expected: string;
    value: unknown;
  }> = [
    {
      field: 'service_url',
      condition: typeof d.service_url === 'string' && d.service_url.length > 0,
      expected: 'non-empty string',
      value: d.service_url,
    },
    {
      field: 'layer_url',
      condition: typeof d.layer_url === 'string' && d.layer_url.length > 0,
      expected: 'non-empty string',
      value: d.layer_url,
    },
    {
      field: 'layer_name',
      condition: typeof d.layer_name === 'string' && d.layer_name.length > 0,
      expected: 'non-empty string',
      value: d.layer_name,
    },
    {
      field: 'layer_number',
      condition: typeof d.layer_number === 'number' && d.layer_number >= 0,
      expected: 'number >= 0',
      value: d.layer_number,
    },
    {
      field: 'feature_count',
      condition: typeof d.feature_count === 'number' && d.feature_count >= 0,
      expected: 'number >= 0',
      value: d.feature_count,
    },
    {
      field: 'confidence',
      condition: typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 1,
      expected: 'number 0-1',
      value: d.confidence,
    },
    {
      field: 'score',
      condition: typeof d.score === 'number' && d.score >= 0 && d.score <= 100,
      expected: 'number 0-100',
      value: d.score,
    },
    {
      field: 'elected',
      condition: typeof d.elected === 'boolean',
      expected: 'boolean',
      value: d.elected,
    },
    {
      field: 'geometry_type',
      condition: isGeometryType(d.geometry_type),
      expected: `one of: ${Object.values(GeometryType).join(', ')}`,
      value: d.geometry_type,
    },
    {
      field: 'district_type',
      condition: isDistrictType(d.district_type),
      expected: `one of: ${Object.values(DistrictType).join(', ')}`,
      value: d.district_type,
    },
    {
      field: 'tier',
      condition: isQualityTier(d.tier),
      expected: `one of: ${Object.values(QualityTier).join(', ')}`,
      value: d.tier,
    },
    {
      field: 'governance_level',
      condition: isGovernanceLevel(d.governance_level),
      expected: `one of: ${Object.values(GovernanceLevel).join(', ')}`,
      value: d.governance_level,
    },
    {
      field: 'fields',
      condition: Array.isArray(d.fields) && d.fields.every((f) => typeof f === 'string'),
      expected: 'array of strings',
      value: d.fields,
    },
    {
      field: 'classification_reasons',
      condition:
        Array.isArray(d.classification_reasons) &&
        d.classification_reasons.every((r) => typeof r === 'string'),
      expected: 'array of strings',
      value: d.classification_reasons,
    },
  ];

  for (const v of validations) {
    if (!v.condition) {
      errors.push({
        field: v.field,
        value: v.value,
        expected: v.expected,
        message: `Invalid ${v.field}: expected ${v.expected}, got ${JSON.stringify(v.value)}`,
      });
    }
  }

  return errors;
}
