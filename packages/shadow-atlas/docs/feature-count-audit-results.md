# Feature Count Audit Results

**Generated:** 2026-01-16T20:20:11.223Z

## Summary

| Metric | Count |
|--------|-------|
| Total Entries | 622 |
| HIGH (>25 features) | 24 |
| NORMAL (3-25 features) | 569 |
| LOW (<3 features) | 29 |

### Recommendations

| Recommendation | Count |
|----------------|-------|
| KEEP | 585 |
| QUARANTINE | 23 |
| INVESTIGATE | 14 |

## Reference: Typical Council District Counts

| City Size | Population | Expected Districts |
|-----------|------------|-------------------|
| Small | <50k | 4-7 |
| Medium | 50k-200k | 5-9 |
| Large | 200k-1M | 7-15 |
| Major Metro | >1M | 9-51 |

## HIGH Feature Count Entries (>25 features)

These entries have unusually high feature counts that may indicate:
- Precincts (typically 100s-1000s per city)
- Census tracts or block groups
- VTDs (Voting Tabulation Districts)
- Other non-council-district data

| City | State | FIPS | Features | Recommendation | Reason |
|------|-------|------|----------|----------------|--------|
| Alvin | TX | 4802272 | 97 (actual: 97) | **KEEP** | High feature count but field names confirm council districts |
| Buckeye | AZ | 0407940 | 76 (actual: 76) | **KEEP** | High feature count but field names confirm council districts |
| Winter Springs | FL | 1278325 | 73 (actual: 73) | **KEEP** | High feature count but field names confirm council districts |
| Fort Collins | CO | 0827425 | 67 (actual: 67) | **QUARANTINE** | Field names indicate wrong data type: PRECINCT |
| Nichols Hills | OK | 4051800 | 59 (actual: 59) | **KEEP** | High feature count but field names confirm council districts |
| Iberia Parish | LA | 22045 | 55 (actual: 55) | **KEEP** | High feature count but field names confirm council districts |
| Escondido | CA | 0622804 | 53 (actual: 53) | **KEEP** | High feature count but field names confirm council districts |
| East Feliciana Parish | LA | 22037 | 52 (actual: 52) | **KEEP** | High feature count but field names confirm council districts |
| Hawthorne | CA | 0632548 | 52 (actual: 52) | **INVESTIGATE** | 52 features exceeds typical council district count (4-15). May be precincts/tracts. |
| New York City | NY | 3651000 | 51 (actual: 51) | **KEEP** | NYC has 51 council districts |
| Chattahoochee Hills | GA | 1315552 | 50 (actual: 50) | **QUARANTINE** | Field names indicate wrong data type: CENSUS_BLOCK, ZIP |
| Chicago | IL | 1714000 | 50 (actual: 50) | **KEEP** | Chicago has 50 aldermanic wards |
| Clovis | CA | 0614218 | 42 (actual: 42) | **INVESTIGATE** | 42 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Racine | WI | 5566000 | 41 (actual: 41) | **KEEP** | High feature count but field names confirm council districts |
| Noblesville | IN | 1854180 | 39 (actual: 39) | **KEEP** | High feature count but field names confirm council districts |
| Goshen | IN | 1828386 | 38 (actual: 38) | **KEEP** | High feature count but field names confirm council districts |
| Portage | IN | 1861092 | 37 (actual: 37) | **INVESTIGATE** | 37 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Nashville | TN | 4752006 | 35 (actual: 35) | **KEEP** | High feature count but field names confirm council districts |
| Kenosha | WI | 5539225 | 34 (actual: 34) | **INVESTIGATE** | 34 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Wauwatosa | WI | 5584675 | 31 (actual: 31) | **KEEP** | High feature count but field names confirm council districts |
| Flathead County | MT | 30029 | 28 (actual: 28) | **KEEP** | High feature count but field names confirm council districts |
| Auburn | MI | 2604080 | 27 (actual: 27) | **INVESTIGATE** | 27 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Louisville | KY | 2148006 | 26 (actual: 26) | **INVESTIGATE** | 26 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Elk Grove | CA | 0622020 | 26 (actual: 26) | **KEEP** | High feature count but field names confirm council districts |

### Detailed Analysis: HIGH Feature Count

#### Alvin, TX

- **FIPS:** 4802272
- **Feature Count:** 97 (actual: 97)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Alvin TX - 97 districts, bulk ingested from "City Council Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `OBJECTID_1`, `CITY`, `DISTRICT`, `MEMBER`, `TERM`, `WEBPAGE`, `ShapeSTAre`, `ShapeSTLen`, `Shape_STArea`, `Shape_STLength`, `GlobalID`, `created_user`, `created_date`, `last_edited_user`, `last_edited_date`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

#### Buckeye, AZ

- **FIPS:** 0407940
- **Feature Count:** 76 (actual: 76)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Buckeye AZ - 76 districts, bulk ingested from "CityCouncilDistricts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `Juris`, `LglLabel`, `Ward`, `BdName`
- **Confirming Fields:** `Ward` (WARD)

#### Winter Springs, FL

- **FIPS:** 1278325
- **Feature Count:** 73 (actual: 73)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Winter Springs FL - 73 districts, bulk ingested from "City Council and Commission Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `District`, `City`, `Commissioner`, `Shape__Area`, `Shape__Length`, `GlobalID`
- **Confirming Fields:** `District` (DISTRICT)

#### Fort Collins, CO

- **FIPS:** 0827425
- **Feature Count:** 67 (actual: 67)
- **Recommendation:** QUARANTINE
- **Reason:** Field names indicate wrong data type: PRECINCT
- **Notes:** Fort Collins CO - 67 districts, bulk ingested from "Council Districts"
- **Field Verdict:** CONFIRMED_WRONG
- **All Fields:** `OBJECTID`, `PRECT`, `DIST`, `SENATE`, `HOUSE`, `VOTERCOUNT`, `PREC2002`, `BCCNUM`, `PRECNUM`, `REVDATE`, `NAME`, `TERM_EXP`, `PHONE`, `E_MAIL`, `MAYOR`, `MAYOR_TERM_EXPIRES`, `MAYOR_PHONE`, `MAYOR_E_MAIL`, `DIST_LEGEND`, `Shape__Area`, `Shape__Length`
- **Suspicious Fields:** `PRECT` (PRECINCT), `PREC2002` (PRECINCT), `PRECNUM` (PRECINCT)
- **Confirming Fields:** `DIST` (DISTRICT)

#### Nichols Hills, OK

- **FIPS:** 4051800
- **Feature Count:** 59 (actual: 59)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Nichols Hills OK - 59 districts, bulk ingested from "City_Council_Wards"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `FID`, `Council_Wa`, `City`, `TOTAL_AREA`, `IN_`, `PER_IN`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `Council_Wa` (COUNCIL)

#### Iberia Parish, LA

- **FIPS:** 22045
- **Feature Count:** 55 (actual: 55)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Iberia Parish LA - 55 districts, bulk ingested from "Council Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `ID`, `AREA`, `DISTRICT`, `MEMBERS`, `LOCKED`, `NAME`, `POPULATION`, `DEVIATION`, `F_DEVIATIO`, `IDEAL_VALU`, `DISTRICT_L`, `DistrictName`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

#### Escondido, CA

- **FIPS:** 0622804
- **Feature Count:** 53 (actual: 53)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Escondido CA - 53 districts, bulk ingested from "COUNCIL_DISTRICTS"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `FID`, `DISTRICT`, `WEBSITE`, `CODE`, `JUR_NAME`, `NAME`, `PHONE`, `Shape_Leng`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

#### East Feliciana Parish, LA

- **FIPS:** 22037
- **Feature Count:** 52 (actual: 52)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** East Feliciana Parish LA - 52 districts, bulk ingested from "ARBC_Council_Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `District`, `Member`, `Parish`, `ParishPresident`, `GEOMETRY_Length`, `GEOMETRY_Area`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `District` (DISTRICT)

#### Hawthorne, CA

- **FIPS:** 0632548
- **Feature Count:** 52 (actual: 52)
- **Recommendation:** INVESTIGATE
- **Reason:** 52 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Hawthorne CA - 52 districts, bulk ingested from "Regional_Council_Districts_-_SCAG_Region"
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `FID`, `OBJECTID`, `RC_DIST`, `PERIMETER`, `ACRES`, `COUNTY_ID`, `COUNTY`, `RC_LABEL`, `SUBREGION`, `YEAR`, `Shapearea`, `Shapelen`, `Shape__Area`, `Shape__Length`

#### New York City, NY

- **FIPS:** 3651000
- **Feature Count:** 51 (actual: 51)
- **Recommendation:** KEEP
- **Reason:** NYC has 51 council districts
- **Notes:** NYC City Council Districts - 51 districts. VINTAGE WARNING: Data appears to be pre-2022 redistricting boundaries. NYC redistricted 2022-2023 after 2020 Census. Coverage ratio may be low (~55%) due to boundary mismatch with current TIGER data. TODO: Find post-2022 redistricting boundaries from NYC data.cityofnewyork.us or council.nyc.gov
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `OBJECTID`, `CounDist`, `Shape__Area`, `Shape__Length`

#### Chattahoochee Hills, GA

- **FIPS:** 1315552
- **Feature Count:** 50 (actual: 50)
- **Recommendation:** QUARANTINE
- **Reason:** Field names indicate wrong data type: CENSUS_BLOCK, ZIP
- **Notes:** Chattahoochee Hills GA - 50 districts, bulk ingested from "City Council Districts"
- **Field Verdict:** CONFIRMED_WRONG
- **All Fields:** `OBJECTID`, `ToxRelFac`, `TARGET_FID`, `FID`, `STLength`, `STArea`, `CityName`, `Officers`, `DistrNum`, `Loc_name`, `Status`, `Score`, `Match_type`, `Match_addr`, `LongLabel`, `ShortLabel`, `Addr_type`, `Type`, `PlaceName`, `Place_addr`, `Phone`, `URL`, `Rank`, `AddBldg`, `AddNum`, `AddNumFrom`, `AddNumTo`, `AddRange`, `Side`, `StPreDir`, `StPreType`, `StName`, `StType`, `StDir`, `BldgType`, `BldgName`, `LevelType`, `LevelName`, `UnitType`, `UnitName`, `SubAddr`, `StAddr`, `Block`, `Sector`, `Nbrhd`, `District`, `City`, `MetroArea`, `Subregion`, `Region`, `RegionAbbr`, `Territory`, `Zone`, `Postal`, `PostalExt`, `Country`, `LangCode`, `Distance`, `X`, `Y`, `DisplayX`, `DisplayY`, `Xmin`, `Xmax`, `Ymin`, `Ymax`, `ExInfo`, `IN_Address`, `IN_Address2`, `IN_Address3`, `IN_Neighborhood`, `IN_City`, `IN_Subregion`, `IN_Region`, `IN_Postal`, `IN_PostalExt`, `IN_CountryCode`, `USER_F1__YEAR`, `USER_F2__TRIFD`, `USER_F3__FRS_ID`, `USER_F4__FACILITY_NAME`, `USER_F5__STREET_ADDRESS`, `USER_F6__CITY`, `USER_F7__COUNTY`, `USER_F8__ST`, `USER_F9__ZIP`, `USER_F10__BIA`, `USER_F11__TRIBE`, `USER_F12__LATITUDE`, `USER_F13__LONGITUDE`, `USER_F14__HORIZONTAL_DATUM`, `USER_F15__PARENT_CO_NAME`, `USER_F16__PARENT_CO_DB_NUM`, `USER_F17__STANDARD_PARENT_CO_NA`, `USER_F18__FEDERAL_FACILITY`, `USER_F19__INDUSTRY_SECTOR_CODE`, `USER_F20__INDUSTRY_SECTOR`, `USER_F21__PRIMARY_SIC`, `USER_F22__SIC_2`, `USER_F23__SIC_3`, `USER_F24__SIC_4`, `USER_F25__SIC_5`, `USER_F26__SIC_6`, `USER_F27__PRIMARY_NAICS`, `USER_F28__NAICS_2`, `USER_F29__NAICS_3`, `USER_F30__NAICS_4`, `USER_F31__NAICS_5`, `USER_F32__NAICS_6`, `USER_F33__DOC_CTRL_NUM`, `USER_F34__CHEMICAL`, `USER_F35__ELEMENTAL_METAL_INCLU`, `USER_F36__TRI_CHEMICAL_COMPOUND`, `USER_F37__CAS_`, `USER_F38__SRS_ID`, `USER_F39__CLEAN_AIR_ACT_CHEMICA`, `USER_F40__CLASSIFICATION`, `USER_F41__METAL`, `USER_F42__METAL_CATEGORY`, `USER_F43__CARCINOGEN`, `USER_F44__PFAS`, `USER_F45__FORM_TYPE`, `USER_F46__UNIT_OF_MEASURE`, `USER_F47__5_1___FUGITIVE_AIR`, `USER_F48__5_2___STACK_AIR`, `USER_F49__5_3___WATER`, `USER_F50__5_4___UNDERGROUND`, `USER_F51__5_4_1___UNDERGROUND_C`, `USER_F52__5_4_2___UNDERGROUND_C`, `USER_F53__5_5_1___LANDFILLS`, `USER_F54__5_5_1A___RCRA_C_LANDF`, `USER_F55__5_5_1B___OTHER_LANDFI`, `USER_F56__5_5_2___LAND_TREATMEN`, `USER_F57__5_5_3___SURFACE_IMPND`, `USER_F58__5_5_3A___RCRA_SURFACE`, `USER_F59__5_5_3B___OTHER_SURFAC`, `USER_F60__5_5_4___OTHER_DISPOSA`, `USER_F61__ON_SITE_RELEASE_TOTAL`, `USER_F62__6_1___POTW___TRNS_RLS`, `USER_F63__6_1___POTW___TRNS_TRT`, `USER_F64__POTW___TOTAL_TRANSFER`, `USER_F65__6_2___M10`, `USER_F66__6_2___M41`, `USER_F67__6_2___M62`, `USER_F68__6_2___M40_METAL`, `USER_F69__6_2___M61_METAL`, `USER_F70__6_2___M71`, `USER_F71__6_2___M81`, `USER_F72__6_2___M82`, `USER_F73__6_2___M72`, `USER_F74__6_2___M63`, `USER_F75__6_2___M66`, `USER_F76__6_2___M67`, `USER_F77__6_2___M64`, `USER_F78__6_2___M65`, `USER_F79__6_2___M73`, `USER_F80__6_2___M79`, `USER_F81__6_2___M90`, `USER_F82__6_2___M94`, `USER_F83__6_2___M99`, `USER_F84__OFF_SITE_RELEASE_TOTA`, `USER_F85__6_2___M20`, `USER_F86__6_2___M24`, `USER_F87__6_2___M26`, `USER_F88__6_2___M28`, `USER_F89_6_2___M93`, `USER_F90__OFF_SITE_RECYCLED_TOT`, `USER_F91__6_2___M56`, `USER_F92__6_2___M92`, `USER_F93__OFF_SITE_ENERGY_RECOV`, `USER_F94__6_2___M40_NON_METAL`, `USER_F95__6_2___M50`, `USER_F96__6_2___M54`, `USER_F97__6_2___M61_NON_METAL`, `USER_F98__6_2___M69`, `USER_F99__6_2___M95`, `USER_F100__OFF_SITE_TREATED_TOT`, `USER_F101__6_2___UNCLASSIFIED`, `USER_F102__6_2___TOTAL_TRANSFER`, `USER_F103__TOTAL_RELEASES`, `USER_F104__8_1___RELEASES`, `USER_F105__8_1A___ON_SITE_CONTA`, `USER_F106__8_1B___ON_SITE_OTHER`, `USER_F107__8_1C___OFF_SITE_CONT`, `USER_F108__8_1D___OFF_SITE_OTHE`, `USER_F109__8_2___ENERGY_RECOVER`, `USER_F110__8_3___ENERGY_RECOVER`, `USER_F111__8_4___RECYCLING_ON_S`, `USER_F112__8_5___RECYCLING_OFF_`, `USER_F113__8_6___TREATMENT_ON_S`, `USER_F114__8_7___TREATMENT_OFF_`, `USER_F115__PRODUCTION_WSTE__8_1`, `USER_F116__8_8___ONE_TIME_RELEA`, `USER_F117__PROD_RATIO_OR__ACTIV`, `USER_F118__8_9___PRODUCTION_RAT`, `sum_user_f61__on_site_release_t`, `Point_Count`, `Shape__Area`, `Shape__Length`
- **Suspicious Fields:** `Block` (CENSUS_BLOCK), `Postal` (ZIP), `PostalExt` (ZIP), `IN_Postal` (ZIP), `IN_PostalExt` (ZIP), `USER_F9__ZIP` (ZIP)
- **Confirming Fields:** `District` (DISTRICT)

#### Chicago, IL

- **FIPS:** 1714000
- **Feature Count:** 50 (actual: 50)
- **Recommendation:** KEEP
- **Reason:** Chicago has 50 aldermanic wards
- **Notes:** Chicago City Council Wards - 50 wards (2023-), Socrata Resource API with $limit parameter
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `ward_id`, `st_area_sh`, `st_length_`, `edit_date`, `objectid`, `globalid`, `ward`
- **Confirming Fields:** `ward_id` (WARD), `ward` (WARD)

#### Clovis, CA

- **FIPS:** 0614218
- **Feature Count:** 42 (actual: 42)
- **Recommendation:** INVESTIGATE
- **Reason:** 42 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Clovis CA - 42 districts, bulk ingested from "City Council Districts"
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `FID`, `OBJECTID`, `AREA_`, `PERIMETER`, `CITYDIST_`, `CITYDIST_I`, `CD_CITY_LM`, `CD_CITYCNC`, `NM_CITY_CN`, `IND_HOLE`, `DT_ADD`, `DT_MANT`, `OPER_ADD`, `OPER_MANT`, `CREATEDBY`, `CREATEDDAT`, `MODIFIEDBY`, `MODIFIEDDA`, `SHAPE_STAr`, `SHAPE_STLe`, `Shape__Area`, `Shape__Length`

#### Racine, WI

- **FIPS:** 5566000
- **Feature Count:** 41 (actual: 41)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Racine WI - 41 districts, bulk ingested from "Aldermanic Wards"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `Id`, `District`, `Ward`, `Label`, `Fade`, `RUSD_Election_District`, `Alderman`, `Phone`, `Email`, `PollingLocName`, `PollingLocAddress`, `ImageURL`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `District` (DISTRICT), `Ward` (WARD), `Alderman` (ALDERMAN)

#### Noblesville, IN

- **FIPS:** 1854180
- **Feature Count:** 39 (actual: 39)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Noblesville IN - 39 districts, bulk ingested from "Municipal Council Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `MUNI`, `DIST`, `MAPNAME`, `created_user`, `created_date`, `last_edited_user`, `last_edited_date`, `GlobalID`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `DIST` (DISTRICT)

#### Goshen, IN

- **FIPS:** 1828386
- **Feature Count:** 38 (actual: 38)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Goshen IN - 38 districts, bulk ingested from "Goshen_City_Council"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `Municipality`, `CityCouncil`, `SourceDesc`, `SourceDate`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `CityCouncil` (COUNCIL)

#### Portage, IN

- **FIPS:** 1861092
- **Feature Count:** 37 (actual: 37)
- **Recommendation:** INVESTIGATE
- **Reason:** 37 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Portage IN - 37 districts, bulk ingested from "City Council Members"
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `OBJECTID`, `OBJECTID_1`, `COUNCIL_RE`, `DISTRICT_N`, `PRECINCT_N`, `GlobalID`, `created_user`, `created_date`, `last_edited_user`, `last_edited_date`, `Shape__Area`, `Shape__Length`
- **Suspicious Fields:** `PRECINCT_N` (PRECINCT)
- **Confirming Fields:** `COUNCIL_RE` (COUNCIL)

#### Nashville, TN

- **FIPS:** 4752006
- **Feature Count:** 35 (actual: 35)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Nashville Metropolitan Council Districts - 35 districts (metro government). FIXED 2025-12-14: Uses direct FeatureServer URL instead of hub.arcgis.com download API which requires redirect following.
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `DISTRICT`, `DistrictName`, `Representative`, `Website`, `LastName`, `FirstName`, `Email`, `BusinessPhone`, `GlobalID`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

#### Kenosha, WI

- **FIPS:** 5539225
- **Feature Count:** 34 (actual: 34)
- **Recommendation:** INVESTIGATE
- **Reason:** 34 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Kenosha WI - 34 districts, bulk ingested from "Aldermanic Districts"
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `objectid`, `districtnumber`, `representative`, `hyperlink`, `year`, `photo`, `x_cent`, `y_cent`, `Shape__Area`, `Shape__Length`, `Phone`, `email`, `Address`, `Sort`

#### Wauwatosa, WI

- **FIPS:** 5584675
- **Feature Count:** 31 (actual: 31)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Wauwatosa WI - 31 districts, bulk ingested from "Wauwatosa Ward Boundaries - Final"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `FID`, `PERSONS`, `PERSONS18`, `WHITE`, `BLACK`, `HISPANIC`, `ASIAN`, `AMINDIAN`, `PISLAND`, `OTHER`, `OTHERMLT`, `DISTRICT`, `Shape__Area`, `Shape__Length`, `ALD_DIST`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

#### Flathead County, MT

- **FIPS:** 30029
- **Feature Count:** 28 (actual: 28)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Flathead County MT - 28 districts, bulk ingested from "Montana Community Council Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `CountyName`, `CountyCode`, `DistrictNumber`, `DistrictName`, `DistrictCode`, `Notes`, `Source`, `Metadata`, `LastUpdate`, `ID_UK`, `Community_Council`, `Acres`, `AreaSqMi`, `SqMiles`, `GlobalID`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `Community_Council` (COUNCIL)

#### Auburn, MI

- **FIPS:** 2604080
- **Feature Count:** 27 (actual: 27)
- **Recommendation:** INVESTIGATE
- **Reason:** 27 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Auburn MI - 27 districts, bulk ingested from "City Wards"
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `OBJECTID`, `DISTRICTID`, `NAME`, `REPNAME`, `DISTRICTURL`, `POPULATION`, `CreationDate`, `Creator`, `EditDate`, `Editor`, `Shape__Area`, `Shape__Length`

#### Louisville, KY

- **FIPS:** 2148006
- **Feature Count:** 26 (actual: 26)
- **Recommendation:** INVESTIGATE
- **Reason:** 26 features exceeds typical council district count (4-15). May be precincts/tracts.
- **Notes:** Louisville Metro Council Districts - 26 districts (2020 Census data), ArcGIS Hub
- **Field Verdict:** INCONCLUSIVE
- **All Fields:** `OBJECTID`, `COUNDIST`, `COUN_NAME`, `COUN_ADD`, `COUN_LOC`, `COUN_YR_ELECTED`, `COUN_TERM`, `COUN_PARTY`, `COUN_PHONENO`, `COUN_FAX`, `COUN_EMAIL`, `COMMENTS`, `COUN_WEB`, `SHAPEAREA`, `SHAPELEN`

#### Elk Grove, CA

- **FIPS:** 0622020
- **Feature Count:** 26 (actual: 26)
- **Recommendation:** KEEP
- **Reason:** High feature count but field names confirm council districts
- **Notes:** Elk Grove CA - 26 districts, bulk ingested from "City Council Districts"
- **Field Verdict:** CONFIRMED_CORRECT
- **All Fields:** `OBJECTID`, `City`, `DISTRICT`, `Shape__Area`, `Shape__Length`
- **Confirming Fields:** `DISTRICT` (DISTRICT)

## LOW Feature Count Entries (<3 features)

These entries have unusually low feature counts that may indicate:
- Incomplete data
- Wrong layer selected
- City boundary instead of districts
- At-large representation (no districts)

| City | State | FIPS | Features | Recommendation | Reason |
|------|-------|------|----------|----------------|--------|
| Shawnee County | KS | 20177 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Comanche County | OK | 40031 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Oklahoma County | OK | 40109 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Montgomery County | PA | 42091 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Bexar County | TX | 48029 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Madisonville | LA | 2247560 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Wilmington | NC | 3774440 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Oakwood | OH | 3957750 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Baytown | TX | 4806128 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Arapahoe County | CO | 08005 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Peoria | AZ | 0454050 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Jefferson County | CO | 08059 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Antioch | CA | 0602252 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Brentwood | CA | 0608142 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Martinez | CA | 0646114 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Oakley | CA | 0653070 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| San Ramon | CA | 0668378 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Hemet | CA | 0633182 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Santa Monica | CA | 0670000 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Claremont | CA | 0613756 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Riverside County | CA | 06065 | 1 (actual: 1) | **QUARANTINE** | Single feature cannot represent district boundaries |
| Colleton County | SC | 45029 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Hampton County | SC | 45049 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Haysville | KS | 2031125 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Lafayette | LA | 2240735 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Farmington | NM | 3525800 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Victoria | TX | 4875428 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Douglas County | CO | 08035 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |
| Bridgeport | CT | 0908000 | 2 (actual: 2) | **INVESTIGATE** | Only 2 features - possibly incomplete or wrong layer |

### Detailed Analysis: LOW Feature Count

#### Shawnee County, KS

- **FIPS:** 20177
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Shawnee County KS - 1 districts, bulk ingested from "Council District"
- **All Fields:** `OBJECTID`, `NAME`, `DESCRIPTION`, `CREATED`, `MODIFIED`, `CREATOR`, `EDITOR`, `REGION`, `FLAGS`, `SYMBOL`, `SITE_METADATA`, `SITE_UPLOAD_ID`, `DISTNO`, `Population`, `Person`, `PictureURL`, `SiteURL`, `Email`, `Phone`, `DISTTYPE`, `DIST_NAME`, `DISTNM`, `PDDistrict`, `Shape__Area`, `Shape__Length`

#### Comanche County, OK

- **FIPS:** 40031
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Comanche County OK - 1 districts, bulk ingested from "Lawton City Ward Boundaries Outside Area"
- **All Fields:** `OBJECTID`, `FID_1`, `CO_FIPS`, `MUNI_NAME`, `MUNI_CODE`, `WARD_CODE`, `SQ_MILES`, `EDIT_DATE`, `SHAPE_Leng`, `Shape__Area`, `Shape__Length`

#### Oklahoma County, OK

- **FIPS:** 40109
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Oklahoma County OK - 1 districts, bulk ingested from "City_Wards_2023_City_of_Piedmont_Mask"
- **All Fields:** `OBJECTID`, `CO_FIPS`, `MUNI_NAME`, `MUNI_CODE`, `WARD_CODE`, `SQ_MILES`, `EDIT_DATE`, `Shape__Area`, `Shape__Length`

#### Montgomery County, PA

- **FIPS:** 42091
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Montgomery County PA - 1 districts, bulk ingested from "Council District Boundary"
- **All Fields:** `FID`, `FID_1`, `ID`, `DISTRICT`, `SHAPE_Leng`, `Shape__Area`, `Shape__Length`

#### Bexar County, TX

- **FIPS:** 48029
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Bexar County TX - 1 districts, bulk ingested from "Council_District_6"
- **All Fields:** `FID`, `OBJECTID`, `District`, `Name`, `SqMiles`, `GlobalID`, `SHAPE_Leng`, `SHAPE_Area`, `Shape__Area`, `Shape__Length`

#### Madisonville, LA

- **FIPS:** 2247560
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Madisonville LA - 1 districts, bulk ingested from "Council District 4"
- **All Fields:** `OBJECTID`, `AREA`, `DISTRICT`, `NAME`, `POPULATION`, `Shape__Area`, `Shape__Length`

#### Wilmington, NC

- **FIPS:** 3774440
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Wilmington NC - 1 districts, bulk ingested from "City Council"
- **All Fields:** `OBJECTID`, `DISTRICTID`, `NAME`, `REPNAME`, `DISTRICTURL`, `CreationDate`, `Creator`, `EditDate`, `Editor`, `Shape__Area`, `Shape__Length`

#### Oakwood, OH

- **FIPS:** 3957750
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Oakwood OH - 1 districts, bulk ingested from "Cuyahoga Council District 9"
- **All Fields:** `OBJECTID`, `FID_1`, `CCD21`, `Adopted`, `Active`, `Inactive`, `Pending`, `Total_Vote`, `Shape__Are`, `Shape__Len`, `Council_Di`, `Shape__Area`, `Shape__Length`

#### Baytown, TX

- **FIPS:** 4806128
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Baytown TX - 1 districts, bulk ingested from "Find_Locations_in_2022_Council_Districts"
- **All Fields:** `OBJECTID`, `District`, `LAYER`, `created_us`, `created_da`, `last_edite`, `last_edi_1`, `AREA`, `COUNCILMEM`, `POPULATION`, `H18_POP`, `NH18_POP`, `NH18_WHT`, `NH18_BLK`, `NH18_IND`, `NH18_ASN`, `NH18_HWN`, `NH18_OTH`, `TOTAL_US_C`, `NOT_HISPAN`, `AM_INDIAN_`, `ASIAN_US_C`, `BLACK_US_C`, `HAWAIIAN_U`, `WHITE_US_C`, `AM_INDIANW`, `ASIANWHITE`, `BLACKWHITE`, `AM_INDIANB`, `F2_RACES_U`, `HISPANIC_U`, `DEVIATION`, `F_DEVIATIO`, `F_TOTAL_US`, `F_NOT_HISP`, `F_AM_INDIA`, `F_ASIAN_US`, `F_BLACK_US`, `F_HAWAIIAN`, `F_18_POP`, `IDEAL_VALU`, `F_NH18_POP`, `F_H18_POP`, `F_NH18_WHT`, `F_NH18_BLK`, `F_NH18_IND`, `F_NH18_ASN`, `F_NH18_HWN`, `F_NH18_OTH`, `DISTRICT_L`, `PHONE`, `EMAIL`, `Shape_STAr`, `Shape_STLe`

#### Arapahoe County, CO

- **FIPS:** 08005
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Arapahoe County CO - 1 districts, bulk ingested from "City_Council_Districts_portal"
- **All Fields:** `FID`, `District`, `Shape_STAr`, `Shape_STLe`, `Shape_Leng`, `Shape_Area`, `Council_Member`, `Council_Phone`, `Council_Email`

#### Peoria, AZ

- **FIPS:** 0454050
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Peoria AZ - 1 districts, bulk ingested from "Council District"
- **All Fields:** `OBJECTID`, `CCDIST`, `GIS_MOD_DA`, `ACRES`, `Jurisdiction`, `IMS_Tag`, `ID`, `CIty_URL`, `CMember_Photo`, `Council_Person`, `Shape__Area`, `Shape__Length`

#### Jefferson County, CO

- **FIPS:** 08059
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Jefferson County CO - 1 districts, bulk ingested from "Arvada Council Districts"
- **All Fields:** `OBJECTID`, `NAME`, `DESCRIPTION`, `CREATED`, `MODIFIED`, `CREATOR`, `EDITOR`, `REGION`, `FLAGS`, `SYMBOL`, `SITE_METADATA`, `DISTRICT`, `COUNCIL_ME`, `WEBSITE`, `Shape__Area`, `Shape__Length`

#### Antioch, CA

- **FIPS:** 0602252
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Antioch CA - 1 districts, bulk ingested from "City of Antioch - Council District 1"
- **All Fields:** `OBJECTID`, `DistrictName`, `Shape__Area`, `Shape__Length`

#### Brentwood, CA

- **FIPS:** 0608142
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Brentwood CA - 1 districts, bulk ingested from "City of Brentwood - Council District 1"
- **All Fields:** `OBJECTID`, `DistrictName`, `Shape__Area`, `Shape__Length`

#### Martinez, CA

- **FIPS:** 0646114
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Martinez CA - 1 districts, bulk ingested from "City of Martinez - Council District 1"
- **All Fields:** `OBJECTID`, `DistrictName`, `Shape__Area`, `Shape__Length`

#### Oakley, CA

- **FIPS:** 0653070
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Oakley CA - 1 districts, bulk ingested from "City of Oakley - Council District 1"
- **All Fields:** `OBJECTID`, `DistrictName`, `Shape__Area`, `Shape__Length`

#### San Ramon, CA

- **FIPS:** 0668378
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** San Ramon CA - 1 districts, bulk ingested from "City of San Ramon - Council District 1"
- **All Fields:** `OBJECTID`, `DistrictName`, `Shape__Area`, `Shape__Length`

#### Hemet, CA

- **FIPS:** 0633182
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Hemet CA - 1 districts, bulk ingested from "Hemet_Council_District2"
- **All Fields:** `FID`, `OBJECTID`, `ID`, `AREA`, `DISTRICT`, `Photo`, `Council_de`, `Council_me`, `STARTED`, `TERMEXP`, `Shape_STAr`, `Shape_STLe`, `Shape__Area`, `Shape__Length`

#### Santa Monica, CA

- **FIPS:** 0670000
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Santa Monica CA - 1 districts, bulk ingested from "Council_District_11_shp"
- **All Fields:** `FID`, `OBJECTID`, `NAME`, `District`, `District_N`, `TOOLTIP`, `NLA_URL`, `Shape__Area`, `Shape__Length`

#### Claremont, CA

- **FIPS:** 0613756
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Claremont CA - 1 districts, bulk ingested from "Claremont_City_Council_Distrticst_2022"
- **All Fields:** `FID`, `ID`, `AREA`, `DISTRICT`, `MEMBERS`, `LOCKED`, `NAME`, `POPULATION`, `HISPANIC_O`, `NH_WHT`, `DOJ_NH_BLK`, `DOJ_NH_IND`, `DOJ_NH_ASN`, `DOJ_NH_HWN`, `DOJ_NH_OTH`, `DOJ_NH_OT1`, `F18_POPULA`, `H18_POP`, `NH18_WHT`, `DOJ_NH18_B`, `DOJ_NH18_I`, `DOJ_NH18_A`, `DOJ_NH18_H`, `DOJ_NH18_O`, `DOJ_NH18_1`, `ST1519_M1_`, `ST1519_M11`, `ST1519_M12`, `ST1519_M13`, `ST1519_M14`, `ST1519_M15`, `ST1519_M16`, `ST1519_M2_`, `ST1519_M21`, `ST1519_M22`, `ST1519_M23`, `ST1519_M24`, `ST1519_M25`, `ST1519_M26`, `ACS1519_M1`, `ACS1519_M2`, `ACS1519_M3`, `ACS1519_M4`, `ACS1519_M5`, `ACS1519_M6`, `ACS1519_M7`, `ACS1519_M8`, `ACS1519_M9`, `ACS1519_10`, `ACS1519_11`, `ACS1519_12`, `ACS1519_13`, `ACS1519_14`, `ACS1519_15`, `ACS1519_16`, `SWDB_CVAP1`, `SWDB_CVAP2`, `SWDB_CVAP3`, `SWDB_CVAP4`, `SWDB_CVAP5`, `SWDB_CVAP6`, `SWDB_CVAP7`, `SWDB_CVAP8`, `G18_REG_TO`, `G18_REG_SS`, `G18_REG_AS`, `G18_REG_FI`, `G18_REG_LA`, `G18_REG_WH`, `G18_REG_BL`, `G18_VOT_TO`, `G18_VOT_SS`, `G18_VOT_AS`, `G18_VOT_FI`, `G18_VOT_LA`, `G18_VOT_WH`, `G18_VOT_BL`, `G20_REG_TO`, `G20_REG_SS`, `G20_REG_AS`, `G20_REG_FI`, `G20_REG_LA`, `G20_REG_WH`, `G20_REG_BL`, `G20_VOTE_T`, `G20_VOTE_S`, `G20_VOTE_A`, `G20_VOTE_F`, `G20_VOTE_L`, `G20_VOTE_W`, `G20_VOTE_B`, `TRACT_ACSP`, `TRACT_BORN`, `TRACT_IMMI`, `TRACT_CIT`, `TRACT_NONC`, `BG_ACSPOP`, `BG_AGE0_19`, `BG_AGE20_6`, `BG_AGE60PL`, `BG_POP5PLU`, `BG_ENGLISH`, `BG_SPANISH`, `BG_ASIAN_L`, `BG_OTHER_L`, `BG_ENG_LVW`, `BG_POP25PL`, `BG_NOHSDEG`, `BG_HS_GRAD`, `BG_BACHELO`, `BG_GRADDEG`, `BG_POP16PL`, `BG_EMPLOYE`, `BG_HHS`, `BG_FAMS`, `BG_CHILD`, `BG_HHINC0_`, `BG_HHINC25`, `BG_HHINC50`, `BG_HHINC75`, `BG_HHINC20`, `BG_HOUSING`, `BG_VACANT`, `BG_OCCUPIE`, `BG_RENTED`, `BG_OWNED`, `BG_SINGLEF`, `BG_MULTIFA`, `IDEAL_VALU`, `DEVIATION`, `F_DEVIATIO`, `F_HISPANIC`, `F_NH_WHT`, `F_DOJ_NH_B`, `F_DOJ_NH_I`, `F_DOJ_NH_A`, `F_DOJ_NH_H`, `F_DOJ_NH_O`, `F_DOJ_NH_1`, `F_18_POPUL`, `F_H18_POP`, `F_NH18_WHT`, `F_DOJ_NH18`, `F_DOJ_NH11`, `F_DOJ_NH12`, `F_DOJ_NH13`, `F_DOJ_NH14`, `F_DOJ_NH15`, `F_ST1519_M`, `F_ST1519_1`, `F_ST1519_2`, `F_ST1519_3`, `F_ST1519_4`, `F_ST1519_5`, `F_ST1519_6`, `F_ST1519_7`, `F_ST1519_8`, `F_ST1519_9`, `F_ST151910`, `F_ST151911`, `F_ST151912`, `F_ST151913`, `F_ACS1519_`, `F_ACS15191`, `F_ACS15192`, `F_ACS15193`, `F_ACS15194`, `F_ACS15195`, `F_ACS15196`, `F_ACS15197`, `F_ACS15198`, `F_ACS15199`, `F_ACS15110`, `F_ACS15111`, `F_ACS15112`, `F_ACS15113`, `F_ACS15114`, `F_ACS15115`, `F_SWDB_CVA`, `F_SWDB_CV1`, `F_SWDB_CV2`, `F_SWDB_CV3`, `F_SWDB_CV4`, `F_SWDB_CV5`, `F_SWDB_CV6`, `F_SWDB_CV7`, `F_G18_REG_`, `F_G18_REG1`, `F_G18_REG2`, `F_G18_REG3`, `F_G18_REG4`, `F_G18_REG5`, `F_G18_VOT_`, `F_G18_VOT1`, `F_G18_VOT2`, `F_G18_VOT3`, `F_G18_VOT4`, `F_G18_VOT5`, `F_G18_VOT6`, `F_G20_REG_`, `F_G20_REG1`, `F_G20_REG2`, `F_G20_REG3`, `F_G20_REG4`, `F_G20_REG5`, `F_G20_VOTE`, `F_G20_VOT1`, `F_G20_VOT2`, `F_G20_VOT3`, `F_G20_VOT4`, `F_G20_VOT5`, `F_G20_VOT6`, `F_TRACT_AC`, `F_TRACT_BO`, `F_TRACT_IM`, `F_TRACT_CI`, `F_TRACT_NO`, `F_BG_ACSPO`, `F_BG_AGE0_`, `F_BG_AGE20`, `F_BG_AGE60`, `F_BG_POP5P`, `F_BG_ENGLI`, `F_BG_SPANI`, `F_BG_ASIAN`, `F_BG_OTHER`, `F_BG_ENG_L`, `F_BG_POP25`, `F_BG_NOHSD`, `F_BG_HS_GR`, `F_BG_BACHE`, `F_BG_GRADD`, `F_BG_POP16`, `F_BG_EMPLO`, `F_BG_FAMS`, `F_BG_CHILD`, `F_BG_HHINC`, `F_BG_HHIN1`, `F_BG_HHIN2`, `F_BG_HHIN3`, `F_BG_HHIN4`, `F_BG_VACAN`, `F_BG_OCCUP`, `F_BG_RENTE`, `F_BG_OWNED`, `F_BG_SINGL`, `F_BG_MULTI`, `DISTRICT_L`, `Shape__Area`, `Shape__Length`

#### Riverside County, CA

- **FIPS:** 06065
- **Feature Count:** 1 (actual: 1)
- **Recommendation:** QUARANTINE
- **Reason:** Single feature cannot represent district boundaries
- **Notes:** Riverside County CA - 1 districts, bulk ingested from "Hemet_Council_District4"
- **All Fields:** `FID`, `OBJECTID`, `ID`, `AREA`, `DISTRICT`, `Photo`, `Council_de`, `Council_me`, `STARTED`, `TERMEXP`, `Shape_STAr`, `Shape_STLe`, `Shape__Area`, `Shape__Length`

#### Colleton County, SC

- **FIPS:** 45029
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Colleton County SC - 2 districts, bulk ingested from "County Council Districts"
- **All Fields:** `OBJECTID`, `WardNumber`, `WardName`, `SiteName`

#### Hampton County, SC

- **FIPS:** 45049
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Hampton County SC - 2 districts, bulk ingested from "County Council Districts"
- **All Fields:** `OBJECTID`, `DistrictLabel`, `district`, `Shape__Area`, `Shape__Length`

#### Haysville, KS

- **FIPS:** 2031125
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Haysville KS - 2 districts, bulk ingested from "Council_District_1"
- **All Fields:** `OBJECTID`, `CityCD`, `CouDistNO`, `CouRepNM`, `Shape__Area`, `Shape__Length`, `Term_Exp`, `Phn_Nbr`, `E_mail`, `GlobalID`, `CreationDate`, `Creator`, `EditDate`, `Editor`, `CDPopulation`

#### Lafayette, LA

- **FIPS:** 2240735
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Lafayette LA - 2 districts, bulk ingested from "North_Lafayette_City_Council_Districts_1"
- **All Fields:** `FID`, `ID`, `AREA`, `DISTRICT`, `MEMBERS`, `LOCKED`, `NAME`, `DATA`, `IDEAL_VALU`, `DEVIATION`, `F_DEVIATIO`, `Shape__Are`, `Shape__Len`, `Shape__Area`, `Shape__Length`

#### Farmington, NM

- **FIPS:** 3525800
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Farmington NM - 2 districts, bulk ingested from "Farmington_City_Council_Districts"
- **All Fields:** `OBJECTID`, `ID`, `District`, `Councilor`, `Name_Distr`, `AreaI`, `Shape__Area`, `Shape__Length`

#### Victoria, TX

- **FIPS:** 4875428
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Victoria TX - 2 districts, bulk ingested from "COVGIS.DBO.Super_CouncilDistricts"
- **All Fields:** `OBJECTID`, `District`, `Link`, `GlobalID`, `Shape__Area`, `Shape__Length`

#### Douglas County, CO

- **FIPS:** 08035
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Douglas County CO - 2 districts, bulk ingested from "City Council Districts"
- **All Fields:** `objectid`, `district`, `Shape__Area`, `Shape__Length`

#### Bridgeport, CT

- **FIPS:** 0908000
- **Feature Count:** 2 (actual: 2)
- **Recommendation:** INVESTIGATE
- **Reason:** Only 2 features - possibly incomplete or wrong layer
- **Notes:** Bridgeport CT - 2 districts, bulk ingested from "Council_District_130"
- **All Fields:** `FID`, `OBJECTID`, `District`, `Shape_Leng`, `Shape_Area`, `Shape__Area`, `Shape__Length`

## Quarantine List

The following entries should be removed or moved to a quarantine registry:

```typescript
// Entries to quarantine (wrong data type or incomplete)
const QUARANTINE_FIPS = [
  '0827425', // Fort Collins, CO - Field names indicate wrong data type: PRECINCT
  '1315552', // Chattahoochee Hills, GA - Field names indicate wrong data type: CENSUS_BLOCK, ZIP
  '20177', // Shawnee County, KS - Single feature cannot represent district boundaries
  '40031', // Comanche County, OK - Single feature cannot represent district boundaries
  '40109', // Oklahoma County, OK - Single feature cannot represent district boundaries
  '42091', // Montgomery County, PA - Single feature cannot represent district boundaries
  '48029', // Bexar County, TX - Single feature cannot represent district boundaries
  '2247560', // Madisonville, LA - Single feature cannot represent district boundaries
  '3774440', // Wilmington, NC - Single feature cannot represent district boundaries
  '3957750', // Oakwood, OH - Single feature cannot represent district boundaries
  '4806128', // Baytown, TX - Single feature cannot represent district boundaries
  '08005', // Arapahoe County, CO - Single feature cannot represent district boundaries
  '0454050', // Peoria, AZ - Single feature cannot represent district boundaries
  '08059', // Jefferson County, CO - Single feature cannot represent district boundaries
  '0602252', // Antioch, CA - Single feature cannot represent district boundaries
  '0608142', // Brentwood, CA - Single feature cannot represent district boundaries
  '0646114', // Martinez, CA - Single feature cannot represent district boundaries
  '0653070', // Oakley, CA - Single feature cannot represent district boundaries
  '0668378', // San Ramon, CA - Single feature cannot represent district boundaries
  '0633182', // Hemet, CA - Single feature cannot represent district boundaries
  '0670000', // Santa Monica, CA - Single feature cannot represent district boundaries
  '0613756', // Claremont, CA - Single feature cannot represent district boundaries
  '06065', // Riverside County, CA - Single feature cannot represent district boundaries
];
```

## Investigation Required

The following entries need manual verification:

| City | State | FIPS | Features | Reason |
|------|-------|------|----------|--------|
| Hawthorne | CA | 0632548 | 52 | 52 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Clovis | CA | 0614218 | 42 | 42 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Portage | IN | 1861092 | 37 | 37 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Kenosha | WI | 5539225 | 34 | 34 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Auburn | MI | 2604080 | 27 | 27 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Louisville | KY | 2148006 | 26 | 26 features exceeds typical council district count (4-15). May be precincts/tracts. |
| Colleton County | SC | 45029 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Hampton County | SC | 45049 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Haysville | KS | 2031125 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Lafayette | LA | 2240735 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Farmington | NM | 3525800 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Victoria | TX | 4875428 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Douglas County | CO | 08035 | 2 | Only 2 features - possibly incomplete or wrong layer |
| Bridgeport | CT | 0908000 | 2 | Only 2 features - possibly incomplete or wrong layer |
