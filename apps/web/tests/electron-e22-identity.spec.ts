import { test, expect, type Page } from '@playwright/test';
const profile = (id: string) => ({ id, label: id, icon: 'AG', enabled: true, isAgent: true, isManager: false, sessionSelectable: true, modelProvider: 'custom', modelId: 'profile-model', allowedMcpsJson: '{}', allowedSkillsJson: '["skill-one"]', allowedDelegatesJson: '[]', corePermissionsJson: '{"bash":{"*":"ask","git status":"allow"}}', autoApproveActions: false, updatedAt: '2026-09-11T00:00:00Z' });
export async function open(page: Page, empty = false) {
  let profiles: any[] = empty ? [] : [profile('alpha'), profile('beta'), { ...profile('disabled'), enabled: false }];
  let session: any = { id: 'selected', name: 'Selected', profileId: 'alpha', opencodeAgentId: 'alpha', providerId: 'custom', modelId: 'default-model', thinkingBudget: 2048, permissionMode: 'default', fastMode: false, cwd: '/tmp/e22', branch: 'e22-base', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  const writes: { path: string; method: string; body: any }[] = []; const frames: any[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, ws => ws.onMessage(data => { const frame = JSON.parse(String(data)); frames.push(frame); if (frame.type === 'session.input') ws.send(JSON.stringify({ type: 'session.status', id: frame.id, status: 'idle' })); }));
  await page.route(/https:\/\/e22.invalid|http:\/\/127.0.0.1:(4199|4197)/, route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
    const body = request.postDataJSON(); const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (method !== 'GET') writes.push({ path, method, body });
    if (path === '/agent-configs' && method === 'POST') { const saved = { ...body, id: `saved-${writes.length}`, updatedAt: new Date().toISOString() }; profiles.push(saved); return send(saved); }
    if (path.startsWith('/agent-configs/')) {
      const id = path.split('/').pop(); const found = profiles.find(p => p.id === id);
      if (!found) return send({ error: 'Unknown profile' }, 404);
      if (method === 'DELETE') { profiles = profiles.filter(p => p.id !== id); return route.fulfill({ status: 204 }); }
      if (method === 'PATCH') {
        if (body.corePermissionsJson) { try { JSON.parse(body.corePermissionsJson); } catch { return send({ error: 'Invalid permission policy' }, 400); } }
        Object.assign(found, body, { updatedAt: new Date().toISOString() });
      }
      return send(found);
    }
    if (path === '/agent-configs') return send(profiles);
    if (path === '/opencode/skills') return send([{ name: 'skill-one', managed: true, source: 'managed', location: '/managed/skill-one' }, { name: 'skill-two', managed: true, source: 'managed', location: '/managed/skill-two' }]);
    if (path === '/agents/models/catalog') return send(empty ? [] : ['profile-model', 'default-model', 'turn-model'].map(modelId => ({ provider: 'custom', modelId, displayName: modelId, authorized: true })).concat([{ provider: 'unauthed', modelId: 'hidden-model', displayName: 'Hidden', authorized: false }]));
    if (path === '/opencode/auth/accounts') return send({ accounts: empty ? [] : [{ id: 'account-22', label: 'Actual account' }], defaultId: null });
    if (path === '/tasks') return send([{ id: 'task-22', title: 'Actual task', status: 'open' }]);
    if (path.endsWith('/branches')) return send({ current: 'e22-base', local: ['e22-base', 'other-branch'], recent: [] });
    if (path === '/agent-sessions' && method === 'POST') { session = { ...session, ...body, id: 'created-session' }; return send(session); }
    if (path === '/agent-sessions') return send({ sessions: [session], pageInfo: { nextCursor: null, hasMore: false } });
    if (/^\/agent-sessions\/[^/]+$/.test(path)) { if (method === 'PATCH') { Object.assign(session, body); return send(session); } return send({ session, messages: [] }); }
    if (path.endsWith('/health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('state')).toContainText('default-model');
  return { writes, frames, profiles: () => profiles, session: () => session };
}

test('E22-c1 live catalogs replace fixture choices and empty profiles remain usable', async ({ page }) => {
  const h = await open(page, true);
  await expect(page.getByTestId('new-chat-instant')).toBeDisabled();
  await expect(page.getByTestId('composer-model')).toBeDisabled();
  await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect(page.getByTestId('profile-create')).toBeVisible();
  await page.getByTestId('profile-create').click();
  await expect(page.getByTestId('profile-model').locator('option')).toHaveText(['No preference']);
  await expect(page.getByTestId('profile-provider').locator('option')).toHaveText(['No preference']);
  await expect(page.getByTestId('profile-account').locator('option')).toHaveText(['No default']);
  await page.getByTestId('profile-label').fill('First real profile'); await page.getByTestId('profile-save').click();
  await expect.poll(() => h.profiles().find(p => p.label === 'First real profile')?.modelId).toBeNull();
});

test('E22-c2 profile duplicate is a POST draft with canonical nested policy; create/edit/delete readback', async ({ page }) => {
  const h = await open(page); await page.getByRole('button', { name: 'Switch surface' }).click();
  await page.getByTestId('profile-duplicate').click(); await page.getByTestId('profile-label').fill('Copied identity');
  await page.getByTestId('profile-save').click();
  await expect.poll(() => h.writes.some(w => w.method === 'POST' && w.path === '/agent-configs')).toBe(true);
  const saved = h.profiles().find(p => p.label === 'Copied identity');
  expect(saved.corePermissionsJson).toBe('{"bash":{"*":"ask","git status":"allow"}}');
  expect(h.writes.some(w => w.method === 'PATCH' && w.path.includes('copy'))).toBe(false);
  await expect(page.getByTestId(`profile-${saved.id}`)).toBeVisible();
  await page.getByTestId('profile-label').fill('Edited identity'); await page.getByTestId('profile-save').click();
  await expect.poll(() => h.profiles().find(p => p.id === saved.id)?.label).toBe('Edited identity');
  await page.getByTestId('profile-delete').click(); await page.getByTestId('confirm-profile-delete').click();
  await expect(page.getByTestId(`profile-${saved.id}`)).toHaveCount(0);
});

test('E22-c3 persisted session settings use canonical profile/model/budget/mode and survive readback', async ({ page }) => {
  const h = await open(page); await page.getByTestId('session-actions').click(); await page.getByTestId('session-actions-settings').click();
  const dialog = page.getByTestId('session-settings-dialog');
  await expect(dialog.locator('[name=thinking]')).toHaveAttribute('type', 'number');
  await dialog.locator('[name=name]').fill('Settings saved'); await dialog.locator('[name=profile]').selectOption('beta');
  await dialog.locator('[name=model]').selectOption('custom/turn-model');
  await dialog.locator('[name=thinking]').fill('4096'); await dialog.locator('[name=permission]').selectOption('plan'); await dialog.locator('[name=fast]').check();
  await page.getByTestId('save-session-settings').click();
  await expect.poll(() => h.writes.find(w => w.method === 'PATCH' && w.path === '/agent-sessions/selected')?.body).toMatchObject({ name: 'Settings saved', profileId: 'beta', providerId: 'custom', modelId: 'turn-model', thinkingBudget: 4096, permissionMode: 'plan', fastMode: true });
  await page.reload(); await expect(page.getByTestId('state')).toContainText('Settings saved');
  await expect(page.getByTestId('composer-model')).toHaveValue('custom/turn-model');
  await expect(page.getByTestId('composer-thinking')).toHaveValue('4096');
  await expect(page.getByTestId('composer-permission-mode')).toHaveValue('plan');
  await expect(page.getByTestId('composer-fast')).toHaveAttribute('aria-pressed', 'true');
});

test('E22-c4 agent/model override is explicit exactly once, then persisted defaults, never profile fallback', async ({ page }) => {
  const h = await open(page);
  await page.getByTestId('composer-profile').selectOption('beta');
  await expect(page.getByTestId('agent-this-turn')).toBeVisible();
  await page.getByTestId('agent-this-turn').click();
  await page.getByTestId('composer-model').selectOption('custom/turn-model'); await page.getByTestId('model-this-turn').click();
  await page.getByTestId('composer-input').fill('first'); await page.getByTestId('composer-input').press('Enter');
  await expect.poll(() => h.frames.filter(f => f.type === 'session.input').length).toBe(1);
  await page.getByTestId('composer-input').fill('second'); await page.getByTestId('composer-input').press('Enter');
  await expect.poll(() => h.frames.filter(f => f.type === 'session.input').length).toBe(2);
  const inputs = h.frames.filter(f => f.type === 'session.input');
  expect(inputs[0]).toMatchObject({ agent: 'beta', modelOverride: { providerId: 'custom', modelId: 'turn-model' } });
  expect(inputs[1]).toMatchObject({ modelOverride: { providerId: 'custom', modelId: 'default-model' } });
  expect(inputs[1].agent).toBeUndefined(); expect(h.session().profileId).toBe('alpha'); expect(h.session().modelId).toBe('default-model');
});

test('E22-c6 policy controls round-trip canonical values, preserving pattern rules; managed skills explicitly unavailable', async ({ page }) => {
  const h = await open(page); await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect(page.getByTestId('profile-provider').locator('option[value=custom]')).toHaveCount(1);
  await expect(page.getByTestId('profile-provider').locator('option[value=unauthed]')).toHaveCount(0);
  await expect(page.getByTestId('profile-managed-skills')).toBeDisabled();
  await expect(page.getByTestId('profile-auto-approve')).toBeVisible();
  await page.getByTestId('profile-auto-approve').check(); await page.getByTestId('delegate-beta').check();
  await page.getByTestId('profile-account').selectOption('account-22'); await page.getByTestId('profile-manager').check();
  await page.getByTestId('skill-skill-two').check();
  await page.getByTestId('profile-save').click();
  await expect.poll(() => h.profiles().find(p => p.id === 'alpha')).toMatchObject({ autoApproveActions: true, isManager: true, allowedSkillsJson: '["skill-one","skill-two"]', allowedDelegatesJson: '["beta"]', defaultAnthropicAccountId: 'account-22', corePermissionsJson: '{"bash":{"*":"ask","git status":"allow"}}' });
  await page.reload(); await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect(page.getByTestId('profile-auto-approve')).toBeChecked(); await expect(page.getByTestId('delegate-beta')).toBeChecked();
  await expect(page.getByTestId('profile-account')).toHaveValue('account-22');
  await expect(page.getByTestId('skill-skill-two')).toBeChecked();
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  await page.getByTestId('profile-permissions').fill('not JSON');
  await expect(page.getByTestId('profile-save')).toBeDisabled();
  await expect(page.getByTestId('profile-permissions')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: 'Fix the permission JSON before saving.' })).toBeVisible();
  expect(h.profiles().find(p => p.id === 'alpha').corePermissionsJson).toBe('{"bash":{"*":"ask","git status":"allow"}}');
});

test('E22-c5 default is used for instant create; advanced submits real account/task/worktree values', async ({ page }) => {
  const h = await open(page); await page.getByRole('button', { name: 'Switch surface' }).click();
  await page.getByTestId('profile-beta').click(); await page.getByTestId('profile-default').click();
  await expect(page.getByText(/local.*account|account.*local/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Switch surface' }).click(); await page.getByTestId('new-chat-instant').click();
  await expect.poll(() => h.writes.find(w => w.path === '/agent-sessions' && w.method === 'POST')?.body.profileId).toBe('beta');
  await page.getByTestId('new-session-advanced').click(); await page.getByTestId('advanced-name').fill('Advanced');
  await page.getByTestId('advanced-task').selectOption('task-22'); await page.getByTestId('advanced-account').selectOption('account-22');
  await page.getByTestId('advanced-cwd').fill('/tmp/e22-chosen'); await page.getByTestId('advanced-isolate-worktree').check(); await page.getByTestId('advanced-worktree-name').fill('e22-worktree');
  await page.getByTestId('advanced-branch').selectOption('__new__'); await page.getByTestId('advanced-new-branch').fill('e22-selected-branch');
  await expect(page.getByTestId('advanced-browse')).toBeDisabled();
  await page.getByTestId('advanced-create').click();
  await expect.poll(() => h.writes.filter(w => w.path === '/agent-sessions' && w.method === 'POST').at(-1)?.body).toMatchObject({ name: 'Advanced', profileId: 'beta', taskId: 'task-22', anthropicAccountId: 'account-22', cwd: '/tmp/e22-chosen', isolateWorktree: true, worktreeName: 'e22-worktree', branch: 'e22-selected-branch', createBranch: true });
  expect(h.writes.at(-1)?.body.stash).toBeUndefined();
});
