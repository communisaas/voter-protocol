#!/usr/bin/env npx tsx
/**
 * Agentic Boundary Discovery
 *
 * Autonomous workflow to discover ward/district boundaries for any region.
 * Uses Gemini 2.5 Flash with multi-project key rotation.
 *
 * Usage:
 *   # Discover all boundaries for Montana
 *   npx tsx agents/discover.ts --region US-MT
 *
 *   # Use specific model
 *   npx tsx agents/discover.ts --region US-CA --model gemini-2.5-pro
 *
 *   # Resume from checkpoint
 *   npx tsx agents/discover.ts --region US-MT --resume
 *
 *   # Dry run (no API calls)
 *   npx tsx agents/discover.ts --region US-MT --dry-run
 *
 * Environment:
 *   GEMINI_KEYS=project1:key1:tier1,project2:key2:free
 */

import { KeyRotator, createKeyRotatorFromEnv } from './rate-limiting/key-rotator.js';
import { GeminiClient } from './providers/gemini.js';
import {
  DiscoveryState,
  createInitialState,
  calculateSummary,
  serializeState,
  deserializeState,
  type GovernanceClassification,
  type CandidateUrl,
  type ValidatedBoundary,
} from './workflow/state.js';
import { CensusPlaceListLoader } from '../core/registry/census-place-list.js';
import { ArcGISHubScanner } from '../acquisition/scanners/arcgis-hub.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  region: string;
  model?: string;
  resume: boolean;
  dryRun: boolean;
  maxPlaces?: number;
} {
  const args = process.argv.slice(2);

  const regionIndex = args.indexOf('--region');
  if (regionIndex === -1 || !args[regionIndex + 1]) {
    logger.error('Usage: npx tsx agents/discover.ts --region <region>');
    logger.error('Example: npx tsx agents/discover.ts --region US-MT');
    process.exit(1);
  }

  const modelIndex = args.indexOf('--model');
  const maxIndex = args.indexOf('--max');

  return {
    region: args[regionIndex + 1],
    model: modelIndex !== -1 ? args[modelIndex + 1] : undefined,
    resume: args.includes('--resume'),
    dryRun: args.includes('--dry-run'),
    maxPlaces: maxIndex !== -1 ? parseInt(args[maxIndex + 1], 10) : undefined,
  };
}

/**
 * Get checkpoint path for a region
 */
function getCheckpointPath(region: string): string {
  const dir = path.join(process.cwd(), 'data', 'checkpoints');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `discovery-${region.toLowerCase()}.json`);
}

/**
 * Save checkpoint
 */
function saveCheckpoint(state: DiscoveryState): void {
  state.lastCheckpoint = Date.now();
  const checkpointPath = getCheckpointPath(state.region);
  fs.writeFileSync(checkpointPath, serializeState(state));
}

/**
 * Load checkpoint if exists
 */
function loadCheckpoint(region: string): DiscoveryState | null {
  const checkpointPath = getCheckpointPath(region);
  if (fs.existsSync(checkpointPath)) {
    const json = fs.readFileSync(checkpointPath, 'utf-8');
    return deserializeState(json);
  }
  return null;
}

/**
 * Parse region code into country and subdivision
 */
function parseRegion(region: string): { country: string; subdivision: string } {
  const parts = region.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid region format: ${region}. Expected format: CC-XX (e.g., US-MT)`);
  }
  return { country: parts[0], subdivision: parts[1] };
}

// STATE_FIPS imported from centralized geo-constants (eliminated duplicate)
import { STATE_ABBR_TO_FIPS as STATE_FIPS } from '../core/geo-constants.js';
import { logger } from '../core/utils/logger.js';

/**
 * Governance classification prompt
 */
const GOVERNANCE_CLASSIFICATION_PROMPT = `You are an expert on US municipal governance structures.

Given a city name and state, determine its governance type:
- "ward": City council members elected from geographic wards/districts
- "district": Same as ward but called districts (common in consolidated city-counties)
- "commission": City commission form with commissioners elected from districts
- "at-large": All council members elected at-large (citywide, no geographic districts)

For small cities (<5000 population), assume "at-large" unless you have specific knowledge otherwise.
For larger cities, research indicates most use ward-based systems.

Respond in JSON format:
{
  "governanceType": "ward" | "district" | "commission" | "at-large",
  "expectedDistricts": <number or 0 for at-large>,
  "confidence": "verified" | "inferred",
  "reasoning": "<brief explanation>"
}`;

/**
 * Main discovery workflow
 */
async function runDiscovery(
  region: string,
  options: {
    resume: boolean;
    dryRun: boolean;
    maxPlaces?: number;
    client?: GeminiClient;
  }
): Promise<DiscoveryState> {
  const { country, subdivision } = parseRegion(region);

  // Initialize or resume state
  let state: DiscoveryState;
  if (options.resume) {
    const checkpoint = loadCheckpoint(region);
    if (checkpoint) {
      logger.info(`Resuming from checkpoint (phase: ${checkpoint.phase})`);
      state = checkpoint;
    } else {
      logger.info('No checkpoint found, starting fresh');
      state = createInitialState(region);
    }
  } else {
    state = createInitialState(region);
  }

  logger.info('='.repeat(70));
  logger.info(`  AGENTIC BOUNDARY DISCOVERY: ${region}`);
  logger.info('='.repeat(70));
  logger.info('');

  // Phase 1: Load places
  if (state.phase === 'initializing' || state.phase === 'loading_places') {
    state.phase = 'loading_places';
    logger.info('Phase 1: Loading places from Census Bureau...');

    if (country === 'US') {
      const fips = STATE_FIPS[subdivision];
      if (!fips) {
        throw new Error(`Unknown US state: ${subdivision}`);
      }

      const loader = new CensusPlaceListLoader();
      const places = await loader.loadPlacesByState(fips);

      state.places = places.map(p => ({
        id: p.geoid,
        name: p.name,
        state: subdivision,
        countryCode: country,
        population: p.population,
        placeType: p.lsad,
      }));

      // Limit if requested
      if (options.maxPlaces) {
        state.places = state.places.slice(0, options.maxPlaces);
      }

      logger.info(`   Loaded ${state.places.length} places`);
    } else {
      throw new Error(`Country ${country} not yet supported. Only US implemented.`);
    }

    saveCheckpoint(state);
  }

  // Phase 2: Classify governance types
  if (state.phase === 'loading_places' || state.phase === 'classifying_governance') {
    state.phase = 'classifying_governance';
    logger.info('\nPhase 2: Classifying governance types...');

    const alreadyClassified = new Set(state.classifications.map(c => c.placeId));

    for (let i = state.currentPlaceIndex; i < state.places.length; i++) {
      const place = state.places[i];

      if (alreadyClassified.has(place.id)) {
        continue;
      }

      state.currentPlaceIndex = i;

      if (options.dryRun) {
        // Dry run - assume at-large for small places
        state.classifications.push({
          placeId: place.id,
          placeName: place.name,
          governanceType: 'at-large',
          expectedDistricts: 0,
          confidence: 'inferred',
          source: 'dry-run',
          reasoning: 'Dry run mode',
        });
      } else if (options.client) {
        // Use Gemini to classify
        try {
          const response = await options.client.generateForTask(
            'governance_classify',
            `City: ${place.name}, ${place.state}\nPopulation: ${place.population || 'unknown'}`,
            GOVERNANCE_CLASSIFICATION_PROMPT
          );

          state.apiCallCount++;
          state.estimatedCost += response.estimatedCost;

          // Parse response
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            state.classifications.push({
              placeId: place.id,
              placeName: place.name,
              governanceType: parsed.governanceType,
              expectedDistricts: parsed.expectedDistricts,
              confidence: parsed.confidence,
              source: 'gemini-classification',
              reasoning: parsed.reasoning,
            });
          }
        } catch (error) {
          logger.warn(`   Error classifying ${place.name}: ${(error as Error).message}`);
          state.errors.push({
            placeId: place.id,
            phase: 'classifying_governance',
            error: (error as Error).message,
            timestamp: Date.now(),
            retryCount: 0,
          });
        }
      } else {
        // No client - skip classification
        state.classifications.push({
          placeId: place.id,
          placeName: place.name,
          governanceType: 'unknown',
          expectedDistricts: 0,
          confidence: 'needs-research',
          source: 'no-client',
          reasoning: 'No Gemini client configured',
        });
      }

      // Checkpoint every 10 places
      if (i % 10 === 0) {
        saveCheckpoint(state);
        process.stdout.write(`   Classified ${i + 1}/${state.places.length}\r`);
      }
    }

    logger.info(`   Classified ${state.classifications.length} places`);
    state.currentPlaceIndex = 0;
    saveCheckpoint(state);
  }

  // Phase 3: Search for boundary sources
  if (state.phase === 'classifying_governance' || state.phase === 'searching_sources') {
    state.phase = 'searching_sources';
    logger.info('\nPhase 3: Searching for boundary sources...');

    const wardBased = state.classifications.filter(
      c => c.governanceType !== 'at-large' && c.governanceType !== 'unknown'
    );

    logger.info(`   ${wardBased.length} places need boundary data`);

    if (!options.dryRun) {
      const scanner = new ArcGISHubScanner();
      const alreadySearched = new Set(state.candidateUrls.map(u => u.placeId));

      for (const classification of wardBased) {
        if (alreadySearched.has(classification.placeId)) {
          continue;
        }

        try {
          const candidates = await scanner.search({
            name: classification.placeName,
            state: subdivision,
          });

          for (const candidate of candidates) {
            state.candidateUrls.push({
              placeId: classification.placeId,
              url: candidate.downloadUrl,
              source: 'arcgis',
              layerName: candidate.title,
              confidence: candidate.score,
              discoveredAt: Date.now(),
            });
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 500));
        } catch (error) {
          logger.warn(`   Error searching for ${classification.placeName}: ${(error as Error).message}`);
        }
      }
    }

    logger.info(`   Found ${state.candidateUrls.length} candidate URLs`);
    saveCheckpoint(state);
  }

  // Phase 4: Validate URLs
  if (state.phase === 'searching_sources' || state.phase === 'validating_urls') {
    state.phase = 'validating_urls';
    logger.info('\nPhase 4: Validating discovered URLs...');

    const alreadyValidated = new Set(state.validatedBoundaries.map(b => b.url));

    for (const candidate of state.candidateUrls) {
      if (alreadyValidated.has(candidate.url)) {
        continue;
      }

      if (options.dryRun) {
        continue;
      }

      try {
        const startTime = Date.now();
        const response = await fetch(candidate.url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30000),
        });

        if (response.ok) {
          const data = await response.json();
          const featureCount = data.features?.length ?? 0;

          if (featureCount > 0) {
            const place = state.classifications.find(c => c.placeId === candidate.placeId);
            state.validatedBoundaries.push({
              placeId: candidate.placeId,
              placeName: place?.placeName ?? candidate.placeId,
              url: candidate.url,
              format: 'geojson',
              featureCount,
              geometryType: 'polygon',
              validatedAt: Date.now(),
              responseTimeMs: Date.now() - startTime,
            });
          }
        }
      } catch (error) {
        // Skip validation errors
      }

      await new Promise(r => setTimeout(r, 200));
    }

    logger.info(`   Validated ${state.validatedBoundaries.length} boundaries`);
    saveCheckpoint(state);
  }

  // Phase 5: Complete
  state.phase = 'complete';
  state.summary = calculateSummary(state);
  saveCheckpoint(state);

  // Print summary
  logger.info('\n');
  logger.info('='.repeat(70));
  logger.info('  DISCOVERY COMPLETE');
  logger.info('='.repeat(70));
  logger.info('');
  logger.info(`Region: ${state.summary.region}`);
  logger.info(`Total places: ${state.summary.totalPlaces}`);
  logger.info(`Ward-based places: ${state.summary.wardBasedPlaces}`);
  logger.info(`At-large places: ${state.summary.atLargePlaces}`);
  logger.info(`Boundaries found: ${state.summary.boundariesFound}`);
  logger.info(`Boundaries missing: ${state.summary.boundariesMissing}`);
  logger.info(`Coverage: ${state.summary.coveragePercent}%`);
  logger.info(`API calls: ${state.summary.totalApiCalls}`);
  logger.info(`Estimated cost: $${state.summary.totalCost.toFixed(4)}`);
  logger.info(`Duration: ${Math.round(state.summary.durationMs / 1000)}s`);

  return state;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  // Try to create Gemini client if keys available
  let client: GeminiClient | undefined;
  if (process.env.GEMINI_KEYS && !args.dryRun) {
    try {
      const keyRotator = createKeyRotatorFromEnv();
      client = new GeminiClient(keyRotator);
      logger.info('Gemini client initialized with key rotation');
    } catch (error) {
      logger.warn('Could not initialize Gemini client', { error: (error as Error).message });
    }
  } else if (!args.dryRun) {
    logger.warn('GEMINI_KEYS not set. Running without AI classification.');
    logger.warn('Set GEMINI_KEYS=project1:key1:tier1,project2:key2:free');
  }

  await runDiscovery(args.region, {
    resume: args.resume,
    dryRun: args.dryRun,
    maxPlaces: args.maxPlaces,
    client,
  });
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
