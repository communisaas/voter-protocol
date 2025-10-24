/**
 * Basic usage example for @voter-protocol/client
 * Demonstrates account creation, district verification, and reputation management
 */

import { VOTERClient } from '../src/index';
import { ethers } from 'ethers';

async function main() {
  // Initialize client with Scroll testnet
  const client = new VOTERClient({
    network: 'scroll-sepolia',
    nearNetwork: 'testnet',
    districtGateAddress: '0x...', // Replace with deployed contract
    reputationRegistryAddress: '0x...', // Replace with deployed contract
    ipfsGateway: 'https://gateway.pinata.cloud/ipfs',
    cacheStrategy: 'aggressive'
  });

  console.log('🚀 VOTER Protocol Client - Basic Usage Example\n');

  // ============================================================================
  // 1. CREATE ACCOUNT (FREE, NO GAS)
  // ============================================================================
  console.log('📱 Creating NEAR implicit account with Face ID/Touch ID...');

  const account = await client.account.create({
    method: 'passkey'  // Uses WebAuthn (Face ID/Touch ID)
  });

  console.log('✅ Account created (FREE, instant):');
  console.log(`   NEAR Account: ${account.nearAccount}`);
  console.log(`   Scroll Address: ${account.scrollAddress}`);
  console.log(`   Ethereum Address: ${account.ethAddress}\n`);

  // ============================================================================
  // 2. VERIFY CONGRESSIONAL DISTRICT (ZERO-KNOWLEDGE PROOF)
  // ============================================================================
  console.log('🏛️  Generating zero-knowledge proof of congressional district...');

  const fullAddress = '1600 Pennsylvania Avenue NW, Washington, DC 20500';

  // Generate proof (8-12 seconds in browser)
  const startTime = Date.now();
  const districtProof = await client.zk.proveDistrict({
    address: fullAddress  // Never leaves browser, never on-chain
  });
  const provingTime = (Date.now() - startTime) / 1000;

  console.log(`✅ Proof generated in ${provingTime.toFixed(2)}s:`);
  console.log(`   District Hash: ${districtProof.districtHash}`);
  console.log(`   Proof Size: ${districtProof.proof.length} bytes`);
  console.log(`   Merkle Root: ${districtProof.merkleRoot}\n`);

  // ============================================================================
  // 3. SUBMIT PROOF ON-CHAIN (SCROLL L2)
  // ============================================================================
  console.log('📝 Submitting proof to DistrictGate contract...');

  // Connect wallet (MetaMask or NEAR Chain Signatures)
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // Submit proof
  const tx = await client.contracts.districtGate.verifyDistrict(districtProof);
  console.log(`   Transaction: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`✅ District verified on-chain (block ${receipt?.blockNumber})`);
  console.log(`   Gas used: ${receipt?.gasUsed.toString()}`);
  console.log(`   Finality: ~2 seconds on Scroll L2\n`);

  // ============================================================================
  // 4. CHECK VERIFICATION STATUS
  // ============================================================================
  console.log('🔍 Checking verification status...');

  const isVerified = await client.contracts.districtGate.isVerified(
    account.scrollAddress
  );

  console.log(`✅ Verification status: ${isVerified ? 'VERIFIED' : 'NOT VERIFIED'}\n`);

  // ============================================================================
  // 5. GET REPUTATION SCORE
  // ============================================================================
  console.log('⭐ Fetching reputation score...');

  const reputation = await client.contracts.reputationRegistry.getReputation(
    account.scrollAddress,
    'healthcare'  // Domain-specific reputation
  );

  console.log(`✅ Reputation in 'healthcare' domain:`);
  console.log(`   Score: ${reputation.score}/10000`);
  console.log(`   Tier: ${reputation.tier}`);
  console.log(`   Decay Rate: ${reputation.decayRate}% annually`);
  console.log(`   Last Update: ${reputation.lastUpdate.toISOString()}\n`);

  // ============================================================================
  // 6. LISTEN FOR EVENTS
  // ============================================================================
  console.log('👂 Listening for on-chain events...\n');

  // Listen for district verifications
  const unsubscribeDistrict = client.contracts.districtGate.onDistrictVerified(
    (user, districtHash) => {
      console.log(`🎉 New district verified: ${user.slice(0, 10)}...`);
      console.log(`   District Hash: ${districtHash}\n`);
    }
  );

  // Listen for reputation updates
  const unsubscribeReputation = client.contracts.reputationRegistry.onReputationUpdated(
    (user, domain, newScore, delta, reason) => {
      console.log(`📈 Reputation updated: ${user.slice(0, 10)}...`);
      console.log(`   Domain: ${domain}`);
      console.log(`   New Score: ${newScore}`);
      console.log(`   Delta: ${delta > 0 ? '+' : ''}${delta}`);
      console.log(`   Reason: ${reason}\n`);
    }
  );

  // Cleanup
  setTimeout(() => {
    unsubscribeDistrict();
    unsubscribeReputation();
    console.log('✅ Example complete!\n');
  }, 5000);
}

// Run example
main().catch(console.error);
