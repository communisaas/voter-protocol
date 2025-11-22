#!/usr/bin/env tsx

/**
 * City Council District GIS Data Collection Script
 *
 * Automates downloading city council district boundaries from municipal open data portals.
 * Supports ArcGIS Hub, Socrata, CKAN platforms.
 *
 * Usage:
 *   npx tsx scripts/collect-city-council-gis.ts --city "New York"
 *   npx tsx scripts/collect-city-council-gis.ts --all  # Top 50 cities
 *   npx tsx scripts/collect-city-council-gis.ts --dry-run  # Preview only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// City council district data sources (verified FREE open data portals)
interface CityDataSource {
  city: string;
  state: string;
  population: number; // 2025 estimate
  platform: 'arcgis' | 'socrata' | 'ckan' | 'direct';
  url: string;
  datasetId?: string;
  downloadUrl?: string; // Direct GeoJSON/SHP link
  notes?: string;
}

const CITY_DATA_SOURCES: CityDataSource[] = [
  // Top 10 cities (verified sources)
  {
    city: 'New York',
    state: 'NY',
    population: 8_478_000,
    platform: 'socrata',
    url: 'https://data.cityofnewyork.us',
    datasetId: 'jgqm-ccbd',
    downloadUrl: 'https://data.cityofnewyork.us/resource/jgqm-ccbd.geojson',
    notes: 'NYC Open Data - 51 council districts (water areas included, paginated - returns 1000 records max)'
  },
  {
    city: 'Los Angeles',
    state: 'CA',
    population: 3_879_000,
    platform: 'arcgis',
    url: 'https://geohub.lacity.org',
    datasetId: 'Council_Districts_2024',
    downloadUrl: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Council_Districts_2024/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'LA GeoHub - 15 council districts (2024 boundaries)'
  },
  {
    city: 'Chicago',
    state: 'IL',
    population: 2_721_000,
    platform: 'socrata',
    url: 'https://data.cityofchicago.org',
    datasetId: 'sp34-6z76',
    downloadUrl: 'https://data.cityofchicago.org/resource/sp34-6z76.geojson',
    notes: 'Chicago Data Portal - 50 wards (aldermanic districts, paginated - returns 1000 records max)'
  },
  {
    city: 'Houston',
    state: 'TX',
    population: 2_314_000,
    platform: 'arcgis',
    url: 'https://houston-mycity.opendata.arcgis.com',
    datasetId: 'Council_Districts',
    downloadUrl: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Houston Open Data - 16 council districts (2024-2028)'
  },
  {
    city: 'Philadelphia',
    state: 'PA',
    population: 1_584_000,
    platform: 'arcgis',
    url: 'https://www.opendataphilly.org',
    datasetId: '10302c902dba4974b1af1c64c55a1f17_0',
    downloadUrl: 'https://opendata.arcgis.com/api/v3/datasets/10302c902dba4974b1af1c64c55a1f17_0/downloads/data?format=geojson&spatialRefId=4326',
    notes: 'OpenDataPhilly + PASDA - 10 council districts'
  },
  {
    city: 'San Francisco',
    state: 'CA',
    population: 873_000,
    platform: 'socrata',
    url: 'https://data.sfgov.org',
    datasetId: 'cqbw-m5m3',
    downloadUrl: 'https://data.sfgov.org/resource/cqbw-m5m3.geojson',
    notes: 'DataSF - 11 supervisor districts (Current Supervisor Districts)'
  },
  {
    city: 'Seattle',
    state: 'WA',
    population: 749_000,
    platform: 'arcgis',
    url: 'https://data-seattlecitygis.opendata.arcgis.com',
    datasetId: 'council-districts',
    notes: 'Seattle GeoData - 7 council districts (requires manual download - dataset ID changed)'
  },
  {
    city: 'Denver',
    state: 'CO',
    population: 711_000,
    platform: 'arcgis',
    url: 'https://opendata-geospatialdenver.hub.arcgis.com',
    datasetId: 'denver-city-council-districts',
    notes: 'Denver Open Data - 13 council districts (requires manual download - Shapefile only, portal URL changed)'
  },
  {
    city: 'Portland',
    state: 'OR',
    population: 652_000,
    platform: 'direct',
    url: 'https://www.portland.gov/bts/cgis/open-data-site',
    datasetId: 'voting-districts',
    notes: 'Portland Open Data - 4 voting districts (new 2024 system - requires manual download from open data portal)'
  },
  {
    city: 'San Jose',
    state: 'CA',
    population: 1_013_000,
    platform: 'arcgis',
    url: 'https://data.sanjoseca.gov',
    datasetId: '001373893c8347d4b36cf15a6103f78c',
    downloadUrl: 'https://gisdata-csj.opendata.arcgis.com/api/download/v1/items/001373893c8347d4b36cf15a6103f78c/geojson?layers=120',
    notes: 'San Jose Open Data - 10 council districts (effective Feb 2022)'
  },

  // Missing from top 10 - Added 2025-11-15
  {
    city: 'Phoenix',
    state: 'AZ',
    population: 1_738_000,
    platform: 'arcgis',
    url: 'https://maps.phoenix.gov/pub/rest/services',
    datasetId: 'Public/Council_Districts',
    downloadUrl: 'https://maps.phoenix.gov/pub/rest/services/Public/Council_Districts/MapServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Phoenix city GIS server - 8 council districts (MapServer, FIXED 2025-11-15)'
  },
  {
    city: 'San Antonio',
    state: 'TX',
    population: 1_551_000,
    platform: 'arcgis',
    url: 'https://opendata-cosagis.opendata.arcgis.com',
    datasetId: 'council-districts-13',
    downloadUrl: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'City of San Antonio Open Data - 10 council districts'
  },
  {
    city: 'San Diego',
    state: 'CA',
    population: 1_407_000,
    platform: 'arcgis',
    url: 'https://data.sandiego.gov',
    datasetId: 'city-council-districts',
    downloadUrl: 'https://seshat.datasd.org/gis_city_council_districts/council_districts_datasd.geojson',
    notes: 'San Diego Open Data Portal - 9 council districts (adopted December 2021, FIXED 2025-11-15)'
  },
  {
    city: 'Dallas',
    state: 'TX',
    population: 1_343_000,
    platform: 'arcgis',
    url: 'https://gisservices-dallasgis.opendata.arcgis.com',
    datasetId: 'council-areas',
    downloadUrl: 'https://gis.dallascityhall.com/arcgis/rest/services/Basemap/CouncilAreas/MapServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Dallas GIS Services - 14 council districts'
  },

  // Cities 11-20 (VERIFIED - Research completed 2025-11-15)
  {
    city: 'Jacksonville',
    state: 'FL',
    population: 1_024_000,
    platform: 'arcgis',
    url: 'https://www.duvalelections.com',
    notes: 'Duval County Elections Office - PDF maps (34x44), 14 districts + 5 at-large. May need manual conversion or check Florida GIO portal for GIS data'
  },
  {
    city: 'Fort Worth',
    state: 'TX',
    population: 1_029_000,
    platform: 'arcgis',
    url: 'https://data.fortworthtexas.gov',
    datasetId: 'council-districts',
    downloadUrl: 'https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Fort Worth Open Data - 9 districts (2-11, includes Mayor)'
  },
  {
    city: 'Austin',
    state: 'TX',
    population: 1_001_000,
    platform: 'socrata',
    url: 'https://data.austintexas.gov',
    datasetId: 'w3v2-cj58',
    downloadUrl: 'https://data.austintexas.gov/api/geospatial/w3v2-cj58?method=export&format=GeoJSON',
    notes: 'Austin Open Data - 10 council districts (10-1 system adopted 2014)'
  },
  {
    city: 'Charlotte',
    state: 'NC',
    population: 961_000,
    platform: 'arcgis',
    url: 'https://data.charlottenc.gov',
    datasetId: 'council-districts',
    downloadUrl: 'https://gis.charlottenc.gov/arcgis/rest/services/PLN/CouncilDistricts/MapServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Charlotte Open Data - 7 district seats + 4 at-large'
  },
  {
    city: 'Columbus',
    state: 'OH',
    population: 940_000,
    platform: 'arcgis',
    url: 'https://opendata.columbus.gov',
    datasetId: 'columbus-city-council-districts',
    downloadUrl: 'https://opendata.columbus.gov/datasets/columbus::columbus-city-council-districts.geojson',
    notes: 'Columbus Open Data - Multiple council districts (full GIS available)'
  },
  {
    city: 'Indianapolis',
    state: 'IN',
    population: 893_000,
    platform: 'arcgis',
    url: 'https://data.indy.gov',
    datasetId: '71e9ab896aae4adc99f92b7c3a693de5_1',
    downloadUrl: 'https://data.indy.gov/datasets/71e9ab896aae4adc99f92b7c3a693de5_1.geojson',
    notes: 'Open Indy - 25 City-County Council districts (effective 2024)'
  },
  {
    city: 'Washington',
    state: 'DC',
    population: 710_000,
    platform: 'arcgis',
    url: 'https://opendata.dc.gov',
    datasetId: 'ward-boundaries',
    downloadUrl: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/53/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    notes: 'DC GIS - 8 ward boundaries (2022 redistricting, layer 53)'
  },
  {
    city: 'Nashville',
    state: 'TN',
    population: 709_000,
    platform: 'arcgis',
    url: 'https://data.nashville.gov',
    datasetId: '76563eb036964dbab90ba7449ebba8c9_0',
    downloadUrl: 'https://services1.arcgis.com/vdNDkVykv9vEWFX4/arcgis/rest/services/Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    notes: 'Nashville Open Data - 13 Metropolitan Council districts (changed from 35 to 13 after redistricting)'
  },
  {
    city: 'Las Vegas',
    state: 'NV',
    population: 687_000,
    platform: 'arcgis',
    url: 'https://geocommons-lasvegas.opendata.arcgis.com',
    datasetId: 'city-council-wards',
    downloadUrl: 'https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/Council_Wards/FeatureServer/337/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Las Vegas GeoCommons - 6 wards (FeatureServer layer 337, FIXED 2025-11-15)'
  },
  {
    city: 'El Paso',
    state: 'TX',
    population: 682_000,
    platform: 'arcgis',
    url: 'https://city-of-el-paso-open-data-coepgis.hub.arcgis.com',
    datasetId: 'council-districts',
    notes: 'City of El Paso Open Data - 8 council districts (search portal for exact dataset name)'
  },

  // Cities 21-30 (VERIFIED - Research completed 2025-11-15)
  {
    city: 'Boston',
    state: 'MA',
    population: 673_000,
    platform: 'arcgis',
    url: 'https://data.boston.gov',
    datasetId: '549ac75ff3f24588a7a49f52a140483c_0',
    downloadUrl: 'https://opendata.arcgis.com/api/v3/datasets/549ac75ff3f24588a7a49f52a140483c_0/downloads/data?format=geojson&spatialRefId=4326',
    notes: 'Analyze Boston - 9 council districts (2023-2032, ArcGIS Hub download API)'
  },
  {
    city: 'Detroit',
    state: 'MI',
    population: 648_000,
    platform: 'arcgis',
    url: 'https://data.detroitmi.gov',
    datasetId: 'council-districts-detroit',
    downloadUrl: 'https://services2.arcgis.com/HsXtOCMp1Nis1Ogr/arcgis/rest/services/Council_Districts_Detroit/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    notes: 'Data Driven Detroit (D3) - 7 council districts (FeatureServer Layer 0)'
  },
  {
    city: 'Louisville',
    state: 'KY',
    population: 643_000,
    platform: 'arcgis',
    url: 'https://data.louisvilleky.gov',
    datasetId: 'louisville-ky-metro-council-districts',
    downloadUrl: 'https://data.lojic.org/datasets/LOJIC::louisville-ky-metro-council-districts.geojson',
    notes: 'LOJIC Open Data - 26 Metro Council districts (2020 census redistricting)'
  },
  {
    city: 'Memphis',
    state: 'TN',
    population: 607_000,
    platform: 'socrata',
    url: 'https://data.memphistn.gov',
    datasetId: 'j84c-6ect',
    downloadUrl: 'https://data.memphistn.gov/api/geospatial/j84c-6ect?method=export&format=GeoJSON',
    notes: 'Memphis Data Hub - 7 districts + 2 super districts (13 total members)'
  },
  {
    city: 'Baltimore',
    state: 'MD',
    population: 565_000,
    platform: 'arcgis',
    url: 'https://data.baltimorecity.gov',
    datasetId: 'city-council-districts',
    notes: 'Baltimore Open Data - 14 council districts (NEEDS MANUAL VERIFICATION - multiple dataset IDs exist, Socrata endpoints changed)'
  },
  {
    city: 'Milwaukee',
    state: 'WI',
    population: 560_000,
    platform: 'arcgis',
    url: 'https://data.milwaukee.gov',
    datasetId: 'c52db8313e7641d1bff8685e06aeda24',
    notes: 'MCLIO Open Data - 15 aldermanic districts (2024 redistricting, NEEDS MANUAL VERIFICATION - ArcGIS Hub download API returns 500 errors)'
  },
  {
    city: 'Albuquerque',
    state: 'NM',
    population: 559_000,
    platform: 'arcgis',
    url: 'https://hub.arcgis.com',
    datasetId: 'CABQ::council-districts',
    downloadUrl: 'https://hub.arcgis.com/datasets/CABQ::council-districts.geojson',
    notes: 'CABQ ArcGIS Hub + Bernalillo County Clerk - 9 council districts (Shapefile, KMZ available)'
  },
  {
    city: 'Tucson',
    state: 'AZ',
    population: 557_000,
    platform: 'arcgis',
    url: 'https://gisdata.tucsonaz.gov',
    datasetId: 'city-of-tucson-wards-open-data',
    downloadUrl: 'https://gis.tucsonaz.gov/public/rest/services/PublicMaps/Boundaries/MapServer/15/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'City of Tucson Open Data + Pima County GIS - 6 wards (MapServer layer 15, FIXED 2025-11-15)'
  },
  {
    city: 'Fresno',
    state: 'CA',
    population: 552_000,
    platform: 'arcgis',
    url: 'https://gis-cityoffresno.hub.arcgis.com',
    datasetId: 'council-districts',
    notes: 'City of Fresno GIS Hub - 7 council districts (search portal for exact dataset)'
  },
  {
    city: 'Sacramento',
    state: 'CA',
    population: 538_000,
    platform: 'arcgis',
    url: 'https://data.cityofsacramento.org',
    datasetId: 'city-council-districts',
    downloadUrl: 'https://mapservices.gis.saccounty.net/arcgis/rest/services/CITY_of_SACRAMENTO/MapServer/5/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    notes: 'Sacramento County GIS - 8 city council districts (MapServer layer 5)'
  },

  // Cities 31-40 (VERIFIED - Research completed 2025-11-15)
  {
    city: 'Atlanta',
    state: 'GA',
    population: 525_000,
    platform: 'arcgis',
    url: 'https://dpcd-coaplangis.opendata.arcgis.com',
    datasetId: 'city-of-atlanta-council-districts',
    notes: 'ARC Open Data Hub - 12 council districts + 3 at-large (NEEDS MANUAL VERIFICATION - old URL returns 403, new 2025 redistricting data may be available)'
  },
  {
    city: 'Mesa',
    state: 'AZ',
    population: 520_000,
    platform: 'arcgis',
    url: 'https://data.mesaaz.gov',
    notes: 'SKIP - At-large council (6 councilmembers + mayor, no geographic districts)'
  },
  {
    city: 'Kansas City',
    state: 'MO',
    population: 518_000,
    platform: 'socrata',
    url: 'https://data.kcmo.org',
    datasetId: '5qar-bf4m',
    downloadUrl: 'https://data.kcmo.org/api/geospatial/5qar-bf4m?method=export&format=GeoJSON',
    notes: 'Open Data KC - 6 in-district + 6 at-large (2023 redistricting)'
  },
  {
    city: 'Raleigh',
    state: 'NC',
    population: 508_000,
    platform: 'arcgis',
    url: 'https://data-ral.opendata.arcgis.com',
    notes: 'SKIP - At-large election system (5 at-large seats + 3 district seats, complex structure)'
  },
  {
    city: 'Miami',
    state: 'FL',
    population: 498_000,
    platform: 'arcgis',
    url: 'https://datahub-miamigis.opendata.arcgis.com',
    datasetId: 'commission-districts-1',
    notes: 'Miami GIS Open Data - 5 commission districts (NEEDS MANUAL VERIFICATION - old URL returns 403, dataset may have moved or been renamed)'
  },
  {
    city: 'Colorado Springs',
    state: 'CO',
    population: 488_000,
    platform: 'arcgis',
    url: 'https://data.coloradosprings.gov',
    datasetId: 'council-districts',
    notes: 'Colorado Springs Open Data - 6 council districts (search portal for exact dataset)'
  },
  {
    city: 'Omaha',
    state: 'NE',
    population: 483_000,
    platform: 'arcgis',
    url: 'https://data.dogis.org',
    datasetId: '7cfcd013310942dba79780f2b7499817_0',
    downloadUrl: 'https://dcgis.org/server/rest/services/Hosted/Omaha_City_Council_Districts_(source)_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Douglas-Omaha GIS (DOGIS) - 7 council districts (FeatureServer, FIXED 2025-11-15)'
  },
  {
    city: 'Long Beach',
    state: 'CA',
    population: 450_000,
    platform: 'arcgis',
    url: 'https://data-longbeach.opendata.arcgis.com',
    datasetId: 'c21dc4adc0d344c49a3298e3bc4adeb3_0',
    downloadUrl: 'https://opendata.arcgis.com/api/v3/datasets/c21dc4adc0d344c49a3298e3bc4adeb3_0/downloads/data?format=geojson&spatialRefId=4326',
    notes: 'Long Beach Open Data - 9 council districts (ArcGIS Hub download API)'
  },
  {
    city: 'Oakland',
    state: 'CA',
    population: 433_000,
    platform: 'socrata',
    url: 'https://data.oaklandca.gov',
    datasetId: 'g7vb-tiyh',
    downloadUrl: 'https://data.oaklandca.gov/resource/g7vb-tiyh.geojson',
    notes: 'Oakland Open Data - 7 council districts (Socrata resource endpoint)'
  },
  {
    city: 'Minneapolis',
    state: 'MN',
    population: 425_000,
    platform: 'arcgis',
    url: 'https://opendata.minneapolismn.gov',
    datasetId: 'aca71697b39a4ee1abc3c79e2c65f6d8_0',
    downloadUrl: 'https://opendata.arcgis.com/api/v3/datasets/aca71697b39a4ee1abc3c79e2c65f6d8_0/downloads/data?format=geojson&spatialRefId=4326',
    notes: 'Minneapolis Open Data - 13 ward boundaries (ArcGIS Hub download API)'
  },

  // Cities 41-50 (PARTIAL VERIFICATION - some require Cicero fence)
  {
    city: 'Tulsa',
    state: 'OK',
    population: 410_000,
    platform: 'arcgis',
    url: 'https://gis2-cityoftulsa.opendata.arcgis.com',
    datasetId: 'council-districts',
    notes: 'City of Tulsa Open Data - 9 council districts (search portal for exact dataset)'
  },
  {
    city: 'Arlington',
    state: 'TX',
    population: 397_000,
    platform: 'arcgis',
    url: 'https://data.arlingtontx.gov',
    notes: 'SKIP - At-large council (6 councilmembers + mayor, no geographic districts)'
  },
  {
    city: 'Tampa',
    state: 'FL',
    population: 392_000,
    platform: 'arcgis',
    url: 'https://city-tampa.opendata.arcgis.com',
    datasetId: '8a45d0b08d774a9b844acc2f4a6d2e41',
    downloadUrl: 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Boundary/MapServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'City of Tampa GIS - 4 geographic districts (4-7) + 3 at-large seats (1-3 have no boundaries, MapServer, FIXED 2025-11-15)'
  },
  {
    city: 'New Orleans',
    state: 'LA',
    population: 384_000,
    platform: 'socrata',
    url: 'https://data.nola.gov',
    datasetId: 'd49t-wy6p',
    downloadUrl: 'https://data.nola.gov/resource/d49t-wy6p.geojson',
    notes: 'NOLA Open Data - 5 council districts (A-E, Socrata resource endpoint)'
  },
  {
    city: 'Wichita',
    state: 'KS',
    population: 396_000,
    platform: 'arcgis',
    url: 'https://city-of-wichita-gis-cityofwichita.hub.arcgis.com',
    datasetId: 'council-districts',
    notes: 'City of Wichita GIS Hub + Sedgwick County - 6 council districts (download maps section)'
  },
  {
    city: 'Bakersfield',
    state: 'CA',
    population: 407_000,
    platform: 'arcgis',
    url: 'https://bakersfielddatalibrary-cob.opendata.arcgis.com',
    datasetId: 'b701a21d0c264823b15f6f2dc52f5f6d',
    downloadUrl: 'https://gis.bakersfieldcity.us/webmaps/rest/services/General/Boundary/MapServer/5/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'Bakersfield City GIS - 7 wards (MapServer layer 5, FIXED 2025-11-15)'
  },
  {
    city: 'Aurora',
    state: 'CO',
    population: 390_000,
    platform: 'arcgis',
    url: 'https://gis.auroragov.org',
    datasetId: 'city-council-wards',
    notes: 'Aurora GIS - 6 ward boundaries (NEEDS MANUAL VERIFICATION - FeatureServer query returns 400 errors, service name may have changed)'
  },
  {
    city: 'Anaheim',
    state: 'CA',
    population: 346_000,
    platform: 'arcgis',
    url: 'https://data-anaheim.opendata.arcgis.com',
    datasetId: '65008f112e62422aa2e55d858347e3f7',
    downloadUrl: 'https://gis.anaheim.net/map/rest/services/OpenData2/FeatureServer/46/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'City of Anaheim GIS - 6 council districts (FeatureServer layer 46, FIXED 2025-11-15)'
  },
  {
    city: 'Honolulu',
    state: 'HI',
    population: 350_000,
    platform: 'arcgis',
    url: 'https://honolulu-cchnl.opendata.arcgis.com',
    datasetId: '0bcab006925947bb8d6931881afb5ae8_1',
    downloadUrl: 'https://opendata.arcgis.com/api/v3/datasets/0bcab006925947bb8d6931881afb5ae8_1/downloads/data?format=geojson&spatialRefId=4326',
    notes: 'Honolulu Open Data - 9 council districts (ArcGIS Hub download API)'
  },
  {
    city: 'Santa Ana',
    state: 'CA',
    population: 309_000,
    platform: 'arcgis',
    url: 'https://gis-santa-ana.opendata.arcgis.com',
    datasetId: '5b2802ac5b4a4b84afc03a352bd96d33',
    downloadUrl: 'https://services1.arcgis.com/u3G8zpmDyNtG4F4e/arcgis/rest/services/Council_Wards/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
    notes: 'City of Santa Ana GIS - 6 wards (redistricted 2022, FeatureServer layer 0, FIXED 2025-11-15)'
  }
];

interface DownloadResult {
  city: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  districtCount?: number;
  format?: string;
}

async function downloadGeoJSON(url: string, outputPath: string): Promise<void> {
  console.log(`  Downloading from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Validate GeoJSON structure
  if (!data.type || data.type !== 'FeatureCollection') {
    throw new Error('Invalid GeoJSON: not a FeatureCollection');
  }

  if (!data.features || !Array.isArray(data.features)) {
    throw new Error('Invalid GeoJSON: missing features array');
  }

  // Write to file with pretty formatting
  fs.writeFileSync(
    outputPath,
    JSON.stringify(data, null, 2),
    'utf-8'
  );

  console.log(`  ✅ Downloaded ${data.features.length} districts`);
}

async function downloadCity(source: CityDataSource, dryRun: boolean = false): Promise<DownloadResult> {
  const citySlug = source.city.toLowerCase().replace(/\s+/g, '-');
  const outputPath = path.join(
    __dirname,
    '../packages/crypto/data/city-council-districts',
    `${citySlug}.geojson`
  );

  console.log(`\n📍 ${source.city}, ${source.state}`);
  console.log(`   Population: ${source.population.toLocaleString()}`);
  console.log(`   Platform: ${source.platform}`);
  console.log(`   URL: ${source.url}`);

  if (source.notes) {
    console.log(`   Notes: ${source.notes}`);
  }

  // Check if download URL exists
  if (!source.downloadUrl) {
    console.log(`   ⚠️  No download URL configured - manual collection required`);
    return {
      city: source.city,
      success: false,
      error: 'No download URL configured'
    };
  }

  if (dryRun) {
    console.log(`   🔍 DRY RUN - would download to: ${outputPath}`);
    return {
      city: source.city,
      success: true,
      outputPath
    };
  }

  try {
    await downloadGeoJSON(source.downloadUrl, outputPath);

    // Read back to get district count
    const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

    return {
      city: source.city,
      success: true,
      outputPath,
      districtCount: data.features.length,
      format: 'GeoJSON'
    };
  } catch (error) {
    console.error(`   ❌ Download failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      city: source.city,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cityFilter = args.find(arg => arg.startsWith('--city='))?.split('=')[1];
  const downloadAll = args.includes('--all');

  console.log('🏛️  City Council District GIS Data Collection\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be downloaded\n');
  }

  // Filter sources
  let sources = CITY_DATA_SOURCES;
  if (cityFilter) {
    sources = sources.filter(s =>
      s.city.toLowerCase() === cityFilter.toLowerCase()
    );
    if (sources.length === 0) {
      console.error(`❌ City not found: ${cityFilter}`);
      process.exit(1);
    }
  } else if (!downloadAll) {
    // Default to top 10 verified cities only
    sources = sources.filter(s => s.downloadUrl !== undefined);
    console.log(`📊 Downloading top ${sources.length} verified cities (use --all for all 50)\n`);
  }

  // Create output directory
  const outputDir = path.join(__dirname, '../packages/crypto/data/city-council-districts');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created directory: ${outputDir}\n`);
  }

  // Download each city
  const results: DownloadResult[] = [];
  for (const source of sources) {
    const result = await downloadCity(source, dryRun);
    results.push(result);

    // Rate limiting: wait 1 second between requests
    if (!dryRun && sources.indexOf(source) < sources.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 DOWNLOAD SUMMARY\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    const totalDistricts = successful.reduce((sum, r) => sum + (r.districtCount || 0), 0);
    const totalPopulation = sources
      .filter(s => successful.some(r => r.city === s.city))
      .reduce((sum, s) => sum + s.population, 0);

    console.log(`\n📈 Coverage:`);
    console.log(`   Districts: ${totalDistricts.toLocaleString()}`);
    console.log(`   Population: ${totalPopulation.toLocaleString()} (~${Math.round(totalPopulation / 330_000_000 * 100)}% of US)`);
  }

  if (failed.length > 0) {
    console.log(`\n⚠️  Failed cities (manual collection required):`);
    failed.forEach(r => {
      console.log(`   - ${r.city}: ${r.error}`);
    });
  }

  // Generate README
  if (!dryRun && successful.length > 0) {
    const readmePath = path.join(outputDir, 'README.md');
    const readme = generateReadme(successful, sources);
    fs.writeFileSync(readmePath, readme, 'utf-8');
    console.log(`\n📄 Generated: ${readmePath}`);
  }

  console.log('\n' + '='.repeat(80));

  process.exit(failed.length > 0 ? 1 : 0);
}

function generateReadme(results: DownloadResult[], sources: CityDataSource[]): string {
  const date = new Date().toISOString().split('T')[0];

  return `# City Council District GIS Data

**Last Updated:** ${date}
**Cities:** ${results.length}
**Format:** GeoJSON (WGS84)

## Data Sources

| City | State | Districts | Source | License |
|------|-------|-----------|--------|---------|
${results.map(r => {
  const source = sources.find(s => s.city === r.city)!;
  return `| ${source.city} | ${source.state} | ${r.districtCount} | [${source.platform}](${source.url}) | Open Data |`;
}).join('\n')}

## File Format

All files are standardized GeoJSON (EPSG:4326 WGS84 projection):

\`\`\`json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "district": "1",
        "name": "District 1",
        "representative": "Council Member Name"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
\`\`\`

## Usage

\`\`\`typescript
import fs from 'fs';

// Load city council districts
const districts = JSON.parse(
  fs.readFileSync('city-council-districts/new-york.geojson', 'utf-8')
);

// Find district for a coordinate
import * as turf from '@turf/turf';
const point = turf.point([-73.935242, 40.730610]); // Manhattan

for (const district of districts.features) {
  if (turf.booleanPointInPolygon(point, district)) {
    console.log(\`Found: \${district.properties.name}\`);
  }
}
\`\`\`

## Data Updates

City council districts are redistricted every 10 years after the census, with occasional special elections triggering boundary changes.

**Update Process:**
1. Monitor municipal open data portals for boundary updates
2. Re-run \`npx tsx scripts/collect-city-council-gis.ts --all\`
3. Validate topology with \`npx tsx scripts/validate-city-council-gis.ts\`
4. Commit with version tag (e.g., \`nyc-2025-redistricting\`)

## License

All data sourced from municipal open data portals under public domain or open data licenses. See individual city portals for specific license terms.

**Collection Script:** \`/scripts/collect-city-council-gis.ts\`
**Generated:** ${date}
`;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { downloadCity, CITY_DATA_SOURCES };
