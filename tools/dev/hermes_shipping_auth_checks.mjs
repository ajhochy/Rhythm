import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const fixture = '/private/tmp/hermes-auth-cloud-20261014-fixture';
const sb = '/private/tmp/hermes-auth-cloud-20261014-sandbox';
const runtime = `${root}/tools/dev/.hermes-shipping-runtime`;
const node = `${runtime}/node/bin/node`;
const bin = `${runtime}/dist/opencode-darwin-arm64/bin/opencode`;
const tests = ['hermes_approvals', 'human_approval_signature', 'expired_approval_decide',
  'approval_not_required_on_clean_session', 'issue_1134_external_content_security']
  .map(name => `src/__tests__/${name}.test.ts`);
const control = 'src/contract/local_agent_cloud_token_auth.test.ts';
const files = [...tests, control].map(p => `apps/api_server/${p}`).concat([
  'apps/api_server/src/app.ts', 'apps/api_server/src/routes/agent_approvals_routes.ts',
  'apps/api_server/src/repositories/agent_approvals_repository.ts',
  'apps/api_server/src/security/human_approval_security.ts',
  'apps/api_server/src/security/trusted_mcp_call.ts',
  'apps/api_server/src/security/relay_approval_security.ts',
  'apps/api_server/src/services/mobile_cloud_identity_service.ts',
  'apps/api_server/src/services/external_content_security_service.ts',
  'apps/api_server/src/__tests__/helpers/human_approval_test_credentials.ts',
  'apps/api_server/src/__tests__/helpers/trusted_mcp_test_proof.ts',
  'apps/api_server/src/__tests__/helpers/real_server.ts',
  'tools/dev/sandbox.sh', 'tools/dev/sandbox_fixture.mjs']);
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const snapshot = () => Object.fromEntries(files.map(p => [p, digest(`${root}/${p}`)]));
assert.equal(root, '/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014');
assert.equal(process.execPath, node);
assert.equal(digest(bin), 'd60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072');
assert.ok(!existsSync(sb), 'refuse existing sandbox');
const evidence = { sourceBefore: snapshot(), engineBefore: digest(bin), commands: [], cloud401: 0,
  cloudUnexpected: 0, metadataGets: 0, modelRequests: 0, nativeDesktopTests: 0 };
const env = { PATH: `${resolve(node, '..')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: fixture,
  RHYTHM_APPROVED_FIXTURE_ROOT: fixture, RHYTHM_LIVE_DB_PATH: `${fixture}/rhythm.db`,
  RHYTHM_SANDBOX_OPENCODE_CONFIG: `${fixture}/auth-opencode-${randomUUID()}.json`, RHYTHM_SANDBOX_DIR: sb,
  RHYTHM_SANDBOX_API_PORT: '5198', RHYTHM_SANDBOX_ENGINE_PORT: '5197', RHYTHM_SANDBOX_GATEWAY_PORT: '5199',
  RHYTHM_SANDBOX_NODE_BIN: node, RHYTHM_SANDBOX_ENGINE_DIR: runtime, RHYTHM_SANDBOX_SKIP_ENGINE_BUILD: '1',
  DB_CLIENT: 'sqlite', RHYTHM_OPTIMIZER_MODE: 'shadow', OPENCODE_PURE: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', RHYTHM_NUMBAT_MONITORING_DISABLED: '1',
  HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*' };
async function command(file, args, childEnv = env, cwd = root) {
  // Never persist child env, headers, credentials or test request bodies.
  const result = await exec(file, args, { cwd, env: childEnv, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  evidence.commands.push({ file, args, exit: 0 });
  console.log(result.stdout.trim());
  return result;
}
async function listen(server) {
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return `http://127.0.0.1:${server.address().port}`;
}
const cloud = createServer((req, res) => {
  // Exact request-target only; no header/token inspection, no body reads/forwarding.
  const valid = req.method === 'GET' && req.url === '/auth/me';
  const status = valid ? 401 : req.method !== 'GET' || !req.url?.startsWith('/') ? 400 : 404;
  if (valid) evidence.cloud401++; else evidence.cloudUnexpected++;
  res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
  res.end(JSON.stringify({ error: { code: valid ? 'UNAUTHORIZED' : 'TEST_FIXTURE_REJECTED' } }));
});
const metadata = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    evidence.metadataGets++;
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'metadata-only', object: 'model', owned_by: 'synthetic' }] }));
  } else { evidence.modelRequests++; res.writeHead(400, { Connection: 'close' }); res.end(); }
});
let up = false;
try {
  for (const port of [5198, 5197, 5199]) {
    const result = await exec('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
      .catch(e => { assert.equal(e.code, 1); return { stdout: '' }; });
    assert.equal(result.stdout, '', `owned port ${port} must be free`);
  }
  if (!existsSync(fixture)) await command(node, ['tools/dev/sandbox_fixture.mjs', fixture]);
  assert.equal(realpathSync(fixture), fixture);
  assert.equal(lstatSync(`${fixture}/rhythm.db`).mode & 0o777, 0o400);
  const origin = await listen(cloud);
  const providerOrigin = await listen(metadata);
  // Small runnable boundary check; counters reset before exercising the actual units.
  for (const [path, method, status] of [['/auth/me', 'GET', 401], ['/other', 'GET', 404],
    ['/auth/me?input=unknown', 'GET', 404], ['/auth/me', 'POST', 400]]) {
    const response = await fetch(`${origin}${path}`, { method });
    assert.equal(response.status, status); assert.equal(response.headers.get('set-cookie'), null);
    await response.arrayBuffer();
  }
  evidence.cloud401 = 0; evidence.cloudUnexpected = 0;
  const config = JSON.parse(readFileSync(`${fixture}/opencode.json`, 'utf8'));
  config.mcp.rhythm.command = [node, `${root}/apps/mcp_server/dist/index.js`];
  config.mcp.rhythm.environment.RHYTHM_API_URL = 'http://127.0.0.1:5198';
  config.mcp.rhythm.environment.RHYTHM_AGENT_URL = 'http://127.0.0.1:5198';
  config.provider = { 'hermes-auth-fixture': { npm: '@ai-sdk/openai-compatible',
    options: { apiKey: 'synthetic-not-a-credential', baseURL: `${providerOrigin}/v1` },
    models: { 'metadata-only': { name: 'metadata-only', tool_call: false, limit: { context: 4096, output: 512 } } } } };
  config.model = config.small_model = 'hermes-auth-fixture/metadata-only';
  writeFileSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG, JSON.stringify(config), { flag: 'wx', mode: 0o400 });
  await command('/bin/bash', ['tools/dev/sandbox.sh', 'up']); up = true;
  await command('/bin/bash', ['tools/dev/sandbox.sh', 'status']);
  const unitEnv = { ...env, HOME: `${sb}/home`, XDG_CONFIG_HOME: `${sb}/home/.config`,
    XDG_DATA_HOME: `${sb}/home/.local/share`, XDG_CACHE_HOME: `${sb}/home/.cache`, TMPDIR: `${sb}/tmp`,
    DB_PATH: ':memory:', RHYTHM_OPENCODE_ENGINE_PORT: '5197', RHYTHM_AGENT_URL: 'http://127.0.0.1:5198',
    RHYTHM_API_BASE: 'http://127.0.0.1:5198', RHYTHM_CLOUD_API_URL: origin, PROD_API_URL: origin,
    NODE_OPTIONS: `--require=${root}/tools/dev/hermes_shipping_auth_test_helper/loopback.cjs` };
  const unit = await command(node, ['node_modules/vitest/vitest.mjs', 'run', ...tests,
    '--no-file-parallelism', '--reporter=json', `--outputFile=${fixture}/supplemental-${randomUUID()}.json`], unitEnv, `${root}/apps/api_server`);
  const reportPath = evidence.commands.at(-1).args.at(-1).split('=')[1];
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.numPassedTests, 33); assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0); assert.equal(evidence.cloud401, 1); assert.equal(evidence.cloudUnexpected, 0);
  evidence.supplemental = { passed: report.numPassedTests, failed: report.numFailedTests, reportPath };
  // Existing control owns its Cloud-only fetch fixture (including thrown offline failure).
  // Its hooks are unchanged; do not force HTTP 503, which is not an offline exception.
  await command(node, ['node_modules/vitest/vitest.mjs', 'run', control, '--no-file-parallelism',
    '--reporter=json', `--outputFile=${fixture}/control-${randomUUID()}.json`], unitEnv, `${root}/apps/api_server`);
  const controlPath = evidence.commands.at(-1).args.at(-1).split('=')[1];
  const cr = JSON.parse(readFileSync(controlPath, 'utf8'));
  assert.equal(cr.numPassedTests, 10); assert.equal(cr.numFailedTests, 0); assert.equal(cr.numPendingTests, 0);
  evidence.control = { passed: cr.numPassedTests, failed: cr.numFailedTests, controlPath };
  assert.equal(evidence.cloud401, 1); assert.equal(evidence.cloudUnexpected, 0); assert.equal(evidence.modelRequests, 0);
} finally {
  try { if (up || existsSync(`${sb}/api_server.pid`)) await command('/bin/bash', ['tools/dev/sandbox.sh', 'down']); }
  finally {
    for (const server of [cloud, metadata]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    evidence.sourceAfter = snapshot(); evidence.engineAfter = digest(bin);
    if (existsSync(fixture)) writeFileSync(`${fixture}/receipt-${randomUUID()}.json`, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o400 });
    assert.deepEqual(evidence.sourceAfter, evidence.sourceBefore, 'relevant source changed: parent must requalify');
    assert.equal(evidence.engineAfter, evidence.engineBefore);
    assert.ok(!existsSync(sb), 'stock teardown must remove owned sandbox');
    console.log(JSON.stringify({ supplemental: evidence.supplemental, control: evidence.control,
      cloud401: evidence.cloud401, cloudUnexpected: evidence.cloudUnexpected, modelRequests: evidence.modelRequests,
      sourceUnchanged: true, teardown: 'stock down; ephemeral helpers closed' }));
  }
}
