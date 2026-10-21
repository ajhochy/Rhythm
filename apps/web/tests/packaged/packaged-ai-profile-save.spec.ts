import { randomUUID } from 'node:crypto';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, localRows, expectedRevision, expectStalePrivateProfileConflict } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Profile = { id: string; label: string; revision: number; updatedAt: string };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI profiles] owned draft survives a failed save, then revisioned retry persists across reload';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'profile writes require the private signed-in actor').toBeDefined();
  const label = `[smoke] profile save ${randomUUID().slice(0, 12)}`;
  const revised = `${label} revised`;
  const owned = new Set<string>();
  let api: ObservedApi | undefined;
  try {
    const initial = responseFor(page, 'GET', '/agent-configs');
    await page.goto('rhythm://app/index.html#/profiles');
    await page.reload();
    const listResponse = await initial;
    await assertResponse(listResponse, 'GET', '/agent-configs', 200);
    api = ObservedApi.from(listResponse);
    await expect(page.getByTestId('profile-create')).toBeVisible();

    await page.getByTestId('profile-create').click();
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
    expect(localRows('SELECT id,label,revision FROM agent_configs WHERE id=?', profile.id)).toEqual([{ id: profile.id, label: revised, revision: 1 }]);

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
        expect(localRows('SELECT id FROM agent_configs WHERE id=?', id)).toEqual([]);
      }
      expect((await api.json<Profile[]>('/agent-configs')).filter(row => row.label === label || row.label === revised)).toEqual([]);
    }
  }
});

const staleTitle = '[AI profiles] stale UI save keeps its draft and preserves the newer API revision';
if (!manifestPath) {
  unverified(staleTitle, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(staleTitle, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'profile writes require the private signed-in actor').toBeDefined();
  const nonce = randomUUID().slice(0, 12);
  const label = `[smoke] profile revision ${nonce}`;
  const uiDraft = `${label} UI draft`;
  const apiWinner = `${label} API winner`;
  const owned = new Set<string>();
  let api: ObservedApi | undefined;
  const patchRequests: import('@playwright/test').Request[] = [];
  let onPatch: ((request: import('@playwright/test').Request) => void) | undefined;
  try {
    await page.goto('rhythm://app/index.html#/profiles');
    await page.getByTestId('profile-create').waitFor({ state: 'visible' });
    const initial = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const listed = await initial;
    await assertResponse(listed, 'GET', '/agent-configs', 200);
    api = ObservedApi.from(listed);
    await expect(page.getByTestId('profile-create')).toBeVisible();

    await page.getByTestId('profile-create').click();
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
    expectStalePrivateProfileConflict(row.id, apiWinner, 1);

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
    expect(localRows('SELECT id,label,revision FROM agent_configs WHERE id=?', row.id)).toEqual([{ id: row.id, label: apiWinner, revision: 1 }]);
  } finally {
    if (onPatch) page.off('request', onPatch);
    if (api) {
      for (const row of await api.json<Profile[]>('/agent-configs'))
        if ([label, uiDraft, apiWinner].includes(row.label) && typeof row.id === 'string') owned.add(row.id);
      for (const id of owned) {
        const detail = await api.json<Profile>(`/agent-configs/${encodeURIComponent(id)}`);
        expect([label, uiDraft, apiWinner], 'refuse to delete a foreign profile').toContain(detail.label);
        expect((await api.fetch(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' })).status).toBe(204);
        expect(localRows('SELECT id FROM agent_configs WHERE id=?', id)).toEqual([]);
      }
    }
  }
});
