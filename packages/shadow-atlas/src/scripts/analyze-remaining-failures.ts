#!/usr/bin/env npx tsx
/**
 * Analyze remaining unresolved layers to understand failure patterns
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UnresolvedLayer {
    url: string;
    name: string;
    failureReason?: string;
    metadata?: {
        name?: string;
        description?: string;
        copyrightText?: string;
        extent?: {
            spatialReference?: { wkid?: number; latestWkid?: number };
        };
    };
    centroidResult?: string;
    geocodeResult?: string;
}

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response | null> {
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        return null;
    }
}

async function analyzeLayer(url: string, name: string): Promise<UnresolvedLayer> {
    const result: UnresolvedLayer = { url, name };
    const failures: string[] = [];

    // Step 1: Fetch metadata
    try {
        const metaResponse = await fetchWithTimeout(`${url}?f=json`);
        if (!metaResponse) {
            failures.push('METADATA_TIMEOUT');
        } else if (!metaResponse.ok) {
            failures.push(`METADATA_HTTP_${metaResponse.status}`);
        } else {
            const meta = await metaResponse.json();
            result.metadata = {
                name: meta.name,
                description: meta.description,
                copyrightText: meta.copyrightText,
                extent: meta.extent,
            };

            if (!meta.extent) {
                failures.push('NO_EXTENT');
            }
        }
    } catch (e) {
        failures.push(`METADATA_ERROR: ${(e as Error).message}`);
    }

    // Step 2: Query for geometry
    try {
        const queryUrl = `${url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`;
        const queryResponse = await fetchWithTimeout(queryUrl, 15000);

        if (!queryResponse) {
            failures.push('QUERY_TIMEOUT');
        } else if (!queryResponse.ok) {
            failures.push(`QUERY_HTTP_${queryResponse.status}`);
        } else {
            const data = await queryResponse.json();

            if (data.error) {
                failures.push(`QUERY_ERROR: ${data.error.message || data.error.code}`);
                result.centroidResult = JSON.stringify(data.error);
            } else if (!data.features || data.features.length === 0) {
                failures.push('NO_FEATURES');
                result.centroidResult = 'Empty features array';
            } else if (!data.features[0].geometry) {
                failures.push('NO_GEOMETRY');
                result.centroidResult = 'Feature has no geometry';
            } else {
                const geom = data.features[0].geometry;
                let centroid: { lat: number; lon: number } | null = null;

                if (geom.rings && geom.rings[0]) {
                    const ring = geom.rings[0];
                    let sumX = 0, sumY = 0;
                    for (const [x, y] of ring) {
                        sumX += x;
                        sumY += y;
                    }
                    centroid = { lon: sumX / ring.length, lat: sumY / ring.length };
                } else if (typeof geom.x === 'number' && typeof geom.y === 'number') {
                    centroid = { lon: geom.x, lat: geom.y };
                }

                if (centroid) {
                    result.centroidResult = `${centroid.lat.toFixed(4)}, ${centroid.lon.toFixed(4)}`;

                    // Step 3: Try Census geocoder
                    const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${centroid.lon}&y=${centroid.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=28&format=json`;
                    const geocodeResponse = await fetchWithTimeout(geocodeUrl);

                    if (!geocodeResponse) {
                        failures.push('GEOCODE_TIMEOUT');
                    } else if (!geocodeResponse.ok) {
                        failures.push(`GEOCODE_HTTP_${geocodeResponse.status}`);
                    } else {
                        const geocodeData = await geocodeResponse.json();
                        const place = geocodeData.result?.geographies?.['Incorporated Places']?.[0];

                        if (!place) {
                            // Check if it's in a county but not an incorporated place
                            const county = geocodeData.result?.geographies?.['Counties']?.[0];
                            if (county) {
                                failures.push('NOT_INCORPORATED_PLACE');
                                result.geocodeResult = `In ${county.NAME}, but not in an incorporated city`;
                            } else if (centroid.lon < -130 || centroid.lon > -65 || centroid.lat < 24 || centroid.lat > 50) {
                                failures.push('OUTSIDE_CONUS');
                                result.geocodeResult = `Coordinates outside continental US: ${centroid.lat.toFixed(2)}, ${centroid.lon.toFixed(2)}`;
                            } else {
                                failures.push('NO_CENSUS_PLACE');
                                result.geocodeResult = 'Geocoder returned no place';
                            }
                        } else {
                            // This shouldn't happen if we got here - it means geocoding worked
                            result.geocodeResult = `${place.NAME} (${place.GEOID})`;
                        }
                    }
                } else {
                    failures.push('GEOMETRY_PARSE_ERROR');
                }
            }
        }
    } catch (e) {
        failures.push(`QUERY_EXCEPTION: ${(e as Error).message}`);
    }

    result.failureReason = failures.join(' | ');
    return result;
}

async function main(): Promise<void> {
    const inputPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const unresolvedInputs = data.unresolved;

    console.log('='.repeat(80));
    console.log('REMAINING UNRESOLVED LAYER ANALYSIS');
    console.log('='.repeat(80));
    console.log(`\nAnalyzing ${unresolvedInputs.length} remaining unresolved layers...\n`);

    const analyzed: UnresolvedLayer[] = [];
    const failureCategories: Record<string, number> = {};

    // Process a subset if too many, but 302 is manageable
    const toProcess = unresolvedInputs; // .slice(0, 50) if we wanted a sample

    for (let i = 0; i < toProcess.length; i++) {
        const layer = toProcess[i];
        const analysis = await analyzeLayer(layer.url, layer.name);
        analyzed.push(analysis);

        // Categorize failures
        const reasons = analysis.failureReason?.split(' | ') || [];
        for (const reason of reasons) {
            const category = reason.split(':')[0];
            failureCategories[category] = (failureCategories[category] || 0) + 1;
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  Analyzed ${i + 1}/${toProcess.length}...`);
        }
    }

    console.log('\n' + '-'.repeat(80));
    console.log('FAILURE CATEGORY BREAKDOWN');
    console.log('-'.repeat(80));

    for (const [category, count] of Object.entries(failureCategories).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${category.padEnd(30)} ${count}`);
    }

    console.log('\nTOP 5 UNRESOLVED EXAMPLES BY CATEGORY');
    const grouped = analyzed.reduce((acc, curr) => {
        const reason = curr.failureReason?.split(' | ')[0]?.split(':')[0] || 'UNKNOWN';
        if (!acc[reason]) acc[reason] = [];
        acc[reason].push(curr);
        return acc;
    }, {} as Record<string, UnresolvedLayer[]>);

    for (const [reason, layers] of Object.entries(grouped)) {
        console.log(`\nCategory: ${reason} (${layers.length})`);
        for (const layer of layers.slice(0, 3)) {
            console.log(`  - ${layer.name}`);
            console.log(`    URL: ${layer.url}`);
            console.log(`    Stats: ${layer.geocodeResult || layer.centroidResult || 'N/A'}`);
        }
    }
}

main().catch(console.error);
