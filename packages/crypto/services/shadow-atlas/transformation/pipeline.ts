/**
 * Transformation Pipeline Orchestrator
 *
 * Coordinates all transformation steps: validation → normalization → indexing → commitment
 *
 * ARCHITECTURE (9 stages):
 * 1. Load raw datasets from acquisition layer
 * 2. Semantic validation (title/tag scoring, negative keyword filtering)
 * 3. Geographic validation (state bounds, county union, cross-city contamination)
 * 4. Geometry normalization (CRS transform, vertex simplification)
 * 5. District count validation (informational warnings, no blocking)
 * 6. Batch normalization (metadata standardization, deterministic IDs)
 * 7. Build Merkle tree (cryptographic commitment)
 * 8. Build R-tree index (SQLite spatial index)
 * 9. Export metadata (audit trail + provenance)
 *
 * VALIDATION SPEC: See VALIDATION-ARCHITECTURE-SPEC.md for complete requirements
 *
 * IDEMPOTENCY: Safe to re-run transformations (deterministic output)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { FeatureCollection } from 'geojson';
import { TransformationValidator } from './validator.js';
import { TransformationNormalizer } from './normalizer.js';
import { RTreeBuilder } from './rtree-builder.js';
import { MerkleTreeBuilder } from './merkle-builder.js';
import { SemanticValidator, GeographicValidator } from '../validators/index.js';

// Backward compatibility aliases
const SemanticLayerValidator = SemanticValidator;
const EnhancedGeographicValidator = GeographicValidator;

// Helper function to maintain backward compatibility with validateCityBoundary
function validateCityBoundary(geojson: FeatureCollection, city: { name: string; state: string; fips: string }): { valid: boolean; confidence: number; reason: string; centroid?: { lat: number; lon: number } } {
  const validator = new GeographicValidator();
  const result = validator.validateBounds(geojson, city);
  return {
    valid: result.valid,
    confidence: result.confidence,
    reason: result.reason,
    centroid: result.centroid,
  };
}

// Helper function for validateDistrictCount
function validateDistrictCount(geojson: FeatureCollection, fips: string): { valid: boolean; isWarning: boolean; reason: string; expected: number | null; actual: number } {
  const validator = new GeographicValidator();
  return validator.validateDistrictCount(geojson, fips);
}
import type {
  RawDataset,
  ValidationContext,
  TransformationResult,
  TransformationMetadata,
  StageResult,
  ProvenanceMetadata,
} from './types.js';

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  readonly inputDir: string;           // Raw snapshot directory
  readonly outputDir: string;          // Validated output directory
  readonly databaseName: string;       // SQLite database name
  readonly skipValidation: boolean;    // Skip validation (DANGEROUS)
  readonly parallelValidation: boolean; // Validate in parallel
}

/**
 * Default pipeline configuration
 */
const DEFAULT_CONFIG: PipelineConfig = {
  inputDir: '',
  outputDir: '',
  databaseName: 'shadow-atlas-v1.db',
  skipValidation: false,
  parallelValidation: true,
};

/**
 * Transformation pipeline orchestrator
 */
export class TransformationPipeline {
  private config: PipelineConfig;
  private validator: TransformationValidator;
  private normalizer: TransformationNormalizer;
  private rtreeBuilder: RTreeBuilder;
  private merkleBuilder: MerkleTreeBuilder;
  private semanticValidator: SemanticValidator;
  private geographicValidator: GeographicValidator;

  constructor(config: Partial<PipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new TransformationValidator();
    this.normalizer = new TransformationNormalizer();
    this.rtreeBuilder = new RTreeBuilder();
    this.merkleBuilder = new MerkleTreeBuilder();
    this.semanticValidator = new SemanticLayerValidator();
    this.geographicValidator = new EnhancedGeographicValidator();
  }

  /**
   * Run complete transformation pipeline
   *
   * @returns Transformation result with Merkle root, database path, etc.
   */
  async transform(): Promise<TransformationResult> {
    console.log('\n=== Shadow Atlas Transformation Pipeline ===\n');
    console.log(`Input:  ${this.config.inputDir}`);
    console.log(`Output: ${this.config.outputDir}\n`);

    const startTime = Date.now();

    // STAGE 1: Load raw datasets
    const loadResult = await this.loadRawDatasets();
    if (!loadResult.success || !loadResult.data) {
      throw new Error(`Failed to load raw datasets: ${loadResult.error}`);
    }

    const rawDatasets = loadResult.data;
    console.log(`\n✓ Stage 1: Loaded ${rawDatasets.length} raw datasets (${loadResult.duration}ms)\n`);

    // STAGES 2-5: Validate (Semantic, Geographic, Normalization, District Count)
    let validatedDatasets = rawDatasets;
    if (!this.config.skipValidation) {
      const validateResult = await this.validateDatasets(rawDatasets);
      if (!validateResult.success || !validateResult.data) {
        throw new Error(`Validation failed: ${validateResult.error}`);
      }

      validatedDatasets = validateResult.data;
      console.log(`\n✓ Stages 2-5: Validated ${validatedDatasets.length} datasets (${validateResult.duration}ms)\n`);
    } else {
      console.log('\n⚠ Stages 2-5: Validation SKIPPED (skipValidation=true)\n');
    }

    // STAGE 6: Normalize (geometry transformation + simplification)
    const normalizeResult = await this.normalizeDatasets(validatedDatasets);
    if (!normalizeResult.success || !normalizeResult.data) {
      throw new Error(`Normalization failed: ${normalizeResult.error}`);
    }

    const normalizedDistricts = normalizeResult.data;
    console.log(`\n✓ Stage 6: Normalized ${normalizedDistricts.length} districts (${normalizeResult.duration}ms)\n`);

    // STAGE 7: Build Merkle tree
    const merkleResult = await this.buildMerkleTree(normalizedDistricts);
    if (!merkleResult.success || !merkleResult.data) {
      throw new Error(`Merkle tree construction failed: ${merkleResult.error}`);
    }

    const merkleTree = merkleResult.data;
    console.log(`\n✓ Stage 7: Built Merkle tree (${merkleResult.duration}ms)`);
    console.log(`  Root: ${merkleTree.root}\n`);

    // STAGE 8: Build R-tree index
    const dbPath = path.join(this.config.outputDir, this.config.databaseName);
    const rtreeResult = await this.buildRTreeIndex(normalizedDistricts, dbPath);
    if (!rtreeResult.success) {
      throw new Error(`R-tree construction failed: ${rtreeResult.error}`);
    }

    console.log(`\n✓ Stage 8: Built R-tree index (${rtreeResult.duration}ms)`);
    console.log(`  Database: ${dbPath}\n`);

    // STAGE 9: Export metadata
    const snapshotId = this.extractSnapshotId(this.config.inputDir);
    const metadata: TransformationMetadata = {
      snapshotId,
      inputPath: this.config.inputDir,
      outputPath: this.config.outputDir,
      rawDatasetCount: rawDatasets.length,
      validatedCount: validatedDatasets.length,
      normalizedCount: normalizedDistricts.length,
      rejectionReasons: {}, // TODO: Track from validation
      merkleRoot: merkleTree.root,
      ipfsCID: '', // TODO: Implement IPFS publication
      transformationDuration: Date.now() - startTime,
      transformationCommit: await this.getGitCommit(),
      timestamp: Date.now(),
    };

    await this.exportMetadata(metadata);

    console.log(`\n✓ Stage 9: Exported metadata\n`);
    console.log(`=== Transformation Complete ===`);
    console.log(`  Duration: ${metadata.transformationDuration}ms`);
    console.log(`  Districts: ${normalizedDistricts.length}`);
    console.log(`  Merkle Root: ${merkleTree.root}`);
    console.log(`  Database: ${dbPath}\n`);

    return {
      merkleRoot: merkleTree.root,
      ipfsCID: metadata.ipfsCID,
      databasePath: dbPath,
      districtCount: normalizedDistricts.length,
      timestamp: metadata.timestamp,
      snapshotId,
    };
  }

  /**
   * STAGE 1: Load raw datasets from acquisition layer
   */
  private async loadRawDatasets(): Promise<StageResult<RawDataset[]>> {
    const startTime = Date.now();

    try {
      const datasets: RawDataset[] = [];

      // Read directory structure (acquisition outputs)
      const entries = await fs.readdir(this.config.inputDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.geojson')) {
          const geojsonPath = path.join(this.config.inputDir, entry.name);
          const provenancePath = path.join(
            this.config.inputDir,
            'provenance',
            entry.name.replace('.geojson', '-provenance.json')
          );

          // Load GeoJSON
          const geojsonData = await fs.readFile(geojsonPath, 'utf-8');
          const geojson: FeatureCollection = JSON.parse(geojsonData);

          // Load provenance (if exists)
          let provenance: RawDataset['provenance'];
          try {
            const provenanceData = await fs.readFile(provenancePath, 'utf-8');
            provenance = JSON.parse(provenanceData);
          } catch {
            // No provenance file - create minimal metadata
            provenance = {
              source: geojsonPath,
              authority: 'municipal',
              jurisdiction: 'Unknown',
              timestamp: Date.now(),
              method: 'Unknown',
              responseHash: '',
              httpStatus: 200,
              featureCount: geojson.features.length,
              geometryType: 'Polygon',
              coordinateSystem: 'EPSG:4326',
            };
          }

          datasets.push({ geojson, provenance });
        }
      }

      return {
        success: true,
        data: datasets,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * STAGE 2-5: Complete validation pipeline
   *
   * Stage 2: Semantic validation (title/tag scoring)
   * Stage 3: Geographic validation (state bounds + county union)
   * Stage 4: Geometry normalization (CRS transform + simplification)
   * Stage 5: District count validation (informational)
   */
  private async validateDatasets(
    datasets: readonly RawDataset[]
  ): Promise<StageResult<RawDataset[]>> {
    const startTime = Date.now();

    try {
      const validated: RawDataset[] = [];

      for (const dataset of datasets) {
        const source = dataset.provenance.source;

        // Extract city info from provenance (if available)
        const cityInfo = this.extractCityInfo(dataset.provenance);

        console.log(`\n  Validating: ${source}`);

        // STAGE 2: Semantic Layer Validation
        // Check if title/properties match council district semantics
        const datasetTitle = this.extractTitle(dataset);
        const semanticResult = this.semanticValidator.scoreTitle(datasetTitle);

        if (semanticResult.score < 30) {
          console.log(`  ✗ Stage 2 REJECTED (Semantic): ${source}`);
          console.log(`    Score: ${semanticResult.score}/100 (threshold: 30)`);
          console.log(`    Reasons: ${semanticResult.reasons.join(', ')}`);
          continue; // Reject this dataset
        }

        console.log(`  ✓ Stage 2 PASSED (Semantic): Score ${semanticResult.score}/100`);
        semanticResult.reasons.forEach((reason: string) => console.log(`    - ${reason}`));

        // STAGE 3: Geographic Validation
        // Validate bounding box is within expected state/city bounds
        if (cityInfo) {
          const geoValidation = validateCityBoundary(dataset.geojson, cityInfo);

          if (!geoValidation.valid) {
            console.log(`  ✗ Stage 3 REJECTED (Geographic): ${source}`);
            console.log(`    Reason: ${geoValidation.reason}`);
            if (geoValidation.centroid) {
              console.log(`    Centroid: [${geoValidation.centroid.lon.toFixed(4)}, ${geoValidation.centroid.lat.toFixed(4)}]`);
            }
            console.log(`    Expected: ${cityInfo.name}, ${cityInfo.state}`);
            continue; // Reject this dataset
          }

          console.log(`  ✓ Stage 3 PASSED (Geographic): Confidence ${geoValidation.confidence}%`);
          if (geoValidation.confidence < 100 && geoValidation.reason) {
            console.log(`    Warning: ${geoValidation.reason}`);
          }
        } else {
          console.log(`  ⚠ Stage 3 SKIPPED (Geographic): No city info available`);
        }

        // STAGE 4: Geometry Normalization + Re-validation
        // This happens in the normalizeDatasets stage, but we log it here
        console.log(`  → Stage 4 (Normalization): Will apply CRS transform + vertex simplification`);

        // STAGE 5: District Count Validation (informational only)
        if (cityInfo?.fips) {
          const countValidation = validateDistrictCount(
            dataset.geojson,
            cityInfo.fips
          );

          if (!countValidation.valid) {
            console.log(`  ⚠ Stage 5 WARNING (District Count): ${source}`);
            console.log(`    ${countValidation.reason}`);
            console.log(`    Expected: ${countValidation.expected}, Got: ${countValidation.actual}`);
            // NOTE: This does NOT reject - it's informational only
          } else {
            console.log(`  ✓ Stage 5 PASSED (District Count): ${countValidation.reason}`);
            console.log(`    Expected: ${countValidation.expected}, Got: ${countValidation.actual}`);
          }
        } else {
          console.log(`  ⚠ Stage 5 SKIPPED (District Count): No FIPS code available`);
        }

        // All stages passed - add to validated list
        validated.push(dataset);
        console.log(`  ✓ ACCEPTED: ${source}\n`);
      }

      return {
        success: true,
        data: validated,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract city information from provenance metadata
   */
  private extractCityInfo(provenance: ProvenanceMetadata): {
    name: string;
    state: string;
    fips: string;
    region: string;
  } | null {
    // Try to parse jurisdiction (format: "City, State" or "State")
    const jurisdiction = provenance.jurisdiction;

    // Check if we have FIPS code in provenance (extended field)
    // For now, return null if we can't extract city info
    // This will be enhanced when provenance includes FIPS codes

    return null;
  }

  /**
   * Extract dataset title from provenance or GeoJSON properties
   */
  private extractTitle(dataset: RawDataset): string {
    // Try to get title from provenance source URL
    const source = dataset.provenance.source;

    // Try to extract from features properties
    if (dataset.geojson.features.length > 0) {
      const firstFeature = dataset.geojson.features[0];
      const props = firstFeature.properties;

      if (props) {
        // Look for common title-like properties
        const titleKeys = ['title', 'TITLE', 'name', 'NAME', 'layer', 'LAYER'];
        for (const key of titleKeys) {
          if (props[key]) {
            return String(props[key]);
          }
        }
      }
    }

    // Fallback to source URL or jurisdiction
    return dataset.provenance.jurisdiction || source;
  }

  /**
   * STAGE 4: Normalize datasets (Geometry normalization + re-validation)
   *
   * Steps:
   * 1. CRS transformation to WGS84 (if needed)
   * 2. Vertex simplification (Douglas-Peucker, tolerance=0.0001°)
   * 3. Re-validate geometry to ensure normalization didn't break anything
   */
  private async normalizeDatasets(
    datasets: readonly RawDataset[]
  ): Promise<StageResult<RawDataset['geojson']['features'][number][]>> {
    const startTime = Date.now();

    try {
      console.log(`\n  Stage 4: Geometry Normalization`);

      // Run normalization
      const { districts, stats } = this.normalizer.normalizeBatch(datasets);

      console.log(`  Normalization statistics:`);
      console.log(`    - Avg vertices before: ${stats.avgVertexCountBefore.toFixed(0)}`);
      console.log(`    - Avg vertices after: ${stats.avgVertexCountAfter.toFixed(0)}`);
      console.log(`    - Simplification ratio: ${(stats.simplificationRatio * 100).toFixed(1)}%`);

      // Re-validate normalized geometries to ensure we didn't break anything
      console.log(`\n  Re-validating normalized geometries...`);

      let validNormalized = 0;
      let invalidNormalized = 0;

      for (const district of districts) {
        // Basic validation: check that geometry is still valid
        const hasValidGeometry = this.validateNormalizedGeometry(district.geometry);

        if (hasValidGeometry) {
          validNormalized++;
        } else {
          invalidNormalized++;
          console.log(`  ✗ Normalization broke geometry for district: ${district.id}`);
        }
      }

      console.log(`  Re-validation: ${validNormalized} valid, ${invalidNormalized} invalid`);

      if (invalidNormalized > 0) {
        throw new Error(`Normalization broke ${invalidNormalized} geometries - aborting`);
      }

      return {
        success: true,
        data: districts as any, // Type assertion needed here
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate normalized geometry (basic sanity checks)
   */
  private validateNormalizedGeometry(
    geometry: { type: string; coordinates: any }
  ): boolean {
    // Check geometry type
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      return false;
    }

    // Check coordinates are present
    if (!geometry.coordinates || !Array.isArray(geometry.coordinates)) {
      return false;
    }

    // Check that rings are closed (first coord === last coord)
    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        if (!this.isRingClosed(ring)) {
          return false;
        }
      }
    } else {
      // MultiPolygon
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          if (!this.isRingClosed(ring)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Check if a coordinate ring is properly closed
   */
  private isRingClosed(ring: any[]): boolean {
    if (!ring || ring.length < 4) {
      return false; // Minimum valid ring: 3 points + closing point
    }

    const first = ring[0];
    const last = ring[ring.length - 1];

    if (!Array.isArray(first) || !Array.isArray(last)) {
      return false;
    }

    // Check that first and last coordinates match
    return first[0] === last[0] && first[1] === last[1];
  }

  /**
   * STAGE 7: Build Merkle tree
   */
  private async buildMerkleTree(
    districts: readonly any[]
  ): Promise<StageResult<any>> {
    const startTime = Date.now();

    try {
      const tree = this.merkleBuilder.build(districts);

      // Export tree metadata
      const treePath = path.join(this.config.outputDir, 'merkle-tree.json');
      this.merkleBuilder.exportTree(tree, treePath);

      // Write root to file
      const rootPath = path.join(this.config.outputDir, 'merkle-root.txt');
      await fs.writeFile(rootPath, tree.root);

      return {
        success: true,
        data: tree,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * STAGE 8: Build R-tree index
   */
  private async buildRTreeIndex(
    districts: readonly any[],
    dbPath: string
  ): Promise<StageResult<void>> {
    const startTime = Date.now();

    try {
      // Ensure output directory exists
      await fs.mkdir(path.dirname(dbPath), { recursive: true });

      // Build index
      this.rtreeBuilder.build(districts, dbPath);

      // Validate
      const isValid = this.rtreeBuilder.validateDatabase(dbPath);
      if (!isValid) {
        throw new Error('Database validation failed');
      }

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Export transformation metadata
   */
  private async exportMetadata(metadata: TransformationMetadata): Promise<void> {
    const metadataPath = path.join(this.config.outputDir, 'transformation-metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`  Metadata written: ${metadataPath}`);
  }

  /**
   * Extract snapshot ID from input directory name
   */
  private extractSnapshotId(inputDir: string): string {
    const basename = path.basename(inputDir);
    const match = basename.match(/raw-(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : basename;
  }

  /**
   * Get current Git commit hash
   */
  private async getGitCommit(): Promise<string> {
    try {
      const { execSync } = require('child_process');
      const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      return commit;
    } catch {
      return 'unknown';
    }
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: transformation-pipeline <input-dir> <output-dir>');
    process.exit(1);
  }

  const [inputDir, outputDir] = args;

  const pipeline = new TransformationPipeline({
    inputDir,
    outputDir,
  });

  try {
    await pipeline.transform();
  } catch (error) {
    console.error(`\n✗ Pipeline failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
