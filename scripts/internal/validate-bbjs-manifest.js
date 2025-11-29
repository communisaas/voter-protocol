#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv)).options({
  manifest: { type: 'string', demandOption: true },
  schema: { type: 'string', default: 'dist/bbjs/manifest.schema.json' },
}).argv;

const ajv = new Ajv({ allErrors: true });
const schema = JSON.parse(fs.readFileSync(argv.schema, 'utf8'));
const validate = ajv.compile(schema);
const manifest = JSON.parse(fs.readFileSync(argv.manifest, 'utf8'));

if (!validate(manifest)) {
  console.error(validate.errors);
  process.exit(1);
}

// Guard: depth class must exist for each authority and not exceed provided classes
const depthSet = new Set(manifest.depth_classes);
for (const a of manifest.authorities) {
  if (!depthSet.has(a.depth)) {
    console.error(`authority ${a.authority_id} uses undeclared depth ${a.depth}`);
    process.exit(1);
  }
}

console.error('[validate-bbjs-manifest] ok');
