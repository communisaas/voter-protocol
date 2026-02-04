
import { Barretenberg } from '@aztec/bb.js';
import { inflate } from 'pako';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';

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
        logger.info('Generating proving key');
        const start = Date.now();
        const result = await (this.api as any).acirGetProvingKey({
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
        logger.info('Proving key generated', { duration: Date.now() - start });
        return (result as any).provingKey ?? result;
    }

    /**
     * Generate ZK proof
     */
    async prove(witness: Uint8Array, provingKey?: Uint8Array): Promise<Uint8Array> {
        const pk = provingKey || await this.generateProvingKey();

        logger.info('Generating ZK proof');
        const start = Date.now();
        const result = await (this.api as any).acirProveWithPk({
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
        logger.info('ZK proof generated', { duration: Date.now() - start });

        return (result as any).proof ?? result;
    }

    /**
     * Verify ZK proof
     *
     * SECURITY: This method is not yet implemented. It throws an error to prevent
     * false positives from code that expects verification to actually validate proofs.
     * Use the NoirProver.verify() method from @voter-protocol/noir-prover instead.
     *
     * @throws Error Always - verification not implemented in this driver
     */
    async verify(_proof: Uint8Array): Promise<boolean> {
        // CRITICAL-001 FIX: Throw error instead of returning true to prevent false sense of security
        // The previous implementation would accept ANY proof, including malicious/invalid ones
        throw new Error(
            'CircuitDriver.verify() is not implemented. ' +
            'Use NoirProver.verify() from @voter-protocol/noir-prover for proof verification, ' +
            'or rely on on-chain verification via the DistrictGate contract.'
        );
    }
    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        await this.api.destroy();
    }
}
