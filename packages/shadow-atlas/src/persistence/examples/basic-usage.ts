/**
 * Basic Usage Examples
 *
 * Demonstrates common Shadow Atlas persistence operations.
 */

import { randomUUID } from 'node:crypto';
import { ShadowAtlasRepository } from '../repository';
import { SQLiteAdapter } from '../adapters/sqlite';
import type {
  JobId,
  JobInsert,
  ExtractionInsert,
  FailureInsert,
  SnapshotInsert,
  ValidationResultInsert,
} from '../schema.types';
import { nowISO8601 } from '../schema.types';
import fs from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Example 1: Create and track a batch extraction job
// ============================================================================

async function example1_createJob(): Promise<void> {
  console.log('Example 1: Create batch extraction job\n');

  // Initialize database
  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  // Create job
  const jobId = randomUUID() as JobId;
  const now = nowISO8601();

  const jobInsert: JobInsert = {
    id: jobId,
    scope_states: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
    scope_layers: JSON.stringify(['congressional', 'state_senate']),
    status: 'pending',
    created_at: now,
    updated_at: now,
    total_tasks: 6, // 3 states × 2 layers
  };

  const job = await repo.createJob(jobInsert);
  console.log('Created job:', job.id);
  console.log('Status:', job.status);
  console.log('Total tasks:', job.total_tasks);
  console.log('');

  // Start job
  const startedJob = await repo.updateJob(jobId, {
    status: 'running',
    started_at: nowISO8601(),
    updated_at: nowISO8601(),
  });
  console.log('Job started at:', startedJob.started_at);
  console.log('');

  // Get job summary
  const summary = await repo.getJobSummary(jobId);
  if (summary) {
    console.log('Job summary:');
    console.log('  Progress:', summary.progress_ratio?.toFixed(2) ?? '0.00');
    console.log('  Successful extractions:', summary.successful_extractions);
    console.log('  Failed attempts:', summary.failed_attempts);
  }

  await adapter.close();
}

// ============================================================================
// Example 2: Record successful extraction with validation
// ============================================================================

async function example2_recordExtraction(): Promise<void> {
  console.log('Example 2: Record successful extraction\n');

  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  // Create job first
  const jobId = randomUUID() as JobId;
  await repo.createJob({
    id: jobId,
    scope_states: JSON.stringify(['US-CA']),
    scope_layers: JSON.stringify(['congressional']),
    status: 'running',
    created_at: nowISO8601(),
    updated_at: nowISO8601(),
    total_tasks: 1,
  });

  // Record extraction
  const extractionInsert: ExtractionInsert = {
    id: randomUUID() as any,
    job_id: jobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52, // California has 52 congressional districts
    validation_passed: true,
    source_url: 'https://gis.data.ca.gov/datasets/congressional-districts',
    source_type: 'arcgis',
    completed_at: nowISO8601(),
  };

  const validationInsert: ValidationResultInsert = {
    id: randomUUID() as any,
    extraction_id: extractionInsert.id,
    validator_type: 'official_district_count',
    passed: true,
    expected_count: 52,
    actual_count: 52,
    authority_source: 'https://www.census.gov/mycd/',
    authority_version: '118th Congress',
    validated_at: nowISO8601(),
  };

  const result = await repo.createValidatedExtraction(
    extractionInsert,
    [validationInsert]
  );

  console.log('Extraction recorded:');
  console.log('  State:', result.extraction.state_code);
  console.log('  Layer:', result.extraction.layer_type);
  console.log('  Boundaries:', result.extraction.boundary_count);
  console.log('  Validated:', result.extraction.validation_passed);
  console.log('  Validations run:', result.validations.length);
  console.log('');

  // Update job progress
  await repo.incrementJobProgress(jobId, 'completed_tasks');

  await adapter.close();
}

// ============================================================================
// Example 3: Handle extraction failure with retry logic
// ============================================================================

async function example3_handleFailure(): Promise<void> {
  console.log('Example 3: Handle extraction failure\n');

  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  // Create job
  const jobId = randomUUID() as JobId;
  await repo.createJob({
    id: jobId,
    scope_states: JSON.stringify(['US-TX']),
    scope_layers: JSON.stringify(['congressional']),
    status: 'running',
    created_at: nowISO8601(),
    updated_at: nowISO8601(),
    total_tasks: 1,
  });

  // Record failure
  const failureInsert: FailureInsert = {
    id: randomUUID() as any,
    job_id: jobId,
    state_code: 'US-TX',
    layer_type: 'congressional',
    error_message: 'HTTP 503: Service temporarily unavailable',
    error_stack: new Error().stack ?? undefined,
    attempt_count: 1,
    retryable: true,
    source_url: 'https://gis.data.texas.gov/datasets/congressional-districts',
    source_type: 'arcgis',
    failed_at: nowISO8601(),
    retry_after: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
  };

  const failure = await repo.createFailure(failureInsert);
  console.log('Failure recorded:');
  console.log('  State:', failure.state_code);
  console.log('  Error:', failure.error_message);
  console.log('  Retryable:', failure.retryable);
  console.log('  Retry after:', failure.retry_after);
  console.log('');

  // Update job progress
  await repo.incrementJobProgress(jobId, 'failed_tasks');

  // Get retryable failures
  const retryable = await repo.listRetryableFailures(jobId);
  console.log('Retryable failures:', retryable.length);
  console.log('');

  // Simulate retry success
  await repo.updateFailure(failure.id, {
    retried_at: nowISO8601(),
    retry_succeeded: true,
  });

  console.log('Retry succeeded, failure marked as resolved');

  await adapter.close();
}

// ============================================================================
// Example 4: Create and publish snapshot
// ============================================================================

async function example4_createSnapshot(): Promise<void> {
  console.log('Example 4: Create Merkle tree snapshot\n');

  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  // Create job
  const jobId = randomUUID() as JobId;
  await repo.createJob({
    id: jobId,
    scope_states: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
    scope_layers: JSON.stringify(['congressional']),
    status: 'completed',
    created_at: nowISO8601(),
    updated_at: nowISO8601(),
    completed_at: nowISO8601(),
    total_tasks: 3,
    completed_tasks: 3,
  });

  // Create snapshot
  const snapshotInsert: SnapshotInsert = {
    id: randomUUID() as any,
    job_id: jobId,
    merkle_root: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ipfs_cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    boundary_count: 138, // CA(52) + TX(38) + NY(26) + others
    regions: JSON.stringify(['US-CA', 'US-TX', 'US-NY']),
    created_at: nowISO8601(),
  };

  const snapshot = await repo.createSnapshot(
    snapshotInsert,
    ['US-CA', 'US-TX', 'US-NY']
  );

  console.log('Snapshot created:');
  console.log('  ID:', snapshot.id);
  console.log('  Merkle root:', snapshot.merkle_root);
  console.log('  IPFS CID:', snapshot.ipfs_cid);
  console.log('  Boundaries:', snapshot.boundary_count);
  console.log('');

  // Look up by state
  const caSnapshot = await repo.getLatestSnapshotForState('US-CA');
  if (caSnapshot) {
    console.log('Latest snapshot covering California:');
    console.log('  Created:', caSnapshot.created_at);
    console.log('  Merkle root:', caSnapshot.merkle_root);
  }

  await adapter.close();
}

// ============================================================================
// Example 5: Query extraction coverage and registry gaps
// ============================================================================

async function example5_queryAnalytics(): Promise<void> {
  console.log('Example 5: Query analytics views\n');

  const schemaSQL = await fs.readFile(
    path.join(__dirname, '../schema.sql'),
    'utf-8'
  );
  const adapter = new SQLiteAdapter(':memory:');
  await adapter.initializeSchema(schemaSQL);
  const repo = new ShadowAtlasRepository(adapter);

  // Create job with mixed results
  const jobId = randomUUID() as JobId;
  await repo.createJob({
    id: jobId,
    scope_states: JSON.stringify(['US-CA', 'US-TX', 'US-NY', 'US-FL']),
    scope_layers: JSON.stringify(['congressional', 'state_senate']),
    status: 'partial',
    created_at: nowISO8601(),
    updated_at: nowISO8601(),
    total_tasks: 8,
  });

  // Successful extractions
  await repo.createExtraction({
    id: randomUUID() as any,
    job_id: jobId,
    state_code: 'US-CA',
    layer_type: 'congressional',
    boundary_count: 52,
    validation_passed: true,
    completed_at: nowISO8601(),
  });

  await repo.createExtraction({
    id: randomUUID() as any,
    job_id: jobId,
    state_code: 'US-TX',
    layer_type: 'congressional',
    boundary_count: 38,
    validation_passed: true,
    completed_at: nowISO8601(),
  });

  // Registry gap
  await repo.createNotConfigured({
    id: randomUUID() as any,
    job_id: jobId,
    state_code: 'US-FL',
    layer_type: 'state_senate',
    reason: 'layer_not_configured',
    checked_at: nowISO8601(),
  });

  // Query coverage
  const coverage = await repo.getExtractionCoverage();
  console.log('Extraction coverage:');
  for (const c of coverage) {
    console.log(`  ${c.state_code} ${c.layer_type}: ${c.total_boundaries} boundaries`);
  }
  console.log('');

  // Query registry gaps
  const gaps = await repo.getRegistryGaps();
  console.log('Registry gaps:');
  for (const g of gaps) {
    console.log(`  ${g.state_code} ${g.layer_type}: ${g.reason}`);
  }

  await adapter.close();
}

// ============================================================================
// Run all examples
// ============================================================================

async function main(): Promise<void> {
  try {
    await example1_createJob();
    console.log('─'.repeat(60));
    console.log('');

    await example2_recordExtraction();
    console.log('─'.repeat(60));
    console.log('');

    await example3_handleFailure();
    console.log('─'.repeat(60));
    console.log('');

    await example4_createSnapshot();
    console.log('─'.repeat(60));
    console.log('');

    await example5_queryAnalytics();
    console.log('─'.repeat(60));
    console.log('');

    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
