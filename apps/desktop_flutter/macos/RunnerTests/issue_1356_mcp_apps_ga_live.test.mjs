import assert from 'node:assert/strict';
import test from 'node:test';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const base = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';

test('issue-1356-c7: real stack preserves the immediate off rollback', { skip: !enabled }, async () => {
  const session = process.env.RHYTHM_MCP_APP_LIVE_SESSION;
  const call = process.env.RHYTHM_MCP_APP_LIVE_CALL;
  assert.ok(session && call, 'set RHYTHM_MCP_APP_LIVE_SESSION/CALL from the pilot fixture');
  assert.equal(process.env.RHYTHM_MCP_APPS_MODE, 'off', 'run this case with exact off mode');
  const response = await fetch(`${base}/agent-sessions/${encodeURIComponent(session)}/mcp-app-resource/${encodeURIComponent(call)}`);
  assert.equal(response.status, 404);
});

test('issue-1356-c7: pilot resource is bounded in an enabled mode', { skip: !enabled }, async () => {
  const session = process.env.RHYTHM_MCP_APP_LIVE_SESSION;
  const call = process.env.RHYTHM_MCP_APP_LIVE_CALL;
  assert.ok(session && call, 'set RHYTHM_MCP_APP_LIVE_SESSION/CALL from the pilot fixture');
  assert.match(process.env.RHYTHM_MCP_APPS_MODE ?? '', /^(readonly|interactive)$/);
  const response = await fetch(`${base}/agent-sessions/${encodeURIComponent(session)}/mcp-app-resource/${encodeURIComponent(call)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mimeType, 'text/html;profile=mcp-app');
  assert.ok(new TextEncoder().encode(body.text).byteLength <= 1_048_576);
});
