
import { Barretenberg } from '@aztec/bb.js';
import { inflate } from 'pako';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to compiled Noir circuit
const CIRCUIT_PATH = join(__dirname, '../../../noir/district_membership/target/district_membership.json');

export class CircuitDriver {
    private api: Barretenberg;
    private bytecode: Uint8Array;

    constructor(api: Barretenberg, bytecode: Uint8Array) {
        this.api = api;
        this.bytecode = bytecode;
    }

    /**
     * Initialize the driver
     */
    static async new(): Promise<CircuitDriver> {
        const api = await Barretenberg.new();

        // Load and decompress bytecode
        const circuitJson = JSON.parse(readFileSync(CIRCUIT_PATH, 'utf-8'));
        const bytecodeBuffer = Buffer.from(circuitJson.bytecode, 'base64');
        const bytecode = inflate(bytecodeBuffer);

        return new CircuitDriver(api, bytecode);
    }

    /**
   * Generate proving key
   */
    async generateProvingKey(): Promise<Uint8Array> {
        console.log('Generating proving key...');
        const start = Date.now();
        const result = await this.api.acirGetProvingKey({
            circuit: {
                name: 'district_membership',
                bytecode: this.bytecode,
                verificationKey: new Uint8Array(0),
            },
            settings: {
                ipaAccumulation: false,
                oracleHashType: 'poseidon',
                disableZk: false,
                optimizedSolidityVerifier: false,
            }
        });
        console.log(`Proving key generated in ${Date.now() - start}ms`);
        return result.provingKey;
    }

    /**
     * Generate ZK proof
     */
    async prove(witness: Uint8Array, provingKey?: Uint8Array): Promise<Uint8Array> {
        const pk = provingKey || await this.generateProvingKey();

        console.log('Generating proof...');
        const start = Date.now();
        const result = await this.api.acirProveWithPk({
            circuit: {
                name: 'district_membership',
                bytecode: this.bytecode,
                verificationKey: new Uint8Array(0),
            },
            witness,
            provingKey: pk,
            settings: {
                ipaAccumulation: false, // Must match keygen
                oracleHashType: 'poseidon',
                disableZk: false,
                optimizedSolidityVerifier: false,
            }
        });
        console.log(`Proof generated in ${Date.now() - start}ms`);

        return result.proof;
    }

    /**
     * Verify ZK proof
     */
    async verify(proof: Uint8Array): Promise<boolean> {
        // Placeholder until verification method is identified
        console.warn("Verify method not yet implemented in driver");
        return true;
        // return this.api.acirVerify(proof);
    }
    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        await this.api.destroy();
    }
}
