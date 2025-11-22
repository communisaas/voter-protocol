# Shadow Atlas – Fire Authority Coverage Tracker

Status legend:

- `authority_live` – Statewide (or full coverage) fire districts ingested from an authoritative source and referenced in `registry.json`.
- `ingestor_configured` – Adapter + ingestion CLI implemented; awaiting credentials or dataset URL before hydrations can run.
- `pending_credentials` – Requires external approval (NG911, state clearinghouse); outreach/agreements in flight.
- `baseline_only` – Currently served by NIFC fallback. Requires research and/or ingestion work.

| State | Status | Authority Source / Requirement | Next Action |
| --- | --- | --- | --- |
| AL | baseline_only | Alabama 911 Board NG911 Fire Service Areas (credentialed) | No public FeatureServer; request statewide NG911 fire polygons from the Alabama 911 Board and document authentication flow. |
| AK | authority_live | AK Fire Service Areas (FeatureServer) | `alaska-dof-fire-service-areas` ingestor pulls Division of Forestry statewide polygons with acreage + borough metadata. |
| AZ | baseline_only | NIFC Jurisdictional Units | Identify statewide fire district layer (Arizona Dept. of Forestry & Fire Mgmt); if restricted, plan NG911 outreach. |
| AR | authority_live | Arkansas Fire Districts (FeatureServer) | `arkansas-fire-districts` adapter uses the Arkansas GIS Office statewide FDID polygons maintained for NG911. |
| CA | authority_live | County LAFCo geojson fixtures (includes fire districts) | Continue onboarding remaining counties via existing special-district authority pipeline. |
| CO | authority_live | DOLA Fire Protection Districts (FeatureServer) | Adapter `colorado-dola-fire-protection-districts` ingests statewide polygons + mailing metadata from DOLA’s hosted FeatureServer. |
| CT | baseline_only | NIFC Jurisdictional Units | State GIS (CT DEEP) publishes fire district outlines—locate FeatureServer or shapefile and add adapter. |
| DC | authority_live | DC FEMS Alarm Districts (MapServer/8) | `district-of-columbia-fems-fire-districts` ingestor captures engine/local alarm districts powering DC Fire & EMS routing. |
| DE | authority_live | FirstMap Fire Districts (FeatureServer layer 1) | Adapter landed (`delaware-firstmap-fire-districts`); rerun `npm run ingest:authority -- --state=DE --dataset=fire` as needed to refresh statewide coverage. |
| FL | baseline_only | Florida Division of State Fire Marshal NG911 feed | Only county-level layers (e.g., Volusia) are public; need statewide NG911 fire service dataset from the State Fire Marshal / 911 Board. |
| GA | baseline_only | Georgia NG911 Fire Service Areas (ShareFile) | Only county layers are public—statewide fire polygons live behind the GEMA/911 ShareFile portal; request NG911 credentials to ingest. |
| HI | baseline_only | NIFC Jurisdictional Units | Reach out to HI Dept. of Land & Natural Resources for island fire service areas. |
| IA | baseline_only | ISICSB NG911 Fire Response (ShareFile) | Iowa Statewide Interoperable Communications Board distributes NG911 polygons via secure ShareFile; request access + automate download when credentials granted. |
| ID | authority_live | IDL Fire Protective Districts (FeatureServer layer 3) | New `idaho-dof-fire-protective-districts` ingestor pulls tokenless statewide polygons; rerun ingest to refresh acreage + response metadata. |
| IL | baseline_only | NIFC Jurisdictional Units | IL GIS Clearinghouse hosts county fire districts (e.g., McHenry); need statewide aggregation from OSFM. |
| IN | baseline_only | NIFC Jurisdictional Units | Indiana Data Hub – determine if DHS publishes statewide fire territory dataset. |
| KS | authority_live | Kansas Forest Service Fire Districts (FeatureServer) | Adapter `kansas-forest-service-fire-districts` ingests statewide polygons with FDID + staffing metadata from KFS. |
| KY | baseline_only | Kentucky 911 Services Board | Kentucky’s statewide NG911 boundary program holds the fire service polygons; request access through the 911 Services Board (no public FeatureServer). |
| LA | baseline_only | Louisiana State Fire Marshal NG911 feed | State Fire Marshal/911 Board maintains statewide fire response polygons behind NG911 credentials; request dataset export. |
| MA | authority_live | MassGIS Department of Fire Services State Fire Districts | Done (MassachusettsFireIngestor). |
| MD | baseline_only | MD iMAP Fire/EMS Response Boundaries (login) | Layer exists on MD iMAP but requires state credentials; submit access request through MD DoIT GIS to retrieve FeatureServer URL. |
| ME | baseline_only | NIFC Jurisdictional Units | Maine GeoLibrary – research fire district boundaries; if none, coordinate with state NG911 board. |
| MI | baseline_only | NIFC Jurisdictional Units | Michigan EGLE / NG911 board – determine statewide fire response dataset. |
| MN | ingestor_configured | `MN_FIRE_FEATURE_SERVICE_URL` (NG911 FeatureServer) – adapter ready | Obtain ECN NG911 FeatureServer URL/token, set env vars, run ingest to flip to live. |
| MO | baseline_only | NIFC Jurisdictional Units | Missouri Spatial Data Center – locate “Fire Protection Districts” dataset for statewide import. |
| MS | baseline_only | NIFC Jurisdictional Units | MS NG911 adoption underway; document credential request similar to VA. |
| MT | authority_live | MSFCA Fire Districts FeatureServer | Done (MontanaFireIngestor). |
| NC | baseline_only | OSFM Fire 9S Ratings (ShareFile delivery) | OSFM requires county uploads to the state ShareFile portal and distributes statewide exports on request; document credential path + automate ShareFile pull once access granted. |
| ND | authority_live | NDGIS Hub Fire Districts (MapServer/10) | `north-dakota-ndgishub-fire-districts` ingestor streams statewide polygons from ND Department of Emergency Services. |
| NE | authority_live | Nebraska Fire District Response Areas (FeatureServer) | Adapter `nebraska-psc-fire-districts` ingests NG911 statewide polygons with NGUID + service metadata from PSC. |
| NH | baseline_only | NIFC Jurisdictional Units | NH GRANIT – validate if statewide fire precincts exist. |
| NJ | baseline_only | NIFC Jurisdictional Units | NJ Office of GIS – need statewide fire district dataset (maybe via NJDEP). |
| NM | authority_live | EMNRD Fire District Boundaries (FeatureServer) | `new-mexico-fire-districts` adapter ingests statewide FDID polygons maintained by State Forestry. |
| NV | baseline_only | NIFC Jurisdictional Units | Nevada’s SilverNet GIS may host statewide fire districts; investigate. |
| NY | baseline_only | NIFC Jurisdictional Units | NYS GIS Clearinghouse: look for Fire Protection Districts dataset; if limited, plan data request. |
| OH | baseline_only | Ohio 9-1-1 Program (DAS) | State DAS 9-1-1 Program aggregates NG911 fire/EMS boundaries but does not publish them; need agency approval + data sharing agreement to ingest. |
| OK | authority_live | Oklahoma Tax Commission Fire Protection Districts (FeatureServer) | `oklahoma-tax-commission-fire-districts` adapter ingests Title 19 FPD filings with OTC numbers used for Ad Valorem taxation. |
| OR | authority_live | ODA Field Burning Fire Districts (MapServer/4) | Done (OregonFireIngestor). |
| PA | baseline_only | NIFC Jurisdictional Units | Pennsylvania PEMA – identify statewide fire response dataset or request NG911 data. |
| RI | baseline_only | NIFC Jurisdictional Units | Rhode Island E911 board – confirm statewide dataset availability. |
| SC | baseline_only | South Carolina State Fire / 911 Program | Only municipal feeds are public; statewide fire response areas require credentials from the SC State Fire Marshal & 911 Program. |
| SD | baseline_only | South Dakota 911 Coordination Board (credentialed) | Fire response boundaries are distributed through SD 911 Coordination Board secure services; request statewide export. |
| TN | baseline_only | NIFC Jurisdictional Units | Tennessee OSFM – locate statewide fire districts or pursue credentialed access. |
| TX | baseline_only | NIFC Jurisdictional Units | Need Texas Commission on Fire Protection/NG911 statewide dataset; plan credential outreach. |
| UT | authority_live | UGRC Fire Response Areas FeatureServer | Done (UtahFireIngestor). |
| VA | pending_credentials | VGIN NG911 Fire/EMS service boundaries | Submit/access VGIN credential request (BLOCKER-001). |
| VT | baseline_only | NIFC Jurisdictional Units | Vermont E911 board – confirm availability of fire district polygons. |
| WA | authority_live | WA E911 Emergency Response Boundaries FeatureServer | Done (WashingtonFireIngestor). |
| WI | baseline_only | Wisconsin NG911 GIS (DOA DET) | Public data stops at county-level (e.g., Jackson County); statewide fire response feed is only available through the WI NG911 GIS program. |
| WV | baseline_only | NIFC Jurisdictional Units | WV GIS Tech Center – search for statewide fire districts or coordinate with NG911. |
| WY | baseline_only | NIFC Jurisdictional Units | Wyoming State Forestry – identify fire district boundaries for ingestion. |
| DC (District) | baseline_only | NIFC Jurisdictional Units | Coordinate with DC Fire/EMS to obtain official service boundary polygon. |

_Last updated: 2025-11-12_
