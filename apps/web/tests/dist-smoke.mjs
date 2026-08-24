import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const distRoot = path.join(projectRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const index = await readFile(indexPath, 'utf8');
const assetPaths = [...index.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((match) => match[1]);
assert.ok(assetPaths.length >= 2, 'dist index must reference built JS and CSS with relative paths');
for (const asset of assetPaths) assert.ok((await stat(path.join(distRoot, asset))).size > 0, `${asset} must exist and be non-empty`);

const server = createServer(async (request, response) => {
  try {
    const requestPath = request.url === '/' ? 'index.html' : decodeURIComponent((request.url ?? '').replace(/^\//, '').split('?')[0]);
    const resolved = path.resolve(distRoot, requestPath);
    if (!resolved.startsWith(`${distRoot}${path.sep}`) && resolved !== indexPath) throw new Error('unsafe request path');
    const body = await readFile(resolved);
    response.writeHead(200, { 'content-type': resolved.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); response.end(body);
  } catch { response.writeHead(404); response.end('not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/index.html#/agents`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div\s+id="root"(?:\s+[^>]*)?><\/div>/, 'dist index must expose the React root while permitting inspectability attributes');
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 404, 'encoded path traversal outside dist must return 404');
  for (const asset of assetPaths) assert.equal((await fetch(`${base}/${asset}`)).status, 200, `${asset} should be served by the deterministic dist path`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log(`dist smoke passed: index and ${assetPaths.length} relative assets verified`);
