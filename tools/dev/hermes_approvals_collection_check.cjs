// API-only CI resolution fixture: never modify shared node_modules.
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

if (process.env.HERMES_API_ONLY_COLLECTION === '1') {
  const load = Module._load;
  Module._load = function (request, ...args) {
    if (request.startsWith('@modelcontextprotocol/sdk/')) {
      throw Object.assign(new Error(`API_ONLY_SDK_UNAVAILABLE: ${request}`), { code: 'MODULE_NOT_FOUND' });
    }
    return load.call(this, request, ...args);
  };
}

if (require.main === module) {
  const api = resolve(__dirname, '../../apps/api_server');
  const result = spawnSync(process.execPath, [resolve(api, 'node_modules/vitest/vitest.mjs'), 'run',
    'src/__tests__/hermes_approvals_live_e2e.test.ts',
    'src/__tests__/hermes_approvals_execution_live_e2e.test.ts',
    'src/__tests__/hermes_approvals_repair_live_e2e.test.ts', '--no-file-parallelism'], {
    cwd: api, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, RHYTHM_LIVE_E2E: '0', HERMES_API_ONLY_COLLECTION: '1',
      NODE_OPTIONS: `--require=${__filename}` },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  process.stdout.write(output);
  assert.equal(result.status, 0, 'API-only collection must succeed without loading the sibling SDK');
  assert.match(output, /17 skipped/, 'all 17 live checks must collect and skip');
  assert.doesNotMatch(output, /API_ONLY_SDK_UNAVAILABLE/);
}
