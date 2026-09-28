import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openFixture } from './helpers';

// Profiles is a column browser: profiles → setting groups → inspector (→ long list).
// Only the selected group's controls are rendered, so tests open a group first.
const groupsColumn = (page: Page) => page.getByTestId('settings-column-groups');
async function backUntil(page: Page, target: ReturnType<Page['getByTestId']>) {
  for (let step = 0; step < 4 && !await target.isVisible(); step++) {
    const back = page.locator('.column-browser-back:visible').first();
    if (!await back.count()) break;
    await back.click();
  }
}
async function openGroup(page: Page, name: string) {
  const row = groupsColumn(page).getByRole('option', { name, exact: true });
  await backUntil(page, row);
  await row.click();
  // Narrow layouts hide the groups column after selection; assert on the rendered ARIA state.
  await expect(groupsColumn(page).getByRole('option', { name, exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true');
}
async function openProfile(page: Page, testId: string) {
  const row = page.getByTestId(testId);
  await backUntil(page, row);
  await row.click();
}
/** Narrow layouts show one column; step forward from the policy inspector to its list. */
async function showList(page: Page) {
  const list = page.getByTestId('settings-column-list');
  if (!await list.isVisible()) await page.locator('.column-browser-forward:visible').first().click();
  await expect(list).toBeVisible();
}
const editorColumns = (page: Page) => page.locator('[data-testid="settings-column-groups"], [data-testid="settings-column-inspector"], [data-testid="settings-column-list"]');

// Opt-in layout evidence: RHYTHM_SETTINGS_SHOTS=<dir> saves screenshots of the column layouts.
const shot = async (page: Page, name: string) => { if (process.env.RHYTHM_SETTINGS_SHOTS) await page.screenshot({ path: `${process.env.RHYTHM_SETTINGS_SHOTS}/${name}.png` }); };

test('editor hierarchy, save/cancel and profile switching keep drafts on their original profile', async ({ page }) => {
  await openFixture(page, '#/profiles');
  const original = await page.getByTestId('profile-label').inputValue();
  await expect(page.getByTestId('settings-column-profiles')).toBeVisible();
  expect(await groupsColumn(page).getByRole('option').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))).toEqual([
    'Identity & instructions', 'Provider, model & account', 'Delegation',
    'Availability & defaults', 'MCPs', 'Permissions', 'Actions',
  ]);
  await expect(groupsColumn(page).getByRole('option', { name: 'Identity & instructions' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('profile-label').fill('Unsaved coordinator');
  await page.getByTestId('profile-profile-builder').click();
  await expect(page.getByTestId('profile-unsaved-dialog')).toBeVisible();
  await expect(page.getByTestId('profile-keep-editing')).toBeFocused();
  await page.getByTestId('profile-keep-editing').click();
  await expect(page.getByTestId('profile-label')).toHaveValue('Unsaved coordinator');
  await page.getByTestId('profile-profile-builder').click();
  await page.getByTestId('profile-discard').click();
  await expect(page.getByTestId('profile-label')).toHaveValue('Implementation Partner');
  await page.getByTestId('profile-label').fill('Saved builder');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  await page.getByTestId('profile-profile-coordinator').click();
  await expect(page.getByTestId('profile-label')).toHaveValue(original);
  await page.getByTestId('profile-label').fill('Cancel me');
  await page.getByTestId('profile-cancel').click();
  await expect(page.getByTestId('profile-label')).toHaveValue(original);
  await expect(page.getByTestId('profile-save-status')).toHaveText('No unsaved changes');
  await page.getByTestId('profile-profile-builder').click();
  await expect(page.getByTestId('profile-label')).toHaveValue('Saved builder');
});

test('create, duplicate and back also protect a dirty draft; rename waits for Save', async ({ page }) => {
  await openFixture(page, '#/profiles');
  await page.getByTestId('profile-rename').click();
  await page.getByTestId('profile-inline-name').fill('Draft name');
  await page.getByTestId('profile-inline-confirm').click();
  await expect(page.getByTestId('profile-profile-coordinator')).toContainText('Rhythm Coordinator');
  await openGroup(page, 'Actions');
  for (const control of ['profile-create', 'profile-duplicate', 'profiles-back']) {
    await page.getByTestId(control).click();
    await expect(page.getByTestId('profile-unsaved-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#profile-editor-title')).toHaveText('Draft name');
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
  }
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-profile-coordinator')).toContainText('Draft name');
});

test('choosing a default during an edit does not get overwritten by Save', async ({ page }) => {
  await openFixture(page, '#/profiles');
  await page.getByTestId('profile-profile-builder').click();
  await page.getByTestId('profile-label').fill('Default builder');
  await openGroup(page, 'Actions');
  await page.getByTestId('profile-default').click();
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-profile-builder')).toContainText('Default');
  await expect(page.getByTestId('profile-default')).toBeDisabled();
  await expect(page.getByTestId('profile-profile-coordinator').locator('em')).toHaveCount(0);
});

test('capability summaries, disclosure, filtering and bulk edits retain individual choices', async ({ page }) => {
  await openFixture(page, '#/profiles');
  await openGroup(page, 'MCPs');
  const skills = page.locator('.profile-capability-group').filter({ has: page.locator('summary', { hasText: 'Workspace skills' }) });
  await expect(skills.locator('summary')).toContainText('2 of 6 selected');
  await expect(skills.locator('summary')).toContainText('Explicit');
  await skills.locator('summary').click();
  await expect(page.getByTestId('skill-planning')).not.toBeVisible();
  await page.getByTestId('profile-capability-filter').fill('verification');
  await expect(page.getByTestId('skill-verification')).toBeVisible();
  await expect(page.getByTestId('skill-planning')).toHaveCount(0);
  await skills.getByRole('button', { name: 'Select all shown in group: Workspace skills' }).click();
  await expect(skills.locator('summary')).toContainText('2 of 6 selected');
  await page.getByTestId('profile-capability-filter').fill('');
  await skills.locator('summary').click();
  await skills.getByRole('button', { name: 'Clear group: Workspace skills' }).click();
  await expect(skills.locator('summary')).toContainText('0 of 6 selected');
  await page.getByTestId('skill-planning').check();
  await page.getByTestId('profile-save').click();
  await page.getByTestId('profile-profile-builder').click();
  await page.getByTestId('profile-profile-coordinator').click();
  await expect(page.getByTestId('skill-planning')).toBeChecked();
  await expect(page.getByTestId('skill-verification')).not.toBeChecked();
});

test('structured permissions preserve advanced JSON, patterns and explicit defaults through save/readback', async ({ page }) => {
  await openFixture(page, '#/profiles');
  await openGroup(page, 'Permissions');
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  const raw = '{ "bash": {"*":"ask", "git *":"allow"}, "future": { "inherit": true, "weight": 1e+03 }, "marker":"inherit", "__proto__":"ask" }';
  await page.getByTestId('profile-permissions').fill(raw);
  await page.getByTestId('permission-bash').selectOption('deny');
  await expect(page.getByTestId('profile-permissions')).toHaveValue(raw.replace('"*":"ask"', '"*":"deny"'));
  await page.getByTestId('profile-pattern-tool').fill('bash');
  await page.getByTestId('profile-pattern-value').fill('npm test');
  await page.getByTestId('profile-pattern-action').selectOption('allow');
  await page.getByTestId('profile-pattern-add').click();
  const expected = await page.getByTestId('profile-permissions').inputValue();
  expect(expected).toContain('"future": { "inherit": true, "weight": 1e+03 }');
  expect(JSON.parse(expected).bash).toEqual({ '*': 'deny', 'git *': 'allow', 'npm test': 'allow' });
  await page.getByTestId('profile-save').click();
  await page.getByTestId('profile-profile-builder').click();
  await page.getByTestId('profile-profile-coordinator').click();
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  await expect(page.getByTestId('profile-permissions')).toHaveValue(expected);
  await page.getByRole('button', { name: 'Remove bash: npm test', exact: true }).click();
  expect(JSON.parse(await page.getByTestId('profile-permissions').inputValue()).bash).toEqual({ '*': 'deny', 'git *': 'allow' });
});

test('invalid names and JSON prevent saving without losing the draft', async ({ page }) => {
  await openFixture(page, '#/profiles');
  await page.getByTestId('profile-label').fill(' ');
  await expect(page.getByTestId('profile-save')).toBeDisabled();
  await expect(page.getByTestId('profile-label')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('profile-label').fill('Valid label');
  await openGroup(page, 'Permissions');
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  await page.getByTestId('profile-permissions').fill('{bad');
  await expect(page.getByTestId('profile-save')).toBeDisabled();
  await expect(page.getByTestId('permission-bash')).toBeDisabled();
  await expect(groupsColumn(page).getByRole('option', { name: 'Permissions' })).toContainText('Invalid JSON');
  await openGroup(page, 'Identity & instructions');
  await expect(page.getByTestId('profile-label')).toHaveValue('Valid label');
  await openGroup(page, 'Permissions');
  // Invalid JSON keeps Advanced open.
  await page.getByTestId('profile-permissions').fill('{"bash":"ask"}');
  await expect(page.getByTestId('profile-save')).toBeEnabled();
  await page.getByTestId('profile-cancel').click();
  await openGroup(page, 'Identity & instructions');
  await expect(page.getByTestId('profile-label')).toHaveValue('Rhythm Coordinator');
});

test('read-only profiles allow inspection with every edit and immediate action disabled', async ({ page }) => {
  await openFixture(page, '#/profiles?state=read-only');
  // Every group stays inspectable while each edit and immediate action is disabled.
  for (const name of ['Identity & instructions', 'Provider, model & account', 'Delegation', 'Availability & defaults', 'MCPs', 'Permissions', 'Actions']) {
    await openGroup(page, name);
    const controls = editorColumns(page).locator('input, textarea, select, button:not(.column-browser-back):not(.column-browser-forward):not(.column-checklist-sort)');
    expect(await controls.count(), `${name} renders controls`).toBeGreaterThan(0);
    for (const control of await controls.all()) await expect(control, name).toBeDisabled();
  }
  await openGroup(page, 'Permissions');
  await page.getByText('Advanced (JSON)', { exact: true }).click();
  await expect(page.getByTestId('profile-permissions')).toBeVisible();
  await page.getByTestId('profile-profile-builder').click();
  await openGroup(page, 'Identity & instructions');
  await expect(page.getByTestId('profile-label')).toHaveValue('Implementation Partner');
  await expect(page.getByTestId('profile-create')).toBeDisabled();
  const result = await new AxeBuilder({ page }).include('.profiles-workspace').analyze();
  expect(result.violations).toEqual([]);
});

test('small windows, 200 percent zoom equivalent, RTL and long text keep controls reachable above the footer', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 700 });
  await openFixture(page, '#/profiles');
  await page.getByTestId('profile-label').fill('A long profile name with instructions for a distributed team');
  await page.getByTestId('profile-system-prompt').fill('Long instructions. '.repeat(250));
  await page.getByTestId('profile-system-prompt').focus();
  const outline = await page.getByTestId('profile-system-prompt').evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
  await openGroup(page, 'Actions');
  for (const direction of ['ltr', 'rtl']) {
    await page.evaluate(dir => document.documentElement.dir = dir, direction);
    // Narrow: one column at a time, and the save footer sits below the columns, never over them.
    await expect(page.getByTestId('settings-column-inspector')).toBeVisible();
    await expect(groupsColumn(page)).toBeHidden();
    const body = page.getByTestId('profile-inspector');
    await page.getByTestId('profile-delete').scrollIntoViewIfNeeded();
    const geometry = await body.evaluate(element => ({ scrollWidth: element.scrollWidth, width: element.clientWidth, bottom: element.getBoundingClientRect().bottom }));
    const footer = await page.locator('.profile-save-footer').boundingBox();
    const action = await page.getByTestId('profile-delete').boundingBox();
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(footer!.y + 1);
    expect(action!.y + action!.height).toBeLessThanOrEqual(footer!.y);
    for (const id of ['profile-save', 'profile-cancel']) {
      const bounds = await page.getByTestId(id).boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
  }
  // A 1440px desktop at 200% browser zoom has a 720 CSS-pixel layout viewport.
  await page.setViewportSize({ width: 720, height: 500 });
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  const result = await new AxeBuilder({ page }).include('.profiles-workspace').analyze();
  expect(result.violations).toEqual([]);
});

// Data fixtures through the existing E22 canonical gateway harness. No actual
// engine/API requests are permitted; this is rendered contract evidence only.
async function openCanonicalFixture(page: Page, options: { allowedMcpsJson?: string; allowedSkillsJson?: string | null; extraProfiles?: string[]; catalog?: Array<Record<string, unknown>> | (() => Array<Record<string, unknown>>); modelProvider?: string; modelId?: string; skillTags?: Record<string, string[]> } = {}) {
  const profiles = ['alpha', 'beta', ...options.extraProfiles ?? []].map(id => ({
    id, label: id, icon: 'AG', enabled: true, isAgent: true, isManager: false, sessionSelectable: true,
    modelProvider: options.modelProvider ?? 'custom', modelId: options.modelId ?? 'model-one', defaultAnthropicAccountId: null, systemPrompt: '',
    allowedMcpsJson: options.allowedMcpsJson ?? '{"server":[], "other":["keep"]}', allowedSkillsJson: options.allowedSkillsJson === undefined ? null : options.allowedSkillsJson,
    allowedDelegatesJson: '[]', corePermissionsJson: '{"bash":{"*":"ask","git *":"allow"}, "future":{"x":"deny"}}',
    updatedAt: '2026-09-18T00:00:00Z',
  }));
  const writes: Array<{ id: string; body: Record<string, unknown> }> = [];
  const skills = [
    ...Array.from({ length: 24 }, (_, i) => ({ name: `skill-${i}`, description: `Skill ${i} description`, source: i < 12 ? 'managed' as const : 'org' as const, managed: i < 12, location: '' })),
    { name: 'external-skill', description: 'External skill description', source: 'external' as const, managed: false, location: '' },
  ].map(skill => options.skillTags?.[skill.name] ? { ...skill, tags: options.skillTags[skill.name] } : skill);
  const skillContent = new Map(skills.map(skill => [skill.name, `Instructions for ${skill.name}`]));
  const skillWrites: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  let fail = false;
  let pending: (() => void) | undefined;
  let hold = false;
  let skillPending: (() => void) | undefined;
  let holdSkill = false;
  let failSkillDelete = false;
  // Only this test's static origin may pass through. Every data endpoint below
  // is intercepted, and a missed configuration substitution fails closed.
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL!).origin ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/tests/electron-e22-harness.tsx', async route => {
    const response = await route.fetch();
    const code = (await response.text())
      .replaceAll('env.VITE_RHYTHM_API_BASE', '"http://127.0.0.1:4199"')
      .replaceAll('env.VITE_RHYTHM_ENGINE_BASE', '"http://127.0.0.1:4197"')
      .replaceAll('env.VITE_RHYTHM_PRODUCTION_API_BASE', '"https://profiles-fixture.invalid"')
      .replaceAll('env.VITE_RHYTHM_LIVE_TOKEN', '"fixture-only"');
    expect(code).toContain('http://127.0.0.1:4199');
    expect(code).toContain('https://profiles-fixture.invalid');
    await route.fulfill({ response, body: code });
  });
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/profiles-fixture.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path.startsWith('/agent-configs/') && request.method() === 'PATCH') {
      const id = path.split('/').at(-1)!; const body = request.postDataJSON(); writes.push({ id, body });
      if (hold) await new Promise<void>(resolve => { pending = resolve; });
      if (fail) return send({ error: 'Fixture save rejected' }, 403);
      const profile = profiles.find(item => item.id === id)!; Object.assign(profile, body, { updatedAt: '2026-09-18T01:00:00Z' });
      return send(profile);
    }
    if (path === '/agent-configs') return send(profiles);
    if (path === '/opencode/mcp') return send([
      { name: 'server', source: 'curated', status: 'connected', tools: Array.from({ length: 60 }, (_, i) => `tool-${i}`) },
      { name: 'other', source: 'rhythm', status: 'connected', tools: ['keep'] },
    ]);
    if (path.startsWith('/opencode/skills/')) {
      const segments = path.split('/'); const name = decodeURIComponent(segments[3]);
      if (request.method() === 'GET' && segments[4] === 'content') return send({ name, content: skillContent.get(name) ?? '' });
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { description?: string; content: string }; skillWrites.push({ method: 'PUT', path, body });
        const skill = skills.find(item => item.name === name)!; skill.description = body.description ?? ''; skillContent.set(name, body.content); return send(skill);
      }
      if (request.method() === 'DELETE') {
        skillWrites.push({ method: 'DELETE', path });
        if (failSkillDelete) return send({ error: 'Fixture skill delete rejected' }, 503);
        const index = skills.findIndex(item => item.name === name); if (index >= 0) skills.splice(index, 1); skillContent.delete(name); return route.fulfill({ status: 204, body: '' });
      }
    }
    if (path === '/opencode/skills' && request.method() === 'POST') {
      const body = request.postDataJSON() as { name: string; description?: string; content: string }; skillWrites.push({ method: 'POST', path, body });
      if (holdSkill) await new Promise<void>(resolve => { skillPending = resolve; });
      const skill = { name: body.name, description: body.description ?? '', source: 'managed' as const, managed: true, location: '' }; skills.push(skill); skillContent.set(skill.name, body.content); return send(skill);
    }
    if (path === '/opencode/skills') return send(skills);
    if (path === '/agents/models/catalog') return send((typeof options.catalog === 'function' ? options.catalog() : options.catalog) ?? ['model-one', 'model-two'].map(modelId => ({ provider: 'custom', modelId, displayName: modelId, authorized: true })));
    if (path === '/opencode/auth/accounts') return send({ accounts: [{ id: 'account', label: 'Fixture account' }], defaultId: null });
    if (path === '/opencode/auth/openai/accounts') return send({ accounts: [{ id: 'openai-work', label: 'Work', status: 'ok' }, { id: 'openai-home', label: 'Home', status: 'ok', email: 'home@example.test' }], defaultAccountId: 'openai-work' });
    if (path === '/agent-sessions') return send({ sessions: [] });
    if (path.endsWith('/health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect(page.getByTestId('profile-label')).toHaveValue('alpha');
  return {
    writes, profiles, skillWrites, skills,
    reject: (value: boolean) => { fail = value; },
    hold: () => { hold = true; },
    release: () => { hold = false; pending?.(); },
    holdSkill: () => { holdSkill = true; },
    releaseSkill: () => { holdSkill = false; skillPending?.(); },
    rejectSkillDelete: (value: boolean) => { failSkillDelete = value; },
  };
}

test('canonical fixture: inheritance, large catalogs, grouped selection and policy survive gateway readback', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'MCPs');
  const group = page.locator('.profile-capability-group').filter({ has: page.locator('summary strong', { hasText: /^server$/ }) });
  await expect(group.locator('summary')).toContainText('60 of 60 selected');
  await expect(group.locator('summary')).toContainText('Inherited');
  await page.getByTestId('profile-mcp-filter').fill('tool-59');
  await page.getByTestId('mcp-server-tool-59').uncheck();
  await expect(group.locator('summary')).toContainText('59 of 60 selected');
  await expect(group.locator('summary')).toContainText('Explicit');
  await page.getByTestId('profile-mcp-filter').fill('');
  // Server groups start collapsed; the filter opened them, clearing it closes them again.
  await expect(group).not.toHaveAttribute('open', '');
  await group.locator('summary').click();
  await group.getByRole('button', { name: 'Clear group: server', exact: true }).click();
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.getByTestId('skill-skill-0').uncheck();
  await openGroup(page, 'Provider, model & account');
  await page.getByTestId('profile-model').selectOption('model-two');
  await page.getByTestId('profile-account').selectOption('account');
  await openGroup(page, 'Delegation');
  await page.getByTestId('profile-manager').check();
  await page.getByTestId('delegate-beta').check();
  await openGroup(page, 'Permissions');
  await page.getByTestId('permission-bash').selectOption('deny');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.profiles[0]).toMatchObject({ modelId: 'model-two', defaultAnthropicAccountId: 'account', isManager: true, allowedDelegatesJson: '["beta"]' });
  expect(JSON.parse(fixture.profiles[0].allowedMcpsJson)).toEqual({ other: ['keep'] });
  expect(JSON.parse(fixture.profiles[0].allowedSkillsJson!)).toHaveLength(24);
  expect(fixture.profiles[0].corePermissionsJson).toBe('{"bash":{"*":"deny","git *":"allow"}, "future":{"x":"deny"}}');
  await page.getByTestId('profile-beta').click(); await page.getByTestId('profile-alpha').click();
  await expect(page.getByTestId('permission-bash')).toHaveValue('deny');
  await openGroup(page, 'MCPs');
  await expect(page.getByTestId('mcp-server-tool-59')).not.toBeChecked();
  await openGroup(page, 'Provider, model & account');
  await expect(page.getByTestId('profile-account')).toHaveValue('account');
});

test('canonical fixture: advanced MCP server policy is warned, locked, and preserved through unrelated saves', async ({ page }) => {
  const raw = '{"server":{"mode":"capability-rules","allowedTools":{"include":["tool-*"],"exclude":["tool-9"]},"approval":{"write":"ask"},"future":{"weight":1e+03}},"other":["keep"]}';
  const fixture = await openCanonicalFixture(page, { allowedMcpsJson: raw });
  await openGroup(page, 'MCPs');
  const group = page.locator('.profile-capability-group').filter({ has: page.locator('summary strong', { hasText: /^server$/ }) });
  await expect(group.locator('summary')).toContainText('Advanced');
  await expect(group.getByRole('alert')).toContainText('Advanced MCP policy');
  await expect(page.getByTestId('mcp-server-tool-0')).toBeDisabled();
  await expect(group.getByRole('button', { name: 'Select all in group: server' })).toBeDisabled();
  await openGroup(page, 'Identity & instructions');
  await page.getByTestId('profile-label').fill('Advanced policy retained');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.profiles[0].allowedMcpsJson).toBe(raw);
});

test('canonical fixture: pending save blocks switching and a failure retains the original draft for retry', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  fixture.reject(true); fixture.hold();
  await page.getByTestId('profile-label').fill('Edited alpha');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Saving profile…');
  await expect(page.getByTestId('profile-beta')).toBeDisabled();
  await expect(page.getByTestId('profile-create')).toBeDisabled();
  await expect(page.getByTestId('profile-cancel')).toBeDisabled();
  await expect.poll(() => fixture.writes.length).toBe(1);
  fixture.release();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible();
  await expect(page.getByTestId('profile-label')).toHaveValue('Edited alpha');
  await page.getByTestId('profile-beta').click();
  await page.getByTestId('profile-keep-editing').click();
  fixture.reject(false);
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.map(write => write.id)).toEqual(['alpha', 'alpha']);
  expect(fixture.profiles[0].label).toBe('Edited alpha'); expect(fixture.profiles[1].label).toBe('beta');
});

test('task-profile-allowed-skills-management-c1: Allowed skills exposes exact All, Selected, and No semantics', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  const policy = page.getByRole('radiogroup', { name: 'Allowed skills' });
  await expect(policy).toBeVisible();
  await expect(policy.getByRole('radio', { name: /^All skills/ })).toBeChecked();
  await expect(policy).toContainText('future');
  await expect(page.getByText(/cannot be saved/i)).toHaveCount(0);
});

test('task-profile-allowed-skills-management-c2: policy transitions preserve effective access without conflating null and empty lists', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('25 selected');
  await page.getByRole('radio', { name: /^No skills/ }).check();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('No skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('0 selected');
  await page.getByTestId('profile-save').click();
  expect(fixture.writes.at(-1)?.body.allowedSkillsJson).toBe('[]');
  await page.getByRole('radio', { name: /^All skills/ }).check();
  await page.getByTestId('profile-save').click();
  expect(fixture.writes.at(-1)?.body.allowedSkillsJson).toBeNull();
});

test('task-profile-allowed-skills-management-c3: filtered bulk actions affect only shown skills and unknown saved names stay removable', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.getByTestId('profile-capability-filter').fill('skill-1');
  await page.getByRole('button', { name: 'Clear all shown skills' }).click();
  await expect(page.getByRole('button', { name: 'Select all shown skills' })).toBeVisible();
  await page.getByTestId('profile-capability-filter').fill('');
  await expect(page.getByTestId('skill-skill-0')).toBeChecked();
  await expect(page.getByTestId('skill-skill-1')).not.toBeChecked();
});

test('task-profile-allowed-skills-management-c4: catalog failure preserves policy controls and the dirty draft', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.getByTestId('skill-skill-0').uncheck();
  await page.route('**/opencode/skills', route => route.fulfill({ status: 503, json: { error: 'private path /tmp/do-not-leak' } }));
  await page.getByRole('button', { name: 'Refresh skill catalog' }).click();
  await expect(page.getByRole('radio', { name: /^Selected skills/ })).toBeChecked();
  await expect(page.getByTestId('skill-skill-0')).not.toBeChecked();
  await expect(page.getByRole('alert')).not.toContainText('/tmp/');
});

test('task-profile-allowed-skills-management-c5: save sends only changed skill policy and failure retains exact draft', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^No skills/ }).check();
  fixture.reject(true);
  await page.getByTestId('profile-save').click();
  await expect(page.getByRole('radio', { name: /^No skills/ })).toBeChecked();
  expect(fixture.writes.at(-1)?.body).toEqual({ allowedSkillsJson: '[]' });
});

test('task-profile-allowed-skills-management-c6: add skill dialog validates a create-only slug and required instructions', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  await expect(dialog).toContainText(/global/i);
  await dialog.getByLabel('Name').fill('Not Valid');
  await dialog.getByLabel('Skill instructions').fill('Do the work');
  await expect(dialog.getByRole('button', { name: 'Create skill' })).toBeDisabled();
});

test('task-profile-allowed-skills-management-c7: create refreshes the catalog and auto-selects only in Selected policy', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  const createSkill = async (name: string) => {
    await page.getByRole('button', { name: 'Add skill' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add managed skill' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Skill instructions').fill(`Instructions for ${name}`);
    await dialog.getByRole('button', { name: 'Create skill' }).click();
    await expect(dialog).toHaveCount(0);
  };

  await createSkill('created-under-all');
  await expect(page.getByRole('radio', { name: /^All skills/ })).toBeChecked();
  await page.getByRole('radio', { name: /^No skills/ }).check();
  const noModeStatus = await page.getByTestId('profile-save-status').textContent();
  await createSkill('created-under-none');
  await expect(page.getByRole('radio', { name: /^No skills/ })).toBeChecked();
  await expect(page.getByTestId('profile-save-status')).toHaveText(noModeStatus!);
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await expect(page.getByTestId('skill-created-under-all')).not.toBeChecked();
  await expect(page.getByTestId('skill-created-under-none')).not.toBeChecked();
  await createSkill('created-under-selected');
  await expect(page.getByTestId('skill-created-under-selected')).toBeChecked();
  expect(fixture.skillWrites.filter(write => write.method === 'POST')).toHaveLength(3);
  expect(fixture.writes).toHaveLength(0);
});

test('task-profile-allowed-skills-management-c8: only managed skills can fetch content and open Edit', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.getByRole('button', { name: 'Edit skill skill-0' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit managed skill' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit skill skill-13' })).toHaveCount(0);
});

test('task-profile-allowed-skills-management-c9: delete names the global skill and removes it from an explicit draft only after success', async ({ page }) => {
  const fixture = await openCanonicalFixture(page, { allowedSkillsJson: '["skill-0"]' });
  await openGroup(page, 'Allowed skills');
  await expect(page.getByTestId('skill-skill-0')).toBeChecked();
  await page.getByRole('button', { name: 'Delete skill skill-0' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete managed skill' });
  await expect(dialog).toContainText('skill-0');
  await expect(dialog).toContainText(/global/i);
  fixture.rejectSkillDelete(true);
  await dialog.getByRole('button', { name: 'Delete skill' }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('skill-skill-0')).toBeChecked();
  expect(fixture.skills.some(skill => skill.name === 'skill-0')).toBe(true);
  fixture.rejectSkillDelete(false);
  await dialog.getByRole('button', { name: 'Delete skill' }).click();
  await expect(page.getByTestId('skill-skill-0')).toHaveCount(0);
  await page.getByTestId('profile-beta').click();
  await page.getByTestId('profile-discard').click();
  await expect(page.getByTestId('profile-beta')).toHaveClass(/selected/);
  await expect(page.getByTestId('skill-skill-0')).toBeChecked();
  expect(fixture.writes).toHaveLength(0);
});

test('task-profile-allowed-skills-management-c10: profile switching closes CRUD dialogs and mutation controls prevent double submit', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  await dialog.getByLabel('Name').fill('held-skill');
  await dialog.getByLabel('Skill instructions').fill('Held instructions');
  fixture.holdSkill();
  await dialog.getByRole('button', { name: 'Create skill' }).click();
  await expect.poll(() => fixture.skillWrites.filter(write => write.method === 'POST').length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await dialog.locator('form').dispatchEvent('submit');
  expect(fixture.skillWrites.filter(write => write.method === 'POST')).toHaveLength(1);
  await page.evaluate(() => { window.location.hash = '#/profiles?profile=beta'; });
  await expect(page.getByTestId('profile-beta')).toHaveClass(/selected/);
  await expect(dialog).toHaveCount(0);
  fixture.releaseSkill();
  await expect.poll(() => fixture.skills.some(skill => skill.name === 'held-skill')).toBe(true);
  await expect(page.getByTestId('profile-beta')).toHaveClass(/selected/);
  await expect(page.getByTestId('profile-save-status')).toHaveText('No unsaved changes');
  await expect(page.getByTestId('skill-held-skill')).toHaveCount(0);
  expect(fixture.skillWrites.filter(write => write.method === 'POST')).toHaveLength(1);
});

test('task-profile-allowed-skills-management-c11: skill API errors are sanitized', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.route('**/opencode/skills/skill-0/content', route => route.fulfill({ status: 500, json: { error: 'private /tmp/path/SKILL.md' } }));
  await page.getByRole('button', { name: 'Edit skill skill-0' }).click();
  await expect(page.getByRole('alert')).toContainText('Load skill content failed (500)');
  await expect(page.getByRole('alert')).not.toContainText(/\/tmp|SKILL\.md/);
  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  await dialog.getByLabel('Name').fill('failed-skill');
  await dialog.getByLabel('Skill instructions').fill('Keep these instructions');
  await page.route('**/opencode/skills', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: 'private /tmp/path/SKILL.md' } })
    : route.fallback());
  await dialog.getByRole('button', { name: 'Create skill' }).click();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(dialog.getByRole('alert')).toContainText('Create skill failed (500)');
  await expect(dialog.getByRole('alert')).not.toContainText(/\/tmp|SKILL\.md/);
  await expect(dialog.getByLabel('Skill instructions')).toHaveValue('Keep these instructions');
});

test('task-profile-allowed-skills-management-c12: policy and CRUD controls remain accessible at 720px', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 500 });
  await openCanonicalFixture(page);
  // The E22 harness prints a raw JSON receipt beside the app; it is not part of the product surface.
  await page.locator('#root > pre').evaluate(element => { element.hidden = true; });
  await openGroup(page, 'Allowed skills');
  const selected = page.getByRole('radio', { name: /^Selected skills/ });
  await selected.focus();
  await page.keyboard.press('Space');
  await expect(selected).toBeChecked();
  const add = page.getByRole('button', { name: 'Add skill' });
  await add.focus();
  await page.keyboard.press('Enter');
  let dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog', { name: 'Add managed skill' });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
  const measure = async (targets: Locator[], minimum: number) => {
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, 'control must be rendered').not.toBeNull();
      expect(box!.width, `control width must be at least ${minimum}px`).toBeGreaterThanOrEqual(minimum);
      expect(box!.height, `control height must be at least ${minimum}px`).toBeGreaterThanOrEqual(minimum);
    }
  };
  // Inspector (policy) controls keep 44px targets.
  await measure([
    ...await page.locator('.profile-skill-policy > label').all(),
    page.getByRole('button', { name: 'Refresh skill catalog' }), add,
    dialog.getByLabel('Name'), dialog.getByLabel('Description'), dialog.getByRole('button', { name: 'Cancel' }), dialog.getByRole('button', { name: 'Create skill' }),
  ], 44);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  // The dense list column uses 24px targets on this fine pointer (44px on coarse pointers, see the list spec).
  await showList(page);
  await measure([
    page.getByRole('button', { name: 'Select all skills' }), page.getByRole('button', { name: 'Clear all skills' }),
    page.getByTestId('profile-capability-filter'), page.getByTestId('skill-skill-0').locator('..'),
    page.getByRole('button', { name: 'Edit skill skill-0' }), page.getByRole('button', { name: 'Delete skill skill-0' }),
  ], 24);
  for (const [name, target] of [['document', page.locator('html')], ['workspace', page.getByTestId('profiles-workspace')], ['list', page.getByTestId('settings-column-list')]] as const) {
    const width = await target.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(width.scroll <= width.client, `${name} must not overflow horizontally (${width.scroll} > ${width.client})`).toBe(true);
  }
});


test('task-profile-allowed-skills-management-c13: unknown saved skills survive stable exact policy PATCH and dirty navigation guard', async ({ page }) => {
  const fixture = await openCanonicalFixture(page, { allowedSkillsJson: '["z-unknown","skill-2","skill-2"]' });
  await openGroup(page, 'Allowed skills');
  await expect(page.getByRole('radio', { name: /^Selected skills/ })).toBeChecked();
  await expect(page.getByTestId('skill-z-unknown')).toBeChecked();
  await page.getByTestId('skill-z-unknown').evaluate((element: HTMLInputElement) => element.click());
  await page.getByTestId('profile-beta').click();
  await expect(page.getByTestId('profile-unsaved-dialog')).toBeVisible();
  await page.getByTestId('profile-keep-editing').click();
  await page.getByTestId('profile-save').click();
  expect(fixture.writes.at(-1)?.body).toEqual({ allowedSkillsJson: '["skill-2"]' });
  expect(fixture.profiles[0].allowedSkillsJson).toBe('["skill-2"]');
});

test('task-profile-allowed-skills-management-c14: managed CRUD stays global, external rows stay read-only, and policy screenshots are durable', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  const artifacts = '../../docs/ai/artifacts/2026-09-27-profile-allowed-skills-management';
  await page.screenshot({ path: `${artifacts}/all-skills-dark.png`, fullPage: true });
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  await page.getByTestId('profile-capability-filter').fill('skill-1');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: `${artifacts}/selected-filtered-light.png`, fullPage: true });
  await page.getByTestId('profile-capability-filter').fill('');
  await expect(page.getByRole('button', { name: 'Edit skill skill-13' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete skill skill-13' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit skill external-skill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete skill external-skill' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit skill skill-0' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit managed skill' });
  await expect(edit.getByLabel('Skill instructions')).toHaveValue('Instructions for skill-0');
  await edit.getByLabel('Skill instructions').fill('Updated instructions');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: `${artifacts}/edit-dialog-dark.png`, fullPage: true });
  await edit.getByRole('button', { name: 'Save skill' }).click();
  expect(fixture.skillWrites.at(-1)).toMatchObject({ method: 'PUT', path: '/opencode/skills/skill-0', body: { content: 'Updated instructions' } });
  await page.getByRole('button', { name: 'Delete skill skill-0' }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: `${artifacts}/delete-confirmation-light.png`, fullPage: true });
  await page.getByRole('dialog', { name: 'Delete managed skill' }).getByRole('button', { name: 'Delete skill' }).click();
  expect(fixture.skillWrites.at(-1)).toEqual({ method: 'DELETE', path: '/opencode/skills/skill-0' });
  await page.getByRole('radio', { name: /^No skills/ }).check();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: `${artifacts}/no-skills-dark.png`, fullPage: true });
});

const checklistNames = (scope: Locator) => scope.locator('.column-check-name').allTextContents();
const byName = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b));

test('column lists: skills sort by name both ways, filter, and select/clear only what is shown', async ({ page }) => {
  await openCanonicalFixture(page);
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  const list = page.getByTestId('settings-column-list');
  await expect(list).toBeVisible();
  const allNames = [...Array.from({ length: 24 }, (_, i) => `skill-${i}`), 'external-skill'];
  const sort = list.getByTestId('column-checklist-sort');
  await expect(sort).toHaveAccessibleName('Sort / Group skills');
  await expect(sort.locator('option')).toHaveText(['Name A→Z', 'Name Z→A', 'Group by source']);
  await shot(page, 'settings-profiles-skills-list');
  // Name sorts are one flat list across every source.
  await expect(list.locator('.profile-capability-group')).toHaveCount(0);
  expect(await checklistNames(list)).toEqual(byName(allNames));
  await sort.selectOption({ label: 'Name Z→A' });
  expect(await checklistNames(list)).toEqual(byName(allNames).reverse());
  await sort.selectOption({ label: 'Name A→Z' });
  expect(await checklistNames(list)).toEqual(byName(allNames));
  // The source still filters a flat list.
  await page.getByTestId('profile-capability-filter').fill('external');
  expect(await checklistNames(list)).toEqual(['external-skill']);
  await page.getByTestId('profile-capability-filter').fill('');
  // Description is a truncated secondary line with the full text as a tooltip.
  await expect(page.getByTestId('skill-skill-0').locator('..')).toHaveAttribute('title', 'skill-0 — Skill 0 description');

  await list.getByRole('button', { name: 'Clear all skills' }).click();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('0 selected');
  await page.getByTestId('profile-capability-filter').fill('skill-1');
  const shown = ['skill-1', ...Array.from({ length: 10 }, (_, i) => `skill-1${i}`)];
  expect(byName(await checklistNames(list))).toEqual(byName(shown));
  await list.getByRole('button', { name: 'Select all shown skills' }).click();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText(`${shown.length} selected`);
  await page.getByTestId('profile-capability-filter').fill('');
  await expect(page.getByTestId('skill-skill-1')).toBeChecked();
  await expect(page.getByTestId('skill-skill-0')).not.toBeChecked();
  await expect(groupsColumn(page).getByRole('option', { name: 'Allowed skills' })).toContainText(`Selected · ${shown.length} of 25`);
  // Compact single-line rows on this fine pointer.
  expect((await page.getByTestId('skill-skill-0').locator('..').boundingBox())!.height).toBeLessThanOrEqual(30);
});

test('column lists: MCP servers and tools sort by name; the policy choice lives in the inspector', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'MCPs');
  const list = page.getByTestId('settings-column-list');
  const groupNames = () => list.locator('.profile-capability-group > summary strong').allTextContents();
  expect(await groupNames()).toEqual(['other', 'server']);
  const server = list.locator('.profile-capability-group').filter({ has: page.locator('summary strong', { hasText: /^server$/ }) });
  const tools = byName(Array.from({ length: 60 }, (_, i) => `tool-${i}`));
  expect(await checklistNames(server)).toEqual(tools);
  // Server groups start collapsed; the filter opens groups with a match.
  await expect(list.locator('.profile-capability-group[open]')).toHaveCount(0);
  await expect(page.getByTestId('mcp-server-tool-1')).toBeHidden();
  await page.getByTestId('profile-mcp-filter').fill('tool-1');
  await expect(server).toHaveAttribute('open', '');
  await expect(page.getByTestId('mcp-server-tool-1')).toBeVisible();
  await page.getByTestId('profile-mcp-filter').fill('');
  await expect(server).not.toHaveAttribute('open', '');
  await server.locator('summary').click();
  await expect(page.getByTestId('mcp-server-tool-1')).toBeVisible();
  const sort = list.getByTestId('column-checklist-sort');
  await expect(sort.locator('option')).toHaveText(['Name A→Z', 'Name Z→A']);
  await sort.selectOption({ label: 'Name Z→A' });
  expect(await groupNames()).toEqual(['server', 'other']);
  expect(await checklistNames(server)).toEqual([...tools].reverse());
  // All / Selected / None policy (null = unrestricted, [] = deny-all).
  await expect(page.getByTestId('profile-mcp-mode-selected')).toBeChecked();
  await page.getByTestId('profile-mcp-mode-all').check();
  await expect(groupsColumn(page).getByRole('option', { name: 'MCPs' })).toContainText('All MCPs');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)?.body).toEqual({ allowedMcpsJson: null });
  await page.getByTestId('profile-mcp-mode-none').check();
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)?.body).toEqual({ allowedMcpsJson: '[]' });
  await expect(page.getByTestId('profile-mcp-summary')).toHaveText('No MCPs');
});

test('column lists: skills group by source and by tag, collapsed with counts and per-group select/clear', async ({ page }) => {
  await openCanonicalFixture(page, { skillTags: { 'skill-0': ['design', 'research'], 'skill-1': ['design'], 'external-skill': ['research'] } });
  await openGroup(page, 'Allowed skills');
  await page.getByRole('radio', { name: /^Selected skills/ }).check();
  const list = page.getByTestId('settings-column-list');
  const sort = list.getByTestId('column-checklist-sort');
  const groupNames = () => list.locator('.profile-capability-group > summary strong').allTextContents();
  const groupFor = (name: string) => list.locator('.profile-capability-group').filter({ has: page.locator('summary strong', { hasText: new RegExp(`^${name}$`) }) });
  await expect(sort.locator('option')).toHaveText(['Name A→Z', 'Name Z→A', 'Group by source', 'Group by tag']);

  await sort.selectOption({ label: 'Group by source' });
  expect(await groupNames()).toEqual(['external', 'managed', 'org']);
  await expect(list.locator('.profile-capability-group[open]')).toHaveCount(0);
  await expect(groupFor('managed').locator('summary')).toContainText('12 of 12 selected');

  await sort.selectOption({ label: 'Group by tag' });
  // A skill with several tags is listed under each; untagged skills go last under "No tag".
  expect(await groupNames()).toEqual(['design', 'research', 'No tag']);
  await expect(list.locator('.profile-capability-group[open]')).toHaveCount(0);
  expect(await checklistNames(groupFor('design'))).toEqual(['skill-0', 'skill-1']);
  expect(await checklistNames(groupFor('research'))).toEqual(['external-skill', 'skill-0']);
  await expect(groupFor('No tag').locator('summary')).toContainText('of 22 selected');
  await groupFor('design').locator('summary').click();
  await groupFor('design').getByRole('button', { name: 'Clear group: design' }).click();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('23 selected');
  await expect(groupFor('research').locator('summary')).toContainText('1 of 2 selected');
  await expect(page.getByTestId('skill-skill-0').first()).not.toBeChecked();
  await expect(page.getByTestId('skill-skill-2')).toBeChecked();
  await groupFor('research').locator('summary').click();
  await groupFor('research').getByRole('button', { name: 'Select all in group: research' }).click();
  await expect(page.getByTestId('profile-skills-summary')).toHaveText('24 selected');
  await expect(page.getByTestId('skill-skill-1')).not.toBeChecked();
});

test('Provider, model & account: providers and models come from the live catalog; switching provider swaps models', async ({ page }) => {
  const catalog = [
    { provider: 'anthropic', modelId: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', authorized: true, available: 'unknown' },
    { provider: 'anthropic', modelId: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', authorized: true, available: 'unknown' },
    { provider: 'openai', modelId: 'gpt-6-sol', displayName: 'GPT-6 Sol', authorized: true, available: 'unknown' },
    { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', authorized: true, available: true },
    { provider: 'github-copilot', modelId: '', displayName: 'github-copilot', authorized: false, available: false },
  ];
  const fixture = await openCanonicalFixture(page, { catalog, modelProvider: 'openai', modelId: 'gpt-5.6-sol' });
  await openGroup(page, 'Provider, model & account');
  const provider = page.getByTestId('profile-provider');
  const model = page.getByTestId('profile-model');
  await expect(provider).toHaveValue('openai');
  await expect(provider.locator('option')).toHaveText(['No preference', 'anthropic', 'openai', 'openrouter']);
  // Only the saved model that the catalog no longer offers is marked unavailable.
  await expect(model.locator('option')).toHaveText(['No preference', 'gpt-5.6-sol (unavailable)', 'GPT-6 Sol']);
  await provider.selectOption('anthropic');
  await expect(model).toHaveValue('');
  await expect(model.locator('option')).toHaveText(['No preference', 'Claude Sonnet 5.5', 'Claude Opus 5.5']);
  await model.selectOption('claude-opus-5-5');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)).toEqual({ id: 'alpha', body: { modelProvider: 'anthropic', modelId: 'claude-opus-5-5' } });
});

test('Provider, model & account: an empty first catalog read (engine timeout) is retried', async ({ page }) => {
  let reads = 0;
  const catalog = () => ++reads === 1 ? [] : [{ provider: 'openai', modelId: 'gpt-6-sol', displayName: 'GPT-6 Sol', authorized: true, available: 'unknown' }];
  await openCanonicalFixture(page, { catalog, modelProvider: 'openai', modelId: 'gpt-6-sol' });
  await openGroup(page, 'Provider, model & account');
  await expect(page.getByTestId('profile-provider').locator('option')).toHaveText(['No preference', 'openai'], { timeout: 10_000 });
  await expect(page.getByTestId('profile-model').locator('option')).toHaveText(['No preference', 'GPT-6 Sol']);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test('column lists: delegation targets sort, filter, select all and clear, then save', async ({ page }) => {
  const fixture = await openCanonicalFixture(page, { extraProfiles: ['gamma', 'delta'] });
  await openGroup(page, 'Delegation');
  const list = page.getByTestId('settings-column-list');
  expect(await checklistNames(list)).toEqual(['beta', 'delta', 'gamma']);
  await list.getByTestId('column-checklist-sort').selectOption({ label: 'Name Z→A' });
  expect(await checklistNames(list)).toEqual(['gamma', 'delta', 'beta']);
  await page.getByTestId('profile-delegate-filter').fill('ga');
  expect(await checklistNames(list)).toEqual(['gamma']);
  await list.getByRole('button', { name: 'Select all shown delegation targets' }).click();
  await page.getByTestId('profile-delegate-filter').fill('');
  await expect(page.getByTestId('delegate-gamma')).toBeChecked();
  await expect(page.getByTestId('delegate-beta')).not.toBeChecked();
  await list.getByRole('button', { name: 'Select all delegation targets' }).click();
  await expect(groupsColumn(page).getByRole('option', { name: 'Delegation' })).toContainText('3 delegation targets');
  await list.getByRole('button', { name: 'Clear all delegation targets' }).click();
  await page.getByTestId('delegate-delta').check();
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)?.body).toEqual({ allowedDelegatesJson: '["delta"]' });
});

test('Provider, model & account: default OpenAI account picker saves through the profile draft', async ({ page }) => {
  const fixture = await openCanonicalFixture(page);
  await openGroup(page, 'Provider, model & account');
  const picker = page.getByTestId('profile-openai-account');
  await expect(picker).toHaveValue('');
  await expect(picker.locator('option')).toHaveText(['Use the global default', 'Work · openai-work', 'Home · openai-home']);
  await picker.selectOption('openai-home');
  await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)).toEqual({ id: 'alpha', body: { defaultOpenaiAccountId: 'openai-home' } });
  await page.getByTestId('profile-beta').click(); await page.getByTestId('profile-alpha').click();
  await expect(page.getByTestId('profile-openai-account')).toHaveValue('openai-home');
  await page.getByTestId('profile-openai-account').selectOption('');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
  expect(fixture.writes.at(-1)?.body).toEqual({ defaultOpenaiAccountId: null });
});

test('column browser keyboard: arrows within Profiles, Enter/Right into settings, Left back', async ({ page }) => {
  await openCanonicalFixture(page);
  const alpha = page.getByTestId('profile-alpha');
  await alpha.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('profile-beta')).toBeFocused();
  await expect(alpha).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(groupsColumn(page).getByRole('option', { name: 'Identity & instructions' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(groupsColumn(page).getByRole('option', { name: 'Actions' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('profile-inspector')).toBeFocused();
  await expect(page.getByTestId('profile-delete')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(groupsColumn(page).getByRole('option', { name: 'Actions' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(alpha).toBeFocused();
  await expect.poll(() => new URL(page.url()).hash).toContain('profileSection=actions');
});

test('narrow Profiles drills in one column at a time with Back and forward to the list', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 700 });
  await openCanonicalFixture(page);
  await page.locator('#root > pre').evaluate(element => { element.hidden = true; });
  const columns = ['settings-column-profiles', 'settings-column-groups', 'settings-column-inspector'].map(id => page.getByTestId(id));
  await expect(columns[2]).toBeVisible();
  await expect(columns[0]).toBeHidden(); await expect(columns[1]).toBeHidden();
  await page.getByRole('button', { name: 'Back to Profile settings', exact: true }).click();
  await expect(columns[1]).toBeVisible(); await expect(columns[2]).toBeHidden();
  await page.getByRole('button', { name: 'Back to Profiles', exact: true }).click();
  await expect(columns[0]).toBeVisible();
  await page.getByTestId('profile-beta').click();
  await expect(columns[1]).toBeVisible();
  await groupsColumn(page).getByRole('option', { name: 'Delegation' }).click();
  await expect(columns[2]).toBeVisible();
  await page.getByRole('button', { name: 'Delegation targets' }).click();
  await expect(page.getByTestId('settings-column-list')).toBeVisible();
  await expect(page.getByTestId('delegate-alpha')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('coarse pointers', () => {
  test.use({ hasTouch: true });
  test('list rows and row actions grow to 44px targets', async ({ page }) => {
    await openCanonicalFixture(page, { allowedSkillsJson: '["skill-0"]' });
    await openGroup(page, 'Allowed skills');
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
    for (const target of [page.getByTestId('skill-skill-0').locator('..'), page.getByRole('button', { name: 'Edit skill skill-0' }), groupsColumn(page).getByRole('option', { name: 'Permissions' })]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test('live profile save survives a full UI reload', async ({ page }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the approved isolated Rhythm sandbox');
  const apiBase = process.env.RHYTHM_LIVE_API_URL;
  const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL;
  const productionApiBase = process.env.RHYTHM_LIVE_PRODUCTION_API_URL ?? 'https://api.invalid';
  const token = process.env.RHYTHM_LIVE_TOKEN;
  test.skip(!apiBase || !engineBase || !token, 'Set RHYTHM_LIVE_API_URL, RHYTHM_LIVE_ENGINE_URL, and RHYTHM_LIVE_TOKEN');
  const marker = `[SMOKE] profile-${Date.now()}`;
  let createdId = '';

  await page.route('**/tests/electron-e22-harness.tsx', async route => {
    const response = await route.fetch();
    const code = (await response.text())
      .replaceAll('env.VITE_RHYTHM_API_BASE', JSON.stringify(apiBase))
      .replaceAll('env.VITE_RHYTHM_ENGINE_BASE', JSON.stringify(engineBase))
      .replaceAll('env.VITE_RHYTHM_PRODUCTION_API_BASE', JSON.stringify(productionApiBase))
      .replaceAll('env.VITE_RHYTHM_LIVE_TOKEN', JSON.stringify(token));
    await route.fulfill({ response, body: code });
  });

  try {
    await page.goto('/tests/electron-e22-harness.html');
    await page.getByRole('button', { name: 'Switch surface' }).click();
    await page.getByTestId('profile-create').click();
    await page.getByTestId('profile-label').fill(marker);
    await page.getByTestId('profile-system-prompt').fill(`${marker} persisted instructions`);
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${apiBase}/agent-configs`);
    await page.getByTestId('profile-save').click();
    const payload = await (await created).json() as { id: string };
    createdId = payload.id;
    await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');

    await page.reload();
    await page.getByRole('button', { name: 'Switch surface' }).click();
    await page.getByTestId(`profile-${createdId}`).click();
    await expect(page.getByTestId('profile-label')).toHaveValue(marker);
    await expect(page.getByTestId('profile-system-prompt')).toHaveValue(`${marker} persisted instructions`);
  } finally {
    if (createdId) {
      await page.request.delete(`${apiBase}/agent-configs/${encodeURIComponent(createdId)}`, { headers: { Authorization: `Bearer ${token}` } });
    }
  }
});
