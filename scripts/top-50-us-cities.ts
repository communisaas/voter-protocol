/**
 * Top 50 US Cities by 2020 Census Population
 *
 * Source: US Census Bureau, 2020 Decennial Census
 * https://www.census.gov/programs-surveys/decennial-census/decade/2020/2020-census-main.html
 *
 * FIPS codes are 7-digit Census PLACE codes (state FIPS + place code)
 */

export interface CityData {
  readonly rank: number;
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly pop2020: number;
}

export const TOP_50_US_CITIES: CityData[] = [
  { rank: 1, fips: '3651000', name: 'New York', state: 'NY', pop2020: 8804190 },
  { rank: 2, fips: '0644000', name: 'Los Angeles', state: 'CA', pop2020: 3898747 },
  { rank: 3, fips: '1714000', name: 'Chicago', state: 'IL', pop2020: 2746388 },
  { rank: 4, fips: '4835000', name: 'Houston', state: 'TX', pop2020: 2304580 },
  { rank: 5, fips: '0455000', name: 'Phoenix', state: 'AZ', pop2020: 1608139 },
  { rank: 6, fips: '4260000', name: 'Philadelphia', state: 'PA', pop2020: 1603797 },
  { rank: 7, fips: '4865000', name: 'San Antonio', state: 'TX', pop2020: 1434625 },
  { rank: 8, fips: '0666000', name: 'San Diego', state: 'CA', pop2020: 1386932 },
  { rank: 9, fips: '4819000', name: 'Dallas', state: 'TX', pop2020: 1304379 },
  { rank: 10, fips: '0668000', name: 'San Jose', state: 'CA', pop2020: 1013240 },
  { rank: 11, fips: '4805000', name: 'Austin', state: 'TX', pop2020: 961855 },
  { rank: 12, fips: '1235000', name: 'Jacksonville', state: 'FL', pop2020: 949611 },
  { rank: 13, fips: '4827000', name: 'Fort Worth', state: 'TX', pop2020: 918915 },
  { rank: 14, fips: '3918000', name: 'Columbus', state: 'OH', pop2020: 905748 },
  { rank: 15, fips: '0667000', name: 'San Francisco', state: 'CA', pop2020: 873965 },
  { rank: 16, fips: '3712000', name: 'Charlotte', state: 'NC', pop2020: 874579 },
  { rank: 17, fips: '1836003', name: 'Indianapolis', state: 'IN', pop2020: 887642 },
  { rank: 18, fips: '5363000', name: 'Seattle', state: 'WA', pop2020: 737015 },
  { rank: 19, fips: '0820000', name: 'Denver', state: 'CO', pop2020: 715522 },
  { rank: 20, fips: '1150000', name: 'Washington', state: 'DC', pop2020: 689545 },
  { rank: 21, fips: '2507000', name: 'Boston', state: 'MA', pop2020: 675647 },
  { rank: 22, fips: '4824000', name: 'El Paso', state: 'TX', pop2020: 678815 },
  { rank: 23, fips: '2622000', name: 'Detroit', state: 'MI', pop2020: 639111 },
  { rank: 24, fips: '4752006', name: 'Nashville', state: 'TN', pop2020: 689447 },
  { rank: 25, fips: '4159000', name: 'Portland', state: 'OR', pop2020: 652503 },
  { rank: 26, fips: '4055000', name: 'Oklahoma City', state: 'OK', pop2020: 681054 },
  { rank: 27, fips: '3240000', name: 'Las Vegas', state: 'NV', pop2020: 641903 },
  { rank: 28, fips: '4748000', name: 'Memphis', state: 'TN', pop2020: 633104 },
  { rank: 29, fips: '2148006', name: 'Louisville', state: 'KY', pop2020: 633045 },
  { rank: 30, fips: '2404000', name: 'Baltimore', state: 'MD', pop2020: 585708 },
  { rank: 31, fips: '5553000', name: 'Milwaukee', state: 'WI', pop2020: 577222 },
  { rank: 32, fips: '3502000', name: 'Albuquerque', state: 'NM', pop2020: 564559 },
  { rank: 33, fips: '0477000', name: 'Tucson', state: 'AZ', pop2020: 542629 },
  { rank: 34, fips: '0627000', name: 'Fresno', state: 'CA', pop2020: 542107 },
  { rank: 35, fips: '0664000', name: 'Sacramento', state: 'CA', pop2020: 524943 },
  { rank: 36, fips: '2938000', name: 'Kansas City', state: 'MO', pop2020: 508090 },
  { rank: 37, fips: '0446000', name: 'Mesa', state: 'AZ', pop2020: 504258 },
  { rank: 38, fips: '1304000', name: 'Atlanta', state: 'GA', pop2020: 498715 },
  { rank: 39, fips: '0816000', name: 'Colorado Springs', state: 'CO', pop2020: 478961 },
  { rank: 40, fips: '3755000', name: 'Raleigh', state: 'NC', pop2020: 467665 },
  { rank: 41, fips: '3137000', name: 'Omaha', state: 'NE', pop2020: 486051 },
  { rank: 42, fips: '1245000', name: 'Miami', state: 'FL', pop2020: 442241 },
  { rank: 43, fips: '0643000', name: 'Long Beach', state: 'CA', pop2020: 466742 },
  { rank: 44, fips: '5182000', name: 'Virginia Beach', state: 'VA', pop2020: 459470 },
  { rank: 45, fips: '0653000', name: 'Oakland', state: 'CA', pop2020: 440646 },
  { rank: 46, fips: '2743000', name: 'Minneapolis', state: 'MN', pop2020: 429954 },
  { rank: 47, fips: '4075000', name: 'Tulsa', state: 'OK', pop2020: 413066 },
  { rank: 48, fips: '4804000', name: 'Arlington', state: 'TX', pop2020: 394266 },
  { rank: 49, fips: '1271000', name: 'Tampa', state: 'FL', pop2020: 384959 },
  { rank: 50, fips: '2255000', name: 'New Orleans', state: 'LA', pop2020: 383997 },
];
