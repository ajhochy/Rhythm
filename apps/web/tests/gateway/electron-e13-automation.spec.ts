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
