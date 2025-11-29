"""
State GIS Portal Registry

Pre-compiled registry of state GIS clearinghouses, MSDI portals,
and known boundary data sources.

This is the SECRET WEAPON for efficient discovery:
- State portals often have statewide ward/precinct data
- One query can cover ALL cities in a state
- Much faster than searching city-by-city

Authority hierarchy:
1. State GIS/MSDI - Official state geographic information office
2. State Open Data - data.{state}.gov portals
3. State Secretary of State - Election boundary data
4. ESRI Living Atlas - Curated authoritative sources
"""

from dataclasses import dataclass
from typing import List, Optional, Dict


@dataclass
class StateGISPortal:
    """State GIS portal configuration"""
    state: str
    name: str
    url: str
    arcgis_rest_url: Optional[str] = None
    has_ward_data: bool = False
    has_precinct_data: bool = False
    notes: Optional[str] = None


@dataclass
class KnownBoundarySource:
    """Pre-verified boundary data source"""
    state: str
    boundary_type: str  # "ward", "precinct", "council_district"
    coverage: str  # "statewide" or specific city/county
    url: str
    format: str  # "arcgis", "geojson", "shapefile"
    authority_tier: int  # 1-4
    verified: bool = True
    notes: Optional[str] = None


# =============================================================================
# STATE GIS PORTALS
# =============================================================================

STATE_GIS_PORTALS: Dict[str, StateGISPortal] = {
    # WESTERN STATES
    "MT": StateGISPortal(
        state="MT",
        name="Montana State Library MSDI",
        url="https://geoinfo.msl.mt.gov/",
        arcgis_rest_url="https://gis.dnrc.mt.gov/arcgis/rest/services",
        has_ward_data=True,
        has_precinct_data=True,
        notes="MSDI has statewide ward boundaries - best source for MT",
    ),
    "WY": StateGISPortal(
        state="WY",
        name="Wyoming Geospatial Hub",
        url="https://geospatialhub.wyoming.gov/",
        arcgis_rest_url="https://services.wygisc.org/arcgis/rest/services",
        has_precinct_data=True,
    ),
    "CO": StateGISPortal(
        state="CO",
        name="Colorado Information Marketplace",
        url="https://data.colorado.gov/",
        has_precinct_data=True,
        notes="Secretary of State has precinct boundaries",
    ),
    "UT": StateGISPortal(
        state="UT",
        name="Utah AGRC",
        url="https://gis.utah.gov/",
        arcgis_rest_url="https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services",
        has_precinct_data=True,
        notes="AGRC is excellent - highly organized state GIS",
    ),
    "NV": StateGISPortal(
        state="NV",
        name="Nevada GeoHub",
        url="https://nevadageohub.org/",
    ),
    "AZ": StateGISPortal(
        state="AZ",
        name="Arizona State Land Department GIS",
        url="https://land.az.gov/mapping-services",
        arcgis_rest_url="https://gis.azland.gov/arcgis/rest/services",
    ),
    "NM": StateGISPortal(
        state="NM",
        name="NM Resource Geographic Information System",
        url="https://rgis.unm.edu/",
    ),
    "ID": StateGISPortal(
        state="ID",
        name="Idaho Geospatial Office",
        url="https://gis.idaho.gov/",
    ),

    # PACIFIC STATES
    "CA": StateGISPortal(
        state="CA",
        name="California Open Data Portal",
        url="https://data.ca.gov/",
        notes="Statewide Redistricting Database has district boundaries",
    ),
    "OR": StateGISPortal(
        state="OR",
        name="Oregon Spatial Data Library",
        url="https://spatialdata.oregonexplorer.info/",
    ),
    "WA": StateGISPortal(
        state="WA",
        name="Washington Geospatial Open Data Portal",
        url="https://geo.wa.gov/",
        has_precinct_data=True,
    ),

    # MIDWEST STATES
    "MN": StateGISPortal(
        state="MN",
        name="Minnesota Geospatial Commons",
        url="https://gisdata.mn.gov/",
        has_precinct_data=True,
        notes="Excellent coverage - MN has good open data culture",
    ),
    "WI": StateGISPortal(
        state="WI",
        name="Wisconsin Legislative Technology Services Bureau",
        url="https://maps.legis.wisconsin.gov/",
        has_ward_data=True,
        notes="LTSB has all ward boundaries",
    ),
    "MI": StateGISPortal(
        state="MI",
        name="Michigan Open Data Portal",
        url="https://gis-michigan.opendata.arcgis.com/",
    ),
    "IL": StateGISPortal(
        state="IL",
        name="Illinois Geospatial Clearinghouse",
        url="https://clearinghouse.isgs.illinois.edu/",
    ),
    "OH": StateGISPortal(
        state="OH",
        name="Ohio Geographically Referenced Information Program",
        url="https://ogrip.oit.ohio.gov/",
        arcgis_rest_url="https://gis3.oit.ohio.gov/arcgis/rest/services",
    ),
    "IN": StateGISPortal(
        state="IN",
        name="IndianaMap",
        url="https://www.indianamap.org/",
        arcgis_rest_url="https://services.indianamap.org/arcgis/rest/services",
    ),
    "IA": StateGISPortal(
        state="IA",
        name="Iowa Geodata",
        url="https://geodata.iowa.gov/",
    ),
    "MO": StateGISPortal(
        state="MO",
        name="Missouri Spatial Data Information Service",
        url="https://msdis.missouri.edu/",
    ),
    "KS": StateGISPortal(
        state="KS",
        name="Kansas Data Access & Support Center",
        url="https://www.kansasgis.org/",
    ),
    "NE": StateGISPortal(
        state="NE",
        name="Nebraska GIS Steering Committee",
        url="https://nitc.nebraska.gov/gis/",
    ),
    "SD": StateGISPortal(
        state="SD",
        name="South Dakota GIS",
        url="https://opendata2017-09-18t192802468z-sdbit.opendata.arcgis.com/",
    ),
    "ND": StateGISPortal(
        state="ND",
        name="North Dakota GIS Hub",
        url="https://gis.nd.gov/",
    ),

    # SOUTHERN STATES
    "TX": StateGISPortal(
        state="TX",
        name="Texas Natural Resources Information System",
        url="https://tnris.org/",
        notes="TNRIS is the authoritative state GIS clearinghouse",
    ),
    "OK": StateGISPortal(
        state="OK",
        name="Oklahoma GIS Council",
        url="https://www.okmaps.org/",
    ),
    "AR": StateGISPortal(
        state="AR",
        name="Arkansas GIS Office",
        url="https://gis.arkansas.gov/",
    ),
    "LA": StateGISPortal(
        state="LA",
        name="Louisiana Spatial Data Clearinghouse",
        url="https://atlas.ga.lsu.edu/",
    ),
    "FL": StateGISPortal(
        state="FL",
        name="Florida Geographic Data Library",
        url="https://www.fgdl.org/",
    ),
    "GA": StateGISPortal(
        state="GA",
        name="Georgia GIS Clearinghouse",
        url="https://gis.georgia.gov/",
    ),
    "NC": StateGISPortal(
        state="NC",
        name="NC OneMap",
        url="https://www.nconemap.gov/",
        has_precinct_data=True,
    ),
    "SC": StateGISPortal(
        state="SC",
        name="SC GIS Clearinghouse",
        url="https://gis.sc.gov/",
    ),
    "VA": StateGISPortal(
        state="VA",
        name="Virginia GIS Clearinghouse",
        url="https://vgin.vdem.virginia.gov/",
    ),
    "TN": StateGISPortal(
        state="TN",
        name="Tennessee GIS Clearinghouse",
        url="https://www.tn.gov/finance/sts-gis.html",
    ),
    "KY": StateGISPortal(
        state="KY",
        name="Kentucky Geography Network",
        url="https://kygeonet.ky.gov/",
    ),
    "AL": StateGISPortal(
        state="AL",
        name="Alabama GIS Community",
        url="https://alabamagis.opendata.arcgis.com/",
    ),
    "MS": StateGISPortal(
        state="MS",
        name="Mississippi GIS Portal",
        url="https://www.maris.state.ms.us/",
    ),

    # NORTHEAST STATES
    "NY": StateGISPortal(
        state="NY",
        name="NYS GIS Clearinghouse",
        url="https://gis.ny.gov/",
        has_ward_data=True,
        notes="Board of Elections has precinct boundaries",
    ),
    "PA": StateGISPortal(
        state="PA",
        name="Pennsylvania Spatial Data Access",
        url="https://www.pasda.psu.edu/",
    ),
    "NJ": StateGISPortal(
        state="NJ",
        name="NJ Geographic Information Network",
        url="https://njgin.nj.gov/",
    ),
    "MA": StateGISPortal(
        state="MA",
        name="MassGIS",
        url="https://www.mass.gov/orgs/massgis-bureau-of-geographic-information",
        has_ward_data=True,
        has_precinct_data=True,
        notes="MassGIS is excellent - has all ward and precinct boundaries",
    ),
    "CT": StateGISPortal(
        state="CT",
        name="CT GeoData Portal",
        url="https://ct-deep-gis-open-data-website-ctdeep.hub.arcgis.com/",
    ),
    "RI": StateGISPortal(
        state="RI",
        name="RIGIS",
        url="https://www.rigis.org/",
    ),
    "VT": StateGISPortal(
        state="VT",
        name="Vermont Center for Geographic Information",
        url="https://geodata.vermont.gov/",
    ),
    "NH": StateGISPortal(
        state="NH",
        name="NH GRANIT",
        url="https://granit.unh.edu/",
    ),
    "ME": StateGISPortal(
        state="ME",
        name="Maine GeoLibrary",
        url="https://geolibrary.maine.gov/",
    ),
    "MD": StateGISPortal(
        state="MD",
        name="Maryland iMap",
        url="https://imap.maryland.gov/",
    ),
    "DE": StateGISPortal(
        state="DE",
        name="Delaware FirstMap",
        url="https://firstmap.delaware.gov/",
    ),
    "WV": StateGISPortal(
        state="WV",
        name="WV GIS Technical Center",
        url="https://wvgis.wvu.edu/",
    ),

    # OTHER
    "AK": StateGISPortal(
        state="AK",
        name="Alaska State Geo-Spatial Data Clearinghouse",
        url="https://gis.data.alaska.gov/",
    ),
    "HI": StateGISPortal(
        state="HI",
        name="Hawaii Statewide GIS Program",
        url="https://geoportal.hawaii.gov/",
    ),
    "DC": StateGISPortal(
        state="DC",
        name="DC Open Data",
        url="https://opendata.dc.gov/",
        has_ward_data=True,
        notes="DC has 8 wards - excellent open data",
    ),
}


# =============================================================================
# PRE-VERIFIED BOUNDARY SOURCES
# =============================================================================

# These are KNOWN GOOD sources discovered through manual research
# Each has been validated to return correct boundary data

KNOWN_BOUNDARY_SOURCES: List[KnownBoundarySource] = [
    # MONTANA (from previous discovery)
    KnownBoundarySource(
        state="MT",
        boundary_type="ward",
        coverage="Missoula",
        url="https://services.arcgis.com/HfwHS0BxZBQ1E5DY/arcgis/rest/services/PoliticalBoundaries_mso/FeatureServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
        format="arcgis",
        authority_tier=1,
        notes="City of Missoula GIS - 6 wards",
    ),
    KnownBoundarySource(
        state="MT",
        boundary_type="ward",
        coverage="Billings",
        url="https://services1.arcgis.com/YZCmUqbcsUpOKfj6/arcgis/rest/services/CityWards/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
        format="arcgis",
        authority_tier=2,
        notes="Yellowstone County GIS - 5 wards",
    ),
    KnownBoundarySource(
        state="MT",
        boundary_type="ward",
        coverage="Great Falls",
        url="https://services1.arcgis.com/R0wPAreANzWdkwJP/arcgis/rest/services/CascadeCounty_GreatFalls_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
        format="arcgis",
        authority_tier=2,
        notes="Cascade County GIS - 4 wards",
    ),
    KnownBoundarySource(
        state="MT",
        boundary_type="ward",
        coverage="statewide",
        url="https://gis.dnrc.mt.gov/arcgis/rest/services",
        format="arcgis",
        authority_tier=3,
        notes="Montana MSDI - has statewide ward layer including Havre, Laurel, Anaconda",
    ),

    # WISCONSIN (known to have statewide ward data)
    KnownBoundarySource(
        state="WI",
        boundary_type="ward",
        coverage="statewide",
        url="https://maps.legis.wisconsin.gov/",
        format="arcgis",
        authority_tier=1,
        notes="LTSB has all ward boundaries for entire state",
    ),

    # MASSACHUSETTS (excellent state GIS)
    KnownBoundarySource(
        state="MA",
        boundary_type="ward",
        coverage="statewide",
        url="https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles/state/wards.zip",
        format="shapefile",
        authority_tier=1,
        notes="MassGIS statewide wards - very complete",
    ),

    # DC (8 wards, well documented)
    KnownBoundarySource(
        state="DC",
        boundary_type="ward",
        coverage="statewide",
        url="https://opendata.dc.gov/datasets/DCGIS::ward-from-2022/explore",
        format="arcgis",
        authority_tier=1,
        notes="DC Open Data - 8 wards",
    ),
]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_state_portal(state: str) -> Optional[StateGISPortal]:
    """Get state GIS portal configuration"""
    return STATE_GIS_PORTALS.get(state.upper())


def get_known_sources(state: str, boundary_type: str = "ward") -> List[KnownBoundarySource]:
    """Get pre-verified sources for a state"""
    return [
        s for s in KNOWN_BOUNDARY_SOURCES
        if s.state == state.upper() and s.boundary_type == boundary_type
    ]


def get_statewide_source(state: str) -> Optional[KnownBoundarySource]:
    """Get statewide boundary source if available"""
    sources = [
        s for s in KNOWN_BOUNDARY_SOURCES
        if s.state == state.upper() and s.coverage == "statewide"
    ]
    return sources[0] if sources else None


def list_states_with_portals() -> List[str]:
    """List all states with known GIS portals"""
    return sorted(STATE_GIS_PORTALS.keys())


def list_states_with_statewide_data() -> List[str]:
    """List states known to have statewide ward/precinct data"""
    return sorted(set(
        s.state for s in KNOWN_BOUNDARY_SOURCES
        if s.coverage == "statewide"
    ))
