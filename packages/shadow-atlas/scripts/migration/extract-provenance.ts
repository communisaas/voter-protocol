#!/usr/bin/env tsx
/**
 * Extract provenance events from TypeScript file comments
 *
 * Parses known-portals.ts to extract remediation history from comments:
 * - // REMEDIATED (Wave L, 2026-01-18): North Chicago IL (1753559)
 * - // WRONG SERVICE CORRECTION: Original discovery indexed...
 * - // QUARANTINED: Single-feature entry...
 *
 * Generates: data/provenance/2026-01/migration-events.ndjson
 *
 * Usage: npm run migrate:extract-provenance
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const REPO_ROOT = path.resolve(__dirname, '../..');

interface ExtractedEvent {
  eventId: string;
  eventType: 'discovered' | 'validated' | 'quarantined' | 'remediated' | 'metadata-updated';
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
  references?: {
    commitHash?: string;
  };
}

interface PortalEntry {
  cityFips: string;
  cityName: string;
  state: string;
  notes?: string;
  discoveredBy: string;
  lastVerified: string;
}

// Regex patterns for comment extraction
const PATTERNS = {
  remediated: /REMEDIATED \((Wave [A-Z]), (\d{4}-\d{2}-\d{2})\): (.+)/,
  wrongService: /WRONG SERVICE CORRECTION: (.+)/,
  quarantined: /QUARANTINED: (.+)/,
  manualAddition: /MANUAL ADDITION: (.+)/,
  wave: /Wave ([A-Z])/,
};

function parseTypescriptRegistry(filePath: string): PortalEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Extract portal entries using regex
  const entryPattern = /'(\d{7})':\s*{([^}]+)}/g;
  const entries: PortalEntry[] = [];

  let match;
  while ((match = entryPattern.exec(content)) !== null) {
    const cityFips = match[1];
    const entryContent = match[2];

    // Parse entry fields
    const cityNameMatch = entryContent.match(/cityName:\s*'([^']+)'/);
    const stateMatch = entryContent.match(/state:\s*'([^']+)'/);
    const notesMatch = entryContent.match(/notes:\s*'([^']+)'/);
    const discoveredByMatch = entryContent.match(/discoveredBy:\s*'([^']+)'/);
    const lastVerifiedMatch = entryContent.match(/lastVerified:\s*'([^']+)'/);

    if (cityNameMatch && stateMatch) {
      entries.push({
        cityFips,
        cityName: cityNameMatch[1],
        state: stateMatch[1],
        notes: notesMatch?.[1],
        discoveredBy: discoveredByMatch?.[1] || 'unknown',
        lastVerified: lastVerifiedMatch?.[1] || new Date().toISOString(),
      });
    }
  }

  return entries;
}

function extractEventsFromEntry(entry: PortalEntry): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];

  if (!entry.notes) {
    // No provenance in comments, create basic discovery event
    events.push({
      eventId: uuidv4(),
      eventType: 'discovered',
      timestamp: entry.lastVerified,
      actor: {
        type: 'automated-discovery',
        id: 'legacy-import',
      },
      entityType: 'portal',
      entityId: entry.cityFips,
      reason: `Legacy import: ${entry.cityName}, ${entry.state} discovered via ${entry.discoveredBy}`,
    });
    return events;
  }

  // Parse remediation event
  const remediatedMatch = entry.notes.match(PATTERNS.remediated);
  if (remediatedMatch) {
    const [, wave, date, description] = remediatedMatch;

    events.push({
      eventId: uuidv4(),
      eventType: 'remediated',
      timestamp: new Date(date).toISOString(),
      actor: {
        type: 'human-operator',
        id: 'legacy-remediation',
      },
      entityType: 'portal',
      entityId: entry.cityFips,
      reason: description,
      remediationDetails: {
        wave,
        strategy: entry.notes.includes('WRONG SERVICE') ? 'wrong-service-correction' : 'manual-portal-search',
      },
    });
  }

  // Parse wrong service correction
  if (entry.notes.includes('WRONG SERVICE CORRECTION')) {
    const wrongServiceMatch = entry.notes.match(PATTERNS.wrongService);
    if (wrongServiceMatch) {
      events.push({
        eventId: uuidv4(),
        eventType: 'metadata-updated',
        timestamp: entry.lastVerified,
        actor: {
          type: 'remediation-script',
          id: 'wrong-service-correction',
        },
        entityType: 'portal',
        entityId: entry.cityFips,
        reason: wrongServiceMatch[1],
      });
    }
  }

  // Parse quarantine event
  if (entry.notes.includes('QUARANTINED')) {
    const quarantinedMatch = entry.notes.match(PATTERNS.quarantined);
    events.push({
      eventId: uuidv4(),
      eventType: 'quarantined',
      timestamp: entry.lastVerified,
      actor: {
        type: 'remediation-script',
        id: 'quarantine-single-feature-entries',
      },
      entityType: 'portal',
      entityId: entry.cityFips,
      reason: quarantinedMatch?.[1] || 'Quarantined pending review',
    });
  }

  // Fallback: Create generic discovery event if no specific events extracted
  if (events.length === 0) {
    events.push({
      eventId: uuidv4(),
      eventType: 'discovered',
      timestamp: entry.lastVerified,
      actor: {
        type: 'automated-discovery',
        id: 'legacy-import',
      },
      entityType: 'portal',
      entityId: entry.cityFips,
      reason: entry.notes,
    });
  }

  return events;
}

async function main(): Promise<void> {
  console.log('🔍 Extracting provenance from TypeScript comments...\n');

  // Read current TypeScript registry
  const knownPortalsPath = path.join(REPO_ROOT, 'src/core/registry/known-portals.ts');
  const quarantinedPath = path.join(REPO_ROOT, 'src/core/registry/quarantined-portals.ts');

  let allEntries: PortalEntry[] = [];

  if (fs.existsSync(knownPortalsPath)) {
    console.log('📋 Parsing known-portals.ts...');
    const knownEntries = parseTypescriptRegistry(knownPortalsPath);
    allEntries = allEntries.concat(knownEntries);
    console.log(`   Found ${knownEntries.length} active portals`);
  }

  if (fs.existsSync(quarantinedPath)) {
    console.log('📋 Parsing quarantined-portals.ts...');
    const quarantinedEntries = parseTypescriptRegistry(quarantinedPath);
    allEntries = allEntries.concat(quarantinedEntries);
    console.log(`   Found ${quarantinedEntries.length} quarantined portals`);
  }

  console.log(`\n📊 Total portals: ${allEntries.length}`);

  // Extract events
  console.log('\n🔄 Extracting provenance events...');
  const allEvents: ExtractedEvent[] = [];

  for (const entry of allEntries) {
    const events = extractEventsFromEntry(entry);
    allEvents.push(...events);
  }

  console.log(`   Extracted ${allEvents.length} events`);

  // Group events by type
  const eventsByType: Record<string, number> = {};
  allEvents.forEach((event) => {
    eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
  });

  console.log('\n   Event breakdown:');
  Object.entries(eventsByType).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // Write to NDJSON
  const outputDir = path.join(REPO_ROOT, 'data/provenance/2026-01');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'migration-events.ndjson');
  const ndjsonLines = allEvents
    .map((event) => JSON.stringify(event))
    .join('\n');

  fs.writeFileSync(outputPath, ndjsonLines + '\n', 'utf-8');

  console.log(`\n✅ Wrote ${allEvents.length} events to: ${outputPath}`);
  console.log('\n✨ Provenance extraction complete!');
}

main().catch((error) => {
  console.error('❌ Extraction failed:', error);
  process.exit(1);
});
