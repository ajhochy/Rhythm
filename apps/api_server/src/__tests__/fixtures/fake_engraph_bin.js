#!/usr/bin/env node
/**
 * #1096 WP1 — fake `engraph` binary fixture.
 *
 * Exercises EngraphManager's REAL spawn/health/ownership code paths (a real
 * OS child process, a real loopback HTTP listener, real Bearer-token
 * enforcement) without depending on the actual ~20MB Rust binary or its
 * ~300MB first-run embedding-model download, so the live behavioral test can
 * run fast and offline in CI.
 *
 * Mirrors just enough of the real `engraph` 1.7.2 CLI contract (verified
 * against the real binary during this work) for the manager to drive it:
 *   - `--version`               → prints "engraph <semver>", exit 0
 *   - `index <vaultPath>`       → validates the path exists, exit 0
 *   - `serve --http --read-only --port <p> --host 127.0.0.1`
 *       reads `$HOME/.engraph/config.toml` for the port + API key the
 *       manager wrote, then serves:
 *         GET  /api/health-check → 200, no auth (matches the real service)
 *         POST /api/search       → requires `Authorization: Bearer <key>`
 *                                   from config.toml; 401 otherwise; 200
 *                                   with one fixed hit otherwise
 *         anything else          → 403 (this fixture never writes)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const FAKE_VERSION = '1.7.2';
const args = process.argv.slice(2);

function readEngraphConfig(home) {
  const raw = fs.readFileSync(path.join(home, '.engraph', 'config.toml'), 'utf8');
  const port = Number(raw.match(/port = (\d+)/)?.[1]);
  const key = raw.match(/key = "([^"]+)"/)?.[1];
  return { port, key };
}

if (args[0] === '--version') {
  process.stdout.write(`engraph ${FAKE_VERSION}\n`);
  process.exit(0);
}

if (args[0] === 'index') {
  const vaultPath = args[1];
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    process.stderr.write(`Error: vault path does not exist: ${vaultPath}\n`);
    process.exit(1);
  }
  process.stdout.write('Indexed 0 new, 0 updated, 0 deleted files (0 chunks) in 0.0s\n');
  process.exit(0);
}

if (args[0] === 'serve') {
  const home = process.env.HOME;
  const { port, key } = readEngraphConfig(home);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/health-check') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${key}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing Authorization header' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ file_path: 'fact/fake-hit.md', confidence: 100 }]));
      return;
    }
    // Read-only fixture: every other route (write endpoints) is refused.
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Insufficient permissions: write access required' }));
  });
  server.listen(port, '127.0.0.1');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  return;
}

process.stderr.write(`fake engraph: unknown command ${args.join(' ')}\n`);
process.exit(1);
