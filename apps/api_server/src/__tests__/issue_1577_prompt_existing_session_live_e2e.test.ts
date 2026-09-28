/** Real fork + API + MCP boundary; only the external model provider is scripted. */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_API_URL;
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL;
const sandbox = process.env.RHYTHM_SANDBOX_DIR;
const marker = `issue-1577-${randomUUID()}`;
const providerId = `fixture-1577-${randomUUID().slice(0, 8)}`;
const modelId = 'scripted-tool-call';
let client: ReturnType<typeof createOpencodeClient>;
let provider: Server;
let token: string;
let caller: { id: string; sdkSessionId: string };
let target: { id: string; sdkSessionId: string };
let restricted: { id: string; sdkSessionId: string };
let restrictedProfileId: string;
let fixtureProfileId: string;
let firstCall = true;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers } });
}
async function read(path: string, init?: RequestInit): Promise<any> {
  const response = await api(path, init);
  expect(response.status, `${path}: ${await response.clone().text()}`).toBeLessThan(300);
  return response.json();
}

describe.skipIf(!live)('issue-1577-c7: real MCP prompt into existing session', () => {
  beforeAll(async () => {
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    if (!API || !ENGINE || !sandbox) throw new Error('RHYTHM_LIVE_API_URL, RHYTHM_LIVE_ENGINE_URL and RHYTHM_SANDBOX_DIR are required');
    const apiUrl = new URL(API);
    const engineUrl = new URL(ENGINE);
    if (apiUrl.hostname !== '127.0.0.1' || engineUrl.hostname !== '127.0.0.1' || ['4001', '4096'].includes(apiUrl.port) || ['4001', '4096'].includes(engineUrl.port)) {
      throw new Error('Live E2E requires isolated loopback sandbox ports, never 4001/4096');
    }
    client = createOpencodeClient({ baseUrl: ENGINE, directory: sandbox });
    const db = new Database(`${sandbox}/rhythm.db`, { readonly: true });
    try {
      token = (db.prepare('SELECT token FROM sessions ORDER BY created_at DESC LIMIT 1').get() as { token: string }).token;
    } finally { db.close(); }
    expect(await read('/opencode/health')).toMatchObject({ status: 'ready' });
    const config = await (await fetch(`${ENGINE}/global/config`)).json() as any;
    expect(config.mcp.rhythm.environment.RHYTHM_AGENT_URL).toBe(API);
    expect(config.mcp.rhythm.command).toEqual(['node', resolve(__dirname, '../../../mcp_server/dist/index.js')]);
    provider = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { tools?: Array<{ name: string; description?: string }> };
        const tool = firstCall ? (body.tools?.some(({ name }) => name === 'mcp_dispatch') ? 'mcp_dispatch' :
          body.tools?.find(({ name }) => name.endsWith('_rhythm_prompt_session'))?.name) : undefined;
        firstCall = false;
        const input = tool === 'mcp_dispatch'
          ? { name: body.tools?.find(({ name }) => name === 'mcp_dispatch')?.description?.match(/<name>([^<]*rhythm_prompt_session)<\/name>/)?.[1] ?? 'rhythm_rhythm_prompt_session', arguments: { sessionId: target.id, prompt: marker } }
          : { sessionId: target.id, prompt: marker };
        const id = `toolu_${randomUUID().replaceAll('-', '')}`;
        const events = [
          { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: modelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id, name: tool, input: {} } : { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(input) } : { type: 'text_delta', text: 'Fixture complete.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
          { type: 'message_stop' },
        ];
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
      });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('fixture provider failed to listen');
    const patch = await fetch(`${ENGINE}/global/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: { [providerId]: {
      npm: '@ai-sdk/anthropic', name: 'Isolated issue-1577 transport', options: { apiKey: 'fixture-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
      models: { [modelId]: { name: modelId, limit: { context: 200_000, output: 4_000 } } },
    } } }) });
    expect(patch.status).toBe(200);
    await read(`/opencode/auth/${providerId}`, { method: 'POST', body: JSON.stringify({ apiKey: 'fixture-only' }) });
    await read('/system/refresh', { method: 'POST' });
    const fixtureProfile = await read('/agent-configs', { method: 'POST', body: JSON.stringify({ label: `${marker} provider`, icon: 'shield', ocAgent: 'build', modelProvider: providerId, modelId }) });
    fixtureProfileId = fixtureProfile.id;
    caller = await read('/agent-sessions', { method: 'POST', body: JSON.stringify({ profileId: fixtureProfileId, cwd: sandbox, name: `${marker} caller` }) });
    target = await read('/agent-sessions', { method: 'POST', body: JSON.stringify({ profileId: fixtureProfileId, cwd: sandbox, name: `${marker} target` }) });
    const profile = await read('/agent-configs', { method: 'POST', body: JSON.stringify({ label: `${marker} restricted`, icon: 'shield',
      ocAgent: 'build', allowedMcpsJson: '[]', allowedSkillsJson: '[]', modelProvider: providerId, modelId }) });
    restrictedProfileId = profile.id;
    restricted = await read('/agent-sessions', { method: 'POST', body: JSON.stringify({ profileId: restrictedProfileId, cwd: sandbox, name: `${marker} restricted target` }) });
  }, 180_000);
  afterAll(async () => {
    for (const session of [caller, target, restricted]) if (session) await api(`/agent-sessions/${session.id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    if (restrictedProfileId) await api(`/agent-configs/${restrictedProfileId}`, { method: 'DELETE' }).catch(() => undefined);
    if (fixtureProfileId) await api(`/agent-configs/${fixtureProfileId}`, { method: 'DELETE' }).catch(() => undefined);
    if (provider) await new Promise<void>((resolve) => provider.close(() => resolve()));
  });

  it('delivers signed MCP attribution; forged HTTP stays http; removed target records immutable rejection', async () => {
    const before = await client.session.messages({ path: { id: caller.sdkSessionId } });
    const sent = await client.session.prompt({ path: { id: caller.sdkSessionId }, body: {
      model: { providerID: providerId, modelID: modelId }, parts: [{ type: 'text', text: 'Deliver scripted MCP prompt' }],
    } });
    expect(sent.error).toBeUndefined();
    const after = await client.session.messages({ path: { id: caller.sdkSessionId } });
    const tools = (after.data ?? []).filter((message) => !(before.data ?? []).some((old) => old.info.id === message.info.id))
      .flatMap((message) => message.parts).filter((part) => part.type === 'tool') as any[];
    expect(tools.some((part) => part.state?.status === 'completed')).toBe(true);
    const log = await read(`/agent-sessions/${target.id}/prompt-log`);
    expect(log.injections[0]).toMatchObject({ source: 'mcp', prompt: marker, callerSessionId: caller.id, callerSdkSessionId: caller.sdkSessionId, accepted: true });
    const delivered = await client.session.messages({ path: { id: target.sdkSessionId } });
    expect(JSON.stringify(delivered.data)).toContain(marker);

    const originalRestricted = await read(`/agent-sessions/${restricted.id}`);
    expect(originalRestricted.session.profileId).toBe(restrictedProfileId);
    const restrictedLog = () => read(`/agent-sessions/${restricted.id}/prompt-log`);
    const beforeOverride = await restrictedLog();
    for (const agent of ['build', null]) {
      const refusedOverride = await api(`/agent-sessions/${restricted.id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: marker, agent }) });
      expect(refusedOverride.status).toBe(400);
    }
    expect((await restrictedLog()).injections).toEqual(beforeOverride.injections);
    expect((await read(`/agent-sessions/${restricted.id}`)).session.profileId).toBe(restrictedProfileId);
    const safe = await api(`/agent-sessions/${restricted.id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: `${marker} restricted safe` }) });
    expect(safe.status, await safe.clone().text()).toBe(202);
    expect((await restrictedLog()).injections[0]).toMatchObject({ prompt: `${marker} restricted safe`, accepted: true });
    expect((await read(`/agent-sessions/${restricted.id}`)).session.profileId).toBe(restrictedProfileId);
    expect((await read(`/agent-sessions/${restricted.id}`)).session.sdkSessionId).toBe(restricted.sdkSessionId);

    const forged = await api(`/agent-sessions/${target.id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: `${marker} forged`, source: 'mcp', callerSdkSessionId: caller.sdkSessionId }) });
    expect(forged.status).toBe(202);
    expect((await read(`/agent-sessions/${target.id}/prompt-log`)).injections[0]).toMatchObject({ source: 'http', callerSessionId: null, callerSdkSessionId: null });

    const removed = await client.session.delete({ path: { id: target.sdkSessionId } });
    expect(removed.error).toBeUndefined();
    const refused = await api(`/agent-sessions/${target.id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: `${marker} deleted engine` }) });
    expect(refused.status).toBe(502);
    const rejection = (await read(`/agent-sessions/${target.id}/prompt-log`)).injections[0];
    expect(rejection).toMatchObject({ prompt: `${marker} deleted engine`, accepted: false, source: 'http' });
    const db = new Database(`${sandbox}/rhythm.db`, { readonly: true });
    try {
      expect(db.prepare('SELECT accepted FROM agent_prompt_injection_outcomes WHERE injection_id = ?').get(rejection.id)).toMatchObject({ accepted: 0 });
    } finally { db.close(); }
  }, 180_000);
});
