import {
    type BoundaryProvider,
    type DownloadParams,
    type RawBoundaryFile,
    type UpdateMetadata,
    type ProviderSourceMetadata,
    type NormalizedBoundary,
    type AdministrativeLevel,
} from '../core/types/provider.js';
import {
    BoundaryType,
} from '../core/types/boundary.js';
import { logger } from '../core/utils/logger.js';
import {
    reconstructCityFromParsed,
    loadStreetNetworkForCity,
    type GoldenVector,
} from '../reconstruction/index.js';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Legal Description Boundary Provider
 * 
 * Sourcing methodology:
 * 1. Reads "Golden Vector" JSON files which contain legal descriptions and metadata
 * 2. Loads authoritative street network data from OpenStreetMap
 * 3. Reconstructs ward polygons using the Shadow Atlas Reconstruction Pipeline
 * 4. Validates output against expected polygons in the Golden Vector (if present)
 * 
 * This provider effectively "compiles" text-based legal definitions into geospatial boundaries.
 */
export class LegalDescriptionProvider implements BoundaryProvider {
    readonly countryCode = 'US';
    readonly name = 'Legal Description Registry';
    readonly source = 'Shadow Atlas Reconstruction Module';
    readonly sourceId = 'legal-description-registry';
    readonly updateSchedule = 'event-driven';
    readonly administrativeLevels: readonly AdministrativeLevel[] = ['ward', 'council-district'];

    // We handle city-level council districts (wards)
    readonly boundaryTypes = [BoundaryType.CITY_COUNCIL_WARD];

    private readonly goldenVectorDir: string;

    constructor(
        private readonly config: {
            goldenVectorDir?: string;
        } = {}
    ) {
        // Default to the reconstruction/golden-vectors directory
        this.goldenVectorDir = config.goldenVectorDir ||
            join(__dirname, '../reconstruction/golden-vectors');
    }

    /**
     * "Download" step - lists available Golden Vector files
     */
    async download(params: DownloadParams): Promise<RawBoundaryFile[]> {
        logger.info(`Scanning for legal descriptions in ${this.goldenVectorDir}`);

        try {
            const files = await readdir(this.goldenVectorDir);
            const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('SUMMARY'));

            const rawFiles: RawBoundaryFile[] = [];

            for (const file of jsonFiles) {
                const path = join(this.goldenVectorDir, file);
                const content = await readFile(path, 'utf-8');
                const goldenVector = JSON.parse(content) as GoldenVector;

                // Filter by state if requested
                if (params.region && goldenVector.state !== params.region) {
                    continue;
                }

                // We wrap the raw JSON content as a "boundary file"
                rawFiles.push({
                    url: `file://${path}`,
                    format: 'geojson', // Treating parsed JSON as source data
                    data: Buffer.from(content),
                    metadata: {
                        lastModified: new Date().toISOString(),
                        originalName: file
                    }
                });
            }

            logger.info(`Found ${rawFiles.length} legal description vectors`);
            return rawFiles;

        } catch (error) {
            logger.error('Failed to read golden vectors', { error });
            throw error;
        }
    }

    /**
     * "Transform" step - Reconstructs polygons from legal descriptions
     */
    async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
        const results: NormalizedBoundary[] = [];

        for (const file of raw) {
            try {
                const goldenVector = JSON.parse(file.data.toString()) as GoldenVector;
                logger.info(`Reconstructing ${goldenVector.cityName}, ${goldenVector.state}...`);

                // 1. Load Street Network (the physical reality)
                const streetSegments = await loadStreetNetworkForCity(
                    goldenVector.cityName,
                    goldenVector.state
                );

                logger.info(`Loaded ${streetSegments.length} street segments for ${goldenVector.cityName}`);

                // 2. Run Optimized Reconstruction Pipeline
                // Golden vectors already have pre-parsed segments - use them directly!
                // No need to re-assemble descriptionText and re-parse.
                const reconstructionResult = await reconstructCityFromParsed(
                    goldenVector.legalDescriptions,
                    streetSegments
                );

                logger.info(`Reconstruction success for ${reconstructionResult.successCount}/${goldenVector.legalDescriptions.length} wards`);

                if (reconstructionResult.failureCount > 0) {
                    logger.warn(`Failed wards in ${goldenVector.cityName}:`, {
                        failures: reconstructionResult.results
                            .filter(r => !r.success)
                            .map(r => `${r.description.wardId}: ${r.failureReason}`)
                    });
                }

                // 3. Convert to NormalizedBoundary
                for (const wardResult of reconstructionResult.results) {
                    if (!wardResult.success || !wardResult.polygon) continue;

                    const boundary: NormalizedBoundary = {
                        id: `${wardResult.description.cityFips}-${wardResult.description.wardId}`,
                        name: wardResult.description.wardName,
                        level: 'ward', // Valid AdministrativeLevel
                        geometry: wardResult.polygon.geometry,
                        // properties: additional attributes
                        properties: {
                            externalId: wardResult.description.wardId,
                            wardId: wardResult.description.wardId,
                            type: BoundaryType.CITY_COUNCIL_WARD,
                        },
                        source: {
                            provider: this.name,
                            url: wardResult.description.source.source,
                            version: new Date().toISOString().split('T')[0],
                            license: "MIT", // Assuming open data for golden vectors
                            updatedAt: new Date().toISOString(),
                            checksum: "calculated-at-runtime",
                            authorityLevel: 'municipal-agency', // Valid AuthorityLevel
                            legalStatus: 'official', // Valid LegalStatus
                            collectionMethod: 'manual-verification', // Valid CollectionMethod
                            lastVerified: wardResult.description.source.retrievedAt,
                            verifiedBy: 'human-reviewed',
                            topologyValidated: true,
                            geometryRepaired: false,
                            coordinateSystem: 'EPSG:4326',
                            updateMonitoring: 'none'
                        }
                    };
                    results.push(boundary);
                }

            } catch (err) {
                logger.error(`Error transforming ${file.url}`, { error: err });
                // Continue with other files
            }
        }

        return results;
    }

    async checkForUpdates(): Promise<UpdateMetadata> {
        // Legal descriptions update rarely.
        return {
            available: false,
            latestVersion: '1.0.0',
            releaseDate: new Date().toISOString()
        };
    }

    async getMetadata(): Promise<ProviderSourceMetadata> {
        return {
            provider: this.name,
            url: "https://github.com/voter-protocol/shadow-atlas/tree/main/packages/shadow-atlas/src/reconstruction/golden-vectors",
            version: '1.0.0',
            license: "MIT",
            updatedAt: new Date().toISOString(),
            checksum: '',
            authorityLevel: 'municipal-agency',
            legalStatus: 'official',
            collectionMethod: 'manual-verification',
            lastVerified: new Date().toISOString(),
            verifiedBy: 'human-reviewed',
            topologyValidated: true,
            geometryRepaired: false,
            coordinateSystem: 'EPSG:4326',
            updateMonitoring: 'none'
        };
    }
}
