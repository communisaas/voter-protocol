/**
 * Local Development Example
 * Demonstrates using VOTERClient with locally-served Shadow Atlas
 *
 * Prerequisites:
 *   1. npm run atlas:dev      # Build mock Shadow Atlas
 *   2. npm run atlas:verify   # Verify Atlas integrity
 *   3. npm run atlas:serve    # Start local server (keep running)
 *   4. tsx examples/local-development.ts  # Run this example
 */

import { VOTERClient } from '../packages/client/src';
import { createStreetAddress } from '../packages/client/src/utils/addresses';

async function main() {
  console.log('🗺️  VOTER Protocol - Local Development Example\n');

  // Step 1: Create client with local Shadow Atlas
  console.log('1. Creating VOTERClient with local Shadow Atlas...');
  const client = new VOTERClient({
    network: 'scroll-sepolia',
    nearNetwork: 'testnet',
    districtGateAddress: '0x0000000000000000000000000000000000000000', // Mock address
    reputationRegistryAddress: '0x0000000000000000000000000000000000000000', // Mock address

    // USE LOCAL SERVER instead of IPFS
    shadowAtlasUrl: 'http://localhost:8080/atlas',

    // Skip NEAR account creation for faster testing
    skipNEAR: true,

    // Minimal caching for development (faster iteration)
    cacheStrategy: 'minimal'
  });

  console.log('   ✓ Client created\n');

  // Step 2: Wait for initialization
  console.log('2. Waiting for client initialization...');
  await client.ready();
  console.log('   ✓ Client ready\n');

  // Step 3: Verify client state
  console.log('3. Client state:');
  const state = client.getState();
  console.log(`   Network: ${client.getNetwork()}`);
  console.log(`   Initialized: ${state.initialized}`);
  console.log(`   NEAR account: ${state.nearAccount || 'skipped'}`);
  console.log();

  // Step 4: Test Shadow Atlas access
  console.log('4. Accessing Shadow Atlas...');
  const shadowAtlas = client.zk.shadowAtlas;

  if (shadowAtlas && shadowAtlas.isLoaded()) {
    const metadata = shadowAtlas.getMetadata();
    console.log(`   ✓ Atlas loaded`);
    console.log(`   Version: ${metadata?.version}`);
    console.log(`   Congress: ${metadata?.congress}th`);
    console.log(`   Districts: ${metadata?.totalDistricts}`);
    console.log(`   CID: ${shadowAtlas.getCurrentCID()}`);
    console.log();
  } else {
    console.log('   ℹ Atlas not loaded yet (will load on first proof generation)\n');
  }

  // Step 5: Test address validation
  console.log('5. Testing address validation...');

  const testAddresses = [
    '1600 Pennsylvania Ave NW, Washington, DC 20500', // White House
    '1 Infinite Loop, Cupertino, CA 95014',           // Apple HQ (invalid - no city/state)
    '123 Main St',                                     // Too short
    'Some random text without numbers'                // Invalid format
  ];

  for (const addr of testAddresses) {
    try {
      const streetAddress = createStreetAddress(addr);
      console.log(`   ✓ Valid: "${addr.slice(0, 40)}..."`);
    } catch (error) {
      if (error instanceof Error) {
        console.log(`   ✗ Invalid: "${addr.slice(0, 40)}..." - ${error.message}`);
      }
    }
  }

  console.log();

  // Step 6: Demonstrate proof generation workflow (mock)
  console.log('6. Proof generation workflow (mock):\n');

  console.log('   NOTE: Full proof generation requires:');
  console.log('   - Deployed DistrictGate contract on Scroll Sepolia');
  console.log('   - Shadow Atlas published to IPFS');
  console.log('   - CID stored in contract');
  console.log();

  console.log('   Mock workflow:');
  console.log('   a) User enters address in browser');
  console.log('   b) Client geocodes address → (lat, lon)');
  console.log('   c) Client loads Shadow Atlas from local server');
  console.log('   d) Client generates Merkle proof');
  console.log('   e) Client generates Halo2 ZK proof (8-12 sec)');
  console.log('   f) Client submits proof on-chain');
  console.log();

  // Step 7: Show example production config
  console.log('7. Production configuration example:\n');

  const productionExample = `
  const productionClient = new VOTERClient({
    network: 'scroll-mainnet',
    nearNetwork: 'mainnet',
    districtGateAddress: '0x...', // Deployed contract
    reputationRegistryAddress: '0x...', // Deployed contract
    shadowAtlasUrl: 'https://gateway.pinata.cloud/ipfs', // Production IPFS
    cacheStrategy: 'aggressive' // Cache for offline access
  });

  await productionClient.ready();

  // Create NEAR account with Face ID
  await productionClient.account.create({ method: 'passkey' });

  // Generate proof for real address
  const proof = await productionClient.zk.proveDistrict({
    address: '1600 Pennsylvania Ave NW, Washington, DC 20500'
  });

  // Submit proof on-chain
  const signer = productionClient.useChainSignaturesSigner();
  productionClient.connectSigner(signer);
  await productionClient.contracts.districtGate.verifyAndRegister(proof);
  `;

  console.log(productionExample);

  console.log('\n✅ Local development example complete!\n');
  console.log('Next steps:');
  console.log('  1. Deploy contracts to Scroll Sepolia');
  console.log('  2. Generate production Shadow Atlas (npm run atlas:prod)');
  console.log('  3. Publish to IPFS');
  console.log('  4. Test end-to-end proof flow');
  console.log();
}

main().catch(error => {
  console.error('❌ Example failed:', error);
  process.exit(1);
});
