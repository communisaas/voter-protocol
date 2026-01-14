import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import { logger } from '../core/utils/logger.js';
import * as shapefile from 'shapefile';
import JSZip from 'jszip';
import { gunzipSync } from 'node:zlib';

export interface TransformOptions {
    targetCRS?: string;
    validate?: boolean;
    repair?: boolean;
}

/**
 * Transform Shapefile buffer to GeoJSON
 *
 * Handles TIGER/Line shapefiles that come as ZIP archives containing .shp, .dbf, .prj, .shx files.
 * Supports both raw ZIP files and gzipped archives.
 *
 * @param data - Buffer containing shapefile data (ZIP or gzipped ZIP)
 * @param options - Transform options (currently unused, reserved for future CRS transformation)
 * @returns GeoJSON FeatureCollection
 */
export async function transformShapefileToGeoJSON(
    data: Buffer,
    options: TransformOptions = {}
): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
    if (data.length === 0) {
        throw new Error('Empty shapefile data');
    }

    logger.info('Starting shapefile transformation', {
        dataSize: data.length,
        format: 'shapefile-to-geojson'
    });

    // Extract .shp and .dbf from archive
    const { shpBuffer, dbfBuffer } = await extractShapefileComponents(data);

    logger.info('Extracted shapefile components', {
        shpSize: shpBuffer.length,
        dbfSize: dbfBuffer.length
    });

    // Parse shapefile using shapefile library
    const features: Array<GeoJSON.Feature<Geometry, GeoJsonProperties>> = [];

    try {
        const source = await shapefile.open(shpBuffer, dbfBuffer);

        // Stream features into array
        let result = await source.read();
        while (!result.done) {
            if (result.value) {
                features.push(result.value);
            }
            result = await source.read();
        }

        logger.info('Shapefile transformation complete', {
            featureCount: features.length,
            format: 'geojson'
        });

        return {
            type: 'FeatureCollection',
            features
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Shapefile parsing failed', {
            error: message,
            shpSize: shpBuffer.length,
            dbfSize: dbfBuffer.length
        });
        throw new Error(`Failed to parse shapefile: ${message}`);
    }
}

/**
 * Extract .shp and .dbf files from shapefile archive
 *
 * Handles both raw ZIP and gzipped ZIP formats.
 * Detects format using magic bytes:
 * - ZIP: 0x50 0x4B (PK)
 * - GZIP: 0x1F 0x8B
 *
 * @param data - Buffer containing archive data
 * @returns Object containing .shp and .dbf buffers
 */
async function extractShapefileComponents(
    data: Buffer
): Promise<{ shpBuffer: Buffer; dbfBuffer: Buffer }> {
    // Check magic bytes to detect format
    const isGzip = data[0] === 0x1f && data[1] === 0x8b;
    const isZip = data[0] === 0x50 && data[1] === 0x4b;

    let zipData: Buffer;

    if (isGzip) {
        logger.info('Detected gzipped archive, decompressing', {
            originalSize: data.length
        });
        zipData = gunzipBuffer(data);
        logger.info('Decompression complete', {
            decompressedSize: zipData.length
        });
    } else if (isZip) {
        zipData = data;
    } else {
        throw new Error('Unknown archive format (expected ZIP or GZIP)');
    }

    // Extract from ZIP
    return extractFromZip(zipData);
}

/**
 * Extract .shp and .dbf files from ZIP archive
 *
 * @param data - Buffer containing ZIP archive
 * @returns Object containing .shp and .dbf buffers
 */
async function extractFromZip(
    data: Buffer
): Promise<{ shpBuffer: Buffer; dbfBuffer: Buffer }> {
    try {
        const zip = await JSZip.loadAsync(data);

        // Find .shp and .dbf files
        let shpBuffer: Buffer | null = null;
        let dbfBuffer: Buffer | null = null;

        for (const [filename, file] of Object.entries(zip.files)) {
            if (file.dir) continue;

            const lowerName = filename.toLowerCase();

            if (lowerName.endsWith('.shp')) {
                shpBuffer = await file.async('nodebuffer');
                logger.info('Found .shp file', { filename });
            } else if (lowerName.endsWith('.dbf')) {
                dbfBuffer = await file.async('nodebuffer');
                logger.info('Found .dbf file', { filename });
            }
        }

        if (!shpBuffer) {
            throw new Error('No .shp file found in archive');
        }
        if (!dbfBuffer) {
            throw new Error('No .dbf file found in archive');
        }

        return { shpBuffer, dbfBuffer };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to extract from ZIP: ${message}`);
    }
}

/**
 * Decompress gzipped buffer
 *
 * @param data - Gzipped buffer
 * @returns Decompressed buffer
 */
function gunzipBuffer(data: Buffer): Buffer {
    try {
        return gunzipSync(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to decompress gzip: ${message}`);
    }
}
