/**
 * Live #1357 execution matrix. The session must contain an interactive MCP App
 * origin and a profile-scoped, pre-approved same-server app-visible tool.
 *
 * RHYTHM_MCP_APPS_MODE=interactive tools/dev/sandbox.sh up
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_MCP_APP_SESSION_ID=<local-id> RHYTHM_LIVE_MCP_APP_CALL_ID=<call-id> \
 * RHYTHM_LIVE_MCP_APP_TOOL=<pre-approved-key> \
 * RHYTHM_LIVE_MCP_APP_DENIED_TOOL=<permission-denied-key> RHYTHM_LIVE_MCP_APP_TOOL_INPUT='{}' \
 * npx vitest run src/__tests__/issue_1357_mcp_app_execution_live.test.ts --no-file-parallelism
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION = process.env.RHYTHM_LIVE_MCP_APP_SESSION_ID;
const CALL = process.env.RHYTHM_LIVE_MCP_APP_CALL_ID;
const TOOL = process.env.RHYTHM_LIVE_MCP_APP_TOOL;
const DENIED_TOOL = process.env.RHYTHM_LIVE_MCP_APP_DENIED_TOOL;

describeLive('issue #1357 live interactive MCP App execution', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    if (!SESSION || !CALL || !TOOL || !DENIED_TOOL) {
      throw new Error('live MCP App approved/denied execution fixture is required');
    }
  });

  async function issue() {
    const response = await fetch(
      `${BASE}/agent-sessions/${encodeURIComponent(SESSION!)}/mcp-app-capability/${encodeURIComponent(CALL!)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json() as Promise<{ capability: string }>;
  }

  async function call(capability: string, id: string, name: string) {
    return fetch(
      `${BASE}/agent-sessions/${encodeURIComponent(SESSION!)}/mcp-app-capability/${encodeURIComponent(CALL!)}/request`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capability,
          id,
          method: 'tools/call',
          params: {
            name,
            arguments: JSON.parse(process.env.RHYTHM_LIVE_MCP_APP_TOOL_INPUT ?? '{}'),
          },
        }),
      },
    );
  }

  it('approved same-server returns its result once; replay and cross-server fail closed', async () => {
    const approved = await issue();
    const result = await call(approved.capability, 'approved-1', TOOL!);
    expect(result.status, await result.clone().text()).toBe(200);
    const body = await result.json() as Record<string, unknown>;
    expect(body.content !== undefined || body.structuredContent !== undefined).toBe(true);

    const replay = await call(approved.capability, 'approved-1', TOOL!);
    expect(replay.status).toBe(404);

    const permission = await issue();
    const permissionDenied = await call(permission.capability, 'permission-denied-1', DENIED_TOOL!);
    expect(permissionDenied.status).toBeGreaterThanOrEqual(400);

    const cross = await issue();
    const denied = await call(cross.capability, 'cross-server-1', 'other_server_tool');
    expect(denied.status).toBeGreaterThanOrEqual(400);
  });
});
