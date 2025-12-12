
import { Barretenberg } from '@voter-protocol/bb.js';
import { BarretenbergSync } from '@voter-protocol/bb.js';

async function check() {
    try {
        const api = await Barretenberg.new();
        console.log('API Keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(api)));
        await api.destroy();
    } catch (e) {
        console.error(e);
    }
}

check();
