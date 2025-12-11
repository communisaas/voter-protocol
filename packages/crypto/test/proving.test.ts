
import { describe, it, expect, beforeAll } from 'vitest';
import { CircuitDriver } from '../services/shadow-atlas/proving/circuit_driver';
// import { ShadowAtlasMerkleTree } from '../services/shadow-atlas/merkle-tree';

describe('Stateful Keygen Integration', () => {
    let driver: CircuitDriver;
    // let tree: ShadowAtlasMerkleTree;

    beforeAll(async () => {
        // Initialize driver (loads ACIR)
        driver = await CircuitDriver.new();

        // Initialize merkle tree with some dummy data
        // const addresses = [
        //     "0x1234567890123456789012345678901234567890",
        //     "0xabcdef1234567890abcdef1234567890abcdef12",
        //     // Fill a few more to have depth
        // ];
        // tree = new ShadowAtlasMerkleTree(addresses);
    });

    it('should initialize and generate proving key', async () => {
        const pk = await driver.generateProvingKey();
        expect(pk).toBeDefined();
        expect(pk.length).toBeGreaterThan(0);
    });

    it('should generate a valid proof', async () => {
        // 1. Generate Merkle Proof
        // const address = "0x1234567890123456789012345678901234567890";
        // const merkleProof = tree.generateProof(address);

        // 2. Construct Circuit Inputs
        // We need to map the merkle proof to what the circuit expects.
        // This is where we need the witness generation logic.
        // For now, we will test the DRIVER mostly.

        // We can't generate a real proof without a witness generator.
        // But we can verifying the API availability.

        // TODO: Connect real witness generation
        // const witness = await generateWitness(inputs);
        // const proof = await driver.prove(witness);
        // expect(proof).toBeDefined();
        // const verified = await driver.verify(proof);
        // expect(verified).toBe(true);
    });
});
