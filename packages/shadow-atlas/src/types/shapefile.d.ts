declare module 'shapefile' {
    import { Feature, FeatureCollection } from 'geojson';
    import { Readable } from 'stream';

    export interface OpenOptions {
        encoding?: string;
    }

    export interface Source<T = Feature> {
        bbox: number[];
        read(): Promise<{ done: boolean; value: T }>;
        cancel(): Promise<void>;
    }

    export function open(
        shp: string | Readable | ArrayBuffer | Uint8Array,
        dbf?: string | Readable | ArrayBuffer | Uint8Array,
        options?: OpenOptions
    ): Promise<Source<Feature>>;

    export function openShp(
        source: string | Readable | ArrayBuffer | Uint8Array,
        options?: OpenOptions
    ): Promise<Source<any>>;

    export function openDbf(
        source: string | Readable | ArrayBuffer | Uint8Array,
        options?: OpenOptions
    ): Promise<Source<any>>;

    export function read(
        shp: string | Readable | ArrayBuffer | Uint8Array,
        dbf?: string | Readable | ArrayBuffer | Uint8Array,
        options?: OpenOptions
    ): Promise<FeatureCollection>;
}
