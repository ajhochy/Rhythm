// Issue #1580 slice S1 — web catalog contract, visibility gateway, immediate picker refresh.
//
// Node --test logic tests (no rendering). Rendered Playwright coverage for the picker UI runs
// parent-side per the lane notes; these tests exercise sessions.ts's HTTP mapping and the
// generation-fencing helper store.tsx uses for refreshModels().
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('1580:S1:1 gateway.models() selects only authorized+not-unavailable rows and flags unknown as needsVerification', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createLiveSessionsGateway } = await vite.ssrLoadModule('/src/gateway/sessions.ts');
    const catalogRows = [
      { provider: 'anthropic', modelId: 'claude-a', displayName: 'Claude A', authorized: true, available: true },
      { provider: 'openai', modelId: 'gpt-b', displayName: 'GPT B', authorized: true, available: 'unknown' },
      { provider: 'google', modelId: 'gemini-c', displayName: 'Gemini C', authorized: true, available: false },
      { provider: 'openrouter', modelId: 'model-d', displayName: 'Model D', authorized: false, available: true },
    ];
    const fetcher = async () => jsonResponse(catalogRows);
    const gateway = createLiveSessionsGateway('http://127.0.0.1:4098', 'disposable-contract-token', fetcher);

    const models = await gateway.models();

    assert.deepEqual(models.map((model) => `${model.providerId}/${model.modelId}`), ['anthropic/claude-a', 'openai/gpt-b']);
    assert.equal(models.find((model) => model.modelId === 'claude-a').needsVerification, false);
    assert.equal(models.find((model) => model.modelId === 'gpt-b').needsVerification, true);
  } finally {
    await vite.close();
  }
});

test('1580:S1:2 gateway.modelVisibility() GETs the visibility endpoint and setModelVisibility() PATCHes the exact contract', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createLiveSessionsGateway } = await vite.ssrLoadModule('/src/gateway/sessions.ts');
    const requests = [];
    const fetcher = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body });
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse([{ provider: 'anthropic', modelId: 'claude-a', visible: true }]);
      return jsonResponse({ updated: 1 });
    };
    const gateway = createLiveSessionsGateway('http://127.0.0.1:4098', 'disposable-contract-token', fetcher);

    const rows = await gateway.modelVisibility();
    assert.deepEqual(rows, [{ provider: 'anthropic', modelId: 'claude-a', visible: true }]);

    await gateway.setModelVisibility([{ provider: 'anthropic', modelId: 'claude-a', visible: false }]);
    const patch = requests.find((request) => request.method === 'PATCH');
    assert.ok(patch, 'expected a PATCH request');
    assert.equal(patch.url, 'http://127.0.0.1:4098/agent-models/visibility');
    assert.deepEqual(JSON.parse(patch.body), { updates: [{ provider: 'anthropic', modelId: 'claude-a', visible: false }] });
  } finally {
    await vite.close();
  }
});

test('1580:S2:1 gateway.modelCatalogFull() dedupes per-agent fan-out rows and preserves hidden/unavailable rows', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createLiveSessionsGateway } = await vite.ssrLoadModule('/src/gateway/sessions.ts');
    const fullCatalogRows = [
      // Same model fanned out to two agents (claude-code, codex) — must collapse to one row.
      { agent: 'claude-code', provider: 'anthropic', modelId: 'claude-a', displayName: 'Claude A', authorized: true, available: true, visible: true, availabilityReason: 'available' },
      { agent: 'codex', provider: 'anthropic', modelId: 'claude-a', displayName: 'Claude A', authorized: true, available: true, visible: true, availabilityReason: 'available' },
      // Hidden and unavailable rows the picker-facing catalog would drop — curation must keep them.
      { agent: 'opencode', provider: 'openrouter', modelId: 'hidden-model', displayName: 'Hidden Model', authorized: true, available: true, visible: false, availabilityReason: 'hidden' },
      { agent: 'opencode', provider: 'google', modelId: 'gemini-c', displayName: 'Gemini C', authorized: false, available: false, visible: true, availabilityReason: 'not_connected', connectUrl: '/connect/google' },
    ];
    const fetcher = async () => jsonResponse(fullCatalogRows);
    const gateway = createLiveSessionsGateway('http://127.0.0.1:4098', 'disposable-contract-token', fetcher);

    const catalog = await gateway.modelCatalogFull();

    assert.deepEqual(catalog.map((row) => `${row.provider}/${row.modelId}`), ['anthropic/claude-a', 'openrouter/hidden-model', 'google/gemini-c']);
    assert.equal(catalog.find((row) => row.modelId === 'hidden-model').visible, false);
    const unavailable = catalog.find((row) => row.modelId === 'gemini-c');
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.connectUrl, '/connect/google');
  } finally {
    await vite.close();
  }
});

test('1580:S1:3 createGenerationGuard discards a token superseded by a newer request', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createGenerationGuard } = await vite.ssrLoadModule('/src/gateway/sessions.ts');
    const guard = createGenerationGuard();

    // Simulates: refreshModels() begins a fetch (first), then a gateway/account switch begins
    // a second fetch (second) before the first resolves. The first's token must read as stale
    // so its response is never painted, even though it may resolve after the second begins.
    const first = guard.begin();
    const second = guard.begin();

    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
  } finally {
    await vite.close();
  }
});
