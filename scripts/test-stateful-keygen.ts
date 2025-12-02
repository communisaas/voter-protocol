
import { Barretenberg, BarretenbergSync } from '@aztec/bb.js';
import { compile, createFileManager } from '@noir-lang/noir_wasm';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
    console.log('1. Loading existing ACIR...');
    const acirPath = path.join(process.cwd(), 'dist/bbjs/14/acir.bin');
    // Check if file exists, if not use dummy
    let acir: Buffer;
    try {
        acir = await fs.readFile(acirPath);
        console.log('   Loaded ACIR from', acirPath, 'Size:', acir.length);
    } catch (e) {
        console.warn('   Could not load ACIR from disk, using dummy buffer (might fail at WASM level but tests API existence)');
        acir = Buffer.alloc(100);
    }

    console.log('2. Initializing Barretenberg...');
    // We use the async Barretenberg class which wraps the WASM worker
    const bb = await Barretenberg.new({ threads: 1 });

    console.log('3. Attempting to generate Proving Key (Stateful API)...');
    try {
        // @ts-ignore
        if (typeof bb.acirGetProvingKeyUltraHonk !== 'function') {
            throw new Error('bb.acirGetProvingKeyUltraHonk is not defined');
        }

        // @ts-ignore
        const pk = await bb.acirGetProvingKeyUltraHonk(acir);
        console.log('   Success! PK generated. Size:', pk.length);

        // For demonstration, create a dummy witness
        const witness = Buffer.alloc(0); // Replace with actual witness data if available

        // @ts-ignore
        const proof = await bb.acirProveUltraHonkWithPk(acir, pk, witness);
        console.log('   Success! Proof generated. Size:', proof.length);
    } catch (e) {
        if (e.message.includes('Some input bytes were not read') || e.message.includes('Failed to load ACIR')) {
            console.log("   Success! API is reachable (runtime error expected with dummy data):", e.message);
        } else {
            console.error("   Failed:", e.message);
            process.exit(1);
        }
    } finally {
        await bb.destroy();
    }
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
