/**
 * Live behavioral gate for #1157.
 *
 * Drives a real sandboxed api_server + rebuilt fork engine. The test injects:
 *   - a local MCP server whose tool has an irreducible top-level `anyOf`; and
 *   - a strict Anthropic-compatible HTTP endpoint that rejects such schemas.
 *
 * A real agent turn must reach the endpoint with a sanitized tool schema and
 * produce observable assistant output through the normal WebSocket/API path.
 *
 * Run against an isolated sandbox started on the matching ports:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 *   RHYTHM_SANDBOX_OPENCODE_JSON=... DB_PATH=... \
 *   npx vitest run src/__tests__/issue_1157_anthropic_tool_schema_live.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE_BASE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const CONFIG = process.env.RHYTHM_SANDBOX_OPENCODE_JSON ?? '';
const describeLive = LIVE ? describe : describe.skip;

const PROVIDER_ID = 'e2e-anthropic-1157';
const MODEL_ID = 'claude-schema-fixture';
const MCP_ID = 'issue1157-union';
const MCP_FIXTURE = resolve(__dirname, 'fixtures/issue_1157_invalid_schema_mcp.mjs');

let strictServer: Server | undefined;
let strictPort = 0;
let originalConfig: string | undefined;
let createdSdkSessionId: string | undefined;
const capturedBodies: Array<Record<string, unknown>> = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

function hasTopLevelCombiner(body: Record<string, unknown>): boolean {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some((tool) => {
    if (!tool || typeof tool !== 'object') return false;
    const schema = (tool as { input_schema?: unknown }).input_schema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
    const node = schema as Record<string, unknown>;
    return ['anyOf', 'oneOf', 'allOf'].some((key) => Array.isArray(node[key]));
  });
}

function anthropicSuccessStream(): string {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_issue_1157',
        type: 'message',
        role: 'assistant',
        model: MODEL_ID,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 5,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Schema accepted.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
    { type: 'message_stop' },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

beforeAll(async () => {
  if (!LIVE) return;
  assertLiveE2EIsolation();
  if (!CONFIG) throw new Error('set RHYTHM_SANDBOX_OPENCODE_JSON from tools/dev/sandbox.sh env');

  strictServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      capturedBodies.push(body);
      if (hasTopLevelCombiner(body)) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'input_schema does not support oneOf, allOf, or anyOf at the top level',
          },
        }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(anthropicSuccessStream());
    });
  });
  await new Promise<void>((resolve, reject) => {
    strictServer?.once('error', reject);
    strictServer?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = strictServer.address();
  if (!address || typeof address === 'string') throw new Error('strict Anthropic fixture did not bind');
  strictPort = address.port;

  const health = await api('/health');
  if (!health.ok) throw new Error(`sandbox api_server is not reachable at ${BASE}`);
});

afterEach(async () => {
  if (!LIVE) return;
  if (createdSdkSessionId) {
    const client = createOpencodeClient({ baseUrl: ENGINE_BASE, directory: process.cwd() });
    await client.session.delete({ path: { id: createdSdkSessionId } }).catch(() => {});
    createdSdkSessionId = undefined;
  }
  if (originalConfig !== undefined) {
    writeFileSync(CONFIG, originalConfig, 'utf8');
    originalConfig = undefined;
    await api('/system/refresh', { method: 'POST' }).catch(() => {});
  }
  capturedBodies.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => strictServer?.close(() => resolve()) ?? resolve());
});

describeLive('live E2E — #1157 Anthropic tool schema sanitization', () => {
  it(
    'issue-1157-c4: real engine session reaches a strict Anthropic-compatible endpoint and returns a response',
    async () => {
      originalConfig = readFileSync(CONFIG, 'utf8');
      const config = JSON.parse(originalConfig) as {
        provider?: Record<string, unknown>;
        mcp?: Record<string, unknown>;
      };
      config.provider = config.provider ?? {};
      config.mcp = config.mcp ?? {};
      config.provider[PROVIDER_ID] = {
        npm: '@ai-sdk/anthropic',
        name: 'Strict Anthropic #1157',
        options: {
          apiKey: 'e2e-fixture-key',
          baseURL: `http://127.0.0.1:${strictPort}/v1`,
        },
        models: {
          [MODEL_ID]: {
            name: 'Claude Schema Fixture',
            limit: { context: 200000, output: 4096 },
          },
        },
      };
      config.mcp[MCP_ID] = {
        type: 'local',
        command: [process.execPath, MCP_FIXTURE],
        enabled: true,
      };
      writeFileSync(CONFIG, JSON.stringify(config, null, 2), 'utf8');

      const refresh = await api('/system/refresh', { method: 'POST' });
      expect(refresh.ok, await refresh.text()).toBe(true);
      await poll(
        async () => {
          const entries = await apiJson<Array<{ name: string; status: string }>>('/opencode/mcp');
          const fixture = entries.find((entry) => entry.name === MCP_ID);
          if (fixture?.status !== 'connected') {
            throw new Error(`MCP status is ${JSON.stringify(fixture ?? { status: 'missing' })}`);
          }
          return fixture;
        },
        30_000,
        'fixture MCP connection',
      );

      const client = createOpencodeClient({ baseUrl: ENGINE_BASE, directory: process.cwd() });
      const created = await client.session.create({
        body: { title: 'issue-1157-live' },
      });
      if (created.error || !created.data?.id) {
        throw new Error(`engine session create failed: ${JSON.stringify(created.error)}`);
      }
      createdSdkSessionId = created.data.id;

      const prompt = await client.session.prompt({
        path: { id: created.data.id },
        body: {
          model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
          parts: [{ type: 'text', text: 'Reply with: schema accepted.' }],
          system: 'Answer in one short sentence without calling any tools.',
        },
      });
      expect(prompt.error, JSON.stringify(prompt.error)).toBeUndefined();
      expect(JSON.stringify(prompt.data)).toContain('Schema accepted.');
      expect(capturedBodies.length).toBeGreaterThan(0);
      expect(capturedBodies.some(hasTopLevelCombiner)).toBe(false);
      const sentTools = capturedBodies.flatMap((body) => Array.isArray(body.tools) ? body.tools : []);
      expect(
        sentTools.some((tool) =>
          !!tool &&
          typeof tool === 'object' &&
          (tool as { name?: string }).name?.includes('union_search'),
        ),
        'the strict endpoint must receive the MCP fixture tool',
      ).toBe(true);
    },
    90_000,
  );
});
