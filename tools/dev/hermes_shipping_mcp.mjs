// Real stdio MCP discovery and unauthorized read; never a human decision.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const sb = '/private/tmp/hermes-shipping-rollout-20261014-sandbox';
assert.equal(process.env.RHYTHM_LIVE_E2E, '1');
assert.match(readFileSync(`${sb}/api_server.pid`, 'utf8').trim(), /^\d+$/);
const require = createRequire(`${root}/apps/mcp_server/package.json`);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const client = new Client({ name: 'shipping-fixture-readonly', version: '1' });
try {
  await client.connect(new StdioClientTransport({
    command: `${root}/tools/dev/.hermes-shipping-runtime/node/bin/node`,
    args: [`${root}/apps/mcp_server/dist/index.js`], stderr: 'pipe',
    env: { PATH: '/usr/bin:/bin', HOME: `${sb}/home`,
      RHYTHM_API_URL: 'http://127.0.0.1:4898', RHYTHM_AGENT_URL: 'http://127.0.0.1:4898',
      RHYTHM_API_TOKEN: 'invalid-shipping-fixture-token' },
  }));
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 112);
  for (const name of ['rhythm_list_pending_approvals', 'rhythm_get_pending_approval', 'rhythm_decide_approval'])
    assert.ok(names.includes(name), name);
  const denied = await client.callTool({ name: 'rhythm_list_pending_approvals', arguments: {} });
  assert.equal(denied.isError, true, 'invalid fixture token must not read cards');
  console.log(JSON.stringify({ tools: names.length, shippingBaseline: 109, additive: 3,
    unauthorizedRead: 'DENIED', decisions: 0, providerRequests: 0 }));
} finally { await client.close(); }
