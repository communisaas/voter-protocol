import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ShadowAtlasService } from '../core/shadow-atlas-service.js';
import { LegalDescriptionProvider } from '../providers/legal-description-provider.js';
import { StateBatchExtractor, type StateExtractionResult } from '../providers/state-batch-extractor.js';
import { MultiLayerMerkleTreeBuilder } from '../core/multi-layer-builder.js';
import { ChangeDetectionAdapter } from '../acquisition/change-detection-adapter.js';
import type { DownloadParams, RawBoundaryFile, NormalizedBoundary, UpdateMetadata, ProviderSourceMetadata } from '../core/types/provider.js';
import type { ShadowAtlasConfig } from '../core/config.js';

// Mock dependencies
vi.mock('../providers/state-batch-extractor.js');
vi.mock('../core/multi-layer-builder.js');
vi.mock('../acquisition/change-detection-adapter.js');
vi.mock('../providers/legal-description-provider.js');

/**
 * Typed mock for StateBatchExtractor
 * Matches the public interface of StateBatchExtractor class
 */
interface MockStateBatchExtractor {
    extractState: Mock<[state: string], Promise<StateExtractionResult>>;
}

/**
 * Typed mock for LegalDescriptionProvider
 * Matches the BoundaryProvider interface
 */
interface MockLegalDescriptionProvider {
    download: Mock<[params: DownloadParams], Promise<RawBoundaryFile[]>>;
    transform: Mock<[raw: RawBoundaryFile[]], Promise<NormalizedBoundary[]>>;
    checkForUpdates: Mock<[], Promise<UpdateMetadata>>;
    getMetadata: Mock<[], Promise<ProviderSourceMetadata>>;
}

describe('Legal Description Flow Integration', () => {
    let service: ShadowAtlasService;
    let mockExtractor: MockStateBatchExtractor;
    let mockLegalProvider: MockLegalDescriptionProvider;

    beforeEach(() => {
        // Setup typed mocks
        const mockStateExtractionResult: StateExtractionResult = {
            state: 'MO',
            stateName: 'Missouri',
            authority: 'state-agency',
            layers: [
                {
                    state: 'MO',
                    layerType: 'congressional',
                    success: true,
                    featureCount: 8,
                    expectedCount: 8,
                    boundaries: [],
                    metadata: {
                        endpoint: 'https://example.com/api',
                        extractedAt: new Date().toISOString(),
                        durationMs: 100
                    }
                }
            ],
            summary: {
                totalBoundaries: 8,
                layersSucceeded: 1,
                layersFailed: 0,
                durationMs: 100
            }
        };

        mockExtractor = {
            extractState: vi.fn<[state: string], Promise<StateExtractionResult>>()
                .mockResolvedValue(mockStateExtractionResult)
        };

        // Using vi.mocked to control the module export constructor
        vi.mocked(StateBatchExtractor).mockImplementation(() => mockExtractor as unknown as StateBatchExtractor);

        // Mock LegalDescriptionProvider with properly typed methods
        mockLegalProvider = {
            download: vi.fn<[params: DownloadParams], Promise<RawBoundaryFile[]>>(),
            transform: vi.fn<[raw: RawBoundaryFile[]], Promise<NormalizedBoundary[]>>(),
            checkForUpdates: vi.fn<[], Promise<UpdateMetadata>>(),
            getMetadata: vi.fn<[], Promise<ProviderSourceMetadata>>(),
        };
        vi.mocked(LegalDescriptionProvider).mockImplementation(() => mockLegalProvider as unknown as LegalDescriptionProvider);

        // Instantiate service with properly typed config
        const testConfig: ShadowAtlasConfig = {
            storageDir: ':memory:',
            extraction: {
                retryAttempts: 1,
                retryDelayMs: 0,
                concurrency: 1,
                timeoutMs: 1000
            },
            validation: {
                minPassRate: 0.95,
                crossValidate: false,
                storeResults: false,
                haltOnTopologyError: false,
                haltOnCompletenessError: false,
                haltOnCoordinateError: false
            },
            ipfs: {
                gateway: 'https://gateway.pinata.cloud',
                pinService: undefined
            },
            persistence: {
                enabled: false,
                databasePath: ':memory:',
                autoMigrate: false
            },
            crossValidation: {
                enabled: false,
                failOnMismatch: false,
                minQualityScore: 70,
                gracefulFallback: true
            }
        };

        service = new ShadowAtlasService(testConfig);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should extract and merge legal descriptions into state results', async () => {
        // Arrange: Setup mock return values for LegalDescriptionProvider
        const mockBoundaries: NormalizedBoundary[] = [
            {
                id: 'NKC-1',
                name: 'Ward 1',
                level: 'ward' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                properties: {},
                source: {
                    provider: 'test',
                    url: 'https://example.com',
                    version: '1.0',
                    license: 'MIT',
                    updatedAt: new Date().toISOString(),
                    checksum: 'abc123',
                    authorityLevel: 'municipal-agency',
                    legalStatus: 'official',
                    collectionMethod: 'manual-verification',
                    lastVerified: new Date().toISOString(),
                    verifiedBy: 'human-reviewed',
                    topologyValidated: true,
                    geometryRepaired: false,
                    coordinateSystem: 'EPSG:4326',
                    updateMonitoring: 'none'
                }
            },
            {
                id: 'NKC-2',
                name: 'Ward 2',
                level: 'ward' as const,
                geometry: { type: 'Polygon', coordinates: [] },
                properties: {},
                source: {
                    provider: 'test',
                    url: 'https://example.com',
                    version: '1.0',
                    license: 'MIT',
                    updatedAt: new Date().toISOString(),
                    checksum: 'abc123',
                    authorityLevel: 'municipal-agency',
                    legalStatus: 'official',
                    collectionMethod: 'manual-verification',
                    lastVerified: new Date().toISOString(),
                    verifiedBy: 'human-reviewed',
                    topologyValidated: true,
                    geometryRepaired: false,
                    coordinateSystem: 'EPSG:4326',
                    updateMonitoring: 'none'
                }
            }
        ];

        const mockRawFiles: RawBoundaryFile[] = [
            {
                url: 'file://mock',
                format: 'geojson',
                data: Buffer.from('{}'),
                metadata: {}
            }
        ];

        mockLegalProvider.download.mockResolvedValue(mockRawFiles);
        mockLegalProvider.transform.mockResolvedValue(mockBoundaries);

        // Act
        const results = await service['extractStates'](['MO'], {});

        // Assert
        expect(results).toHaveLength(1);
        const moResult = results[0];

        // 1. Verify StateBatchExtractor was called
        expect(mockExtractor.extractState).toHaveBeenCalledWith('MO');

        // 2. Verify LegalDescriptionProvider was called
        expect(mockLegalProvider.download).toHaveBeenCalledWith({ level: 'ward', region: 'MO' });
        expect(mockLegalProvider.transform).toHaveBeenCalled();

        // 3. Verify Merging
        // Original had 1 layer (congressional). Should now have 2 (congressional + council_district).
        expect(moResult.layers).toHaveLength(2);

        const councilLayer = moResult.layers.find(l => l.layerType === 'council_district');
        expect(councilLayer).toBeDefined();
        expect(councilLayer?.success).toBe(true);
        expect(councilLayer?.featureCount).toBe(2);
        expect(councilLayer?.boundaries).toHaveLength(2);

        // Verify Summary Update
        // Original total: 8. Plus 2 from legal descriptions = 10.
        expect(moResult.summary.totalBoundaries).toBe(10);
        expect(moResult.summary.layersSucceeded).toBe(2); // 1 + 1
    });

    it('should handle legal description failures gracefully without failing the state', async () => {
        // Arrange
        mockLegalProvider.download.mockRejectedValue(new Error('FileSystem Failure'));

        // Act
        const results = await service['extractStates'](['MO'], {});

        // Assert
        expect(results).toHaveLength(1);
        const moResult = results[0];

        // Should still have the base layer
        expect(moResult.layers).toHaveLength(1);
        expect(moResult.layers[0].layerType).toBe('congressional');

        // Summary should reflect original values
        expect(moResult.summary.totalBoundaries).toBe(8);
    });
});
