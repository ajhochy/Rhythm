/**
 * Live #1342 contract. The operator first makes one real MCP call in an
 * isolated sandbox session, then supplies that local session id. This test
 * reads the real fork -> stream bridge -> SQLite -> HTTP result; no production
 * component is mocked.
 *
 * RHYTHM_LIVE_E2E=1 \
 * RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * DB_PATH=/tmp/<sandbox>/rhythm.db \
 * RHYTHM_LIVE_MCP_STRUCTURED_SESSION_ID=<local-session-id> \
 *   npx vitest run src/__tests__/issue_1342_mcp_result_envelope_live.test.ts \
 *   --no-file-parallelism
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SESSION_ID = process.env.RHYTHM_LIVE_MCP_STRUCTURED_SESSION_ID;
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1342 live structured MCP result', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!SESSION_ID) {
      throw new Error(
        'RHYTHM_LIVE_MCP_STRUCTURED_SESSION_ID must identify an isolated sandbox session containing a real structured MCP call',
      );
    }
    const health = await fetch(`${BASE}/opencode/health`);
    if (!health.ok) throw new Error(`sandbox fork is not reachable at ${BASE}`);
  });

  it('issue-1342-c1: a real MCP result remains Flutter-consumable from fork through HTTP persistence', async () => {
    // Regression caught: any layer flattens CallToolResult to text. The envelope
    // lookup/assertions fail while still requiring a readable text fallback.
    const response = await fetch(
      `${BASE}/agent-sessions/${encodeURIComponent(SESSION_ID!)}/messages?limit=200`,
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text) as { messages: Array<{ parts?: unknown[] }> };
    const toolParts = body.messages
      .flatMap((message) => message.parts ?? [])
      .filter(
        (part): part is Record<string, any> =>
          typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'tool',
      );
    const structured = toolParts.find((part) => part.state?.mcpResult?.structuredContent !== undefined);

    expect(structured, 'no persisted tool part retained the MCP result envelope').toBeDefined();
    expect(structured?.state.output).toEqual(expect.any(String));
    expect(structured?.state.mcpResult).toMatchObject({
      structuredContent: expect.anything(),
      _meta: expect.any(Object),
      isError: expect.any(Boolean),
    });
    expect(() => JSON.stringify(structured?.state.mcpResult)).not.toThrow();
  });
});
