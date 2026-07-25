import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runPlaywright(env) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(
      'npx',
      [
        'playwright',
        'test',
        'tests/e2e/pairing.spec.mjs',
        '--grep',
        'scanner pairing',
        '--reporter=line',
      ],
      {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Playwright did not reject the occupied port:\n${output}`));
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, durationMs: Date.now() - startedAt, output });
    });
  });
}

// issue-1171-c8: a healthy process already bound to a parameterized fake-server
// port must make Playwright fail before it builds or reuses any foreign app.
const occupiedServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end('{"occupied":true}');
});
const spareServer = http.createServer();
await Promise.all([listen(occupiedServer), listen(spareServer)]);
const occupiedPort = occupiedServer.address().port;
const webPort = spareServer.address().port;
await close(spareServer);

try {
  for (const ci of ['', '1']) {
    const result = await runPlaywright({
      CI: ci,
      PLAYWRIGHT_FAKE_PORT: String(occupiedPort),
      PLAYWRIGHT_WEB_PORT: String(webPort),
    });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /already used|is being used/i);
    assert.ok(
      result.durationMs < 15_000,
      `${ci ? 'CI' : 'local'} occupied-port rejection took ${result.durationMs}ms`,
    );
  }
} finally {
  await close(occupiedServer);
}

console.log('Playwright occupied-port isolation test passed');
