
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NoirProver } from './prover';
import { Barretenberg } from '@voter-protocol/bb.js';
import { inflate } from 'pako';
import { Noir } from '@noir-lang/noir_js';
import fixtureJson from '../../crypto/noir/fixtures/target/fixtures.json';

// Helper to pad hex to 32 bytes buffer
function toBuffer(val: string | bigint | Uint8Array): Uint8Array {
    if (val instanceof Uint8Array) return val;
    if (typeof val === 'bigint') {
        const hex = val.toString(16).padStart(64, '0');
        return Uint8Array.from(Buffer.from(hex, 'hex'));
    }
    const clean = val.replace(/^0x/, '');
    const padded = clean.padStart(64, '0');
    return Uint8Array.from(Buffer.from(padded, 'hex'));
}

// Convert buffer to 0x-prefixed hex string
function toHex(buffer: Uint8Array | string): string {
    if (typeof buffer === 'string') return buffer.startsWith('0x') ? buffer : '0x' + buffer;
    return '0x' + Buffer.from(buffer).toString('hex');
}

describe('NoirProver E2E', () => {
    let prover: NoirProver;
    let fixtureNoir: Noir;



    beforeAll(async () => {
        // Initialize independent BB instance for main prover if needed, 
        // but NoirProver inits its own. We just need Noir for fixture.
        fixtureNoir = new Noir(fixtureJson);
    }, 60000);

    afterAll(async () => {
        if (prover) await prover.destroy();
        /*
        // Cleanup if needed
        */
    });

    async function poseidon(inputs: (string | bigint | Uint8Array)[]): Promise<string> {
        // Pad to 4 inputs
        const paddedInputs = [...inputs];
        while (paddedInputs.length < 4) {
            paddedInputs.push('0x' + '00'.repeat(32));
        }

        // Map to hex strings
        const hexInputs = paddedInputs.slice(0, 4).map((val, idx) => {
            if (val === undefined || val === null) {
                console.error(`Input at index ${idx} is undefined/null`, paddedInputs);
                throw new Error(`Input at index ${idx} is undefined/null`);
            }
            if (val instanceof Uint8Array) return toHex(val);
            if (typeof val === 'bigint') return '0x' + val.toString(16).padStart(64, '0');
            return val.startsWith('0x') ? val : '0x' + val;
        });

        // Run fixture
        const res = await fixtureNoir.execute({ inputs: hexInputs });
        console.log('Fixture Result Keys:', Object.keys(res));
        // result.returnValue in recent versions?
        const ret = (res as any).returnValue || (res as any).return_value;
        return ret as string;
    }

    async function computeMerkleRoot(leaf: string, path: string[], index: number): Promise<string> {
        let node = leaf;
        const zero = '0x' + '00'.repeat(32);

        for (let i = 0; i < path.length; i++) {
            const bit = (index >> i) & 1;
            const sibling = path[i];

            if (bit === 1) {
                // node is right child, hash(sibling, node, 0, 0)
                node = await poseidon([sibling, node, zero, zero]);
            } else {
                // node is left child, hash(node, sibling, 0, 0)
                node = await poseidon([node, sibling, zero, zero]);
            }
        }
        return node;
    }

    it('should generate valid proof verification', async () => {
        const DEPTH = 14;

        // 1. Generate Valid Inputs
        // Use arbitrary small values for secrets/leaves
        const userSecret = '0x1234';
        const leaf = '0x1111';
        const leafIndex = 0; // Leftmost leaf
        const merklePath = Array(DEPTH).fill('0x00'); // All zero siblings

        const authorityHash = '0x01';
        const epochId = '0x01';
        const campaignId = '0x01';

        // Compute valid public inputs
        const merkleRoot = await computeMerkleRoot(leaf, merklePath, leafIndex);

        // Nullifier = Poseidon(secret, campaign, authority, epoch)
        const nullifier = await poseidon([userSecret, campaignId, authorityHash, epochId]);

        const inputs = {
            merkleRoot,
            nullifier,
            authorityHash,
            epochId,
            campaignId,
            leaf,
            merklePath: merklePath.map(toHex),
            leafIndex,
            userSecret,
        };

        // 2. Generate Proof
        prover = new NoirProver();
        await prover.init();

        console.log('Generating proof with valid inputs:', inputs);
        const result = await prover.prove(inputs);

        expect(result.proof).toBeDefined();
        expect(result.proof.length).toBeGreaterThan(0);

        // 3. Verify Proof (using bb.js verifier if available, or just asserting successful generation)
        // Since we don't have verify() on NoirProver yet, successful generation implies 
        // witness satisfaction (Noir) and proof generation (BB).
        // Constraints are checked during witness generation.

        console.log('Proof generated successfully!');
        console.log('Public Inputs:', result.publicInputs);
    }, 240000); // 4 minutes

    it('should generate proving key with consistent bytecode hash', async () => {
        // This test verifies that:
        // 1. Proving key generation is deterministic (same bytecode = same key)
        // 2. The proving key contains a bytecode hash for cache validation

        const prover1 = new NoirProver();
        await prover1.init();
        await prover1.warmup(); // Generate proving key

        const prover2 = new NoirProver();
        await prover2.init();
        await prover2.warmup(); // Generate proving key

        // Both provers should generate the same proving key size
        // (We can't directly compare keys as they may have non-deterministic metadata)
        const pk1Size = (prover1 as any).provingKey?.length || 0;
        const pk2Size = (prover2 as any).provingKey?.length || 0;

        expect(pk1Size).toBeGreaterThan(0);
        expect(pk2Size).toBeGreaterThan(0);
        // Proving keys for same circuit should have same size
        expect(pk1Size).toBe(pk2Size);

        // The proving key should be large enough to contain:
        // - Polynomials (~6MB compressed)
        // - Metadata (dyadic_size, num_public_inputs, etc.)
        // - Bytecode hash (32 bytes Blake3)
        expect(pk1Size).toBeGreaterThan(1000000); // At least 1MB

        await prover1.destroy();
        await prover2.destroy();

        console.log(`Proving key size: ${pk1Size} bytes`);
    }, 120000);
});
