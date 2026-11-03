import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@ajhochy/rhythm-workspace-ui') return load(path.resolve(import.meta.dirname, '../../../../packages/rhythm-workspace-ui/src/domain/types.ts'));
    if (!name.startsWith('.')) return require(name);
    const target = path.resolve(path.dirname(file), name);
    return target.endsWith('.mjs') ? require(target) : load(`${target}.ts`);
  }, module, module.exports);
  return module.exports;
}
const root = path.resolve(import.meta.dirname, '../../src/gateway');
globalThis.WebSocket = class { constructor(url) { this.url = url; } };
const { createLiveGateway } = load(`${root}/index.ts`);
const { createLivePtyGateway } = load(`${root}/pty.ts`);
const { createLiveSessionsGateway } = load(`${root}/sessions.ts`);

test('A4 browser composition rejects desktop assumptions, omits cloud and sends no bearer to real HTTP backend', async () => {
  const { createServer } = await import('node:http');
  const requests = [];
  const server = createServer((req, res) => {
    requests.push([req.url, req.headers.authorization]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/agent-sessions?scope=chats' ? [] : { healthy: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const gateway = createLiveGateway({ browserOrigin: origin });
    assert.equal(gateway.mode, 'live');
    assert.equal(gateway.domains.tasks, undefined);
    assert.ok(gateway.domains.approvals);
    assert.equal(gateway.domains.settings, undefined);
    await gateway.health.api();
    await gateway.health.engine();
    assert.deepEqual(requests, [['/health', undefined], ['/opencode/health', undefined]]);
    assert.ok(gateway.domains.sessions);
    assert.throws(() => createLiveGateway({ apiBase: origin, engineBase: origin, productionApiBase: origin }), /configuration/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

for (const [base, expected] of [['http://rhythm-web.test:4098', 'ws://rhythm-web.test:4098'], ['https://owner.ts.net', 'wss://owner.ts.net']]) {
  test(`A4 PTY catches broken secure WebSocket mapping: ${base}`, () => {
    assert.equal(createLivePtyGateway(base).connect('terminal').url, `${expected}/ws/pty/terminal`);
  });
  test(`A4 sessions catches broken secure WebSocket mapping: ${base}`, () => {
    let actual;
    class Socket {
      constructor(url) { actual = url; }
      addEventListener() {}
      close() {}
    }
    const connection = createLiveSessionsGateway(base, 'unit-only-token', fetch, Socket).connect(() => {}, () => {});
    assert.equal(actual, `${expected}/ws/agents`);
    connection.close();
  });
}
