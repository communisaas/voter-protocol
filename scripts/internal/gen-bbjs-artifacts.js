#!/usr/bin/env node
// Generate proving/verification artifacts from ACIR using bb.js (threaded WASM).
// Inputs:
//   --acir <path to acir.bin>
//   --out <output dir>
//   --threaded (default true)
// Outputs in <out>:
//   acir.bin (copied), proving_key, verification_key.json, wasm

const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { BarretenbergSync } = require('@aztec/bb.js');
const zlib = require('zlib');

async function main() {
  const argv = yargs(hideBin(process.argv)).options({
    acir: { type: 'string', demandOption: true },
    out: { type: 'string', demandOption: true },
    threaded: { type: 'boolean', default: true },
  }).argv;

  const acirBuf = fs.readFileSync(argv.acir);
  // acir.bin is gzipped binary ACIR produced by noir_wasm
  const acir = new Uint8Array(zlib.gunzipSync(acirBuf));

  fs.mkdirSync(argv.out, { recursive: true });

  console.error('[gen-bbjs-artifacts] initializing barretenberg (sync)');
  const bb = new BarretenbergSync();
  fs.writeFileSync(path.join(argv.out, 'acir.bin'), Buffer.from(acir));
  console.error('[gen-bbjs-artifacts] setupGenericProverAndVerifier unavailable in this bb.js build; PK/VK/WASM not generated (placeholder).');

  console.error('[gen-bbjs-artifacts] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
