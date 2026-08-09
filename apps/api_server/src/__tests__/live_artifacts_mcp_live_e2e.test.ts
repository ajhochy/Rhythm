/**
 * AV-03 c8 — live MCP E2E for the five live-artifact tools.
 *
 * `GET /opencode/mcp` reports `tools: []` for EVERY MCP server on this engine
 * build: that array is derived from `tool.ids()`, which returns only built-in +
 * plugin tools (see ToolRegistry.ids in the fork). MCP tools are assembled at
 * session-prompt time by `MCP.tools()`, so the only surface that proves an MCP
 * tool is really listed and really invocable is a prompt against a live engine
 * session — the pattern issue_1175_trusted_mcp_proof_live.test.ts established.
 *
 * This test drives a fixture Anthropic provider so the engine performs real MCP
 * tool calls: create → state CAS update → get, all under one stable artifact ID,
 * then reads the changed fields back through the hosted-style HTTP contract.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const base = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const providerId = `av03-c8-${process.pid}`;
const modelId = 'av03-c8-fixture';
const fixturePort = 56381;
const title = `AV03 Worship Calendar ${process.pid}`;
const expectedTools = [
  'rhythm_rhythm_list_live_artifacts',
  'rhythm_rhythm_get_live_artifact',
  'rhythm_rhythm_create_live_artifact',
  'rhythm_rhythm_update_live_artifact_state',
  'rhythm_rhythm_update_live_artifact_bundle',
];

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`;
}

function messageStart() {
  return {
    type: 'message_start',
    message: {
      id: `msg_av03_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: modelId,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
  };
}

function toolStream(name: string, input: Record<string, unknown>): string {
  return sse([
    messageStart(),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name, input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
    { type: 'message_stop' },
  ]);
}

function textStream(): string {
  return sse([
    messageStart(),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'AV03 live artifact turn complete.' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
    { type: 'message_stop' },
  ]);
}

/** Text of the most recent tool_result the engine fed back to the model. */
function lastToolResult(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as Array<{ content?: unknown }>) : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index].content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type !== 'tool_result') continue;
      return Array.isArray(part.content)
        ? (part.content as Array<{ text?: string }>).map((item) => item.text ?? '').join('')
        : String(part.content ?? '');
    }
  }
  return '';
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((done) => server.close(() => done()));
}

describeLive('AV-03 c8 — live-artifact MCP tools through the real engine', () => {
  it('av03-c8: lists the five tools, creates, CAS-updates state, and reads the change back under one ID', async () => {
    assertLiveE2EIsolation();
    if (!base || !engineUrl || !sandboxDir.startsWith('/')) {
      throw new Error('set RHYTHM_LIVE_URL, RHYTHM_LIVE_ENGINE_URL and RHYTHM_SANDBOX_DIR from tools/dev/sandbox.sh');
    }
    const engineDirectory = realpathSync(sandboxDir);
    const configPath = join(engineDirectory, 'home', '.config', 'opencode', 'opencode.json');
    const originalConfig = readFileSync(configPath, 'utf8');
    const config = JSON.parse(originalConfig) as {
      provider?: Record<string, unknown>;
      mcp: { rhythm: { environment: Record<string, string> } };
    };
    const token = config.mcp.rhythm.environment.RHYTHM_API_TOKEN;
    const db = new Database(join(engineDirectory, 'rhythm.db'));
    const userId = (db.prepare('SELECT user_id AS id FROM sessions WHERE token = ?').get(token) as { id: number }).id;
    // The copied desktop DB predates AV-02, so it carries no workspace rows.
    const joinCode = `av03-c8-${process.pid}`;
    const workspaceId = Number(
      db.prepare('INSERT INTO workspaces (name, join_code, created_by) VALUES (?,?,?)').run('AV03 c8', joinCode, userId)
        .lastInsertRowid,
    );
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id) VALUES (?,?)').run(workspaceId, userId);
    const localSessionId = randomUUID();
    const captured: Array<Record<string, unknown>> = [];
    const toolTurns: string[] = [];
    let artifact: { id: string; currentStateRevision: number } | null = null;
    let fixture: Server | null = null;
    let engineSessionId: string | null = null;

    try {
      fixture = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          captured.push(body);
          const previous = lastToolResult(body);
          if (!artifact && previous.includes('"currentStateRevision"')) {
            try {
              artifact = JSON.parse(previous) as { id: string; currentStateRevision: number };
            } catch {
              // Not the create result — leave artifact unresolved.
            }
          }
          let stream: string;
          if (captured.length === 1) {
            toolTurns.push('create');
            stream = toolStream('rhythm_rhythm_create_live_artifact', {
              title,
              workspace_id: workspaceId,
              bundle: {
                html: '<main id="calendar">Worship Calendar</main>',
                css: '#calendar{color:#111}',
                js: 'window.av03Calendar=true',
              },
              state: { services: [{ date: '2026-08-09', title: 'Sunday Gathering' }] },
            });
          } else if (captured.length === 2 && artifact) {
            toolTurns.push('update_state');
            stream = toolStream('rhythm_rhythm_update_live_artifact_state', {
              id: artifact.id,
              state: { services: [{ date: '2026-08-09', title: 'Sunday Gathering', scripture: 'John 3:16' }] },
              expected_state_revision: artifact.currentStateRevision,
            });
          } else if (captured.length === 3 && artifact) {
            toolTurns.push('get');
            stream = toolStream('rhythm_rhythm_get_live_artifact', { id: artifact.id });
          } else {
            stream = textStream();
          }
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end(stream);
        });
      });
      await new Promise<void>((done, reject) => {
        fixture?.once('error', reject);
        fixture?.listen(fixturePort, '127.0.0.1', done);
      });

      config.provider = config.provider ?? {};
      config.provider[providerId] = {
        npm: '@ai-sdk/anthropic',
        name: 'AV03 c8 fixture',
        options: { apiKey: 'av03-c8-fixture-key', baseURL: `http://127.0.0.1:${fixturePort}/v1` },
        models: { [modelId]: { name: 'AV03 c8 fixture', limit: { context: 200000, output: 4096 } } },
      };
      // ensureRhythmMcp defaults the approval bridge to the DESKTOP api_server on
      // :4001; point it at the sandbox so no live server sees these writes.
      config.mcp.rhythm.environment.RHYTHM_AGENT_URL = base;
      const configUpdate = await fetch(`${engineUrl}/global/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      expect(configUpdate.status, await configUpdate.clone().text()).toBe(200);
      expect((await fetch(`${base}/system/refresh`, { method: 'POST' })).status).toBe(200);

      const createdSession = await fetch(`${engineUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': engineDirectory },
        body: JSON.stringify({
          title: 'AV03 c8 live artifact MCP proof',
          permission: [{ permission: '*', pattern: '*', action: 'allow' }],
        }),
      });
      expect(createdSession.status, await createdSession.clone().text()).toBe(200);
      engineSessionId = ((await createdSession.json()) as { id?: string }).id ?? null;
      expect(engineSessionId).toBeTruthy();

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, created_at, updated_at,
            permission_mode, fast_mode, is_system, delegation_depth, category, sdk_session_id)
         VALUES (?, ?, 'idle', ?, ?, ?, ?, 'default', 0, 0, 0, 'chat', ?)`,
      ).run(localSessionId, 'creative-media', engineDirectory, 'AV03 c8 live artifact MCP proof', now, now, engineSessionId);

      const prompt = await fetch(`${engineUrl}/session/${engineSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': engineDirectory },
        body: JSON.stringify({
          agent: 'build',
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: 'Create the AV03 worship calendar artifact, update its state, then read it back.' }],
        }),
      });
      expect(prompt.status, await prompt.clone().text()).toBe(200);

      // Listing: the engine really advertised all five MCP tools to the model.
      const advertised = (
        (captured[0]?.tools as Array<{ name: string }> | undefined) ?? []
      ).map((tool) => tool.name);
      expect(advertised).toEqual(expect.arrayContaining(expectedTools));

      // Invocation: create → state CAS update → get all ran as real MCP calls.
      expect(toolTurns).toEqual(['create', 'update_state', 'get']);
      expect(artifact, JSON.stringify(captured.map(lastToolResult), null, 2)).toBeTruthy();
      expect(lastToolResult(captured[1])).toContain(artifact!.id);
      // A fresh artifact starts at state revision 1, so the CAS update below is
      // an explicit 1 → 2 transition, not just "some number plus one".
      expect(artifact!.currentStateRevision).toBe(1);

      // Observation: the changed field is visible through the HTTP contract
      // under the SAME stable ID, at the incremented revision.
      const read = await fetch(`${base}/live-artifacts/${artifact!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(read.status).toBe(200);
      const readBody = (await read.json()) as {
        id: string;
        title: string;
        currentStateRevision: number;
        state: { services: Array<{ scripture?: string }> };
      };
      expect(readBody.id).toBe(artifact!.id);
      expect(readBody.title).toBe(title);
      expect(readBody.currentStateRevision).toBe(2);
      expect(readBody.currentStateRevision).toBe(artifact!.currentStateRevision + 1);
      expect(readBody.state.services[0].scripture).toBe('John 3:16');
    } finally {
      if (engineSessionId) {
        await fetch(`${engineUrl}/session/${engineSessionId}`, {
          method: 'DELETE',
          headers: { 'X-OpenCode-Directory': engineDirectory },
        }).catch(() => undefined);
      }
      db.transaction(() => {
        db.prepare('DELETE FROM live_artifact_bundle_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE workspace_id=?)').run(workspaceId);
        db.prepare('DELETE FROM live_artifact_state_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE workspace_id=?)').run(workspaceId);
        db.prepare('DELETE FROM live_artifacts WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM agent_sessions WHERE id=?').run(localSessionId);
        db.prepare('DELETE FROM workspace_members WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM workspaces WHERE id=?').run(workspaceId);
      })();
      db.close();
      await fetch(`${engineUrl}/global/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: originalConfig,
      }).catch(() => undefined);
      await fetch(`${base}/system/refresh`, { method: 'POST' }).catch(() => undefined);
      await closeServer(fixture);
    }
  }, 120_000);
});
