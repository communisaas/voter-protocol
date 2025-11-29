"""
Discovery Workflow State

Defines the state schema for the boundary discovery workflow.
All state is checkpointed to enable resume from any point.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Annotated
from operator import add
import time


class DiscoveryPhase(str, Enum):
    INITIALIZING = "initializing"
    LOADING_PLACES = "loading_places"
    CLASSIFYING_GOVERNANCE = "classifying_governance"
    SEARCHING_SOURCES = "searching_sources"
    VALIDATING_URLS = "validating_urls"
    WRITING_REGISTRY = "writing_registry"
    COMPLETE = "complete"
    FAILED = "failed"


class GovernanceType(str, Enum):
    WARD = "ward"
    DISTRICT = "district"
    COMMISSION = "commission"
    AT_LARGE = "at-large"
    UNKNOWN = "unknown"


class Confidence(str, Enum):
    VERIFIED = "verified"
    INFERRED = "inferred"
    NEEDS_RESEARCH = "needs-research"


class SourceType(str, Enum):
    ARCGIS = "arcgis"
    SOCRATA = "socrata"
    CKAN = "ckan"
    STATE_GIS = "state-gis"
    COUNTY_GIS = "county-gis"
    CITY_GIS = "city-gis"


@dataclass
class Place:
    """Place record from Census or equivalent source"""
    id: str
    name: str
    state: str
    country_code: str
    population: int
    place_type: str


@dataclass
class GovernanceClassification:
    """Governance classification result"""
    place_id: str
    place_name: str
    governance_type: GovernanceType
    expected_districts: int
    confidence: Confidence
    source: str
    reasoning: str


@dataclass
class CandidateUrl:
    """Candidate URL discovered from GIS sources"""
    place_id: str
    url: str
    source: SourceType
    layer_name: str
    confidence: float
    discovered_at: float = field(default_factory=time.time)


@dataclass
class ValidatedBoundary:
    """Validated boundary result"""
    place_id: str
    place_name: str
    url: str
    format: str  # geojson, shapefile, feature-service
    feature_count: int
    geometry_type: str
    validated_at: float = field(default_factory=time.time)
    response_time_ms: float = 0.0


@dataclass
class DiscoveryError:
    """Discovery error record"""
    place_id: str
    phase: DiscoveryPhase
    error: str
    timestamp: float = field(default_factory=time.time)
    retry_count: int = 0


@dataclass
class DiscoverySummary:
    """Discovery summary"""
    region: str
    total_places: int
    ward_based_places: int
    at_large_places: int
    boundaries_found: int
    boundaries_missing: int
    coverage_percent: float
    total_api_calls: int
    total_cost: float
    duration_ms: float


# LangGraph state reducer for lists - appends items instead of replacing
def list_reducer(current: list, new: list) -> list:
    """Reducer that appends new items to existing list"""
    return current + new


@dataclass
class DiscoveryState:
    """
    Complete discovery state for LangGraph.

    Uses Annotated types with reducers for proper list handling
    in parallel execution (fan-out/fan-in).
    """
    # Input (immutable)
    region: str = ""

    # Progress tracking
    phase: DiscoveryPhase = DiscoveryPhase.INITIALIZING
    current_place_index: int = 0

    # Data collections - use reducers for parallel append
    places: Annotated[list[Place], add] = field(default_factory=list)
    classifications: Annotated[list[GovernanceClassification], add] = field(default_factory=list)
    candidate_urls: Annotated[list[CandidateUrl], add] = field(default_factory=list)
    validated_boundaries: Annotated[list[ValidatedBoundary], add] = field(default_factory=list)

    # Error handling
    errors: Annotated[list[DiscoveryError], add] = field(default_factory=list)
    retry_queue: list[str] = field(default_factory=list)

    # Metrics
    started_at: float = field(default_factory=time.time)
    last_checkpoint: float = field(default_factory=time.time)
    api_call_count: int = 0
    estimated_cost: float = 0.0

    # Summary (populated at end)
    summary: Optional[DiscoverySummary] = None

    # Progress notifications
    progress_message: str = ""
    progress_percent: float = 0.0


def create_initial_state(region: str) -> dict:
    """Create initial state for a discovery run"""
    return {
        "region": region,
        "phase": DiscoveryPhase.INITIALIZING,
        "current_place_index": 0,
        "places": [],
        "classifications": [],
        "candidate_urls": [],
        "validated_boundaries": [],
        "errors": [],
        "retry_queue": [],
        "started_at": time.time(),
        "last_checkpoint": time.time(),
        "api_call_count": 0,
        "estimated_cost": 0.0,
        "summary": None,
        "progress_message": "Initializing discovery...",
        "progress_percent": 0.0,
    }


def calculate_summary(state: dict) -> DiscoverySummary:
    """Calculate summary from completed state"""
    classifications = state.get("classifications", [])

    ward_based = [
        c for c in classifications
        if c.governance_type not in (GovernanceType.AT_LARGE, GovernanceType.UNKNOWN)
    ]
    at_large = [c for c in classifications if c.governance_type == GovernanceType.AT_LARGE]

    boundaries_found = len(state.get("validated_boundaries", []))
    boundaries_needed = len(ward_based)
    coverage_percent = (
        (boundaries_found / boundaries_needed) * 100 if boundaries_needed > 0 else 100
    )

    return DiscoverySummary(
        region=state.get("region", ""),
        total_places=len(state.get("places", [])),
        ward_based_places=len(ward_based),
        at_large_places=len(at_large),
        boundaries_found=boundaries_found,
        boundaries_missing=boundaries_needed - boundaries_found,
        coverage_percent=round(coverage_percent, 1),
        total_api_calls=state.get("api_call_count", 0),
        total_cost=round(state.get("estimated_cost", 0.0), 4),
        duration_ms=(time.time() - state.get("started_at", time.time())) * 1000,
    )
