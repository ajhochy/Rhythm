import { test, expect, request as http } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires manager-owned phase2-integration sandbox');
test('E22-c7 real profile/session UI settings readback; safely intercept turn frames without provider execution', async ({ page }) => {
  test.setTimeout(90000);
  page.on('pageerror', error => console.log('renderer error:', error.message));
  page.on('response', res => { if (res.status() >= 400) void res.text().then((body) => console.log('HTTP failure:', res.status(), res.url(), body.slice(0, 200))).catch(() => undefined); });
  const client = await http.newContext({ baseURL: 'http://127.0.0.1:4098' });
  const label = `E22-${randomUUID()}`; let profileId = ''; let sessionId = '';
  const frames: any[] = [];
  try {
    expect((await client.get('/opencode/health')).ok()).toBe(true);
    const createdProfile = await client.post('/agent-configs', { data: { label, icon: 'E2', enabled: true, isAgent: true, sessionSelectable: true, allowedMcpsJson: '{}', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: '{"bash":"ask"}', autoApproveActions: false } });
    expect(createdProfile.status(), await createdProfile.text()).toBe(201);
    profileId = (await createdProfile.json()).id;
    const createdSession = await client.post('/agent-sessions', { data: { name: label, profileId, cwd: '/private/tmp/rhythm-electron-phase2-integration', isolateWorktree: false } });
    expect(createdSession.status(), await createdSession.text()).toBe(201);
    sessionId = (await createdSession.json()).id;
    await page.route('https://e22.invalid/**', route => route.fulfill({ json: [] }));
    // Intercept the socket boundary entirely: no connection can forward a provider prompt.
    // Profile/session HTTP create, PATCH and readback still use the real sandbox + engine.
    await page.routeWebSocket(/\/ws\/agents$/, ws => {
      ws.onMessage(data => { const frame = JSON.parse(String(data)); if (frame.type === 'session.input') { frames.push(frame); ws.send(JSON.stringify({ type: 'session.status', id: frame.id, status: 'idle' })); } });
    });
    await page.addInitScript(id => localStorage.setItem('rhythm-agents-live-selected-session', id), sessionId);
    await page.goto('/tests/electron-e22-harness.html');
    await expect(page.getByTestId(`session-${sessionId}`)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Switch surface' }).click();
    await page.getByTestId(`profile-${profileId}`).click();
    await page.getByTestId('profile-label').fill(`${label}-edited`);
    await page.getByTestId('profile-permissions').fill('{"bash":{"*":"ask","git status":"allow"}}');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('notice')).toHaveText('Profile saved');
    const persistedProfile = await (await client.get(`/agent-configs/${profileId}`)).json();
    expect(persistedProfile).toMatchObject({ label: `${label}-edited`, corePermissionsJson: '{"bash":{"*":"ask","git status":"allow"}}', autoApproveActions: false });
    await page.getByRole('button', { name: 'Switch surface' }).click();
    await page.getByTestId('session-actions').click(); await page.getByTestId('session-actions-settings').click();
    const dialog = page.getByTestId('session-settings-dialog');
    await dialog.locator('[name=name]').fill(`${label}-settings`); await dialog.locator('[name=thinking]').fill('4096');
    await dialog.locator('[name=permission]').selectOption('plan'); await dialog.locator('[name=fast]').check();
    await page.getByTestId('save-session-settings').click(); await expect(dialog).not.toBeVisible();
    const persisted = (await (await client.get(`/agent-sessions/${sessionId}`)).json()).session;
    expect(persisted).toMatchObject({ name: `${label}-settings`, profileId, thinkingBudget: 4096, permissionMode: 'plan', fastMode: true });
    const catalog = (await (await client.get('/agents/models/catalog')).json()).filter((m: any) => m.authorized);
    if (catalog.length >= 2) {
      const [first, second] = catalog;
      await page.getByTestId('composer-model').selectOption(`${first.provider}/${first.modelId}`); await page.getByTestId('model-session-default').click();
      await expect(page.getByTestId('model-scope-dialog')).not.toBeVisible();
      await page.getByTestId('composer-profile').selectOption(profileId); await page.getByTestId('agent-this-turn').click();
      await page.getByTestId('composer-model').selectOption(`${second.provider}/${second.modelId}`); await page.getByTestId('model-this-turn').click();
      for (const text of ['E22 intercepted turn', 'E22 intercepted default']) { await page.getByTestId('composer-input').fill(text); await page.getByTestId('composer-input').press('Enter'); }
      await expect.poll(() => frames.length).toBe(2);
      expect(frames[0]).toMatchObject({ agent: persistedProfile.ocAgent || profileId, modelOverride: { providerId: second.provider, modelId: second.modelId } });
      expect(frames[1]).toMatchObject({ modelOverride: { providerId: first.provider, modelId: first.modelId } }); expect(frames[1].agent).toBeUndefined();
      console.log('E22 LIVE: profile/session create-update-readback; two intercepted input frames verified; zero provider prompts forwarded.');
    } else {
      console.log('E22 LIVE: profile/session create-update-readback PASS; fewer than two enabled models, live input-frame scenario deferred. Intercepted catalog contract covers two frames. Provider execution deferred.');
    }
    await page.reload(); await expect(page.getByTestId('state')).toContainText(`${label}-settings`);
  } finally {
    if (sessionId) expect((await client.delete(`/agent-sessions/${sessionId}/hard`, { data: { removeWorktree: false } })).status()).toBe(204);
    if (profileId) expect((await client.delete(`/agent-configs/${profileId}`)).status()).toBe(204);
    await client.dispose();
  }
});
