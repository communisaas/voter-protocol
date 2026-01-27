
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NoirProver } from './prover';
// bb.js is now used internally by NoirProver via UltraHonkBackend
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
        fixtureNoir = new Noir(fixtureJson as unknown as import('@noir-lang/noir_js').CompiledCircuit);
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
        // Use arbitrary small values for secrets
        const userSecret = '0x1234';
        const districtId = '0x42';
        const authorityLevel = 1;
        const registrationSalt = '0x99';
        const leafIndex = 0; // Leftmost leaf
        const merklePath = Array(DEPTH).fill('0x00'); // All zero siblings

        // Action domain replaces epochId + campaignId
        const actionDomain = '0x01';

        // The new secure circuit computes leaf internally:
        // leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
        const zero = '0x' + '00'.repeat(32);
        const leaf = await poseidon([userSecret, districtId, authorityLevel.toString(), registrationSalt]);

        // Compute valid merkle root from the computed leaf
        const merkleRoot = await computeMerkleRoot(leaf, merklePath, leafIndex);

        // Note: nullifier is now computed inside the circuit as:
        // nullifier = hash(userSecret, actionDomain)

        const inputs = {
            // Public inputs (contract-controlled)
            merkleRoot,
            actionDomain,

            // Private inputs (user secrets)
            userSecret,
            districtId,
            authorityLevel: authorityLevel as 1 | 2 | 3 | 4 | 5,
            registrationSalt,

            // Merkle proof data
            merklePath: merklePath.map(toHex),
            leafIndex,
        };

        // 2. Generate Proof
        prover = new NoirProver();
        await prover.init();

        console.log('Generating proof with valid inputs:', inputs);
        const result = await prover.prove(inputs);

        expect(result.proof).toBeDefined();
        expect((result.proof as Uint8Array).length).toBeGreaterThan(0);

        // 3. Verify public outputs
        // The circuit returns: (merkle_root, nullifier, authority_level, action_domain, district_id)
        expect(result.publicInputs.merkleRoot).toBeDefined();
        expect(result.publicInputs.nullifier).toBeDefined(); // Computed by circuit
        expect(result.publicInputs.authorityLevel).toBe(authorityLevel);
        expect(result.publicInputs.actionDomain).toBeDefined();
        expect(result.publicInputs.districtId).toBeDefined();

        console.log('Proof generated successfully!');
        console.log('Public Inputs:', result.publicInputs);
    }, 240000); // 4 minutes

    it('should warmup without error and backend is initialized', async () => {
        // This test verifies that:
        // 1. Warmup completes successfully
        // 2. Multiple provers can be initialized independently
        // 3. Backend is properly set up for proving

        const prover1 = new NoirProver();
        await prover1.init();
        await prover1.warmup();

        const prover2 = new NoirProver();
        await prover2.init();
        await prover2.warmup();

        // Both provers should have initialized backends
        // UltraHonkBackend doesn't expose provingKey - it manages this internally
        expect((prover1 as any).backend).toBeDefined();
        expect((prover2 as any).backend).toBeDefined();
        expect((prover1 as any).noir).toBeDefined();
        expect((prover2 as any).noir).toBeDefined();

        await prover1.destroy();
        await prover2.destroy();

        // After destroy, backend should be null
        expect((prover1 as any).backend).toBeNull();
        expect((prover2 as any).backend).toBeNull();

        console.log('Warmup and lifecycle test passed');
    }, 120000);
});
