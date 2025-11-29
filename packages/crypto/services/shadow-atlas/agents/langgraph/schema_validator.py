#!/usr/bin/env python3
"""
Language-Agnostic Schema Validator

Validates council district datasets using structural patterns (not keywords).
Works across ANY language without translation.

PHILOSOPHY:
Keywords fail globally. Schema structure is universal.

Council districts have predictable structural patterns:
- ID field (DISTRICT_ID, WARD_NUM, etc.)
- Name field (NAME, NOMBRE, NOM, etc.)
- Geometry field (SHAPE, GEOM, etc.)
- Polygon geometry (districts are areas, not points)
- 4-12 attribute fields typical
- 3-100 features (district count varies by city size)

TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class GeometryType(Enum):
    """Geometry type enumeration."""
    POLYGON = 'Polygon'
    MULTIPOLYGON = 'MultiPolygon'
    POINT = 'Point'
    LINESTRING = 'LineString'
    UNKNOWN = 'Unknown'


class GovernanceLevel(Enum):
    """Governance hierarchy level."""
    MUNICIPAL = 'municipal'      # City/town council
    COUNTY = 'county'            # County commission
    REGIONAL = 'regional'        # Metropolitan/regional authority
    STATE = 'state'              # State legislature
    NATIONAL = 'national'        # Congressional districts
    UNKNOWN = 'unknown'


@dataclass
class SchemaPattern:
    """
    Structural pattern of a council district dataset.

    Language-agnostic features based on field names and types.
    """
    # Field existence patterns
    has_id_field: bool
    has_name_field: bool
    has_district_field: bool
    has_council_field: bool
    has_member_field: bool
    has_geometry_field: bool

    # Schema statistics
    field_count: int
    numeric_field_count: int
    string_field_count: int

    # Geometry properties
    geometry_type: GeometryType
    has_polygon_geometry: bool

    # Feature statistics
    feature_count: Optional[int]
    feature_count_in_range: bool  # 3-100 typical


@dataclass
class ValidationResult:
    """Result of schema validation."""
    is_council_district: bool
    confidence: float  # 0.0-1.0
    score: int  # Raw score (0-100)
    reasons: List[str]  # Why this passed/failed
    governance_level: GovernanceLevel
    pattern: SchemaPattern


class SchemaValidator:
    """
    Language-agnostic schema validator for council district datasets.

    Validates using structural patterns, not keywords.
    """

    # Field name patterns (language-independent substrings)
    ID_PATTERNS = {'ID', 'NUM', 'NO', 'FID', 'OBJECTID', 'OID', 'GID'}

    NAME_PATTERNS = {
        'NAME', 'NOM', 'NOMBRE', 'NAAM', 'BEZEICHNUNG',
        'TITLE', 'LABEL', 'DESCRIPTION'
    }

    DISTRICT_PATTERNS = {
        'DISTRICT', 'DIST', 'WARD', 'BEZIRK', 'ARROND',
        'QUARTIER', 'SECTOR', 'ZONE', 'AREA'
    }

    COUNCIL_PATTERNS = {
        'COUNCIL', 'CONSEIL', 'CONSEJO', 'LEGISLATIVE',
        'MUNICIPAL', 'CITY', 'TOWN', 'BOROUGH'
    }

    MEMBER_PATTERNS = {
        'MEMBER', 'REP', 'COUNCILOR', 'ALDERMAN', 'SUPERVISOR',
        'COMMISSIONER', 'TRUSTEE', 'ELECTED', 'OFFICIAL'
    }

    GEOMETRY_PATTERNS = {
        'SHAPE', 'GEOM', 'GEOMETRY', 'THE_GEOM',
        'WKT', 'WKB', 'POLYGON', 'MULTIPOLYGON'
    }

    # Feature count thresholds by governance level
    FEATURE_COUNT_RANGES = {
        GovernanceLevel.MUNICIPAL: (3, 51),    # NYC has 51 districts
        GovernanceLevel.COUNTY: (3, 25),      # County commissions smaller
        GovernanceLevel.REGIONAL: (5, 50),    # Regional authorities vary
        GovernanceLevel.STATE: (20, 200),     # State legislatures larger
        GovernanceLevel.NATIONAL: (435, 435), # US House = 435 districts
    }

    def validate(
        self,
        fields: List[Dict[str, str]],
        geometry_type: Optional[str],
        feature_count: Optional[int],
        title: str = '',
        description: str = ''
    ) -> ValidationResult:
        """
        Validate a dataset schema for council district characteristics.

        Args:
            fields: List of field dicts with 'name' and 'type' keys
            geometry_type: Geometry type string (e.g., 'esriGeometryPolygon')
            feature_count: Number of features in dataset
            title: Dataset title (optional, for governance level inference)
            description: Dataset description (optional, for context)

        Returns:
            ValidationResult with score, confidence, and reasoning
        """
        # Extract schema pattern
        pattern = self._extract_pattern(fields, geometry_type, feature_count)

        # Score the pattern
        score, reasons = self._score_pattern(pattern, title, description)

        # Infer governance level
        governance_level = self._infer_governance_level(
            pattern, title, description, feature_count
        )

        # Calculate confidence
        confidence = self._calculate_confidence(score, pattern, governance_level)

        # Determine if this is a council district dataset
        is_council_district = score >= 50 and confidence >= 0.6

        return ValidationResult(
            is_council_district=is_council_district,
            confidence=confidence,
            score=score,
            reasons=reasons,
            governance_level=governance_level,
            pattern=pattern
        )

    def _extract_pattern(
        self,
        fields: List[Dict[str, str]],
        geometry_type: Optional[str],
        feature_count: Optional[int]
    ) -> SchemaPattern:
        """Extract structural pattern from schema."""
        field_names_upper = [f.get('name', '').upper() for f in fields]

        # Check for ID field
        has_id = any(
            any(pattern in name for pattern in self.ID_PATTERNS)
            for name in field_names_upper
        )

        # Check for name field
        has_name = any(
            any(pattern in name for pattern in self.NAME_PATTERNS)
            for name in field_names_upper
        )

        # Check for district field
        has_district = any(
            any(pattern in name for pattern in self.DISTRICT_PATTERNS)
            for name in field_names_upper
        )

        # Check for council field
        has_council = any(
            any(pattern in name for pattern in self.COUNCIL_PATTERNS)
            for name in field_names_upper
        )

        # Check for member/representative field
        has_member = any(
            any(pattern in name for pattern in self.MEMBER_PATTERNS)
            for name in field_names_upper
        )

        # Check for geometry field
        has_geometry = any(
            any(pattern in name for pattern in self.GEOMETRY_PATTERNS)
            for name in field_names_upper
        )

        # Count field types
        numeric_count = sum(
            1 for f in fields
            if f.get('type', '').lower() in ('integer', 'double', 'float', 'long', 'short')
        )
        string_count = sum(
            1 for f in fields
            if f.get('type', '').lower() in ('string', 'text', 'varchar')
        )

        # Parse geometry type
        geom_type = self._parse_geometry_type(geometry_type)
        has_polygon = geom_type in (GeometryType.POLYGON, GeometryType.MULTIPOLYGON)

        # Check feature count range
        feature_count_ok = (
            feature_count is not None and
            3 <= feature_count <= 100
        )

        return SchemaPattern(
            has_id_field=has_id,
            has_name_field=has_name,
            has_district_field=has_district,
            has_council_field=has_council,
            has_member_field=has_member,
            has_geometry_field=has_geometry,
            field_count=len(fields),
            numeric_field_count=numeric_count,
            string_field_count=string_count,
            geometry_type=geom_type,
            has_polygon_geometry=has_polygon,
            feature_count=feature_count,
            feature_count_in_range=feature_count_ok
        )

    def _score_pattern(
        self,
        pattern: SchemaPattern,
        title: str,
        description: str
    ) -> Tuple[int, List[str]]:
        """Score a schema pattern (0-100 scale)."""
        score = 0
        reasons = []

        # GEOMETRY TYPE (30 points or -20 penalty)
        if pattern.has_polygon_geometry:
            score += 30
            reasons.append(f"✓ Polygon geometry ({pattern.geometry_type.value})")
        elif pattern.geometry_type == GeometryType.POINT:
            score -= 20
            reasons.append(f"✗ Point geometry (districts should be polygons)")
        else:
            score -= 10
            reasons.append(f"? Unknown geometry type")

        # DISTRICT FIELD (20 points)
        if pattern.has_district_field:
            score += 20
            reasons.append("✓ Has district-related field")

        # ID + NAME FIELDS (15 points total)
        if pattern.has_id_field:
            score += 8
            reasons.append("✓ Has ID field")
        if pattern.has_name_field:
            score += 7
            reasons.append("✓ Has name field")

        # COUNCIL FIELD (15 points)
        if pattern.has_council_field:
            score += 15
            reasons.append("✓ Has council-related field")

        # MEMBER/REPRESENTATIVE FIELD (10 points)
        if pattern.has_member_field:
            score += 10
            reasons.append("✓ Has member/representative field")

        # FIELD COUNT (10 points or penalty)
        if 4 <= pattern.field_count <= 20:
            score += 10
            reasons.append(f"✓ Field count in expected range ({pattern.field_count})")
        elif pattern.field_count > 50:
            score -= 10
            reasons.append(f"✗ Too many fields ({pattern.field_count}) - likely wrong granularity")

        # FEATURE COUNT (10 points or penalty)
        if pattern.feature_count_in_range:
            score += 10
            reasons.append(f"✓ Feature count in range ({pattern.feature_count})")
        elif pattern.feature_count and pattern.feature_count > 100:
            score -= 10
            reasons.append(f"✗ Too many features ({pattern.feature_count}) - likely sub-district data")

        # GEOMETRY FIELD (5 points)
        if pattern.has_geometry_field:
            score += 5
            reasons.append("✓ Has explicit geometry field")

        # Clamp to 0-100
        score = max(0, min(100, score))

        return score, reasons

    def _infer_governance_level(
        self,
        pattern: SchemaPattern,
        title: str,
        description: str,
        feature_count: Optional[int]
    ) -> GovernanceLevel:
        """
        Infer governance hierarchy level from schema and context.
        """
        text = f"{title} {description}".upper()

        # Municipal indicators
        municipal_keywords = ['CITY', 'TOWN', 'MUNICIPAL', 'BOROUGH', 'VILLAGE']
        if any(kw in text for kw in municipal_keywords):
            return GovernanceLevel.MUNICIPAL

        # County indicators
        county_keywords = ['COUNTY', 'COMMISSION', 'SUPERVISOR']
        if any(kw in text for kw in county_keywords):
            return GovernanceLevel.COUNTY

        # State indicators
        state_keywords = ['STATE', 'LEGISLATIVE', 'ASSEMBLY', 'SENATE', 'HOUSE']
        if any(kw in text for kw in state_keywords):
            return GovernanceLevel.STATE

        # National indicators
        national_keywords = ['CONGRESSIONAL', 'CONGRESS', 'FEDERAL', 'US HOUSE']
        if any(kw in text for kw in national_keywords):
            return GovernanceLevel.NATIONAL

        # Use feature count as fallback
        if feature_count:
            if feature_count == 435:
                return GovernanceLevel.NATIONAL  # US House
            elif feature_count >= 100:
                return GovernanceLevel.STATE
            elif feature_count >= 25:
                return GovernanceLevel.COUNTY
            else:
                return GovernanceLevel.MUNICIPAL

        return GovernanceLevel.UNKNOWN

    def _calculate_confidence(
        self,
        score: int,
        pattern: SchemaPattern,
        governance_level: GovernanceLevel
    ) -> float:
        """
        Calculate confidence in classification (0.0-1.0).

        High confidence requires:
        - High score (>70)
        - Polygon geometry
        - Valid feature count
        - Known governance level
        """
        confidence = score / 100.0

        # Boost confidence if all key signals present
        if all([
            pattern.has_polygon_geometry,
            pattern.has_district_field,
            pattern.has_id_field,
            pattern.has_name_field
        ]):
            confidence = min(1.0, confidence + 0.1)

        # Reduce confidence if missing critical signals
        if not pattern.has_polygon_geometry:
            confidence *= 0.7

        if pattern.feature_count and not pattern.feature_count_in_range:
            confidence *= 0.8

        if governance_level == GovernanceLevel.UNKNOWN:
            confidence *= 0.9

        return round(confidence, 3)

    def _parse_geometry_type(self, geometry_type: Optional[str]) -> GeometryType:
        """Parse geometry type string into enum."""
        if not geometry_type:
            return GeometryType.UNKNOWN

        geom_upper = geometry_type.upper()

        if 'POLYGON' in geom_upper and 'MULTI' not in geom_upper:
            return GeometryType.POLYGON
        elif 'MULTIPOLYGON' in geom_upper or 'MULTI' in geom_upper:
            return GeometryType.MULTIPOLYGON
        elif 'POINT' in geom_upper:
            return GeometryType.POINT
        elif 'LINE' in geom_upper:
            return GeometryType.LINESTRING
        else:
            return GeometryType.UNKNOWN


# Example usage
if __name__ == '__main__':
    validator = SchemaValidator()

    # Test case 1: Valid council district schema
    print("TEST 1: Seattle City Council Districts")
    print("="*60)
    result1 = validator.validate(
        fields=[
            {'name': 'DISTRICT_NUM', 'type': 'Integer'},
            {'name': 'DISTRICT_NAME', 'type': 'String'},
            {'name': 'COUNCIL_MEMBER', 'type': 'String'},
            {'name': 'POPULATION', 'type': 'Integer'},
            {'name': 'SHAPE', 'type': 'Geometry'}
        ],
        geometry_type='esriGeometryPolygon',
        feature_count=7,
        title='Seattle City Council Districts',
        description='Official council district boundaries for Seattle'
    )

    print(f"Is Council District: {result1.is_council_district}")
    print(f"Confidence: {result1.confidence:.2f}")
    print(f"Score: {result1.score}/100")
    print(f"Governance Level: {result1.governance_level.value}")
    print("\nReasons:")
    for reason in result1.reasons:
        print(f"  {reason}")

    print("\n" + "="*60)
    print("TEST 2: ZIP Code Boundaries (Should FAIL)")
    print("="*60)
    result2 = validator.validate(
        fields=[
            {'name': 'ZIP_CODE', 'type': 'String'},
            {'name': 'PO_NAME', 'type': 'String'},
            {'name': 'STATE', 'type': 'String'},
            {'name': 'SHAPE', 'type': 'Geometry'}
        ],
        geometry_type='esriGeometryPolygon',
        feature_count=250,  # Too many
        title='ZIP Code Boundaries',
        description='US Postal Service ZIP code areas'
    )

    print(f"Is Council District: {result2.is_council_district}")
    print(f"Confidence: {result2.confidence:.2f}")
    print(f"Score: {result2.score}/100")
    print(f"Governance Level: {result2.governance_level.value}")
    print("\nReasons:")
    for reason in result2.reasons:
        print(f"  {reason}")
