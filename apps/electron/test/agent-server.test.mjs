import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AGENT_SERVER_BASE_URL, AGENT_SERVER_ENGINE_PORT, AGENT_SERVER_PORT, buildEnvironment, checkHealth, findNode, findServerEntry } from '../src/agent-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, '..');

test('post-m1-p7-c4d agent-server: ports match the renderer live-gateway contract, not Flutter production ports', () => {
  // apps/web/src/gateway/index.ts's validateLiveBase hardcodes exactly these two ports — using
  // Flutter's 4001/4096 here would make the renderer refuse to treat this spawn as live at all.
  assert.equal(AGENT_SERVER_PORT, 4098);
  assert.equal(AGENT_SERVER_ENGINE_PORT, 4097);
  assert.equal(AGENT_SERVER_BASE_URL, 'http://127.0.0.1:4098');
});

test('post-m1-p7-c4d agent-server: buildEnvironment sets every required var and strips stale HUMAN_APPROVAL_* keys', () => {
  const env = buildEnvironment({
    baseEnv: { PATH: '/usr/bin', HUMAN_APPROVAL_PUBLIC_KEY: 'stale-forged-value', HOME: '/Users/test' },
    port: 4098,
    enginePort: 4097,
    dbPathValue: '/tmp/rhythm-electron/rhythm.db',
    humanApprovalPublicKey: 'real-key',
    humanApprovalCapabilitySha256: 'real-hash',
    mcpRolesDir: undefined,
  });
  assert.equal(env.PORT, '4098');
  assert.equal(env.RHYTHM_OPENCODE_ENGINE_PORT, '4097');
  assert.equal(env.DB_PATH, '/tmp/rhythm-electron/rhythm.db');
  assert.equal(env.AGENT_LOCAL, 'true');
  assert.equal(env.HUMAN_APPROVAL_PUBLIC_KEY, 'real-key');
  assert.equal(env.HUMAN_APPROVAL_CAPABILITY_SHA256, 'real-hash');
  assert.equal(env.HOME, '/Users/test', 'unrelated base env vars must pass through untouched');
  assert.equal(env.MCP_ROLES_DIR, undefined, 'must not fabricate MCP_ROLES_DIR when none was resolved');
});

test('post-m1-p7-c4d agent-server: buildEnvironment never lets an explicit override win for the two security-critical vars', () => {
  // Unlike MEMORY_VAULT_PATH/MCP_ROLES_DIR (explicit-override-wins, matching Flutter), the two
  // HUMAN_APPROVAL_* vars must always be exactly what THIS process's signer just computed — a
  // caller-supplied value here would mean the server verifies decisions against a key nobody
  // controls the matching private half of.
  const env = buildEnvironment({
    baseEnv: { HUMAN_APPROVAL_PUBLIC_KEY: 'attacker-supplied', HUMAN_APPROVAL_CAPABILITY_SHA256: 'attacker-supplied' },
    port: 4098,
    enginePort: 4097,
    dbPathValue: '/tmp/db',
    humanApprovalPublicKey: 'real-key',
    humanApprovalCapabilitySha256: 'real-hash',
    mcpRolesDir: undefined,
  });
  assert.equal(env.HUMAN_APPROVAL_PUBLIC_KEY, 'real-key');
  assert.equal(env.HUMAN_APPROVAL_CAPABILITY_SHA256, 'real-hash');
});

test('post-m1-p7-c4d agent-server: buildEnvironment respects explicit MCP_ROLES_DIR override, matching Flutter precedence', () => {
  const env = buildEnvironment({
    baseEnv: { MCP_ROLES_DIR: '/explicit/override' },
    port: 4098,
    enginePort: 4097,
    dbPathValue: '/tmp/db',
    humanApprovalPublicKey: 'k',
    humanApprovalCapabilitySha256: 'h',
    mcpRolesDir: '/resolved/from/bundle',
  });
  assert.equal(env.MCP_ROLES_DIR, '/explicit/override');
});

test('post-m1-p7-c4d agent-server: findServerEntry resolves the real apps/api_server dev entry from this checkout', async () => {
  const nodePath = await findNode();
  assert.ok(nodePath, 'a Node binary must be discoverable in this dev environment for the test to be meaningful');
  const entry = findServerEntry(nodePath);
  assert.ok(entry, 'apps/api_server must be found by walking up from apps/electron in this monorepo checkout');
  assert.equal(entry.workingDir, resolve(electronRoot, '../api_server'));
  assert.deepEqual(entry.args, ['tsx', 'src/server.ts']);
});

test('post-m1-p7-c4d agent-server: checkHealth is false for a port nothing listens on', async () => {
  assert.equal(await checkHealth('http://127.0.0.1:65000'), false);
});
