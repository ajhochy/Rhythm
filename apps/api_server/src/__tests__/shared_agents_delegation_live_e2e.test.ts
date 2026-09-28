/**
 * SA-LIVE-1 — live shared-agent delegation through the isolated sandbox.
 *
 * This spec is intentionally skipped unless RHYTHM_SHARED_AGENTS_LIVE=1. It
 * talks only to the operator-selected sandbox URL and refuses protected ports.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_SHARED_AGENTS_LIVE === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:7380';
const describeLive = LIVE ? describe : describe.skip;
const TOKEN = 'e02-synthetic-session-not-a-secret';
const REGISTRAR = 'sa-live-registrar-sentinel';
const CAPABILITY = 'sa-live-capability-sentinel';
const PROVIDER = new URL(process.env.RHYTHM_SHARED_AGENTS_PROVIDER_URL ?? 'http://127.0.0.1:7383');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
let providerServer: Server | null = null;

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

beforeAll(async () => {
  if (!LIVE) return;
  providerServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const chunk of [
      { id: 'sa-live', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] },
      { id: 'sa-live', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'SA-LIVE-RESULT' } }] },
      { id: 'sa-live', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => {
    providerServer!.once('error', reject);
    providerServer!.listen(Number(PROVIDER.port), PROVIDER.hostname, resolve);
  });
});

afterAll(async () => {
  if (!providerServer) return;
  providerServer.closeAllConnections();
  await new Promise<void>((resolve) => providerServer!.close(() => resolve()));
});

describeLive('SA-LIVE-1 isolated sandbox delegation', () => {
  it('runs grant -> report -> catalog -> projection -> Hermes dispatch -> real OpenCode child -> result', async () => {
    if (/:(4000|4001|4002|4096|4097|4098|4099|5173)(?:\/|$)/.test(BASE)) {
      throw new Error(`refusing protected port in RHYTHM_LIVE_URL: ${BASE}`);
    }
    const suffix = randomUUID().slice(0, 8);
    const manager = `sa-live-manager-${suffix}`;
    const target = `sa-live-target-${suffix}`;
    await json('/agent-configs', { method: 'POST', body: JSON.stringify({
      id: manager, label: 'SA live manager', isAgent: true, isManager: true,
      sessionSelectable: true, allowedDelegatesJson: JSON.stringify([target]),
      corePermissionsJson: JSON.stringify({ task: 'allow', rhythm_delegate_async: 'allow' }),
      modelProvider: 'openrouter', modelId: 'deterministic',
    }) });
    await json('/agent-configs', { method: 'POST', body: JSON.stringify({
      id: target, label: 'SA live target', isAgent: true, sessionSelectable: true,
      modelProvider: 'openrouter', modelId: 'deterministic', systemPrompt: 'Reply with exactly SA-LIVE-RESULT.',
    }) });

    const grantId = randomUUID();
    await json('/agent-bridge/v1/registrar/grants', {
      method: 'POST',
      headers: { 'X-Rhythm-Bridge-Registrar': REGISTRAR },
      body: JSON.stringify({
        grantId, capabilitySha256: sha256(CAPABILITY), sessionToken: TOKEN,
        hermesProfile: 'default', runtimeGeneration: randomUUID(),
        serverOrigin: BASE, authGeneration: 'sa-live',
        scopes: ['catalog.read', 'projection.issue', 'runtime.report', 'delegation.dispatch', 'delegation.execute'],
      }),
    });
    const bridgeHeaders = { 'X-Rhythm-Bridge-Capability': CAPABILITY };
    await json('/agent-bridge/v1/runtime/report', {
      method: 'POST', headers: bridgeHeaders,
      body: JSON.stringify({ hermesVersion: 'sa-live', pluginVersion: '1', providers: [{ id: 'openrouter', ready: true }], reasoningEfforts: [], terminalBackend: 'local' }),
    });
    const catalog = await json('/agent-bridge/v1/catalog', { headers: bridgeHeaders });
    expect(catalog.agents.map((agent: { id: string }) => agent.id)).toEqual(expect.arrayContaining([manager, target]));
    const projection = await json('/agent-bridge/v1/projections', {
      method: 'POST', headers: bridgeHeaders,
      body: JSON.stringify({ agentId: manager, expectedRevision: 0, launchKind: 'interactive', acceptVersions: [2], sessionKey: `sa-live:${suffix}`, cwd: null }),
    });
    const dispatched = await json('/agent-bridge/v1/delegations', {
      method: 'POST', headers: bridgeHeaders,
      body: JSON.stringify({ idempotencyKey: randomUUID(), parent: { projectionId: projection.projectionId, sessionKey: `sa-live:${suffix}` }, targetAgentId: target, prompt: 'Return the requested sentinel.' }),
    });

    // A cold sandbox may spend ~45 seconds creating the first git snapshot
    // before it opens the deterministic provider stream.
    const deadline = Date.now() + 90_000;
    let result: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const response = await fetch(`${BASE}/agent-bridge/v1/delegations/${dispatched.job.jobId}/result`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...bridgeHeaders },
        body: JSON.stringify({ parent: { projectionId: projection.projectionId, sessionKey: `sa-live:${suffix}` } }),
      });
      if (response.ok) { result = await response.json() as Record<string, unknown>; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(result).toMatchObject({ state: 'succeeded', untrusted: true, text: expect.stringContaining('SA-LIVE-RESULT') });
  }, 105_000);
});
