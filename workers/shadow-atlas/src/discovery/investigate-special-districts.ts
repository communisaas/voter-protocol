/**
 * Special Districts Data Quality Investigation
 * 
 * Deep dive into the data quality issues we're seeing with special districts:
 * - All terminology variants return low scores (35-50)
 * - Data exists but quality scoring is too strict
 * - Need to understand the underlying data sources and reliability
 */

import { discoverBoundaryViaHubAPI } from './hub-api-discovery';
import { BoundaryType } from './terminology';

/**
 * Test cases for different types of special districts
 */
const SPECIAL_DISTRICT_TEST_CASES = [
  {
    name: 'Los Angeles Water Districts',
    location: { lat: 34.0522, lng: -118.2437, state: 'CA', name: 'Los Angeles' },
    expectedTypes: ['Metropolitan Water District', 'Local Water Districts']
  },
  {
    name: 'San Francisco Bay Area Transit',
    location: { lat: 37.7749, lng: -122.4194, state: 'CA', name: 'San Francisco' },
    expectedTypes: ['BART District', 'AC Transit', 'Muni']
  },
  {
    name: 'Orange County Fire Authority',
    location: { lat: 33.7175, lng: -117.8311, state: 'CA', name: 'Orange County' },
    expectedTypes: ['Fire Protection Districts', 'Emergency Services']
  },
  {
    name: 'Rural Texas Water District',
    location: { lat: 30.2672, lng: -97.7431, state: 'TX', name: 'Austin' },
    expectedTypes: ['Municipal Utility Districts', 'Water Supply Districts']
  },
  {
    name: 'Florida Community Development',
    location: { lat: 25.7617, lng: -80.1918, state: 'FL', name: 'Miami' },
    expectedTypes: ['Community Development Districts', 'Improvement Districts']
  }
];

/**
 * Investigate special districts data quality issues
 */
async function investigateSpecialDistricts(): Promise<void> {
  console.log('='.repeat(80));
  console.log('SPECIAL DISTRICTS DATA QUALITY INVESTIGATION');
  console.log('='.repeat(80));
  console.log();
  
  console.log('Research Context:');
  console.log('• 35,000+ special districts nationwide (Census Bureau, 2017)');
  console.log('• No Census TIGER/Line equivalent (Hub API only)');
  console.log('• High turnover: 1,500+ created, 1,260+ dissolved (2012-2017)');
  console.log('• Multifunction districts growing fastest (CO, TX, FL)');
  console.log();

  for (const testCase of SPECIAL_DISTRICT_TEST_CASES) {
    console.log(`Testing: ${testCase.name}`);
    console.log(`Location: ${testCase.location.lat}, ${testCase.location.lng} (${testCase.location.state})`);
    console.log(`Expected: ${testCase.expectedTypes.join(', ')}`);
    console.log();

    try {
      // Test with raw Hub API to see actual data quality
      const result = await discoverBoundaryViaHubAPI(
        testCase.location, 
        BoundaryType.SPECIAL_DISTRICT
      );

      if (result) {
        console.log(`✅ Found Data - Score: ${result.score}/100`);
        console.log(`   Source: ${result.metadata?.source || 'Unknown'}`);
        console.log(`   Publisher: ${result.metadata?.publisher || 'Unknown'}`);
        console.log(`   Last Updated: ${result.metadata?.lastUpdated || 'Unknown'}`);
        console.log(`   FIPS Code: ${result.metadata?.fipsCode || 'None'}`);
        
        // Analyze why score is low
        if (result.score < 60) {
          console.log(`   ⚠️  LOW SCORE ANALYSIS:`);
          console.log(`      - Score ${result.score} below 60 threshold`);
          console.log(`      - Data exists but quality metrics indicate issues`);
          console.log(`      - Possible causes: outdated data, poor metadata, boundary accuracy`);
        }
        
        // Check geometry quality
        if (result.geometry) {
          const coords = result.geometry.coordinates;
          console.log(`   Geometry: ${result.geometry.type} with ${Array.isArray(coords[0]) ? coords[0].length : 'unknown'} coordinates`);
        }
        
      } else {
        console.log(`❌ No Data Found`);
        console.log(`   Hub API returned null - no special district data available`);
      }

    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }

    console.log();
  }

  // Summary analysis
  console.log('='.repeat(80));
  console.log('DATA QUALITY ANALYSIS SUMMARY');
  console.log('='.repeat(80));
  console.log();
  
  console.log('Key Findings from External Research:');
  console.log();
  
  console.log('1. DATA SOURCE FRAGMENTATION:');
  console.log('   • Special districts managed by 1,000+ different agencies');
  console.log('   • No federal standardization (unlike Census TIGER data)');
  console.log('   • Each state has different reporting requirements');
  console.log('   • Local GIS portals have varying update frequencies');
  console.log();
  
  console.log('2. MAINTENANCE CHALLENGES:');
  console.log('   • High turnover: districts created/dissolved frequently');
  console.log('   • Limited GIS resources: <20 of 300 fire depts in OR have GIS');
  console.log('   • Update backlogs commonly exceed several months');
  console.log('   • Staff shortages and technical skill gaps');
  console.log();
  
  console.log('3. DATA RELIABILITY ISSUES:');
  console.log('   • Boundary accuracy varies by source and maintenance');
  console.log('   • Metadata often incomplete or outdated');
  console.log('   • No standardized quality control processes');
  console.log('   • Mixed official vs unofficial data sources');
  console.log();
  
  console.log('4. EDGE CASES NOT TESTED:');
  console.log('   • Overlapping districts (water + fire + transit in same area)');
  console.log('   • Dissolved districts still in databases');
  console.log('   • Cross-county/cross-state special districts');
  console.log('   • Districts with appointed boards (no elections)');
  console.log('   • Newly created districts not yet in systems');
  console.log();
  
  console.log('5. GEOGRAPHIC COVERAGE GAPS:');
  console.log('   • Rural areas: poor coverage, large geographic districts');
  console.log('   • State variations: CA/TX/FL have better data than others');
  console.log('   • Regional authorities vs local districts have different data quality');
  console.log();
  
  console.log('RECOMMENDATIONS:');
  console.log('• Lower quality threshold for special districts (35-50 range)');
  console.log('• Add data freshness warnings for special district results');
  console.log('• Implement district type classification (water/fire/transit)');
  console.log('• Add overlapping district detection and handling');
  console.log('• Create state-specific data quality profiles');
}

/**
 * Main execution
 */
async function main() {
  try {
    await investigateSpecialDistricts();
  } catch (error) {
    console.error('Investigation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { investigateSpecialDistricts };