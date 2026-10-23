// Source behaviors and exact titles: docs/ai/contracts/web-parity-20261022.json.
// Ports keep UI interactions plus authoritative API/SQLite/engine readbacks.
import { createRequire } from 'node:module';
import { test, expect, ObservedApi, assertResponse, responseFor, reloadJsonFor } from './parity-fixture';
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type WritableDb = { prepare(sql: string): { run(...args: unknown[]): { changes: number } }; close(): void };
type Retention = { mode: string; source: string; setting: string | null };
type Settings = { tokenLimit: number; candidateCount: 2 | 3; lookbackDays: 7 | 14 };
type EvaluationList = { jobs: unknown[] };
type QualityRow = { agentKind: string; agentLabel: string; totalRuns: number; completedRuns: number; notEnoughData: boolean };
const statusLabel: Record<string, string> = { connected: 'Connected', needs_auth: 'Needs authorization', failed: 'Failed', disabled: 'Disabled', disconnected: 'Disconnected', needs_client_registration: 'Needs client registration', configured: 'Configured' };
test('[web-parity-046] [AI settings] selected MCP inspector agrees with the real server status and tools', async ({ page, parity }) => {
  // Catches stale/misleading settings UI when real server status or advertised tools change.
  await page.goto('/#/tools/agent-tools');
  const pending = responseFor(page, 'GET', '/opencode/mcp');
  await page.goto('/#/tools/agent-settings?settingsSection=mcp');
  const response = await pending;
  await assertResponse(response, 'GET', '/opencode/mcp', 200);
  ObservedApi.from(response, parity);
  const servers = await response.json() as Array<{ name: string; status: string; tools: string[] }>;
  expect(servers.length).toBeGreaterThan(0);
  const list = page.getByTestId('settings-column-items');
  await expect(list).toBeVisible();
  const selected = list.getByRole('option', { selected: true });
  await expect(selected).toHaveCount(1);
  const selectedId = await selected.getAttribute('data-item-id');
  expect(selectedId).toMatch(/^mcp:/);
  const name = selectedId!.slice('mcp:'.length);
  const server = servers.find(row => row.name === name);
  expect(server).toBeDefined();
  const card = page.getByTestId(`agent-settings-mcp-${name}`);
  await expect(card).toBeVisible();
  expect(statusLabel[server!.status]).toBeDefined();
  await expect(page.getByTestId(`agent-settings-mcp-status-${name}`)).toHaveText(statusLabel[server!.status]);
  await expect(card).toContainText(`${server!.tools.length} tools`);
  for (const row of servers) await expect(list.getByTestId(`agent-settings-mcp-row-${row.name}`)).toHaveCount(1);
});

test('[web-parity-047] [AI settings] model curation reflects real visibility and search clears back to catalog rows', async ({ page, parity }) => {
  // Catches visibility drift from the live catalog and broken search recovery without mutating it.
  await page.goto('/#/tools/agent-settings?settingsSection=models');
  const { response, body: catalog } = await reloadJsonFor<Array<{ provider: string; modelId: string; visible: boolean; displayName: string }>>(page, '/agents/models/catalog/full', parity.origin);
  await assertResponse(response, 'GET', '/agents/models/catalog/full', 200);
  ObservedApi.from(response, parity);
  expect(catalog.length).toBeGreaterThan(0);
  const first = catalog.find(row => row.provider && row.modelId);
  expect(first).toBeDefined();
  const panel = page.getByTestId('model-curation-panel');
  await expect(panel).toBeVisible();
  const row = panel.getByTestId(`model-curation-model-${first!.provider}-${first!.modelId}`);
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveJSProperty('checked', first!.visible);
  const search = page.getByTestId('model-curation-search');
  await search.fill('rhythm-no-such-model-9f16a');
  await expect(panel.getByText('No matching models', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(row).toBeVisible();
  await expect(row.getByRole('switch')).toHaveJSProperty('checked', first!.visible);
});

test('[web-parity-048] [AI MCP] private inspector advertises the bundled tools', async ({ page, parity }) => {
  await page.goto('/#/tools/agent-settings?settingsSection=mcp');
  const { response, body: servers } = await reloadJsonFor<Array<{ name: string; status: string; tools: string[] }>>(page, '/opencode/mcp', parity.origin);
  await assertResponse(response, 'GET', '/opencode/mcp', 200);
  const api = ObservedApi.from(response, parity);
  const server = servers.find(row => row.name === 'rhythm');
  expect(server).toMatchObject({ name: 'rhythm', status: 'connected' });
  expect(server!.tools.length).toBeGreaterThan(0);
  expect(server!.tools).toContain('rhythm_ping');
  await page.getByTestId('agent-settings-mcp-row-rhythm').click();
  await expect(page.getByTestId('settings-column-items').getByRole('option', { selected: true })).toHaveAttribute('data-item-id', 'mcp:rhythm');
  await expect(page.getByTestId('agent-settings-mcp-status-rhythm')).toHaveText('Connected');
  await expect(page.getByTestId('agent-settings-mcp-rhythm')).toContainText(`${server!.tools.length} tools`);
  expect((await api.json<typeof servers>('/opencode/mcp')).find(row => row.name === 'rhythm')).toEqual(server);
});

test('[web-parity-049] [AI quality] changing time window changes the API rollup and displayed evidence', async ({ page, parity }) => {
  // Catches a cosmetic window selector that continues showing cached 30-day totals.
  await page.goto('/#/tools/report-card');
  const initial = await reloadJsonFor<{ windowDays: number; agents: QualityRow[] }>(page, '/agents/run-quality', parity.origin);
  await assertResponse(initial.response, 'GET', '/agents/run-quality', 200);
  expect(initial.body.windowDays).toBe(30);
  const pending = responseFor(page, 'GET', '/agents/run-quality');
  await page.getByTestId('report-window').selectOption('7');
  const response = await pending;
  expect(new URL(response.url()).searchParams.get('windowDays')).toBe('7');
  await assertResponse(response, 'GET', '/agents/run-quality', 200);
  const api = ObservedApi.from(response, parity);
  const body = await response.json();
  const canonical = await api.json<{ windowDays: number; agents: QualityRow[] }>('/agents/run-quality?windowDays=7');
  expect(canonical.windowDays).toBe(body.windowDays);
  expect(canonical.agents).toEqual(body.agents);
  expect(body.windowDays).toBe(7);
  const rows = body.agents as QualityRow[];
  expect(Array.isArray(rows)).toBe(true);
  await expect(page.getByTestId('tool-page-report-card')).toContainText('last 7 days');
  if (rows.length) {
    const row = rows.find(item => String(item.agentKind).length > 0) ?? rows[0];
    await page.getByTestId(`report-agent-${row.agentKind}`).click();
    await expect(page.getByTestId('list-inspector-detail')).toContainText(`${row.totalRuns} runs`);
    await expect(page.getByTestId('list-inspector-detail')).toContainText(`${row.completedRuns} completed`);
    if (row.notEnoughData) await expect(page.getByTestId('list-inspector-detail')).toContainText('Not enough data');
  } else await expect(page.getByRole('heading', { name: 'No scored runs yet', exact: true })).toBeVisible();
});

test('[web-parity-050] [AI quality] empty agent kind keeps its authoritative Unknown agent identity and exact counts', async ({ page, parity }) => {
  const name = `${parity.prefix} agentless`;
  const created = await parity.api.fetch('/agent-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, profileId: null, cwd: parity.cwd, isolateWorktree: false, permissionMode: 'default' }) });
  expect(created.status).toBe(201);
  const session = await created.json() as { id: string; sdkSessionId: string; cwd: string };
  expect(session).toMatchObject({ id: expect.any(String), name, profileId: null, agentKind: '', ownerUserId: 1, cwd: parity.cwd, sdkSessionId: expect.any(String) });
  parity.deferCleanup('agentless quality session API DB engine deletion', async () => {
    expect(parity.rows('SELECT name,cwd,owner_user_id FROM agent_sessions WHERE id=?', session.id)).toEqual([{ name, cwd: parity.cwd, owner_user_id: 1 }]);
    expect((await parity.api.fetch(`/agent-sessions/${session.id}/hard`, { method: 'DELETE' })).status).toBe(204);
    expect((await parity.api.fetch(`/agent-sessions/${session.id}`)).status).toBe(404);
    expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', session.id)).toEqual([]);
    expect((await parity.engineFetch(`/session/${encodeURIComponent(session.sdkSessionId)}`)).status).toBe(404);
  });
  expect(parity.rows('SELECT id,name,agent_kind,profile_id,owner_user_id,cwd,sdk_session_id FROM agent_sessions WHERE id=?', session.id)).toEqual([{ id: session.id, name, agent_kind: '', profile_id: null, owner_user_id: 1, cwd: parity.cwd, sdk_session_id: session.sdkSessionId }]);
  const engine = await parity.engineFetch(`/session/${encodeURIComponent(session.sdkSessionId)}`);
  expect(engine.status).toBe(200);
  expect(await engine.json()).toMatchObject({ id: session.sdkSessionId, directory: parity.cwd, title: name });
  await page.goto('/#/tools/report-card');
  const { response, body } = await reloadJsonFor<{ windowDays: number; agents: QualityRow[] }>(page, '/agents/run-quality', parity.origin);
  await assertResponse(response, 'GET', '/agents/run-quality', 200);
  expect(body.windowDays).toBe(30);
  const row = body.agents.find(item => typeof item.agentKind === 'string' && item.agentKind.trim() === '');
  expect(row, 'real rollup must retain the empty-kind identity').toBeDefined();
  expect(row!.agentLabel).toBe('Unknown agent');
  expect(row!.totalRuns).toBeGreaterThanOrEqual(1);
  const rowView = page.getByTestId(`report-agent-${row!.agentKind}`);
  await expect(rowView).toBeVisible();
  for (const text of ['Unknown agent', `${row!.totalRuns} runs`, `${row!.completedRuns} completed`]) await expect(rowView).toContainText(text);
  await rowView.click();
  const inspector = page.getByTestId('list-inspector-detail');
  await expect(inspector).toContainText(`${row!.totalRuns} runs`);
  await expect(inspector).toContainText(`${row!.completedRuns} completed`);
  if (row!.notEnoughData) await expect(inspector).toContainText('Not enough data to score this agent yet.');
  expect((await ObservedApi.from(response, parity).json<{ agents: QualityRow[] }>('/agents/run-quality?windowDays=30')).agents).toEqual(body.agents);
});

test('[web-parity-051] [AI settings] private retention On cancel writes nothing and Off persists until owned restore', async ({ page, parity }) => {
  const beforeRows = parity.rows("SELECT content,updated_at FROM org_settings WHERE id='session_retention_mode'");
  expect(beforeRows, 'UNVERIFIED: this private fixture already has a retention override').toEqual([]);
  const writes: Array<string | null> = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/system/session-retention')
      writes.push((request.postDataJSON() as { mode?: string } | null)?.mode ?? null);
  };
  page.on('request', onRequest);
  let offAttempted = false;
  let api: ObservedApi | undefined;
  try {
    // Enter through a neutral route so the Settings GET belongs to one live document.
    await page.goto('/#/tools/agent-tools');
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    const initial = responseFor(page, 'GET', '/system/session-retention');
    await page.goto('/#/settings?settingsSection=session-retention');
    const response = await initial;
    await assertResponse(response, 'GET', '/system/session-retention', 200);
    const initialState = await response.json();
    api = ObservedApi.from(response, parity);
    expect(initialState).toMatchObject({ mode: 'dry-run', source: 'default', setting: null });
    const panel = page.getByTestId('session-retention-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('session-retention-env')).toHaveCount(0);
    await expect(panel.locator('input[name="session-retention"]:checked')).toHaveValue('dry-run');

    await panel.locator('input[name="session-retention"][value="on"]').click();
    const dialog = panel.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes, 'cancel must not save an activating mode').toEqual([]);
    expect(await api.json<Retention>('/system/session-retention')).toMatchObject({ mode: 'dry-run', source: 'default', setting: null });

    const saved = responseFor(page, 'PUT', '/system/session-retention');
    offAttempted = true;
    await panel.locator('input[name="session-retention"][value="off"]').click();
    const saveResponse = await saved;
    await assertResponse(saveResponse, 'PUT', '/system/session-retention', 200);
    expect(saveResponse.request().postDataJSON()).toMatchObject({ mode: 'off' });
    expect(writes).toEqual(['off']);
    expect(await api.json<Retention>('/system/session-retention')).toMatchObject({ mode: 'off', source: 'setting', setting: 'off' });
    expect(parity.rows("SELECT content FROM org_settings WHERE id='session_retention_mode'")).toEqual([{ content: 'off' }]);
    const reloaded = responseFor(page, 'GET', '/system/session-retention');
    await page.reload();
    await assertResponse(await reloaded, 'GET', '/system/session-retention', 200);
    await expect(page.getByTestId('session-retention-panel').locator('input[name="session-retention"]:checked')).toHaveValue('off');
  } finally {
    page.off('request', onRequest);
    if (offAttempted) {
      const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: true }) => WritableDb;
      const db = new Database(parity.dbPath, { fileMustExist: true });
      try {
        // This fixture began at the default with no row. Remove only our Off write.
        expect(db.prepare("DELETE FROM org_settings WHERE id='session_retention_mode' AND content='off'").run().changes).toBe(1);
      } finally { db.close(); }
      expect(parity.rows("SELECT content FROM org_settings WHERE id='session_retention_mode'")).toEqual([]);
      if (api) expect(await api.json<Retention>('/system/session-retention'))
        .toMatchObject({ mode: 'dry-run', source: 'default', setting: null });
    }
  }
});

test('[web-parity-116] [AI Org Reviewer] private evaluation settings persist and empty activity is honest', async ({ page, parity }) => {
  expect(process.env.RHYTHM_FEATURE_MODEL, 'settings contract must not spend a model loan').not.toBe('1');
  const api = parity.api;
  expect(await api.json('/web/bootstrap')).toMatchObject({ mode: 'web', owner: { id: 1 } });
  const before = await api.json<Settings>('/agent-org-proposals/evaluations/settings');
  // Fresh fixture: catches a default too small for a routed target's full cycle.
  expect(before, 'fresh install uses the shipped defaults').toEqual({ tokenLimit: 1_500_000, candidateCount: 2, lookbackDays: 7 });
  expect(await api.json<EvaluationList>('/agent-org-proposals/evaluations')).toEqual({ jobs: [] });

  const changed: Settings = {
    tokenLimit: before.tokenLimit === 100_000 ? 110_000 : 100_000,
    candidateCount: before.candidateCount === 2 ? 3 : 2,
    lookbackDays: before.lookbackDays,
  };
  let writeAttempted = false;
  try {
    const loaded = responseFor(page, 'GET', '/agent-org-proposals/evaluations/settings');
    await page.goto('/#/tools/review');
    const loadedResponse = await loaded;
    expect(loadedResponse.status()).toBe(200);
    ObservedApi.from(loadedResponse, parity);
    const settings = page.getByRole('region', { name: 'Evaluation settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel('Whole-run token limit')).toHaveValue(String(before.tokenLimit));
    await expect(settings.getByLabel('Candidates per review')).toHaveValue(String(before.candidateCount));
    await settings.getByLabel('Whole-run token limit').fill(String(changed.tokenLimit));
    await settings.getByLabel('Candidates per review').selectOption(String(changed.candidateCount));
    const saved = responseFor(page, 'PATCH', '/agent-org-proposals/evaluations/settings');
    writeAttempted = true;
    await settings.getByRole('button', { name: 'Save evaluation settings' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual(changed);
    expect(await api.json<Settings>('/agent-org-proposals/evaluations/settings')).toEqual(changed);
    await page.reload();
    const reloaded = page.getByRole('region', { name: 'Evaluation settings' });
    await expect(reloaded.getByLabel('Whole-run token limit')).toHaveValue(String(changed.tokenLimit));
    await expect(reloaded.getByLabel('Candidates per review')).toHaveValue(String(changed.candidateCount));

    const activity = page.getByRole('region', { name: 'Evaluation activity' });
    await expect(activity).toBeVisible();
    await expect(activity).toContainText('No evaluations yet');
    await expect(activity.getByRole('button', { name: /^Approve$/ })).toHaveCount(0);
    expect(await api.json<EvaluationList>('/agent-org-proposals/evaluations')).toEqual({ jobs: [] });
  } finally {
    if (writeAttempted) {
      const restored = await api.fetch('/agent-org-proposals/evaluations/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(before),
      });
      expect(restored.status, 'restore exact disposable settings preimage').toBe(200);
      expect(await api.json<Settings>('/agent-org-proposals/evaluations/settings')).toEqual(before);
    }
  }
});
