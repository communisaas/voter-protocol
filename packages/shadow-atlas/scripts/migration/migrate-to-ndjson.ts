#!/usr/bin/env tsx
/**
 * Full migration from TypeScript to NDJSON canonical format
 *
 * Pipeline:
 * 1. Parse known-portals.ts and quarantined-portals.ts
 * 2. Extract provenance from comments
 * 3. Generate NDJSON portal registry
 * 4. Generate provenance events
 * 5. Validate schemas
 * 6. Regenerate TypeScript for round-trip verification
 *
 * Usage: npm run migrate:to-ndjson
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../..');

interface PortalRecord {
  cityFips: string;
  cityName: string;
  state: string;
  portalType: string;
  downloadUrl: string;
  featureCount: number;
  lastVerified: string;
  confidence: number;
  discoveredBy: string;
  status: 'active' | 'quarantined' | 'review-needed' | 'deprecated' | 'superseded';
  notes?: string;
  metadata?: {
    districtType?: string;
    serviceId?: string;
    spatialReference?: number;
    updateFrequency?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface ProvenanceEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  actor: {
    type: string;
    id: string;
    version?: string;
  };
  entityType: 'portal';
  entityId: string;
  reason: string;
  remediationDetails?: {
    wave?: string;
    strategy?: string;
  };
}

function parseTypescriptEntry(entryText: string, cityFips: string): Partial<PortalRecord> {
  const record: Partial<PortalRecord> = { cityFips };

  // Extract fields using regex
  const patterns = {
    cityName: /cityName:\s*'([^']+)'/,
    state: /state:\s*'([^']+)'/,
    portalType: /portalType:\s*'([^']+)'/,
    downloadUrl: /downloadUrl:\s*'([^']+)'/,
    featureCount: /featureCount:\s*(\d+)/,
    lastVerified: /lastVerified:\s*'([^']+)'/,
    confidence: /confidence:\s*(\d+)/,
    discoveredBy: /discoveredBy:\s*'([^']+)'/,
    notes: /notes:\s*'([^']+)'/,
  };

  Object.entries(patterns).forEach(([key, pattern]) => {
    const match = entryText.match(pattern);
    if (match) {
      const value = match[1];
      if (key === 'featureCount' || key === 'confidence') {
        (record as Record<string, unknown>)[key] = parseInt(value, 10);
      } else {
        (record as Record<string, unknown>)[key] = value;
      }
    }
  });

  return record;
}

function extractServiceId(downloadUrl: string): string | undefined {
  const match = downloadUrl.match(/FeatureServer\/(\d+)\//);
  return match ? match[1] : undefined;
}

function inferMetadata(record: Partial<PortalRecord>): PortalRecord['metadata'] {
  const metadata: PortalRecord['metadata'] = {
    districtType: 'council', // Default assumption
    spatialReference: 4326, // WGS84 standard
    updateFrequency: 'static', // Conservative default
  };

  if (record.downloadUrl) {
    metadata.serviceId = extractServiceId(record.downloadUrl);
  }

  if (record.notes?.toLowerCase().includes('ward')) {
    metadata.districtType = 'ward';
  }

  if (record.notes?.toLowerCase().includes('at-large') || record.featureCount === 1) {
    metadata.districtType = 'at-large';
  }

  if (record.notes?.toLowerCase().includes('realtime')) {
    metadata.updateFrequency = 'realtime';
  } else if (record.notes?.toLowerCase().includes('quarterly')) {
    metadata.updateFrequency = 'quarterly';
  }

  return metadata;
}

function parseTypescriptFile(filePath: string, defaultStatus: PortalRecord['status']): PortalRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const records: PortalRecord[] = [];

  // Extract portal entries
  const entryPattern = /'(\d{7})':\s*{([^}]+)}/gs;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const cityFips = match[1];
    const entryContent = match[2];

    const partial = parseTypescriptEntry(entryContent, cityFips);

    // Create complete record with defaults
    const record: PortalRecord = {
      cityFips,
      cityName: partial.cityName || 'Unknown',
      state: partial.state || 'XX',
      portalType: partial.portalType || 'municipal-gis',
      downloadUrl: partial.downloadUrl || '',
      featureCount: partial.featureCount || 0,
      lastVerified: partial.lastVerified || new Date().toISOString(),
      confidence: partial.confidence || 50,
      discoveredBy: partial.discoveredBy || 'unknown',
      status: defaultStatus,
      notes: partial.notes,
      metadata: inferMetadata(partial),
      createdAt: partial.lastVerified || new Date().toISOString(),
      updatedAt: partial.lastVerified || new Date().toISOString(),
    };

    records.push(record);
  }

  return records;
}

function generateProvenanceEvents(records: PortalRecord[]): ProvenanceEvent[] {
  const events: ProvenanceEvent[] = [];

  records.forEach((record) => {
    // Generate discovery event
    events.push({
      eventId: uuidv4(),
      eventType: 'discovered',
      timestamp: record.createdAt,
      actor: {
        type: 'automated-discovery',
        id: 'legacy-import',
      },
      entityType: 'portal',
      entityId: record.cityFips,
      reason: `Legacy import: ${record.cityName}, ${record.state}`,
    });

    // Extract remediation events from notes
    if (record.notes?.includes('REMEDIATED')) {
      const waveMatch = record.notes.match(/Wave ([A-Z])/);
      const dateMatch = record.notes.match(/(\d{4}-\d{2}-\d{2})/);

      events.push({
        eventId: uuidv4(),
        eventType: 'remediated',
        timestamp: dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : record.updatedAt,
        actor: {
          type: 'human-operator',
          id: 'legacy-remediation',
        },
        entityType: 'portal',
        entityId: record.cityFips,
        reason: record.notes,
        remediationDetails: {
          wave: waveMatch?.[1] ? `Wave ${waveMatch[1]}` : undefined,
          strategy: record.notes.includes('WRONG SERVICE')
            ? 'wrong-service-correction'
            : 'manual-portal-search',
        },
      });
    }

    // Quarantine event
    if (record.status === 'quarantined') {
      events.push({
        eventId: uuidv4(),
        eventType: 'quarantined',
        timestamp: record.updatedAt,
        actor: {
          type: 'remediation-script',
          id: 'legacy-quarantine',
        },
        entityType: 'portal',
        entityId: record.cityFips,
        reason: record.notes || 'Quarantined during legacy import',
      });
    }
  });

  return events;
}

async function main(): Promise<void> {
  console.log('🚀 Starting full migration to NDJSON...\n');

  // Step 1: Parse TypeScript files
  console.log('📋 Step 1: Parsing TypeScript registries...');
  let allRecords: PortalRecord[] = [];

  const knownPortalsPath = path.join(REPO_ROOT, 'src/core/registry/known-portals.ts');
  const quarantinedPath = path.join(REPO_ROOT, 'src/core/registry/quarantined-portals.ts');

  if (fs.existsSync(knownPortalsPath)) {
    const activeRecords = parseTypescriptFile(knownPortalsPath, 'active');
    allRecords = allRecords.concat(activeRecords);
    console.log(`   ✅ Parsed ${activeRecords.length} active portals`);
  }

  if (fs.existsSync(quarantinedPath)) {
    const quarantinedRecords = parseTypescriptFile(quarantinedPath, 'quarantined');
    allRecords = allRecords.concat(quarantinedRecords);
    console.log(`   ✅ Parsed ${quarantinedRecords.length} quarantined portals`);
  }

  console.log(`   📊 Total: ${allRecords.length} portal records\n`);

  // Step 2: Generate NDJSON portal registry
  console.log('📝 Step 2: Generating NDJSON portal registry...');
  const portalDir = path.join(REPO_ROOT, 'data/portals');
  fs.mkdirSync(portalDir, { recursive: true });

  const portalNDJSON = allRecords
    .map((record) => JSON.stringify(record))
    .join('\n');

  const portalPath = path.join(portalDir, 'current.ndjson');
  fs.writeFileSync(portalPath, portalNDJSON + '\n', 'utf-8');
  console.log(`   ✅ Wrote ${allRecords.length} records to ${portalPath}\n`);

  // Step 3: Generate provenance events
  console.log('📜 Step 3: Generating provenance events...');
  const events = generateProvenanceEvents(allRecords);

  const provenanceDir = path.join(REPO_ROOT, 'data/provenance/2026-01');
  fs.mkdirSync(provenanceDir, { recursive: true });

  const provenanceNDJSON = events
    .map((event) => JSON.stringify(event))
    .join('\n');

  const provenancePath = path.join(provenanceDir, 'events-00.ndjson');
  fs.writeFileSync(provenancePath, provenanceNDJSON + '\n', 'utf-8');
  console.log(`   ✅ Wrote ${events.length} events to ${provenancePath}\n`);

  // Step 4: Validate schemas
  console.log('🔍 Step 4: Validating schemas...');
  try {
    execSync('npm run validate:schemas', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    console.log('   ✅ Schema validation passed\n');
  } catch (error) {
    console.error('   ❌ Schema validation failed');
    throw error;
  }

  // Step 5: Regenerate TypeScript for verification
  console.log('🔄 Step 5: Regenerating TypeScript for round-trip verification...');
  try {
    execSync('npm run build:registry', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    console.log('   ✅ TypeScript regeneration complete\n');
  } catch (error) {
    console.error('   ❌ TypeScript generation failed');
    throw error;
  }

  // Step 6: Create snapshot
  console.log('📸 Step 6: Creating snapshot...');
  const snapshotDir = path.join(portalDir, 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  const snapshotPath = path.join(snapshotDir, `${timestamp}.ndjson`);
  fs.copyFileSync(portalPath, snapshotPath);
  console.log(`   ✅ Snapshot created: ${snapshotPath}\n`);

  // Summary
  console.log('═'.repeat(60));
  console.log('✨ Migration complete!\n');
  console.log('📊 Summary:');
  console.log(`   - Portal records: ${allRecords.length}`);
  console.log(`   - Provenance events: ${events.length}`);
  console.log(`   - Active portals: ${allRecords.filter(r => r.status === 'active').length}`);
  console.log(`   - Quarantined: ${allRecords.filter(r => r.status === 'quarantined').length}`);
  console.log('\n📁 Generated files:');
  console.log(`   - ${portalPath}`);
  console.log(`   - ${provenancePath}`);
  console.log(`   - ${snapshotPath}`);
  console.log('\n🔄 Next steps:');
  console.log('   1. Review generated NDJSON files');
  console.log('   2. Run: npm run verify:roundtrip');
  console.log('   3. Commit NDJSON source + generated TypeScript together');
  console.log('   4. Archive old TypeScript files to archive/pre-ndjson-migration/');
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
