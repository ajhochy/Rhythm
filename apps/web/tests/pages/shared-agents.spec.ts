import { expect, test } from '@playwright/test';
import { fulfillJson } from '../post-m1-phase-5-live-fixtures';

const canonical = (id: string) => ({
  id, label: `Agent ${id}`, icon: 'AG', enabled: true, isAgent: true, isManager: false,
  systemPrompt: 'Be precise.', allowedMcpsJson: null, allowedSkillsJson: null,
  corePermissionsJson: null, allowedDelegatesJson: null, presetId: null, sortOrder: 0,
  createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', revision: 4,
  modelProvider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', ocAgent: 'build',
  sessionSelectable: true, schedulable: false, schedulableOverride: null, modelTierHint: null,
  defaultAnthropicAccountId: null, imageGenerationEnabled: false, reasoningEffort: null,
  locked: false, disabledReason: null, lockedAt: null, lockedBy: null, autoApproveActions: false,
});

const sharedAgent = (id: string) => ({
  schema: 'rhythm.shared-agent.v1', id, revision: 4, canonical: canonical(id),
  runtimes: {
    opencode: { runtime: 'opencode', readiness: 'supported', reasons: [], launchKinds: { interactive: true, delegated: true }, fields: {} },
    hermes: { runtime: 'hermes', readiness: 'unavailable', reasons: [{ code: 'runtime_not_connected', message: 'Hermes is not connected.' }], launchKinds: { interactive: false, delegated: false }, fields: {} },
  },
});

test('UI-WEB-1: shared-agent adapter uses the frozen routes and maps 409/401 gateway errors', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown; authorization: string | null }> = [];
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const raw = route.request();
    const url = new URL(raw.url());
    if (raw.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': raw.headers().origin ?? '*',
          'access-control-allow-methods': 'GET,PATCH,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type',
        },
      });
      return;
    }
    const body = raw.postData() ? raw.postDataJSON() : undefined;
    calls.push({ method: raw.method(), path: url.pathname, body, authorization: raw.headers().authorization ?? null });
    if (url.pathname === '/shared-agents/v1/catalog' && raw.method() === 'GET') {
      await fulfillJson(route, 200, { schema: 'rhythm.shared-agent-catalog.v1', generatedAt: '2026-09-24T00:00:00.000Z', scope: '0123456789abcdef', agents: [sharedAgent('alpha')] });
    } else if (url.pathname === '/shared-agents/v1/catalog/alpha' && raw.method() === 'GET') {
      await fulfillJson(route, 200, sharedAgent('alpha'));
    } else if (url.pathname === '/agent-configs/alpha' && raw.method() === 'PATCH') {
      const label = (body as { label?: string } | undefined)?.label;
      if (label === 'Conflict edit') await fulfillJson(route, 409, { error: { code: 'revision_conflict', message: 'stale' }, currentRevision: 5 });
      else if (label === 'Forbidden edit') await fulfillJson(route, 401, { error: { code: 'UNAUTHORIZED', message: 'denied' } });
      else await fulfillJson(route, 200, canonical('alpha'));
    } else {
      await fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
    }
  });

  // Use the existing Vite-served test page so the production app CSP does not block the
  // intercepted 4098 adapter boundary before Playwright can fulfill it.
  await page.goto('/tests/electron-e40-harness.html');
  const observed = await page.evaluate(async () => {
    const { createLiveSharedAgentsPort } = await import('/src/gateway/shared-agents.ts');
    const port = createLiveSharedAgentsPort(
      'http://127.0.0.1:4098',
      'live-test-token',
      { create: async () => { throw new Error('launch is outside UI-WEB-1'); } } as never,
    );
    const inspect = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return null;
      } catch (error) {
        return {
          constructor: error instanceof Error ? error.constructor.name : typeof error,
          kind: error && typeof error === 'object' && 'kind' in error ? String(error.kind) : null,
        };
      }
    };
    const catalog = await port.list();
    const item = await port.get('alpha');
    const saved = await port.save('alpha', 4, { label: 'Renamed' });
    const conflict = await inspect(() => port.save('alpha', 4, { label: 'Conflict edit' }));
    const forbidden = await inspect(() => port.save('alpha', 4, { label: 'Forbidden edit' }));
    return { catalogSchema: catalog.schema, itemId: item.id, savedId: saved.id, conflict, forbidden };
  });

  expect(observed).toEqual({
    catalogSchema: 'rhythm.shared-agent-catalog.v1',
    itemId: 'alpha',
    savedId: 'alpha',
    conflict: { constructor: 'RhythmGatewayError', kind: 'conflict' },
    forbidden: { constructor: 'RhythmGatewayError', kind: 'forbidden' },
  });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    'GET /shared-agents/v1/catalog',
    'GET /shared-agents/v1/catalog/alpha',
    'PATCH /agent-configs/alpha',
    'GET /shared-agents/v1/catalog/alpha',
    'PATCH /agent-configs/alpha',
    'PATCH /agent-configs/alpha',
  ]);
  expect(calls[2]?.body).toEqual({ expectedRevision: 4, label: 'Renamed' });
  expect(calls[4]?.body).toEqual({ expectedRevision: 4, label: 'Conflict edit' });
  expect(calls[5]?.body).toEqual({ expectedRevision: 4, label: 'Forbidden edit' });
  expect(calls.filter((call) => call.path.startsWith('/shared-agents') || call.path.startsWith('/agent-configs')).every((call) => call.authorization === 'Bearer live-test-token')).toBe(true);
});

test('Settings links to the shared-agent editor without embedding a duplicate editor', async ({ page }) => {
  await page.goto('/tests/electron-e40-harness.html#/settings');
  await page.getByRole('option', { name: 'Shared Agents', exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/tools/shared-agents');
});
