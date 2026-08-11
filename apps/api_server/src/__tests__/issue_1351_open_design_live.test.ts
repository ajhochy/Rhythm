/**
 * Live read-only pilot contract. Create one real Open Design MCP App call in
 * the isolated sandbox and provide its persisted local session/call IDs.
 *
 * RHYTHM_MCP_APPS_MODE=readonly tools/dev/sandbox.sh up
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_MCP_APP_SESSION_ID=<local-session-id> \
 * RHYTHM_LIVE_MCP_APP_CALL_ID=<persisted-call-id> \
 * npx vitest run src/__tests__/issue_1351_open_design_live.test.ts --no-file-parallelism
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION_ID = process.env.RHYTHM_LIVE_MCP_APP_SESSION_ID;
const CALL_ID = process.env.RHYTHM_LIVE_MCP_APP_CALL_ID;
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1351 live read-only Open Design pilot', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    if (!SESSION_ID || !CALL_ID) {
      throw new Error('persisted Open Design session and call IDs are required');
    }
  });

  it('issue-1351-c6: resource renders and an action-shaped request mutates nothing', async () => {
    const url = `${BASE}/agent-sessions/${encodeURIComponent(SESSION_ID!)}/mcp-app-resource/${encodeURIComponent(CALL_ID!)}`;
    const before = await fetch(url);
    const beforeBody = await before.text();
    expect(before.status, beforeBody).toBe(200);
    const resource = JSON.parse(beforeBody) as Record<string, unknown>;
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.text).toEqual(expect.any(String));

    const denied = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tools/call', tool: 'mutate_document' }),
    });
    expect(denied.ok).toBe(false);

    const after = await fetch(url);
    expect(after.status).toBe(200);
    expect(await after.text()).toBe(beforeBody);
  });
});
