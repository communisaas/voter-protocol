declare module 'circomlibjs' {
    export function poseidon(inputs: bigint[]): bigint;
    export function babyJub(): Promise<any>;
    export function eddsa(): Promise<any>;
    export function mimc7(): Promise<any>;
    export function mimcsponge(): Promise<any>;
}
