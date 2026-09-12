import { expect, test } from '@playwright/test';

for (const editor of ['builder', 'inspector']) {
  test(`e13-c4-${editor}: name-only renderer request retains canonical config, disabled state and explicit title clear`, async ({ page }) => {
    const rule = {
      id: 'e13', name: 'Disabled rule', source: 'rhythm', triggerKey: 'rhythm.task_due', enabled: false,
      triggerConfig: { leadDays: 3, teamIds: ['worship'], allDayOnly: false },
      actionType: 'create_task', sourceAccountId: 'retained-account',
      actionConfig: { titleTemplate: 'Follow {{title}}', messageTemplate: 'Message', templateName: 'Sunday Service Launch', facilityId: 'facility-sanctuary', tag: 'care', notesTemplate: 'Notes {{title}}', targetDay: 2, nested: { keep: true } },
      conditions: [{ field: 'title', operator: 'contains', value: 'Sunday' }],
      ownerId: 1, lastEvaluatedAt: null, lastMatchedAt: null, matchCountLastRun: 0, previewSample: null,
      createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z',
    };
    const patches: any[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4186') return route.continue();
      let body: unknown = [];
      if (url.pathname === '/automation-rules') body = [rule];
      if (url.pathname === '/automation-catalog/triggers') body = [{ key: editor === 'builder' ? 'rhythm.project_step_due' : rule.triggerKey, source: 'rhythm', label: 'Task due', configSchema: {} }];
      if (url.pathname === '/automation-catalog/actions') body = [{ key: 'create_task', label: 'Create task', configSchema: {} }];
      if (route.request().method() === 'PATCH') { const patch = route.request().postDataJSON(); patches.push(patch); body = { ...rule, ...patch }; }
      await route.fulfill({ json: body });
    });
    await page.goto('/#/automations');
    await expect(page.getByTestId('automation-rule-e13')).toBeVisible();
    if (editor === 'builder') await page.getByTestId('automation-invalid-edit').click();
    const form = page.getByTestId(editor === 'builder' ? 'automations-builder-dialog' : 'automation-direct-editor');
    await form.getByTestId('automation-name').fill('Renamed');
    await form.getByTestId('automation-builder-submit').click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({ name: 'Renamed', enabled: false, triggerConfig: rule.triggerConfig, actionConfig: rule.actionConfig, sourceAccountId: rule.sourceAccountId, conditions: rule.conditions });
    expect(patches[0].actionConfig).toEqual(rule.actionConfig);
    if (editor === 'builder') await page.getByTestId('automation-invalid-edit').click();
    await form.getByTestId('automation-title-template').fill('');
    await form.getByTestId('automation-builder-submit').click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1].actionConfig).toEqual({ ...rule.actionConfig, titleTemplate: '' });
  });
}

test('E35: live automation uses the integration account and complete typed action fields', async ({ page }) => {
  const rule = {
    id: 'e35', name: 'Gmail tag', source: 'gmail', triggerKey: 'gmail.email_received', enabled: false,
    triggerConfig: { label: 'inbox' }, actionType: 'tag_task', sourceAccountId: 'gmail-account',
    actionConfig: { titleTemplate: '{{subject}}', tag: 'follow-up', notes: '', targetDay: '' }, conditions: [], ownerId: 1,
    createdAt: '', updatedAt: '', lastEvaluatedAt: null, lastMatchedAt: null, matchCountLastRun: 0, previewSample: null,
  };
  const patches: any[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); if (url.origin === 'http://127.0.0.1:4186') return route.continue();
    let body: any = [];
    if (url.pathname === '/automation-rules') body = [rule];
    else if (url.pathname === '/automation-catalog/triggers') body = [{ key: rule.triggerKey, source: 'gmail', label: 'Email received', configSchema: {} }];
    else if (url.pathname === '/automation-catalog/actions') body = [{ key: 'tag_task', label: 'Tag task', configSchema: {} }];
    else if (url.pathname === '/automation-catalog/providers') body = [{ source: 'gmail', label: 'Gmail' }];
    else if (url.pathname === '/integrations/accounts') body = [{ id: 'gmail-account', provider: 'gmail', providerDisplayName: 'Gmail', availableTriggerFamilies: [], syncSupportMode: 'scheduled', status: 'connected', needsReauth: false, accountLabel: 'Staff inbox', email: 'staff@example.invalid', displayName: null, expiresAt: null, lastSyncedAt: null, errorMessage: null, scope: null }];
    if (route.request().method() === 'PATCH') { patches.push(route.request().postDataJSON()); body = { ...rule, ...patches.at(-1) }; }
    await route.fulfill({ json: body });
  });
  await page.goto('/#/automations');
  const editor = page.getByTestId('automation-direct-editor');
  await expect(editor.getByTestId('automation-account')).toContainText('Staff inbox');
  await editor.getByTestId('automation-tag').fill('urgent-follow-up');
  await editor.getByTestId('automation-builder-submit').click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ sourceAccountId: 'gmail-account', enabled: false, triggerConfig: { label: 'inbox' }, actionConfig: { titleTemplate: '{{subject}}', tag: 'urgent-follow-up', notes: '', targetDay: '' } });
});
