/**
 * Live #1345 contract. The operator creates one real MCP App call in the
 * isolated sandbox, then supplies the persisted local session and call IDs.
 * Flutter's production-facing API path performs the fork resource read.
 *
 * RHYTHM_MCP_APPS_MODE=readonly tools/dev/sandbox.sh up
 *
 * RHYTHM_LIVE_E2E=1 \
 * RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * DB_PATH=/tmp/<sandbox>/rhythm.db \
 * RHYTHM_LIVE_MCP_APP_SESSION_ID=<local-session-id> \
 * RHYTHM_LIVE_MCP_APP_CALL_ID=<persisted-call-id> \
 *   npx vitest run src/__tests__/issue_1345_mcp_app_resource_live.test.ts \
 *   --no-file-parallelism
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION_ID = process.env.RHYTHM_LIVE_MCP_APP_SESSION_ID;
const CALL_ID = process.env.RHYTHM_LIVE_MCP_APP_CALL_ID;
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1345 live session-bound MCP App resource read', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!SESSION_ID || !CALL_ID) {
      throw new Error(
        'RHYTHM_LIVE_MCP_APP_SESSION_ID and RHYTHM_LIVE_MCP_APP_CALL_ID must identify one persisted real MCP App call',
      );
    }
    const health = await fetch(`${BASE}/opencode/health`);
    if (!health.ok) throw new Error(`sandbox fork is not reachable at ${BASE}`);
  });

  it('issue-1345-c8: live sandbox reads a persisted call resource through the real fork and API', async () => {
    // Regression caught: unit policy is wired to neither generated SDK nor the
    // localhost route. Observable bounded HTML is required from the real stack.
    const response = await fetch(
      `${BASE}/agent-sessions/${encodeURIComponent(SESSION_ID!)}/mcp-app-resource/${encodeURIComponent(CALL_ID!)}`,
    );
    const raw = await response.text();
    expect(response.status, raw).toBe(200);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body.mimeType).toBe('text/html;profile=mcp-app');
    expect(body.text).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('serverName');
    expect(body).not.toHaveProperty('cwd');
  });
});
