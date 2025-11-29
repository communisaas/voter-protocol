#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argv = require('yargs/yargs')(process.argv.slice(2)).options({
  dir: { type: 'string', demandOption: true },
  out: { type: 'string', demandOption: true },
}).argv;

function sri(pathname) {
  const data = fs.readFileSync(pathname);
  const hash = crypto.createHash('sha384').update(data).digest('base64');
  return `sha384-${hash}`;
}

const entries = {};
for (const file of fs.readdirSync(argv.dir)) {
  const full = path.join(argv.dir, file);
  if (fs.statSync(full).isFile()) {
    entries[file] = sri(full);
  }
}
fs.writeFileSync(argv.out, JSON.stringify(entries, null, 2));
console.error(`[gen-sri] wrote ${argv.out}`);
