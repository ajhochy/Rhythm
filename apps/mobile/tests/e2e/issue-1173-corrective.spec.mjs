import { expect, test } from '@playwright/test';

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test('issue-1173-c14: Brain detail and edit persist through the real tool screen', async ({ page }) => {
  await openTool(page, 'Brain');
  await page.getByRole('button', { name: 'New memory' }).click();
  await page.getByLabel('Memory title').fill('Sunday handoff');
  await page.getByLabel('Memory content').fill('Call the volunteer coordinator.');
  await page.getByRole('button', { name: 'Save memory' }).click();

  await page.getByRole('button', { name: /^Sunday handoff\./ }).click();
  await expect(page.getByRole('heading', { name: 'Memory details' })).toBeVisible();
  await expect(page.getByText('Call the volunteer coordinator.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit memory' }).click();
  await page.getByLabel('Memory title').fill('Sunday volunteer handoff');
  await page.getByLabel('Memory content').fill('Call the coordinator before 4 PM.');
  await page.getByRole('button', { name: 'Save memory changes' }).click();
  await expect(page.getByText('Memory updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sunday volunteer handoff\./ })).toBeVisible();
  await expect(page.getByText('Call the coordinator before 4 PM.').first()).toBeVisible();
});

test('issue-1173-c15: Scheduled Jobs supports edit toggle run status and confirmed delete', async ({ page }) => {
  await openTool(page, 'Scheduled Jobs');
  await page.getByRole('button', { name: 'New scheduled job' }).click();
  await page.getByLabel('Job name').fill('Monday follow-up');
  await page.getByLabel('Cron schedule').fill('0 9 * * 1');
  await page.getByRole('button', { name: 'Save scheduled job' }).click();

  await page.getByRole('button', { name: 'Edit Monday follow-up' }).click();
  await page.getByLabel('Job name').fill('Tuesday follow-up');
  await page.getByLabel('Cron schedule').fill('0 10 * * 2');
  await page.getByRole('button', { name: 'Save scheduled job changes' }).click();
  await expect(page.getByRole('button', { name: /^Tuesday follow-up\./ })).toBeVisible();

  await page.getByRole('button', { name: 'Disable Tuesday follow-up' }).click();
  await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Enable Tuesday follow-up' }).click();
  await expect(page.getByText('Enabled', { exact: true }).first()).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Run Tuesday follow-up now' }).click();
  await expect(page.getByText('Last run: queued').first()).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Tuesday follow-up' }).click();
  await expect(page.getByRole('button', { name: /^Tuesday follow-up\./ })).not.toBeVisible();
});

test('issue-1173-c16: Profiles create edit full policy fields deny truthfully and delete', async ({ page }) => {
  await openTool(page, 'Profiles');
  await page.getByRole('button', { name: 'New profile' }).click();
  await page.getByLabel('Profile name').fill('Volunteer coordinator');
  await page.getByLabel('Profile prompt').fill('Coordinate volunteer follow-up.');
  await page.getByLabel('Model provider').fill('openai');
  await page.getByLabel('Model ID').fill('gpt-5.2');
  await page.getByLabel('Allowed delegates').fill('secretary, researcher');
  await page.getByLabel('Manager profile').click();
  await page.getByRole('button', { name: 'No permissions' }).click();
  await page.getByRole('button', { name: 'Create profile' }).click();
  await expect(page.getByText('Volunteer coordinator')).toBeVisible();

  await page.getByRole('button', { name: /^Volunteer coordinator\./ }).click();
  await page.getByLabel('Profile prompt').fill('forbidden profile change');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Only workspace administrators can edit agent profiles.')).toBeVisible();
  await expect(page.getByLabel('Profile prompt')).toBeVisible();

  await page.getByLabel('Profile prompt').fill('Coordinate volunteer follow-up safely.');
  await page.getByLabel('Model ID').fill('gpt-5.3');
  await page.getByLabel('Allowed delegates').fill('secretary');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Projected to OpenCode')).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Volunteer coordinator' }).click();
  await expect(page.getByRole('button', { name: /^Volunteer coordinator\./ })).not.toBeVisible();
});

test('issue-1173-c17: Cookbook Skills and Playbooks edit and confirm destructive deletes', async ({ page }) => {
  await openTool(page, 'Cookbook');
  await page.getByRole('button', { name: 'New recipe' }).click();
  await page.getByLabel('Recipe title').fill('Weekly volunteer recap');
  await page.getByLabel('Recipe instructions').fill('Summarize the volunteer week.');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await page.getByRole('button', { name: 'Edit Weekly volunteer recap' }).click();
  await page.getByLabel('Recipe instructions').fill('Summarize wins and follow-ups.');
  await page.getByRole('button', { name: 'Save recipe changes' }).click();
  await expect(page.getByText('Summarize wins and follow-ups.').first()).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Weekly volunteer recap' }).click();
  await expect(page.getByText('Weekly volunteer recap')).not.toBeVisible();

  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Skills\./ }).click();
  await page.getByRole('button', { name: 'Edit approved-skill' }).click();
  await page.getByLabel('Description').fill('Approved and edited from mobile.');
  await page.getByLabel('Skill content').fill('Perform the approved workflow safely.');
  await page.getByRole('button', { name: 'Save skill changes' }).click();
  await expect(page.getByText('Approved and edited from mobile.')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Delete approved-skill' }).click();
  await expect(page.getByText('approved-skill', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete approved-skill' }).click();
  await expect(page.getByText('approved-skill', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Playbooks\./ }).click();
  await page.getByRole('button', { name: 'Edit weekly-review' }).click();
  await page.getByLabel('Description').fill('Review the week with next actions.');
  await page.getByLabel('Playbook template').fill('Review, decide, and assign.');
  await page.getByRole('button', { name: 'Save playbook changes' }).click();
  await expect(page.getByText('Review the week with next actions.')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete weekly-review' }).click();
  await expect(page.getByText('weekly-review', { exact: true })).not.toBeVisible();
});

test('issue-1173-c18: Webhooks copy URL rotate a one-time secret and delete', async ({ page }) => {
  await openTool(page, 'Webhooks');
  await page.getByRole('button', { name: 'New webhook' }).click();
  await page.getByLabel('Webhook name').fill('Volunteer intake');
  await page.getByRole('button', { name: 'Save Webhooks' }).click();
  await expect(page.getByRole('heading', { name: 'Copy this webhook secret now' })).toBeVisible();
  await page.getByRole('button', { name: 'I saved it' }).click();

  await page.getByRole('button', { name: 'Copy Volunteer intake URL' }).click();
  await expect(page.getByText('Webhook URL copied.')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Rotate Volunteer intake secret' }).click();
  await expect(page.getByRole('heading', { name: 'Copy this webhook secret now' })).toBeVisible();
  await expect(page.getByText('rotated-e2e-webhook-secret')).toBeVisible();
  await page.getByRole('button', { name: 'I saved it' }).click();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Volunteer intake' }).click();
  await expect(page.getByText('Volunteer intake')).not.toBeVisible();
});

test('issue-1173-c19: MCP OAuth opens returned URL and reports callback error then completion', async ({ page }) => {
  await openTool(page, 'MCP');
  await page.context().route('https://example.test/**', (route) =>
    route.fulfill({ body: '<html><body>OAuth handoff</body></html>', contentType: 'text/html' }));
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Authenticate filesystem' }).click();
  const popup = await popupPromise;
  expect(popup.url()).toContain('/mcp/filesystem/authorize');
  await popup.close();

  await expect(page.getByLabel('MCP authorization code')).toBeVisible();
  await page.getByLabel('MCP authorization code').fill('bad-code');
  await page.getByRole('button', { name: 'Complete MCP authorization' }).click();
  await expect(page.getByText('The authorization code was rejected.')).toBeVisible();
  await page.getByLabel('MCP authorization code').fill('good-code');
  await page.getByRole('button', { name: 'Complete MCP authorization' }).click();
  await expect(page.getByText('MCP authorization completed.')).toBeVisible();
});

test('issue-1173-c20: Providers and Models expose truthful OAuth and credential lifecycle', async ({ page }) => {
  await openTool(page, 'Providers & Models');
  await page.context().route('https://example.test/**', (route) =>
    route.fulfill({ body: '<html><body>Provider OAuth handoff</body></html>', contentType: 'text/html' }));
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Authenticate OpenAI' }).click();
  const popup = await popupPromise;
  expect(popup.url()).toBe('https://example.test/oauth/complete');
  await popup.close();

  await page.getByLabel('Provider authorization code').fill('provider-code');
  await page.getByRole('button', { name: 'Complete provider authorization' }).click();
  await expect(page.getByText('OpenAI authorization completed.').first()).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove OpenAI credentials' }).click();
  await expect(page.getByText('OpenAI credentials removed.')).toBeVisible();
});
