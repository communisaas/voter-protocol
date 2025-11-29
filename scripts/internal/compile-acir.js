#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { compile, createFileManager } = require('@noir-lang/noir_wasm');

const argv = yargs(hideBin(process.argv)).options({
  root: { type: 'string', demandOption: true, describe: 'Path to Noir package root (folder with Nargo.toml)' },
  out: { type: 'string', demandOption: true, describe: 'Output ACIR binary path' },
  json: { type: 'string', describe: 'Optional path to write full program JSON' },
}).argv;

(async () => {
  const root = path.resolve(argv.root);
  const fm = createFileManager({ root_dir: root });
  const res = await compile(fm, root);
  if (!res || !res.program || !res.program.bytecode) {
    throw new Error('compile returned no program.bytecode');
  }
  const acirBytes = Buffer.from(res.program.bytecode, 'base64');
  fs.mkdirSync(path.dirname(argv.out), { recursive: true });
  fs.writeFileSync(argv.out, acirBytes);
  if (argv.json) {
    fs.writeFileSync(argv.json, JSON.stringify(res.program, null, 2));
  }
  console.error(`[compile-acir] wrote ${acirBytes.length} bytes to ${argv.out}`);
})();
