declare module '@voter-protocol/crypto/circuits' {
    export function hash_pair(left: string, right: string): string;
    export function hash_single(input: string): string;
}

declare module '@voter-protocol/crypto/circuits/voter_district_circuit.js' {
    export default function init(options?: { module_or_path?: BufferSource | WebAssembly.Module }): Promise<void>;
}

declare module '@voter-protocol/crypto/noir-fixtures' {
    const fixtures: unknown;
    export default fixtures;
}
