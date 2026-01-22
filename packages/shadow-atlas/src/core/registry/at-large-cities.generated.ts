/**
 * At-Large City Council Registry
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/at-large-cities.ndjson
 * !! Generated: 2026-01-20T02:49:18.243Z
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Cities with at-large voting (no geographic districts)
 * At-large cities: 35
 * Description: Cities with at-large voting (no geographic districts)
 */

export interface AtLargeCity {
  readonly cityName: string;
  readonly state: string;
  readonly councilSize: number;
  readonly electionMethod: 'at-large' | 'proportional';
  readonly source: string;
  readonly notes?: string;
}

export const AT_LARGE_CITIES: Record<string, AtLargeCity> = {
  '0178552': {
      "cityName": "Vestavia Hills",
      "state": "AL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "https://vhal.org/government/city-leadership-2/; Wave F 2026-01-19",
      "notes": "Council-manager form. 4 council members + mayor, all elected at-large citywide. Jefferson County Birmingham suburb (~39k). No geographic districts."
  },
  '0632548': {
      "cityName": "Hawthorne",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Hawthorne Municipal Code, Chapter 2; WS-2 investigation",
      "notes": "At-large elections for all council positions. Registry mistakenly contained SCAG (Southern California Association of Governments) regional planning districts (52 features), not city council districts."
  },
  '0639003': {
      "cityName": "La Cañada Flintridge",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of La Cañada Flintridge official website",
      "notes": "At-large council elections. Registry contained \"Enriched Council_District\" analysis layer (7 features) which is NOT council district data - likely census/demographic enrichment."
  },
  '0667112': {
      "cityName": "San Jacinto",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of San Jacinto official website; Ballotpedia; WS-F investigation 2026-01-18",
      "notes": "General law city with at-large council elections. Registry mistakenly contained Hemet city council district data (5 districts)."
  },
  '0670000': {
      "cityName": "Santa Monica",
      "state": "CA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://www.santamonica.gov/topic-explainers/elections; CalMatters 2023-10",
      "notes": "One of few California cities resisting CVRA transition to district elections. Pico Neighborhood Association v. Santa Monica ongoing at CA Supreme Court. At-large elections continue pending resolution."
  },
  '0683332': {
      "cityName": "Walnut",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Walnut official website; Ballotpedia; WS-F investigation 2026-01-18",
      "notes": "At-large council elections. Registry mistakenly contained West Covina city council district data (5 districts)."
  },
  '1278325': {
      "cityName": "Winter Springs",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Winter Springs official website; WS-F investigation 2026-01-18",
      "notes": "Currently at-large elections (commissioners must reside in districts but elected citywide). 2026 referendum proposes transition to single-member districts. Registry had BWCF regional jurisdiction data (73 features)."
  },
  '1351670': {
      "cityName": "Milton",
      "state": "GA",
      "councilSize": 6,
      "electionMethod": "at-large",
      "source": "City of Milton official website; At-large research 2026-01-16",
      "notes": "At-large voting: all registered voters cast ballots for all council seats. Councilmembers must live in their district but are elected citywide. Mayor also elected at-large."
  },
  '1869354': {
      "cityName": "Sheridan",
      "state": "IN",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "Ballotpedia Town Council Member, At Large elections",
      "notes": "Town council has 7 members elected at-large. No geographic districts exist. Registry mistakenly contained township redistricting data."
  },
  '2038900': {
      "cityName": "Lawrence",
      "state": "KS",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "https://lawrenceks.org/city-commission/; Wave E great-plains-specialist 2026-01-19",
      "notes": "5 commissioners elected at-large. Voters rejected ward system proposal in 2024. Commission-manager government."
  },
  '2044250': {
      "cityName": "Manhattan",
      "state": "KS",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Manhattan official website; Wave E great-plains-specialist 2026-01-19",
      "notes": "5 commissioners elected at-large. Commission-manager government typical of Kansas cities."
  },
  '2247560': {
      "cityName": "Madisonville",
      "state": "LA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "https://townofmadisonville.org/mayor-and-council; NOLA.com",
      "notes": "Town council seats go to top 5 vote-getters (at-large plurality system). No geographic ward or district structure."
  },
  '2467675': {
      "cityName": "Rockville",
      "state": "MD",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://www.rockvillemd.gov/424/Mayor-and-Council; Wave E mid-atlantic-specialist 2026-01-19",
      "notes": "At-large council system with 6 councilmembers + mayor elected city-wide. Council expanded from 4 to 6 members in 2023. No geographic districts."
  },
  '2511000': {
      "cityName": "Cambridge",
      "state": "MA",
      "councilSize": 9,
      "electionMethod": "proportional",
      "source": "Cambridge City Charter, Article II (Plan E)",
      "notes": "Uses proportional representation (ranked-choice voting) since 1941. One of few US cities with proportional representation."
  },
  '2604080': {
      "cityName": "Auburn",
      "state": "MI",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://auburnmi.gov/city-commission/; Wave F 2026-01-19",
      "notes": "City Commission structure. 6 commissioners + mayor elected at-large citywide. Non-partisan elections. Bay County (~2k population)."
  },
  '2755186': {
      "cityName": "Rogers",
      "state": "MN",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City Council page (rogersmn.gov/citycouncil); Municipal GIS research 2026-01-19",
      "notes": "5-member council (mayor + 4 council members) elected at-large. No ward boundaries. Quarantine showed Hennepin County/Met Council districts (16 features)."
  },
  '2767612': {
      "cityName": "Waite Park",
      "state": "MN",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "Mayor & City Council page (ci.waitepark.mn.us); Municipal GIS research 2026-01-19",
      "notes": "Statutory plan A city: mayor + 4 council members elected at-large. No ward boundaries. Quarantine showed Stearns County/St. Cloud districts (7 features)."
  },
  '3146520': {
      "cityName": "Springfield",
      "state": "NE",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Springfield official website (springfieldne.org); municipal code research; WS-J investigation 2026-01-18",
      "notes": "Small Nebraska city with mayor-council government. At-large elections typical for NE cities under 5,000 population (NRS 32-554). Registry mistakenly contained Sarpy County ElectionAdmin data (19 features, 96.8% outside city boundary)."
  },
  '3654705': {
      "cityName": "Old Westbury",
      "state": "NY",
      "councilSize": 4,
      "electionMethod": "at-large",
      "source": "Village of Old Westbury Board of Trustees; NY village government structure research; WS-F investigation 2026-01-18",
      "notes": "Typical NY village structure: Mayor and 4 trustees elected at-large (village-wide). Registry mistakenly contained CitizenServeMapCouncilDist data (6 features, 89.9% outside village boundary) from wrong municipality."
  },
  '3774440': {
      "cityName": "Wilmington",
      "state": "NC",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "https://www.wilmingtonnc.gov/Government/City-Mayor-Council; Ballotpedia",
      "notes": "Non-partisan city council. All council members and mayor elected at-large (citywide). No geographic districts or wards."
  },
  '3885080': {
      "cityName": "Williston",
      "state": "ND",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Williston; Wave E great-plains-specialist 2026-01-19",
      "notes": "5 commissioners elected at-large. City commission structure typical of North Dakota cities."
  },
  '3957750': {
      "cityName": "Oakwood",
      "state": "OH",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "https://oakwoodohio.gov/departments/city-council/; Dayton Daily News",
      "notes": "Council/manager government. 5 council members elected at-large, non-partisan, 4-year terms. Mayor selected by council. Note: Separate Oakwood Village in Cuyahoga County uses wards."
  },
  '4038350': {
      "cityName": "Jenks",
      "state": "OK",
      "councilSize": 4,
      "electionMethod": "at-large",
      "source": "WS-3 containment analysis (pending charter verification)",
      "notes": "Containment failure showed Tulsa County precincts (13 features). Small city likely at-large. Needs charter verification."
  },
  '4131250': {
      "cityName": "Gresham",
      "state": "OR",
      "councilSize": 6,
      "electionMethod": "at-large",
      "source": "City of Gresham Elections; Charter Review Committee Final Report 2023; WS-F verification 2026-01-18",
      "notes": "VERIFIED: At-large elections (Position 1-6). Charter Review Committee recommended 4-district transition with RCV. District transition pending future voter approval. Registry had Portland Metro Council Districts data."
  },
  '4277272': {
      "cityName": "Trafford",
      "state": "PA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://www.traffordborough.com/; Wave F 2026-01-19",
      "notes": "PA third-class borough. 7-member council elected at-large per PA Borough Code. Straddles Westmoreland/Allegheny Counties."
  },
  '4507210': {
      "cityName": "Bluffton",
      "state": "SC",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "Town of Bluffton official website; Ballotpedia; WS-F investigation 2026-01-18",
      "notes": "At-large elections for all council positions. Registry mistakenly contained Beaufort County council district data (11 districts)."
  },
  '4529815': {
      "cityName": "Goose Creek",
      "state": "SC",
      "councilSize": 6,
      "electionMethod": "at-large",
      "source": "City of Goose Creek official website; Post & Courier; Berkeley County Elections; WS-G investigation 2026-01-18",
      "notes": "At-large elections confirmed: \"Council members are elected at-large in Goose Creek, meaning they represent the whole city rather than a specific district.\" Registry mistakenly contained Charleston County Political_Districts data (9 features)."
  },
  '4568425': {
      "cityName": "Springdale",
      "state": "SC",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "Town government page (springdalesc.com/government.php); Municipal GIS research 2026-01-19",
      "notes": "Mayor + 6 council members elected at-large with 4-year staggered terms. No ward boundaries. Quarantine showed Charleston County districts (8 features)."
  },
  '4761960': {
      "cityName": "Red Bank",
      "state": "TN",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "Board of Commissioners (redbanktn.gov); Municipal GIS research 2026-01-19",
      "notes": "Commission form: 5 commissioners with staggered terms, elected at-large. No ward boundaries. Quarantine showed Chattanooga city council data (9 features)."
  },
  '4768540': {
      "cityName": "Signal Mountain",
      "state": "TN",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "Town Council page (signalmountaintn.gov); Municipal GIS research 2026-01-19",
      "notes": "5-member council elected city-wide at-large. No ward boundaries. Quarantine showed Hamilton County/Chattanooga districts (9 features)."
  },
  '4827996': {
      "cityName": "Galena Park",
      "state": "TX",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Galena Park official website; Quarantine investigation 2026-01-17",
      "notes": "Commission form government. Mayor + 4 commissioners elected at-large to numbered positions (Position 1-4). Quarantine correctly blocked Houston council data (11 districts) mistakenly mapped to this city."
  },
  '4842388': {
      "cityName": "Leon Valley",
      "state": "TX",
      "councilSize": 6,
      "electionMethod": "at-large",
      "source": "City of Leon Valley city charter; Quarantine investigation 2026-01-17",
      "notes": "City charter specifies mayor and 5 councilmembers elected at-large. No geographic districts."
  },
  '4856348': {
      "cityName": "Pearland",
      "state": "TX",
      "councilSize": 8,
      "electionMethod": "at-large",
      "source": "Pearland City Charter, Article III",
      "notes": "At-large council. Registry mistakenly contained Houston city council districts (11 districts A-K)."
  },
  '5101000': {
      "cityName": "Alexandria",
      "state": "VA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://www.alexandriava.gov/Council; Wave E mid-atlantic-specialist 2026-01-19",
      "notes": "At-large council system with 6 councilmembers + mayor elected city-wide. No geographic districts. Historical ward system replaced in 1922."
  },
  '5168000': {
      "cityName": "Roanoke",
      "state": "VA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "https://www.roanokeva.gov/989/City-Council; Wave E mid-atlantic-specialist 2026-01-19",
      "notes": "At-large council system with 6 councilmembers + mayor. Largest city in Virginia without ward system. Roanoke County (separate jurisdiction) has 5 magisterial districts."
  },
};

export const AT_LARGE_COUNT = 35;
