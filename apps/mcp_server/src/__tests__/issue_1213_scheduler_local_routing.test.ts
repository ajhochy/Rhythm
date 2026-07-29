/**
 * Issue #1213 — scheduler MCP tools must route to the LOCAL agent server
 * (RHYTHM_AGENT_URL), never the production API (RHYTHM_API_URL).
 *
 * `src/index.ts` has top-level side effects (exits the process without
 * RHYTHM_API_TOKEN, connects a stdio transport on import) so it can't be
 * imported directly in a test — same constraint documented in
 * `mcp_capabilities_and_tool_registration.test.ts`. This test source-inspects
 * the actual registration call (so a revert is caught even without running
 * the live E2E suite) and separately proves — behaviorally — that
 * `registerAgentScheduleTools` sends every CRUD call to whichever URL it is
 * given as `apiUrl`, never a distinct second URL, so wiring the RIGHT
 * constant at the call site is sufficient to fix routing end to end.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAgentScheduleTools } from '../tools/agentSchedule.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../security/security_context.js';

const INDEX_TS = path.join(__dirname, '..', 'index.ts');
const indexSource = readFileSync(INDEX_TS, 'utf8');

describe('issue #1213 — src/index.ts source contract', () => {
  it('registers the scheduler tools with RHYTHM_AGENT_URL, not RHYTHM_API_URL', () => {
    const match = indexSource.match(/registerAgentScheduleTools\(\s*server\s*,\s*([A-Za-z0-9_]+)/);
    expect(match, 'registerAgentScheduleTools(...) call not found in index.ts').not.toBeNull();
    expect(
      match?.[1],
      'the scheduler MCP tools must be routed at RHYTHM_AGENT_URL (local agent-execution ' +
        'state), matching memory, sessions, profiles, delegation, approvals, and ' +
        'org-optimizer tools — never RHYTHM_API_URL (production)',
    ).toBe('RHYTHM_AGENT_URL');
  });
});

describe('issue #1213 — registerAgentScheduleTools behavioral routing', () => {
  const GIVEN_URL = 'http://given-agent-url.invalid';
  const OTHER_URL = 'http://other-url-must-never-be-called.invalid';
  const API_TOKEN = 'test-token';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('create/list/cancel/trigger-now all send their CRUD call to the given apiUrl only', async () => {
    const calledUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith(OTHER_URL)) {
        throw new Error(`must not call this URL: ${url}`);
      }
      if (url.endsWith('/agent-approvals/consume')) {
        return new Response(JSON.stringify({ allowed: true, consumed: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'sched-1', name: 'Test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = new McpServer({ name: 'rhythm-schedule-routing-test', version: '1.0.0' });
    // apiUrl=GIVEN_URL, agentUrl=GIVEN_URL — mirrors how index.ts wires a
    // local-agent-execution tool group (single RHYTHM_AGENT_URL for both).
    registerAgentScheduleTools(server, GIVEN_URL, API_TOKEN, GIVEN_URL);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'routing-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const meta = {
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
        sdkSessionId: 'sdk-routing-test',
        turnId: 'turn-routing-test',
        agentName: 'routing-test',
        toolCallId: 'call-routing-test',
      },
    };

    try {
      await client.callTool({
        name: 'rhythm_create_scheduled_task',
        arguments: { name: 'n', prompt: 'p', scheduleType: 'daily', scheduledTime: '09:00' },
        _meta: meta,
      });
      await client.callTool({ name: 'rhythm_list_scheduled_tasks', arguments: {}, _meta: meta });
      await client.callTool({
        name: 'rhythm_cancel_scheduled_task',
        arguments: { id: 'sched-1' },
        _meta: meta,
      });
      await client.callTool({
        name: 'rhythm_trigger_now',
        arguments: { id: 'sched-1' },
        _meta: meta,
      });
    } finally {
      await client.close();
      await server.close();
    }

    const isSecurityBoundaryCall = (u: string) =>
      u.endsWith('/agent-approvals/consume') || u.endsWith('/agent-approvals/external-content/taint');
    const crudCalls = calledUrls.filter((u) => !isSecurityBoundaryCall(u));
    expect(crudCalls).toHaveLength(4);
    expect(crudCalls.every((u) => u.startsWith(GIVEN_URL))).toBe(true);
  });
});
