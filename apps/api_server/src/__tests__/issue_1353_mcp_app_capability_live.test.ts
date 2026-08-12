/**
 * Live capability-broker contract. The operator supplies one persisted MCP
 * App call in the isolated sandbox, started in exact interactive mode.
 *
 * RHYTHM_MCP_APPS_MODE=interactive tools/dev/sandbox.sh up
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_MCP_APP_SESSION_ID=<local-session-id> \
 * RHYTHM_LIVE_MCP_APP_CALL_ID=<persisted-call-id> \
 * npx vitest run src/__tests__/issue_1353_mcp_app_capability_live.test.ts --no-file-parallelism
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION_ID = process.env.RHYTHM_LIVE_MCP_APP_SESSION_ID;
const CALL_ID = process.env.RHYTHM_LIVE_MCP_APP_CALL_ID;
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1353 live MCP App capability broker', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    if (!SESSION_ID || !CALL_ID) {
      throw new Error('persisted MCP App session and call IDs are required');
    }
  });

  it('issue-1353-c6: valid view request reaches the next gate and executes nothing', async () => {
    const root = `${BASE}/agent-sessions/${encodeURIComponent(SESSION_ID!)}`;
    const call = encodeURIComponent(CALL_ID!);
    const resourceUrl = `${root}/mcp-app-resource/${call}`;
    const before = await fetch(resourceUrl);
    const beforeBody = await before.text();
    expect(before.status, beforeBody).toBe(200);

    const issued = await fetch(`${root}/mcp-app-capability/${call}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const issuedRaw = await issued.text();
    expect(issued.status, issuedRaw).toBe(200);
    const capability = JSON.parse(issuedRaw) as Record<string, unknown>;
    expect(capability.capability).toEqual(expect.any(String));
    expect(JSON.stringify(capability)).not.toMatch(/ui:|serverName|resourceUri/);

    const request = {
      capability: capability.capability,
      id: 'live-next-gate-1',
      method: 'host.next-gate',
      params: { requestedTool: 'must-not-run-in-1353' },
    };
    const denied = await fetch(`${root}/mcp-app-capability/${call}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(denied.status).toBe(403);

    const replay = await fetch(`${root}/mcp-app-capability/${call}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(replay.status).toBe(404);

    const after = await fetch(resourceUrl);
    expect(after.status).toBe(200);
    expect(await after.text()).toBe(beforeBody);
  });
});
