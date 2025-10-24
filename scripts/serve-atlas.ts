/**
 * Local Shadow Atlas Development Server
 * Serves Shadow Atlas via HTTP for local testing
 * Mimics IPFS behavior for development workflow
 *
 * Usage:
 *   npm run atlas:serve
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';

const PORT = 8080;
const ATLAS_FILE = path.join(process.cwd(), 'shadow-atlas-us.json');

async function startServer() {
  console.log('🚀 Shadow Atlas Development Server\n');

  // Check if Atlas exists
  try {
    await fs.access(ATLAS_FILE);
    const stats = await fs.stat(ATLAS_FILE);
    console.log(`✓ Atlas file found: ${ATLAS_FILE}`);
    console.log(`  Size: ${(stats.size / 1024).toFixed(2)}KB`);
    console.log(`  Modified: ${stats.mtime.toISOString()}\n`);
  } catch (error) {
    console.error(`❌ Atlas file not found: ${ATLAS_FILE}`);
    console.error('   Run: npm run atlas:dev\n');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Serve Shadow Atlas
    if (url.pathname === '/atlas' || url.pathname === '/shadow-atlas-us.json') {
      try {
        const atlasData = await fs.readFile(ATLAS_FILE, 'utf-8');
        const atlas = JSON.parse(atlasData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(atlasData);

        console.log(`✓ Served Atlas (${atlas.districts.length} districts, root: ${atlas.root.slice(0, 10)}...)`);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load Atlas' }));
        console.error('❌ Error serving Atlas:', error);
      }
      return;
    }

    // Serve metadata only
    if (url.pathname === '/atlas/metadata') {
      try {
        const atlasData = await fs.readFile(ATLAS_FILE, 'utf-8');
        const atlas = JSON.parse(atlasData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(atlas.metadata, null, 2));

        console.log(`✓ Served metadata (Congress ${atlas.metadata.congress})`);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load metadata' }));
      }
      return;
    }

    // Serve root hash only (mimics on-chain read)
    if (url.pathname === '/atlas/root') {
      try {
        const atlasData = await fs.readFile(ATLAS_FILE, 'utf-8');
        const atlas = JSON.parse(atlasData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ root: atlas.root }));

        console.log(`✓ Served root hash: ${atlas.root}`);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load root' }));
      }
      return;
    }

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    // Index page with usage instructions
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Shadow Atlas Dev Server</title>
  <style>
    body { font-family: monospace; max-width: 800px; margin: 50px auto; padding: 0 20px; }
    h1 { color: #333; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .endpoint { margin: 20px 0; }
    .method { color: #008800; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🗺️ Shadow Atlas Development Server</h1>
  <p>Local server for testing VOTER Protocol Shadow Atlas integration</p>

  <h2>Available Endpoints:</h2>

  <div class="endpoint">
    <p><span class="method">GET</span> <a href="/atlas">/atlas</a></p>
    <p>Returns complete Shadow Atlas JSON (all districts + Merkle tree)</p>
  </div>

  <div class="endpoint">
    <p><span class="method">GET</span> <a href="/atlas/metadata">/atlas/metadata</a></p>
    <p>Returns Atlas metadata only (version, congress, data source)</p>
  </div>

  <div class="endpoint">
    <p><span class="method">GET</span> <a href="/atlas/root">/atlas/root</a></p>
    <p>Returns Merkle root hash (mimics on-chain contract read)</p>
  </div>

  <div class="endpoint">
    <p><span class="method">GET</span> <a href="/health">/health</a></p>
    <p>Server health check</p>
  </div>

  <h2>Usage in VOTERClient:</h2>
  <pre>
const client = new VOTERClient({
  scrollRpcUrl: 'https://sepolia-rpc.scroll.io',
  shadowAtlasUrl: 'http://localhost:${PORT}/atlas',  // Use local server
  districtGateAddress: '0x...'
});

await client.ready();

const proof = await client.proveDistrict(
  createStreetAddress('1600 Pennsylvania Ave NW, Washington, DC 20500')
);
  </pre>

  <h2>Rebuild Atlas:</h2>
  <pre>npm run atlas:dev    # Development (mock data, fast)
npm run atlas:prod   # Production (Census shapefiles, slow)</pre>

  <p style="color: #666; margin-top: 40px;">
    Server running on port ${PORT} |
    <a href="https://github.com/communisaas/voter-protocol">VOTER Protocol</a>
  </p>
</body>
</html>
      `;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, () => {
    console.log(`✓ Server running at http://localhost:${PORT}`);
    console.log(`  Atlas endpoint: http://localhost:${PORT}/atlas`);
    console.log(`  Metadata: http://localhost:${PORT}/atlas/metadata`);
    console.log(`  Root hash: http://localhost:${PORT}/atlas/root`);
    console.log(`  Health: http://localhost:${PORT}/health\n`);
    console.log(`Press Ctrl+C to stop\n`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down server...');
    server.close(() => {
      console.log('✓ Server stopped');
      process.exit(0);
    });
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
