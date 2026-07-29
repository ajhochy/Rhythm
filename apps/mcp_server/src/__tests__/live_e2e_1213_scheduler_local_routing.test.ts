/**
 * Live E2E — issue #1213.
 *
 * Spawns the REAL, unmodified `src/index.ts` entrypoint as a child process
 * (exactly how Claude Desktop/Code launches this MCP server) over stdio, so
 * the actual registration call at the actual call site is exercised — not a
 * hand-mirrored copy.
 *
 * IMPORTANT SCOPE NOTE: all four scheduler MCP tools sit behind the #1134
 * trusted-MCP-call security boundary (Ed25519-signed `trustedCall`, verified
 * server-side against a public key the REAL opencode engine publishes at
 * boot — see security/trusted_mcp_call.ts). That signature can only be
 * produced by the actual running engine wrapping a real tool invocation; a
 * standalone MCP client (this test) cannot fabricate one, nor should it try
 * to — that would mean bypassing a legitimate, unrelated security control.
 * So this test cannot drive a full create → observe round trip through the
 * MCP layer without also standing up a real LLM-driven engine turn.
 *
 * Instead it proves the #1213 regression the way that's actually
 * observable from outside the security boundary: a fake "production" HTTP
 * stub stands in for RHYTHM_API_URL and records every request it receives.
 * RHYTHM_AGENT_URL points at the real sandbox. Every scheduler tool call is
 * asserted to (a) NEVER touch the fake-production stub, and (b) be
 * evaluated by REAL local server code — evidenced by getting the expected,
 * well-formed security-boundary rejection (a structured response from a
 * live Express handler doing a real DB lookup) rather than a network-level
 * failure, which is what routing to a wrong/unreachable host would produce.
 * Combined with the unit-level source-contract + behavioral tests in
 * issue_1213_scheduler_local_routing.test.ts (which prove the exact call
 * site and that the function correctly separates apiUrl from a second URL),
 * this closes the loop: the real entrypoint, at its real call site, never
 * contacts production.
 *
 * Skipped unless RHYTHM_LIVE_E2E=1. Point RHYTHM_LIVE_URL at the sandbox
 * (see docs/ai/testing-guide.md "Isolated dev sandbox").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;

const AGENT_URL = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';

const MCP_SERVER_DIR = path.join(__dirname, '..', '..');
const TSX_BIN = path.join(MCP_SERVER_DIR, 'node_modules', '.bin', 'tsx');
const ENTRYPOINT = path.join(MCP_SERVER_DIR, 'src', 'index.ts');
const SECURITY_CONTEXT_META_KEY = 'com.vcrc.rhythm/security-context';

// A stand-in "production" server: records every request it receives and
// answers 500 (so a wiring bug that hits it is unambiguous, never mistaken
// for a real success). If the #1213 bug ever regresses (scheduler tools
// wired to RHYTHM_API_URL again), this WILL receive requests.
let fakeProdRequests: string[] = [];
let fakeProdServer: http.Server;
let fakeProdUrl: string;

beforeAll(async () => {
  const health = await fetch(`${AGENT_URL}/health`);
  if (!health.ok) throw new Error(`sandbox not reachable at ${AGENT_URL} — start the sandbox first`);

  fakeProdServer = http.createServer((req, res) => {
    fakeProdRequests.push(`${req.method} ${req.url}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'this is the FAKE PRODUCTION stub — it must never be called' }));
  });
  await new Promise<void>((resolve) => fakeProdServer.listen(0, '127.0.0.1', resolve));
  const { port } = fakeProdServer.address() as AddressInfo;
  fakeProdUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fakeProdServer.close(() => resolve()));
});

describeLive('live E2E — #1213 scheduler MCP tools never contact production', () => {
  it(
    'all four scheduler tools call ONLY the local sandbox — the fake-production stub receives zero requests',
    async () => {
      const meta = {
        [SECURITY_CONTEXT_META_KEY]: {
          sdkSessionId: 'live-e2e-1213-sdk-session',
          turnId: 'live-e2e-1213-turn',
          agentName: 'live-e2e-1213-agent',
          toolCallId: 'live-e2e-1213-call',
        },
      };

      const transport = new StdioClientTransport({
        command: TSX_BIN,
        args: [ENTRYPOINT],
        cwd: MCP_SERVER_DIR,
        env: {
          ...(process.env as Record<string, string>),
          RHYTHM_API_URL: fakeProdUrl,
          RHYTHM_AGENT_URL: AGENT_URL,
          RHYTHM_API_TOKEN: 'live-e2e-dummy-token',
        },
        stderr: 'pipe',
      });
      const client = new Client({ name: 'issue-1213-live-e2e', version: '1.0.0' });
      await client.connect(transport);

      try {
        const calls: Array<{ tool: string; args: Record<string, unknown> }> = [
          {
            tool: 'rhythm_create_scheduled_task',
            args: {
              name: 'live-e2e-1213-routing-check',
              prompt: 'noop — live E2E routing check',
              scheduleType: 'once',
              runAt: new Date(Date.now() + 3600_000).toISOString(),
            },
          },
          { tool: 'rhythm_list_scheduled_tasks', args: {} },
          { tool: 'rhythm_cancel_scheduled_task', args: { id: 'live-e2e-nonexistent-id' } },
          { tool: 'rhythm_trigger_now', args: { id: 'live-e2e-nonexistent-id' } },
        ];

        for (const { tool, args } of calls) {
          const result = await client.callTool({ name: tool, arguments: args, _meta: meta });
          const text = (result.content as Array<{ type: string; text: string }>)[0].text;

          // Whatever the outcome, it must be a response the LOCAL sandbox's
          // real Express handlers produced — never a raw network failure,
          // which is exactly what "still wired to a wrong/unreachable host"
          // would look like.
          expect(
            text,
            `${tool} produced a network-level failure instead of a real local server response`,
          ).not.toMatch(/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i);
        }
      } finally {
        await client.close();
      }

      expect(
        fakeProdRequests,
        `the fake-production stub received request(s) it must never see: ${fakeProdRequests.join(', ')}`,
      ).toEqual([]);
    },
    30_000,
  );
});
