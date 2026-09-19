import { expect, test } from '@playwright/test';
import { openFixture } from '../helpers';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

const selectableTools = [
  { slug: 'brain', first: 'Sunday handoffs must identify a livestream fallback owner before publishing.', second: 'When the desktop relay is offline, keep drafts local and state that they have not been sent.' },
  { slug: 'deep-research', first: 'Service accessibility', second: 'Relay compatibility' },
  { slug: 'tasks', first: 'Monday planning digest', second: 'Integration health sweep' },
  { slug: 'skills', first: 'verification', second: 'research' },
  { slug: 'playbooks', first: '/review', second: '/status' },
  { slug: 'review', first: 'Adopt research-librarian profile', second: 'Promote verification skill' },
  { slug: 'report-card', first: 'Rhythm Coordinator', second: 'Implementation Partner' },
  { slug: 'email', first: 'Sunday handoff owner', second: 'Relay recovery notes' },
  { slug: 'gallery', first: 'Sunday service announcement', second: 'Relay status card' },
] as const;

test('issue-1513-c6: mouse and keyboard selection update each inspector', async ({ page }, testInfo) => {
  for (const tool of selectableTools) {
    await openFixture(page, `#/tools/${tool.slug}`);
    await selectRow(page, tool.first);
    await expectInspectorHeading(page, tool.first);
    await selectRow(page, tool.second);
    await expectInspectorHeading(page, tool.second);
    await page.screenshot({ path: testInfo.outputPath(`issue-1513-${tool.slug}.png`), fullPage: true });
  }

  await openFixture(page, '#/tools/webhooks');
  await page.getByTestId('webhook-new').click();
  await page.getByTestId('webhook-editor').getByLabel('Name').fill('Planning Intake');
  await page.getByTestId('webhook-create').click();
  await page.getByTestId('webhook-copy-created').click();
  await selectRow(page, 'GitHub Push Handler');
  await expectInspectorHeading(page, 'GitHub Push Handler');
  await selectRow(page, 'Planning Intake');
  await expectInspectorHeading(page, 'Planning Intake');
  await page.screenshot({ path: testInfo.outputPath('issue-1513-webhooks.png'), fullPage: true });

  await openFixture(page, '#/tools/cookbook');
  await page.getByTestId('cookbook-new').click();
  await page.getByTestId('cookbook-editor').getByLabel('Title').fill('Verify release handoff');
  await page.getByTestId('cookbook-editor').getByLabel('Steps (one per line)').fill('Read evidence\nReport gaps');
  await page.getByTestId('cookbook-save').click();
  await selectRow(page, 'Review an agent handoff');
  await expectInspectorHeading(page, 'Review an agent handoff');
  await selectRow(page, 'Verify release handoff');
  await expectInspectorHeading(page, 'Verify release handoff');
  await page.screenshot({ path: testInfo.outputPath('issue-1513-cookbook.png'), fullPage: true });

  await openFixture(page, '#/tools/brain');
  await keyboardSelect(page, { fromTitle: selectableTools[0].first, presses: ['ArrowDown', 'Enter'] });
  await expectSelected(page, selectableTools[0].second);
  await expectInspectorHeading(page, selectableTools[0].second);
});

test('issue-1513-c5: every item action remains reachable from its inspector', async ({ page }) => {
  const cases = [
    { slug: 'brain', title: selectableTools[0].first, actions: ['brain-edit-memory-handoff', 'brain-delete-memory-handoff'] },
    { slug: 'deep-research', title: selectableTools[1].first, actions: ['research-start-run', 'research-archive', 'research-copy', 'research-magazine', 'research-export', 'research-discuss'] },
    { slug: 'tasks', title: selectableTools[2].first, actions: ['schedule-toggle', 'schedule-edit', 'schedule-delete', 'schedule-trigger'] },
    { slug: 'webhooks', title: 'GitHub Push Handler', actions: ['webhook-copy-webhook-github', 'webhook-delete-webhook-github'] },
    { slug: 'skills', title: 'verification', actions: ['skills-edit', 'skills-delete'] },
    { slug: 'playbooks', title: '/review', actions: ['playbooks-edit', 'playbooks-delete'] },
    { slug: 'cookbook', title: 'Review an agent handoff', actions: ['cookbook-run-recipe-handoff', 'cookbook-delete-recipe-handoff'] },
    { slug: 'review', title: selectableTools[5].first, actions: ['proposal-expand-proposal-research-agent', 'proposal-reject-proposal-research-agent', 'proposal-approve-proposal-research-agent'] },
    { slug: 'report-card', title: selectableTools[6].first, actions: ['report-run-evidence'] },
    { slug: 'email', title: selectableTools[7].first, actions: ['email-launch'] },
    { slug: 'gallery', title: selectableTools[8].first, actions: ['gallery-open-design-service-slide', 'gallery-project-design-service-slide', 'gallery-launch'] },
  ] as const;

  for (const item of cases) {
    await openFixture(page, `#/tools/${item.slug}`);
    await selectRow(page, item.title);
    const inspector = page.getByTestId('list-inspector-detail');
    for (const action of item.actions) await expect(inspector.getByTestId(action), `${item.slug}:${action}`).toBeVisible();
  }

  await openFixture(page, '#/tools/deep-research');
  await selectRow(page, selectableTools[1].second);
  await expect(page.getByTestId('list-inspector-detail').getByTestId('research-retry')).toBeVisible();
});

test('issue-1513-c8: deep links restore selection and missing ids show not found', async ({ page }) => {
  await openFixture(page, '#/tools/email?emailId=email-relay');
  await expectSelected(page, 'Relay recovery notes');
  await expectInspectorHeading(page, 'Relay recovery notes');
  await page.reload();
  await expectInspectorHeading(page, 'Relay recovery notes');

  await openFixture(page, '#/tools/brain?memoryId=deleted');
  await expectInspectorHeading(page, 'Item not found');
  await expect(page.getByTestId('list-inspector-detail').getByRole('status')).toContainText('no longer available');

  await openFixture(page, '#/tools/brain');
  await selectRow(page, selectableTools[0].first);
  await page.getByTestId('brain-delete-memory-handoff').click();
  await page.getByTestId('memory-delete-dialog-confirm').click();
  await expectInspectorHeading(page, 'Item not found');
});

test('issue-1513-c7: edge states remain accessible at narrow width and 200 percent zoom', async ({ page }, testInfo) => {
  await openFixture(page, '#/tools/brain');
  await page.getByRole('searchbox', { name: 'Search Agent memories' }).fill('no-result-value');
  await expect(page.getByText('No results match your search.')).toBeVisible();

  for (const state of ['loading', 'server-error', 'empty', 'readonly']) {
    await page.getByTestId('tool-state-select').selectOption(state);
    await expect(page.getByTestId(state === 'server-error' ? 'tool-state-server-error' : `tool-state-${state}`)).toBeVisible();
  }

  await page.getByTestId('tool-state-select').selectOption('ready');
  await atNarrow(page);
  await expect(page.getByRole('option', { name: selectableTools[0].second }).locator('strong')).toHaveAttribute('title', selectableTools[0].second);
  await selectRow(page, selectableTools[0].second);
  await expectInspectorHeading(page, selectableTools[0].second);
  await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('issue-1513-narrow.png'), fullPage: true });

  await openFixture(page, '#/tools/gallery');
  await atZoom200(page);
  await selectRow(page, selectableTools[8].second);
  await expectInspectorHeading(page, selectableTools[8].second);
  await expectListInspectorAxeClean(page);
  await page.screenshot({ path: testInfo.outputPath('issue-1513-zoom-200.png'), fullPage: true });
});
