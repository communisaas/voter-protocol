/**
 * At-Large City Council Registry
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! THIS FILE IS AUTO-GENERATED - DO NOT EDIT MANUALLY !!
 * !! Source: data/registries/at-large-cities.ndjson
 * !! Generated: 2026-01-23T08:25:30.343Z
 * !! To modify: Edit the NDJSON file, then run: npm run registry:generate
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * PURPOSE: Cities with at-large voting (no geographic districts)
 * At-large cities: 77
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
  '0412000': {
      "cityName": "Chandler",
      "state": "AZ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Chandler; Wave-K Sun Belt specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Maricopa County."
  },
  '0427820': {
      "cityName": "Gilbert",
      "state": "AZ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "Town of Gilbert; Wave-K Sun Belt specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Maricopa County town."
  },
  '0465000': {
      "cityName": "Scottsdale",
      "state": "AZ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Scottsdale; Wave-K Sun Belt specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Maricopa County."
  },
  '0473000': {
      "cityName": "Tempe",
      "state": "AZ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Tempe; Wave-K Sun Belt specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Home of Arizona State University."
  },
  '0632548': {
      "cityName": "Hawthorne",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Hawthorne Municipal Code, Chapter 2; WS-2 investigation",
      "notes": "At-large elections for all council positions. Registry mistakenly contained SCAG (Southern California Association of Governments) regional planning districts (52 features), not city council districts."
  },
  '0636000': {
      "cityName": "Huntington Beach",
      "state": "CA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "Ballotpedia 2024; Voice of OC; Wave-K CA specialist",
      "notes": "All 7 council seats elected citywide. No CVRA challenge filed. 2024 election swept by conservative slate."
  },
  '0639003': {
      "cityName": "La Cañada Flintridge",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of La Cañada Flintridge official website",
      "notes": "At-large council elections. Registry contained \"Enriched Council_District\" analysis layer (7 features) which is NOT council district data - likely census/demographic enrichment."
  },
  '0640130': {
      "cityName": "Lancaster",
      "state": "CA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "AV Press Feb 2024; Ballotpedia; Wave-K CA specialist",
      "notes": "Currently at-large. CVRA study initiated Feb 2024 but no transition implemented. Elections held in April of even years."
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
  '0807850': {
      "cityName": "Boulder",
      "state": "CO",
      "councilSize": 9,
      "electionMethod": "at-large",
      "source": "City of Boulder; Wave-L Mountain West specialist",
      "notes": "Council-Manager form. 9 council members elected at-large. University of Colorado flagship. No ward system."
  },
  '1212875': {
      "cityName": "Clearwater",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Clearwater; Wave-K FL specialist",
      "notes": "Mayor + 4 council members. Largest Gulf Coast city allowing plurality winners (no runoff). 2024 ballot considered runoffs but NOT districts."
  },
  '1214400': {
      "cityName": "Coral Springs",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Coral Springs; Wave-K FL specialist",
      "notes": "5-member commission with numbered seats (1-5). All seats elected citywide. Broward County city."
  },
  '1230000': {
      "cityName": "Hialeah",
      "state": "FL",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Hialeah Charter; Wave-K FL specialist",
      "notes": "Strong Mayor/Council form. 7 council members elected at-large by group numbers. All elections citywide."
  },
  '1245975': {
      "cityName": "Miramar",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Miramar; Wave-K FL specialist",
      "notes": "Commission-Manager form since 1991. Mayor + 4 commissioners elected at-large by seat number."
  },
  '1254000': {
      "cityName": "Palm Bay",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Palm Bay Charter; Wave-K FL specialist",
      "notes": "Council-Manager form. Mayor + 4 council members all elected at-large to designated seats. Non-partisan, 4-year terms."
  },
  '1269700': {
      "cityName": "Sunrise",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Sunrise official website; Wave-N FL FGDL analysis",
      "notes": "At-large commission. Mayor + 4 commissioners elected citywide. No geographic districts."
  },
  '1270600': {
      "cityName": "Tallahassee",
      "state": "FL",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Tallahassee; Ballotpedia; Wave-K FL specialist",
      "notes": "State capital. 5 commissioners (4 + mayor) all elected citywide. Charter Review Committee debated districts in 2024 but no change made."
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
  '1723074': {
      "cityName": "Elgin",
      "state": "IL",
      "councilSize": 9,
      "electionMethod": "at-large",
      "source": "City of Elgin; Wave-K Midwest specialist",
      "notes": "Council-Manager form. 8 council members + mayor elected at-large. Kane/Cook Counties."
  },
  '1753234': {
      "cityName": "Naperville",
      "state": "IL",
      "councilSize": 9,
      "electionMethod": "at-large",
      "source": "City of Naperville; Wave-K Midwest specialist",
      "notes": "Council-Manager form. 8 council members + mayor elected at-large. DuPage/Will Counties."
  },
  '1869354': {
      "cityName": "Sheridan",
      "state": "IN",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "Ballotpedia Town Council Member, At Large elections",
      "notes": "Town council has 7 members elected at-large. No geographic districts exist. Registry mistakenly contained township redistricting data."
  },
  '1902305': {
      "cityName": "Ankeny",
      "state": "IA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Ankeny; Wave-K Iowa-Plains specialist",
      "notes": "Mayor + 6 council members elected at-large. Des Moines suburb, one of fastest-growing cities in Iowa."
  },
  '1916860': {
      "cityName": "Council Bluffs",
      "state": "IA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Council Bluffs; Wave-K Iowa-Plains specialist",
      "notes": "Council-Manager form. Mayor + 4 council members elected at-large."
  },
  '1938595': {
      "cityName": "Iowa City",
      "state": "IA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Iowa City; Wave-K Iowa-Plains specialist",
      "notes": "Council-Manager form. Mayor + 6 council members (4 at-large + 2 district seats - hybrid but primarily at-large)."
  },
  '1973335': {
      "cityName": "Sioux City",
      "state": "IA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Sioux City; Wave-K Iowa-Plains specialist",
      "notes": "Council-Manager form. Mayor + 4 council members elected at-large."
  },
  '1982425': {
      "cityName": "Urbandale",
      "state": "IA",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Urbandale; Wave-K Iowa-Plains specialist",
      "notes": "Council-Manager form. Mayor + 4 council members elected at-large. Des Moines suburb."
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
  '2648000': {
      "cityName": "Livonia",
      "state": "MI",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Livonia; Wave-K Midwest specialist",
      "notes": "Mayor + 6 council members elected at-large. Wayne County suburb of Detroit."
  },
  '2674900': {
      "cityName": "Sterling Heights",
      "state": "MI",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Sterling Heights Charter; Wave-K Midwest specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Macomb County's largest city."
  },
  '2686180': {
      "cityName": "Westland",
      "state": "MI",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Westland; Wave-K Midwest specialist",
      "notes": "Mayor-Council form. Mayor + 6 council members elected at-large. Wayne County."
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
  '3407600': {
      "cityName": "Brick Township",
      "state": "NJ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township council. NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
  },
  '3413120': {
      "cityName": "Cherry Hill Township",
      "state": "NJ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township council. NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
  },
  '3422470': {
      "cityName": "Edison Township",
      "state": "NJ",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township council. NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
  },
  '3429700': {
      "cityName": "Hamilton Township",
      "state": "NJ",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township council (Mercer County). NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
  },
  '3441310': {
      "cityName": "Lakewood Township",
      "state": "NJ",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township committee. NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
  },
  '3448000': {
      "cityName": "Middletown Township",
      "state": "NJ",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "NJGIN Ward Boundaries (ward code 00); Wave-N NJGIN analysis",
      "notes": "At-large township committee. NJGIN statewide ward layer shows single ward code 00 indicating at-large representation."
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
  '3825700': {
      "cityName": "Fargo",
      "state": "ND",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Fargo; Wave-K Iowa-Plains specialist",
      "notes": "Commission form. 5 commissioners (including mayor) elected at-large. Largest city in North Dakota."
  },
  '3885080': {
      "cityName": "Williston",
      "state": "ND",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Williston; Wave E great-plains-specialist 2026-01-19",
      "notes": "5 commissioners elected at-large. City commission structure typical of North Dakota cities."
  },
  '3921000': {
      "cityName": "Dayton",
      "state": "OH",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Dayton; Wave-K Midwest specialist",
      "notes": "Commission-Manager form. 5 commissioners elected at-large. Mayor selected by commission."
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
  '4105350': {
      "cityName": "Beaverton",
      "state": "OR",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Beaverton; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 4 council members elected at-large. Washington County suburb of Portland."
  },
  '4105800': {
      "cityName": "Bend",
      "state": "OR",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Bend; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Deschutes County, Central Oregon."
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
  '4801000': {
      "cityName": "Abilene",
      "state": "TX",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Abilene; Wave-K TX specialist",
      "notes": "Council-Manager form. Mayor + 6 councilmembers elected at-large."
  },
  '4803000': {
      "cityName": "Amarillo",
      "state": "TX",
      "councilSize": 5,
      "electionMethod": "at-large",
      "source": "City of Amarillo; Wave-K TX specialist",
      "notes": "Council-Manager form. 5 councilmembers + mayor elected at-large. One of few comparable US cities with pure at-large and 5 members."
  },
  '4827684': {
      "cityName": "Frisco",
      "state": "TX",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Frisco; Wave-K TX specialist",
      "notes": "Mayor + 6 council members elected at-large. Fastest growing large city in Texas."
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
  '4863500': {
      "cityName": "Round Rock",
      "state": "TX",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Round Rock; Wave-K TX specialist",
      "notes": "Mayor + 6 council members elected at-large to designated Place positions."
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
  '5305210': {
      "cityName": "Bellevue",
      "state": "WA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Bellevue; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. Tech hub in King County. One of wealthiest US cities."
  },
  '5323515': {
      "cityName": "Federal Way",
      "state": "WA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Federal Way; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. King County city between Seattle and Tacoma."
  },
  '5335415': {
      "cityName": "Kirkland",
      "state": "WA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Kirkland; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 6 council members elected at-large. King County lakeside city."
  },
  '5374060': {
      "cityName": "Vancouver",
      "state": "WA",
      "councilSize": 7,
      "electionMethod": "at-large",
      "source": "City of Vancouver; Wave-L Pacific NW specialist",
      "notes": "Council-Manager form. Mayor + 6 council members all elected at-large. Fourth largest city in Washington."
  },
};

export const AT_LARGE_COUNT = 77;
