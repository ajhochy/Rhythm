// Browser ports of the source titles in docs/ai/contracts/web-parity-20261022.json.
// Existing packaged recon supplies behavior; the shared fixture validates the isolated web sandbox.
import { createHash, randomUUID } from 'node:crypto';
import { test, expect, ObservedApi, assertResponse, responseFor } from './parity-fixture';
type Profile = { id: string; label: string; revision: number; updatedAt: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function profileIdentityDigest(rows: Profile[]) {
  return digest(rows.map(row => [row.id, row.label, row.updatedAt ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
test('[web-parity-041] [AI profiles] discarding a new smoke draft leaves the saved profile catalog unchanged', async ({ page, parity }) => {
  const requests: Array<{ method: string; path: string }> = [];
  let ownedDraftLabel: string | null = null;
  const onRequest = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/agent-configs')) requests.push({ method: request.method(), path });
  };
  page.on('request', onRequest);
  try {
    await page.goto('/#/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    await expect(page.getByTestId('profile-label')).toBeVisible();
    // Recon showed the shared worker may have warmed the route already. Observe a fresh GET on reload.
    const initialRead = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const initialResponse = await initialRead;
    await assertResponse(initialResponse, 'GET', '/agent-configs', 200);
    const initialRows = await initialResponse.json() as Profile[];
    expect(initialRows.length).toBeGreaterThan(0);
    const api = ObservedApi.from(initialResponse, parity);
    const savedBefore = await api.json<Profile[]>('/agent-configs');
    const beforeDigest = profileIdentityDigest(savedBefore);

    await page.getByTestId('profiles-workspace').waitFor({ state: 'visible' });
    await page.getByTestId('profile-create').click();
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveCount(1);
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue('New profile');
    ownedDraftLabel = `[smoke] profile draft ${randomUUID().slice(0, 8)}`;
    await page.getByTestId('profile-label').fill(ownedDraftLabel);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    await expect(page.getByTestId('profile-save')).toBeEnabled();

    await page.getByTestId('profiles-back').click();
    await expect(page.getByTestId('profile-unsaved-dialog')).toBeVisible();
    await page.getByTestId('profile-discard').click();
    await expect(page).toHaveURL(/#\/agents(?:\?|$)/);
    await expect(page.getByTestId('profiles-workspace')).toHaveCount(0);
    await expect(page.getByTestId('rhythm-primary-entry')).toBeVisible();

    // The SPA back transition must unmount the dirty editor before a full
    // reload. Re-entering Profiles also proves the draft did not survive.
    await page.goto('/#/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    await expect(page.getByTestId('profile-save-status')).toHaveText('No unsaved changes');
    await expect(page.getByTestId('profile-label')).not.toHaveValue(ownedDraftLabel);
    await expect(page.getByTestId('profile-unsaved-dialog')).toHaveCount(0);
    // Force a fresh catalog read after dismissal; a hash-only route change can reuse cached data.
    const afterRead = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const afterResponse = await afterRead;
    await assertResponse(afterResponse, 'GET', '/agent-configs', 200);
    const savedAfter = await api.json<Profile[]>('/agent-configs');
    expect(savedAfter.length).toBe(savedBefore.length);
    expect(profileIdentityDigest(savedAfter)).toBe(beforeDigest);
    expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  } finally {
    // Recover only the exact unsaved draft created above; never navigate away from a foreign draft.
    if (ownedDraftLabel && new URL(page.url()).hash.startsWith('#/profiles')) {
      const currentLabel = await page.getByTestId('profile-label').inputValue().catch(() => '');
      if (currentLabel === ownedDraftLabel) {
        const discard = page.getByTestId('profile-discard');
        if (await discard.isVisible().catch(() => false)) await discard.click().catch(() => {});
        else {
          await page.getByTestId('profiles-back').click().catch(() => {});
          if (await discard.isVisible().catch(() => false)) await discard.click().catch(() => {});
        }
      }
    }
    page.off('request', onRequest);
  }
});

test('[web-parity-042] [AI profiles] private existing-profile dirty switch keeps or discards without saving', async ({ page, parity }) => {
  const api = parity.api;
  const created: Profile[] = [];
  const nonceSeed = randomUUID();
  const labels = [`[smoke] dirty switch first ${nonceSeed}`, `[smoke] dirty switch second ${nonceSeed}`];
  parity.deferCleanup('exact disposable dirty-switch profiles', async () => {
    const rows = await api.json<Profile[]>('/agent-configs');
    for (const row of rows.filter(row => labels.includes(row.label))) {
      expect(row.id).toMatch(/^smoke-/);
      expect((await api.fetch(`/agent-configs/${encodeURIComponent(row.id)}`, { method: 'DELETE' })).status).toBe(204);
      expect(parity.rows('SELECT id FROM agent_configs WHERE id=?', row.id)).toEqual([]);
    }
    expect((await api.json<Profile[]>('/agent-configs')).filter(row => labels.includes(row.label))).toEqual([]);
  });
  for (const label of labels) {
    const response = await api.fetch('/agent-configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{"*":"deny"}' }) });
    expect(response.status).toBe(201);
    const row = await response.json() as Profile;
    expect(row).toMatchObject({ label, revision: 0 });
    created.push(row);
  }
  const [codingId, secretaryId] = created.map(row => row.id);
  const nonce = randomUUID();
  const draft = `[smoke] unsaved coding profile ${nonce}`;
  const writes: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    const route = new URL(request.url()).pathname;
    if (route.startsWith('/agent-configs') && request.method() !== 'GET') writes.push(`${request.method()} ${route}`);
  };
  const sqlRows = () => parity.rows(
    'SELECT id,label,revision,model_provider,model_id FROM agent_configs WHERE id IN (?,?) ORDER BY id',
    codingId, secretaryId,
  );
  page.on('request', onRequest);
  try {
    await page.goto('/#/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    const initialWait = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const initialResponse = await initialWait;
    await assertResponse(initialResponse, 'GET', '/agent-configs', 200);
    ObservedApi.from(initialResponse, parity);
    const before = await api.json<Profile[]>('/agent-configs');
    const coding = before.find(row => row.id === codingId);
    const secretary = before.find(row => row.id === secretaryId);
    expect(coding?.label, 'only a fixture-owned smoke profile may be drafted').toMatch(/^\[smoke\] /);
    expect(secretary).toBeDefined();
    const beforeCatalog = digest(before);
    const beforeSql = digest(sqlRows());

    const codingRow = page.getByTestId(`profile-${codingId}`);
    const secretaryRow = page.getByTestId(`profile-${secretaryId}`);
    const label = page.getByTestId('profile-label');
    const dialog = page.getByTestId('profile-unsaved-dialog');
    await codingRow.click();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    const originalLabel = await label.inputValue();
    expect(originalLabel).toBe(coding!.label);
    await label.fill(draft);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    await secretaryRow.click();
    await expect(dialog).toBeVisible();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(draft);
    expect(writes).toEqual([]);

    await page.getByTestId('profile-keep-editing').click();
    await expect(dialog).toBeHidden();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(draft);
    expect(writes).toEqual([]);

    await secretaryRow.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('profile-discard').click();
    await expect(dialog).toBeHidden();
    await expect(secretaryRow).toHaveAttribute('aria-selected', 'true');
    await expect(codingRow).toHaveAttribute('aria-selected', 'false');
    await expect(label).not.toHaveValue(draft);
    await codingRow.click();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(originalLabel);

    const afterWait = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    await assertResponse(await afterWait, 'GET', '/agent-configs', 200);
    expect(digest(await api.json<Profile[]>('/agent-configs'))).toBe(beforeCatalog);
    expect(digest(sqlRows())).toBe(beforeSql);
    expect(writes).toEqual([]);
    // Reload may select a different profile. Explicitly reselect the original.
    await page.getByTestId(`profile-${codingId}`).click();
    await expect(page.getByTestId(`profile-${codingId}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue(originalLabel);
  } finally {
    const dialog = page.getByTestId('profile-unsaved-dialog');
    if (await dialog.isVisible().catch(() => false)) await page.getByTestId('profile-discard').click();
    const label = page.getByTestId('profile-label');
    if (await label.inputValue().catch(() => '') === draft) await page.getByTestId('profile-cancel').click();
    page.off('request', onRequest);
    expect(writes, 'dirty-switch probe must never save a profile').toEqual([]);
  }
});

test('[web-parity-043] [AI profiles] owned draft survives a failed save, then revisioned retry persists across reload', async ({ page, parity }) => {
  const label = `[smoke] profile save ${randomUUID().slice(0, 12)}`;
  const revised = `${label} revised`;
  const owned = new Set<string>();
  let api: ObservedApi | undefined;
  try {
    const initial = responseFor(page, 'GET', '/agent-configs');
    await page.goto('/#/profiles');
    await page.reload();
    const listResponse = await initial;
    await assertResponse(listResponse, 'GET', '/agent-configs', 200);
    api = ObservedApi.from(listResponse, parity);
    await expect(page.getByTestId('profile-create')).toBeVisible();

    await page.getByTestId('profile-create').click();
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveCount(1);
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue('New profile');
    await page.getByTestId('profile-label').fill(label);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    const created = responseFor(page, 'POST', '/agent-configs');
    await page.getByTestId('profile-save').click();
    const createResponse = await created;
    await assertResponse(createResponse, 'POST', '/agent-configs', 201);
    expect(createResponse.request().postDataJSON()).toMatchObject({ label });
    const profile = await createResponse.json() as Profile;
    expect(profile).toMatchObject({ id: expect.any(String), label, revision: 0, updatedAt: expect.any(String) });
    owned.add(profile.id);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');

    await page.getByTestId('profile-label').fill(revised);
    const fail = async (route: import('@playwright/test').Route) => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: { message: '[smoke] controlled profile save failure' } } })
      : route.fallback();
    await page.route(`**/agent-configs/${encodeURIComponent(profile.id)}`, fail);
    try {
      const failed = responseFor(page, 'PATCH', `/agent-configs/${profile.id}`);
      await page.getByTestId('profile-save').click();
      const response = await failed;
      await assertResponse(response, 'PATCH', `/agent-configs/${profile.id}`, 503);
      expect(response.request().postDataJSON()).toEqual({ expectedRevision: 0, label: revised });
      await expect(page.getByTestId('profile-label')).toHaveValue(revised);
      await expect(page.locator('.profile-save-error')).toBeVisible();
      expect(await api.json<Profile>(`/agent-configs/${encodeURIComponent(profile.id)}`)).toMatchObject({ id: profile.id, label, revision: 0 });
    } finally { await page.unroute(`**/agent-configs/${encodeURIComponent(profile.id)}`, fail); }

    const retried = responseFor(page, 'PATCH', `/agent-configs/${profile.id}`);
    await page.getByTestId('profile-save').click();
    const retryResponse = await retried;
    await assertResponse(retryResponse, 'PATCH', `/agent-configs/${profile.id}`, 200);
    expect(retryResponse.request().postDataJSON()).toEqual({ expectedRevision: 0, label: revised });
    const saved = await retryResponse.json() as Profile;
    expect(saved).toMatchObject({ id: profile.id, label: revised, revision: 1, updatedAt: expect.any(String) });
    await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
    expect(await api.json<Profile>(`/agent-configs/${encodeURIComponent(profile.id)}`)).toMatchObject({ id: profile.id, label: revised, revision: 1 });
    expect(parity.rows('SELECT id,label,revision FROM agent_configs WHERE id=?', profile.id)).toEqual([{ id: profile.id, label: revised, revision: 1 }]);

    const reloaded = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    await assertResponse(await reloaded, 'GET', '/agent-configs', 200);
    await page.getByTestId('profile-search').fill(revised);
    const row = page.getByTestId(`profile-${profile.id}`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue(revised);
  } finally {
    if (api) {
      for (const row of await api.json<Profile[]>('/agent-configs')) {
        if ((row.label === label || row.label === revised) && typeof row.id === 'string') owned.add(row.id);
      }
      for (const id of owned) {
        const detail = await api.json<Profile>(`/agent-configs/${encodeURIComponent(id)}`);
        expect([label, revised], 'refuse to delete a foreign profile').toContain(detail.label);
        expect((await api.fetch(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' })).status).toBe(204);
        expect(parity.rows('SELECT id FROM agent_configs WHERE id=?', id)).toEqual([]);
      }
      expect((await api.json<Profile[]>('/agent-configs')).filter(row => row.label === label || row.label === revised)).toEqual([]);
    }
  }
});

test('[web-parity-044] [AI profiles] stale UI save keeps its draft and preserves the newer API revision', async ({ page, parity }) => {
  const nonce = randomUUID().slice(0, 12);
  const label = `[smoke] profile revision ${nonce}`;
  const uiDraft = `${label} UI draft`;
  const apiWinner = `${label} API winner`;
  const owned = new Set<string>();
  let api: ObservedApi | undefined;
  const patchRequests: import('@playwright/test').Request[] = [];
  let onPatch: ((request: import('@playwright/test').Request) => void) | undefined;
  try {
    await page.goto('/#/profiles');
    await page.getByTestId('profile-create').waitFor({ state: 'visible' });
    const initial = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const listed = await initial;
    await assertResponse(listed, 'GET', '/agent-configs', 200);
    api = ObservedApi.from(listed, parity);
    await expect(page.getByTestId('profile-create')).toBeVisible();

    await page.getByTestId('profile-create').click();
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveCount(1);
    await expect(page.getByTestId(/^profile-profile-created-/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue('New profile');
    await page.getByTestId('profile-label').fill(label);
    const create = responseFor(page, 'POST', '/agent-configs');
    await page.getByTestId('profile-save').click();
    const created = await create;
    await assertResponse(created, 'POST', '/agent-configs', 201);
    const row = await created.json() as Profile;
    expect(row).toMatchObject({ id: expect.any(String), label, revision: 0 });
    owned.add(row.id);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');

    await page.getByTestId('profile-label').fill(uiDraft);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    const advanced = await api.fetch(`/agent-configs/${encodeURIComponent(row.id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, label: apiWinner }),
    });
    expect(advanced.status).toBe(200);
    expect(await advanced.json()).toMatchObject({ id: row.id, label: apiWinner, revision: 1 });
    expect(row.id).toMatch(/^smoke-/);
    expect(parity.rows('SELECT id,label,revision FROM agent_configs WHERE id=?', row.id)).toEqual([{ id: row.id, label: apiWinner, revision: 1 }]);

    onPatch = request => {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/agent-configs/${row.id}`)
        patchRequests.push(request);
    };
    page.on('request', onPatch);
    const stale = responseFor(page, 'PATCH', `/agent-configs/${row.id}`);
    await page.getByTestId('profile-save').click();
    const response = await stale;
    await assertResponse(response, 'PATCH', `/agent-configs/${row.id}`, 409);
    expect(response.request().postDataJSON()).toEqual({ expectedRevision: 0, label: uiDraft });
    await expect(page.locator('.profile-save-error')).toBeVisible();
    await expect(page.getByTestId('profile-label')).toHaveValue(uiDraft);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    expect(patchRequests).toHaveLength(1);
    expect(await api.json<Profile>(`/agent-configs/${encodeURIComponent(row.id)}`)).toMatchObject({ id: row.id, label: apiWinner, revision: 1 });
    expect(parity.rows('SELECT id,label,revision FROM agent_configs WHERE id=?', row.id)).toEqual([{ id: row.id, label: apiWinner, revision: 1 }]);
  } finally {
    if (onPatch) page.off('request', onPatch);
    if (api) {
      for (const row of await api.json<Profile[]>('/agent-configs'))
        if ([label, uiDraft, apiWinner].includes(row.label) && typeof row.id === 'string') owned.add(row.id);
      for (const id of owned) {
        const detail = await api.json<Profile>(`/agent-configs/${encodeURIComponent(id)}`);
        expect([label, uiDraft, apiWinner], 'refuse to delete a foreign profile').toContain(detail.label);
        expect((await api.fetch(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' })).status).toBe(204);
        expect(parity.rows('SELECT id FROM agent_configs WHERE id=?', id)).toEqual([]);
      }
    }
  }
});

test('[web-parity-045] [AI profiles] live profile rail and selected editor agree with GET /agent-configs', async ({ page, parity }) => {
  // Catches stale profile rail/editor data; choosing a row is local navigation and performs no save.
  await page.goto('/#/profiles');
  // Finish the initial catalog load before observing the reload's response;
  // otherwise the first page's response can be captured and invalidated by reload.
  await expect(page.getByTestId('profile-label')).toBeVisible();
  const pending = responseFor(page, 'GET', '/agent-configs');
  await page.reload();
  const response = await pending;
  await assertResponse(response, 'GET', '/agent-configs', 200);
  ObservedApi.from(response, parity);
  const profiles = await response.json() as Array<{ id: string; label: string }>;
  expect(profiles.length).toBeGreaterThan(0);
  const workspace = page.getByTestId('profiles-workspace');
  await expect(workspace).toBeVisible();
  const rail = page.getByTestId('settings-column-profiles');
  for (const profile of profiles) await expect(rail.getByTestId(`profile-${profile.id}`)).toHaveCount(1);
  const profile = profiles[0];
  const row = rail.getByTestId(`profile-${profile.id}`);
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('profile-inspector')).toBeVisible();
  await expect(page.getByTestId('profile-label')).toHaveValue(profile.label);
});
