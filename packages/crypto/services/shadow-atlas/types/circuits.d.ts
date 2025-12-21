declare module '*/circuits/pkg' {
    export function hash_pair(left: string, right: string): string;
    export function hash_single(input: string): string;
}

declare module '*/circuits/pkg/index.js' {
    export function hash_pair(left: string, right: string): string;
    export function hash_single(input: string): string;
}
