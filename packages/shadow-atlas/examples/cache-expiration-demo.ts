/**
 * TIGER Cache Expiration Demo
 *
 * Demonstrates automatic cache expiration based on TIGER release schedule.
 *
 * Usage:
 *   npx tsx examples/cache-expiration-demo.ts
 */

import { TIGERBoundaryProvider } from '../src/providers/tiger-boundary-provider.js';

async function demo() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      TIGER Cache Expiration Demo                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Create provider with default settings (auto-expire enabled)
  const provider = new TIGERBoundaryProvider({
    year: 2024,
    autoExpireCache: true,
    gracePeriodDays: 30,
  });

  // Get cache status
  const status = await provider.getCacheStatus();

  console.log('📊 Cache Configuration:');
  console.log(`   TIGER Year: ${status.tigerYear}`);
  console.log(`   Auto-Expire: ${status.autoExpireEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Grace Period: ${status.gracePeriodDays} days\n`);

  console.log('📅 Cache Expiration Schedule:');
  console.log(`   TIGER ${status.tigerYear} data released: September 1, ${status.tigerYear + 1}`);
  console.log(`   Cache expires after: ${status.nextExpiration.toISOString()}`);
  console.log(`   (${status.gracePeriodDays} days after release)\n`);

  console.log('📁 Cache Directory:');
  console.log(`   ${status.cacheDir}\n`);

  console.log('💡 How It Works:');
  console.log('   1. TIGER data is released annually on September 1st');
  console.log('   2. Cache files are checked against their modification time');
  console.log('   3. After the grace period, old cache triggers fresh downloads');
  console.log('   4. Files created AFTER the release date are considered fresh\n');

  console.log('🔧 Configuration Options:');
  console.log('   autoExpireCache: true/false (default: true)');
  console.log('   gracePeriodDays: number (default: 30)\n');

  console.log('Example Timeline for 2024 Data:');
  console.log('   • Cache created: January 15, 2025');
  console.log('   • TIGER 2025 released: September 1, 2025');
  console.log('   • Cache expires: October 1, 2025 (30-day grace)');
  console.log('   • Fresh downloads start: October 2, 2025\n');

  console.log('✅ Demo complete!\n');
}

demo().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
