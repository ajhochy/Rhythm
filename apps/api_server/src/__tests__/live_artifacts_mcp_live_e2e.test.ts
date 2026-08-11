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
 * tool calls: create → share by email → state CAS update → get, all under one
 * stable artifact ID, then reads the changed fields back through the
 * hosted-style HTTP contract.
 *
 * The `get` turn consumes external content, which arms the #1134 outbound gate.
 * The revocation half therefore runs the full normal approval flow — refused
 * without a token, approval requested and granted for that exact sharing
 * action, then applied — instead of expecting an unapproved mutation to land.
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
  'rhythm_rhythm_update_live_artifact_sharing',
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
  it('av07-ac8: the real engine MCP update is visible to a same-ID human collaborator with audited revision history', async () => {
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
    const collaboratorEmail = `av07-human-${randomUUID()}@example.test`;
    const collaboratorId = Number(
      db.prepare('INSERT INTO users (name, email) VALUES (?,?)')
        .run('AV07 human collaborator', collaboratorEmail).lastInsertRowid,
    );
    const collaboratorToken = randomUUID();
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id) VALUES (?,?)').run(workspaceId, collaboratorId);
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(collaboratorToken, collaboratorId);
    const localSessionId = randomUUID();
    const captured: Array<Record<string, unknown>> = [];
    const toolTurns: string[] = [];
    let artifact: { id: string; currentStateRevision: number } | null = null;
    let fixture: Server | null = null;
    let engineSessionId: string | null = null;
    // Revocation half: the `get` turn below feeds external content into the
    // session, so the #1134 gate must refuse the follow-up sharing mutation
    // until a human approves THAT action. These record the refusal, the access
    // that survived it, and the one approval minted for it.
    let refusal = '';
    let accessDuringRefusal = 0;
    let approvalId = '';
    let approvalRow: Record<string, unknown> | null = null;
    let humanDecisions = 0;
    let revokeResult = '';
    const collaboratorAccess = async (): Promise<number> =>
      (
        await fetch(`${base}/live-artifacts/${artifact!.id}`, {
          headers: { Authorization: `Bearer ${collaboratorToken}` },
        })
      ).status;

    try {
      fixture = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', async () => {
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
               visibility: 'private',
              state: {
                services: [{
                  date: '2026-08-09',
                  title: 'Sunday Gathering',
                  scripture: 'Psalm 23',
                  theme: 'Shepherd',
                  serviceDetails: { leader: 'AV07 Owner' },
                }],
              },
            });
          } else if (captured.length === 2 && artifact) {
            toolTurns.push('update_sharing');
            stream = toolStream('rhythm_rhythm_update_live_artifact_sharing', {
              id: artifact.id,
              visibility: 'shared',
              collaborators: [collaboratorEmail],
            });
          } else if (captured.length === 3 && artifact) {
            toolTurns.push('update_state');
            stream = toolStream('rhythm_rhythm_update_live_artifact_state', {
              id: artifact.id,
              state: {
                services: [{
                  date: '2026-08-09',
                  title: 'AV07 Updated Gathering',
                  scripture: 'John 3:16',
                  theme: 'Hope',
                  serviceDetails: { leader: 'AV07 Human' },
                }],
              },
              expected_state_revision: artifact.currentStateRevision,
            });
          } else if (captured.length === 4 && artifact) {
            toolTurns.push('get');
            stream = toolStream('rhythm_rhythm_get_live_artifact', { id: artifact.id });
          } else if (captured.length === 6 && artifact) {
            // Revocation with NO approval token. `get` above consumed external
            // content, so this must be refused rather than silently applied.
            toolTurns.push('revoke_denied');
            stream = toolStream('rhythm_rhythm_update_live_artifact_sharing', {
              id: artifact.id,
              visibility: 'private',
              collaborators: [],
            });
          } else if (captured.length === 7 && artifact) {
            refusal = previous;
            // Read the collaborator's access mid-flight: a refused mutation
            // must leave the artifact exactly as it was.
            accessDuringRefusal = await collaboratorAccess();
            toolTurns.push('request_approval');
            stream = toolStream('rhythm_rhythm_request_approval', {
              action: 'Revoke the AV07 human collaborator from the AV03 artifact',
              security_action: 'live-artifact.sharing.update',
              security_payload: { id: artifact.id, visibility: 'private', collaborators: [] },
            });
          } else if (captured.length === 8 && artifact) {
            approvalId = /id=([0-9a-fA-F-]{36})/.exec(previous)?.[1] ?? '';
            // Stand in for the human tapping Approve on that card. Only the
            // decision is simulated — the row, its action, its canonical
            // payload digest and its taint binding were all minted by the
            // server from the agent's own request. The signed-decision
            // ceremony needs the desktop Keychain key, which no sandbox holds
            // (it has the public half only); human_approval_signature.test.ts
            // and issue_1175_adversarial_live.test.ts cover that half.
            humanDecisions = approvalId
              ? db
                  .prepare(
                    `UPDATE agent_approvals SET status='approved', actor=?, decided_at=?
                     WHERE id=? AND status='pending' AND security_action='live-artifact.sharing.update'`,
                  )
                  .run(`user:${userId}`, new Date().toISOString(), approvalId).changes
              : 0;
            approvalRow = approvalId
              ? ((db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(approvalId) ??
                  null) as Record<string, unknown> | null)
              : null;
            toolTurns.push('revoke_approved');
            stream = toolStream('rhythm_rhythm_update_live_artifact_sharing', {
              id: artifact.id,
              visibility: 'private',
              collaborators: [],
              approval_id: approvalId,
            });
          } else {
            if (captured.length === 9) revokeResult = previous;
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
          parts: [{ type: 'text', text: 'Create the AV03 worship calendar artifact, share it with the named human collaborator, update its state, then read it back.' }],
        }),
      });
      expect(prompt.status, await prompt.clone().text()).toBe(200);

      // Listing: the engine really advertised every live-artifact MCP tool.
      const advertised = (
        (captured[0]?.tools as Array<{ name: string }> | undefined) ?? []
      ).map((tool) => tool.name);
      expect(advertised).toEqual(expect.arrayContaining(expectedTools));
      // The revocation half below drives the real approval flow, so the
      // approval-request tool has to be advertised on this session too.
      expect(advertised).toContain('rhythm_rhythm_request_approval');

       // Invocation: create → named share → state CAS update → get all ran as real MCP calls.
       expect(toolTurns).toEqual(['create', 'update_sharing', 'update_state', 'get']);
       expect(lastToolResult(captured[2])).toContain(collaboratorEmail);
      expect(artifact, JSON.stringify(captured.map(lastToolResult), null, 2)).toBeTruthy();
      expect(lastToolResult(captured[1])).toContain(artifact!.id);
      // A fresh artifact starts at state revision 1, so the CAS update below is
      // an explicit 1 → 2 transition, not just "some number plus one".
      expect(artifact!.currentStateRevision).toBe(1);

      // Observation: a human collaborator reads the agent's changed calendar
      // through the hosted API under the SAME stable ID, not a copied row.
      const read = await fetch(`${base}/live-artifacts/${artifact!.id}`, {
        headers: { Authorization: `Bearer ${collaboratorToken}` },
      });
      expect(read.status).toBe(200);
      const readBody = (await read.json()) as {
        id: string;
        title: string;
        currentStateRevision: number;
        state: { services: Array<{ title?: string; scripture?: string; theme?: string; serviceDetails?: Record<string, unknown> }> };
      };
      expect(readBody.id).toBe(artifact!.id);
      expect(readBody.title).toBe(title);
      expect(readBody.currentStateRevision).toBe(2);
      expect(readBody.currentStateRevision).toBe(artifact!.currentStateRevision + 1);
      expect(readBody.state.services[0].scripture).toBe('John 3:16');
      // Regression caught: an MCP update that only changes a partial calendar
      // payload would silently drop the Worship Calendar's other editable fields.
       expect(readBody.state.services[0]).toMatchObject({
        title: 'AV07 Updated Gathering',
        scripture: 'John 3:16',
        theme: 'Hope',
        serviceDetails: { leader: 'AV07 Human' },
       });
       // Live sharing proof: this human only acquired access through the MCP
       // email resolution/membership update, not creation-time collaborator IDs.
       expect((await fetch(`${base}/live-artifacts/${artifact!.id}`, {
         headers: { Authorization: `Bearer ${collaboratorToken}` },
       })).status).toBe(200);
       const revokePrompt = await fetch(`${engineUrl}/session/${engineSessionId}/message`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': engineDirectory },
         body: JSON.stringify({
           agent: 'build', model: { providerID: providerId, modelID: modelId },
           parts: [{ type: 'text', text: 'Revoke the human collaborator from the artifact now.' }],
         }),
       });
       expect(revokePrompt.status, await revokePrompt.clone().text()).toBe(200);
       expect(toolTurns).toEqual([
         'create', 'update_sharing', 'update_state', 'get',
         'revoke_denied', 'request_approval', 'revoke_approved',
       ]);
       // Approval is REQUIRED: the unapproved revocation was refused by the
       // server, and the collaborator's access survived that refusal intact.
       expect(refusal).toContain('human approval is required after external content was consumed');
       expect(accessDuringRefusal).toBe(200);
       // The approval that unblocked it was minted for THIS action and THIS
       // exact payload — no reuse of the state/bundle/create actions, and no
       // reuse of the earlier untainted share. `preview` is server-authored
       // from the canonical payload, so it cannot be restated by the model.
       expect(humanDecisions).toBe(1);
       expect(approvalRow).toMatchObject({
         session_id: localSessionId,
         security_action: 'live-artifact.sharing.update',
         status: 'approved',
         preview: `live-artifact.sharing.update: {"collaborators":[],"id":"${artifact!.id}","visibility":"private"}`,
       });
       // Revocation is IMMEDIATE: same stable ID, collaborator now locked out.
       expect((await fetch(`${base}/live-artifacts/${artifact!.id}`, {
         headers: { Authorization: `Bearer ${collaboratorToken}` },
       })).status).toBe(404);
       // ...and it is a real revocation, not just a hidden artifact. The agent's
       // observable outcome must be success, and the collaborator's GRANT must
       // be gone — otherwise re-sharing later silently restores a revoked user.
       expect(revokeResult).not.toContain('Rhythm API error');
       expect(
         db.prepare('SELECT COUNT(*) AS count FROM live_artifact_collaborators WHERE artifact_id=?')
           .get(artifact!.id),
       ).toEqual({ count: 0 });
       // The token was spent, so a replay of the same revocation cannot reuse it.
       expect(
         db.prepare('SELECT consumed_at FROM agent_approvals WHERE id=?').get(approvalId),
       ).not.toEqual({ consumed_at: null });
      expect(db.prepare('SELECT COUNT(*) AS count FROM live_artifacts WHERE id=?').get(artifact!.id)).toEqual({ count: 1 });
      expect(db.prepare('SELECT updated_by_user_id AS actor FROM live_artifacts WHERE id=?').get(artifact!.id)).toEqual({ actor: userId });
      expect(db.prepare('SELECT actor_user_id AS actor FROM live_artifact_state_revisions WHERE artifact_id=? AND revision=2').get(artifact!.id)).toEqual({ actor: userId });
    } finally {
      if (engineSessionId) {
        await fetch(`${engineUrl}/session/${engineSessionId}`, {
          method: 'DELETE',
          headers: { 'X-OpenCode-Directory': engineDirectory },
        }).catch(() => undefined);
      }
      db.transaction(() => {
        db.prepare('DELETE FROM live_artifact_collaborators WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE workspace_id=?)').run(workspaceId);
        db.prepare('DELETE FROM live_artifact_bundle_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE workspace_id=?)').run(workspaceId);
        db.prepare('DELETE FROM live_artifact_state_revisions WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE workspace_id=?)').run(workspaceId);
        db.prepare('DELETE FROM live_artifacts WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM agent_approvals WHERE session_id=?').run(localSessionId);
        db.prepare('DELETE FROM agent_external_content_events WHERE session_id=?').run(localSessionId);
        db.prepare('DELETE FROM agent_external_taint_state WHERE session_id=?').run(localSessionId);
        db.prepare('DELETE FROM agent_sessions WHERE id=?').run(localSessionId);
        db.prepare('DELETE FROM sessions WHERE token=?').run(collaboratorToken);
        db.prepare('DELETE FROM workspace_members WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM workspaces WHERE id=?').run(workspaceId);
        db.prepare('DELETE FROM users WHERE id=?').run(collaboratorId);
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
