import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  registerOrgOptimizerTools,
  ORG_OPTIMIZER_RUN_TIMEOUT_MS,
} from "../orgOptimizer.js";
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from "../../security/security_context.js";

type ToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

function makeStubServer(): {
  server: unknown;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(
      name: string,
      _description: string,
      _shape: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools.set(name, { name, handler });
    },
  };
  return { server, tools };
}

const API_TOKEN = "tok";

// #1115 — rhythm_run_org_optimizer's POST must carry a real, working
// raised-timeout dispatcher, not just a value that type-checks. Drives a
// REAL local HTTP server with a controllable delay (a mocked global fetch
// previously passed here while the implementation threw at runtime — see
// api_client.test.ts for the full explanation).
describe("rhythm_run_org_optimizer — #1115 undici timeout", () => {
  let httpServer: http.Server | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve) =>
      httpServer ? httpServer.close(() => resolve()) : resolve(),
    );
    httpServer = undefined;
  });

  function startDelayedAgentServer(responseDelayMs: number): Promise<string> {
    httpServer = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ proposalsCreated: 0 }));
      }, responseDelayMs);
    });
    return new Promise((resolve) => {
      httpServer!.listen(0, "127.0.0.1", () => {
        const { port } = httpServer!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  it("exports a run timeout configured well above the 300s undici default", () => {
    expect(ORG_OPTIMIZER_RUN_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it("completes a real request to /agent-org-optimizer/run slower than undici would tolerate by default", async () => {
    // 1.5s is obviously far below the real 300s default, but it proves the
    // tool's POST genuinely goes through a working raised-timeout dispatcher
    // end-to-end (registerTool -> handler -> apiPost -> undici fetch+Agent)
    // against a real socket, without the "bounded live check" needing to
    // wait a real five minutes. The exact 300s-vs-900s margin is asserted
    // deterministically in the test above and in api_client.test.ts's
    // short-vs-raised-timeout comparison.
    const agentUrl = await startDelayedAgentServer(1500);

    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerOrgOptimizerTools(server as any, agentUrl, API_TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ allowed: true, consumed: false }),
      })),
    );

    const result = await tools.get("rhythm_run_org_optimizer")!.handler(
      {},
      {
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            sdkSessionId: "sdk-org-test",
            turnId: "turn-org-test",
            agentName: "org-optimizer",
            toolCallId: "call-org-test",
          },
        },
      },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('"proposalsCreated": 0');
  }, 10_000);
});

describe('rhythm_run_external_discovery', () => {
  it('calls only the bounded discovery endpoint and returns its proposal summary', async () => {
    let requestedUrl = '';
    const localServer = http.createServer((req, res) => {
      if (req.url === '/agent-approvals/consume') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: true, consumed: false }));
        return;
      }
      requestedUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ emitted: 0, skipped: false }));
    });
    const agentUrl = await new Promise<string>((resolve) => {
      localServer.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(localServer.address() as AddressInfo).port}`);
      });
    });
    const { server, tools } = makeStubServer();
    registerOrgOptimizerTools(server as any, agentUrl, API_TOKEN);

    const result = await tools.get('rhythm_run_external_discovery')!.handler(
      {},
      {
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            sdkSessionId: 'sdk-discovery-test',
            turnId: 'turn-discovery-test',
            agentName: 'org-external-discovery',
            toolCallId: 'call-discovery-test',
          },
        },
      },
    );

    expect(result.isError).toBeUndefined();
    expect(requestedUrl).toBe('/agent-org-optimizer/external-discovery');
    expect(result.content[0].text).toContain('"emitted": 0');
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  });
});
