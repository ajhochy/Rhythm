import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseDemo, openFixture } from './helpers';

async function expectTrace(page: Page, route: string) {
  await expect(page.getByTestId('tool-trace')).toContainText(route);
}

test.describe('shipping-shaped Agents tools', () => {
  test('searches, expands, edits, and deletes Brain memories', async ({ page }) => {
    await openFixture(page, '#/tools/brain');
    await page.getByTestId('brain-search').fill('offline');
    await expect(page.getByTestId('brain-list')).toContainText('desktop relay is offline');
    await expectTrace(page, '/agent-memory/search');
    await page.getByTestId('brain-search').fill('');
    const memory = page.getByTestId('memory-memory-relay');
    await memory.getByRole('button').first().click();
    await page.getByTestId('brain-edit-memory-relay').click();
    await page.getByTestId('memory-editor').getByLabel('Content').fill('Keep every fixture run deterministic.');
    await page.getByTestId('memory-save').click();
    await expect(memory).toContainText('every fixture run');
    await expectTrace(page, '/agent-memory/memory-relay');
    await page.getByTestId('brain-delete-memory-relay').click();
    await page.getByTestId('memory-delete-dialog-confirm').click();
    await expect(memory).toHaveCount(0);
  });

  test('creates projects and exercises research run, retry, copy, archive, export, and discussion paths', async ({ page }) => {
    await openFixture(page, '#/tools/deep-research');
    await page.getByTestId('research-new-project').click();
    await page.getByTestId('research-project-dialog').getByLabel('Project name').fill('Agent workflow evidence');
    await page.getByTestId('research-project-dialog').getByLabel('Research question').fill('Which tool flows require human review?');
    await page.getByTestId('research-project-create').click();
    await expect(page.getByRole('heading', { name: 'Agent workflow evidence' })).toBeVisible();
    await page.getByTestId('research-start-run').click();
    await expectTrace(page, '/runs');
    await page.getByTestId('research-copy').click();
    await page.getByTestId('research-magazine').click();
    await page.getByTestId('research-export').click();
    await page.getByTestId('research-discuss').click();
    await expectTrace(page, '/discussions');
    await page.getByTestId('research-project-research-relay').click();
    await page.getByTestId('research-retry').click();
    await expectTrace(page, '/retry');
    await page.getByTestId('research-archive').click();
    await expect(page.getByTestId('research-project-research-relay')).toContainText('archived');
    await page.getByTestId('research-new-legacy').click();
    await page.getByTestId('research-legacy-dialog').getByLabel('Question / Topic').fill('Compare retry evidence.');
    await page.getByTestId('research-legacy-dialog').getByLabel('Deep').check();
    await page.getByTestId('research-legacy-start').click();
    await expectTrace(page, '/agent-research');
  });

  test('creates, edits, toggles, triggers, and deletes schedules; creates and revokes webhooks', async ({ page }) => {
    await openFixture(page, '#/tools/tasks');
    await page.getByTestId('schedule-new').click();
    await page.getByTestId('schedule-editor').getByLabel('Name').fill('Friday operations review');
    await page.getByTestId('schedule-editor').getByLabel('Instructions / Prompt').fill('Review unresolved operational handoffs.');
    await page.getByTestId('schedule-save').click();
    await expect(page.getByRole('heading', { name: 'Friday operations review' })).toBeVisible();
    await page.getByTestId('schedule-edit').click();
    await page.getByTestId('schedule-editor').getByLabel('Instructions / Prompt').fill('Review unresolved operational handoffs and owners.');
    await page.getByTestId('schedule-save').click();
    await page.getByTestId('schedule-toggle').click();
    await page.getByTestId('schedule-trigger').click();
    await expectTrace(page, '/trigger-now');
    await page.getByTestId('schedule-delete').click();
    await page.getByTestId('schedule-delete-dialog-confirm').click();
    await expect(page.getByRole('heading', { name: 'Friday operations review' })).toHaveCount(0);

    await openFixture(page, '#/tools/webhooks');
    await page.getByTestId('webhook-new').click();
    await page.getByTestId('webhook-editor').getByLabel('Name').fill('Planning Intake');
    await page.getByTestId('webhook-editor').getByLabel('Target prompt (optional)').fill('Open a planning session for this payload.');
    await page.getByTestId('webhook-create').click();
    await expect(page.getByTestId('webhook-success')).toContainText('/agent-webhooks/webhook-2/receive');
    await page.getByTestId('webhook-copy-created').click();
    await expect(page.getByText('Planning Intake')).toBeVisible();
    await page.getByTestId('webhook-delete-webhook-2').click();
    await page.getByTestId('webhook-delete-dialog-confirm').click();
    await expect(page.getByText('Planning Intake')).toHaveCount(0);
  });

  test('authors, edits, refreshes, and deletes managed skills and playbooks', async ({ page }) => {
    for (const kind of ['skills', 'playbooks'] as const) {
      await openFixture(page, `#/tools/${kind}`);
      await page.getByTestId(`${kind}-refresh`).click();
      await page.getByTestId(`${kind}-new`).click();
      await page.getByTestId(`${kind}-editor`).getByLabel('Name').fill(`fixture-${kind}`);
      await page.getByTestId(`${kind}-editor`).getByLabel('Description').fill(`A deterministic ${kind} fixture.`);
      await page.getByTestId(`${kind}-editor`).getByLabel(kind === 'skills' ? 'SKILL.md content' : 'Command template').fill(kind === 'skills' ? '# Fixture skill\n\nVerify the active flow.' : 'Review $ARGUMENTS and cite evidence.');
      await page.getByTestId(`${kind}-save`).click();
      await expect(page.getByRole('heading', { name: kind === 'skills' ? 'fixture-skills' : '/fixture-playbooks' })).toBeVisible();
      await page.getByTestId(`${kind}-edit`).click();
      await page.getByTestId(`${kind}-editor`).getByLabel('Description').fill(`An updated deterministic ${kind} fixture.`);
      await page.getByTestId(`${kind}-save`).click();
      await expect(page.getByText(`An updated deterministic ${kind} fixture.`)).toBeVisible();
      await page.getByTestId(`${kind}-delete`).click();
      await page.getByTestId(`${kind}-delete-dialog-confirm`).click();
      await expect(page.getByTestId(`${kind}-item-fixture-${kind}`)).toHaveCount(0);
    }
  });

  test('runs Cookbook recipes and preserves the Review Queue human gate', async ({ page }) => {
    await openFixture(page, '#/tools/cookbook');
    await page.getByTestId('cookbook-new').click();
    await page.getByTestId('cookbook-editor').getByLabel('Title').fill('Verify release handoff');
    await page.getByTestId('cookbook-editor').getByLabel('Description').fill('Checks a release handoff.');
    await page.getByTestId('cookbook-editor').getByLabel('Steps (one per line)').fill('Read evidence\nRun checks\nReport gaps');
    await page.getByTestId('cookbook-save').click();
    await page.getByTestId('cookbook-run-recipe-2').click();
    await expect(page.getByTestId('recipe-recipe-2')).toContainText('Running');
    await expectTrace(page, '/run');
    await page.getByTestId('cookbook-delete-recipe-2').click();
    await page.getByTestId('cookbook-delete-dialog-confirm').click();
    await expect(page.getByTestId('recipe-recipe-2')).toHaveCount(0);

    await openFixture(page, '#/tools/review');
    await page.getByTestId('proposal-expand-proposal-research-agent').click();
    await expect(page.getByTestId('proposal-proposal-research-agent')).toContainText('verified runs');
    await page.getByTestId('proposal-approve-proposal-research-agent').click();
    await page.getByTestId('review-filter').selectOption('approved');
    await expect(page.getByText('Adopt research-librarian profile')).toBeVisible();
    await page.getByTestId('review-filter').selectOption('proposed');
    await page.getByTestId('proposal-reject-proposal-review-skill').click();
    await page.getByTestId('proposal-reject-dialog-confirm').click();
    await page.getByTestId('review-filter').selectOption('rejected');
    await expect(page.getByText('Promote verification skill')).toBeVisible();
  });

  test('filters Report Card detail and launches Email and Creative Media sessions with seeded context', async ({ page }) => {
    await openFixture(page, '#/tools/report-card');
    await page.getByTestId('report-window').selectOption('7');
    await expectTrace(page, 'windowDays=7');
    await page.getByTestId('report-agent-builder').click();
    await expect(page.getByRole('heading', { name: 'Implementation Partner' })).toBeVisible();

    await openFixture(page, '#/tools/email');
    await page.getByTestId('email-signal-email-relay').click();
    await expect(page.getByRole('heading', { name: 'Relay recovery notes' })).toBeVisible();
    await page.getByTestId('email-launch').click();
    await expect(page).toHaveURL(/#\/agents/);
    await expect(page.getByRole('heading', { name: 'Email Assistant' })).toBeVisible();
    await expect(page.getByTestId('transcript')).toContainText('Seeded Gmail context');

    await openFixture(page, '#/tools/gallery');
    await page.getByTestId('design-design-relay-card').getByRole('button', { name: 'Select Relay status card' }).click();
    await page.getByTestId('gallery-open-design-relay-card').click();
    await expectTrace(page, '/artifact');
    await page.getByTestId('gallery-launch').click();
    await expect(page.getByRole('heading', { name: 'Graphic Designer' })).toBeVisible();
    await expect(page.getByTestId('transcript')).toContainText('Seeded Creative Media context');
  });

  test('keeps constrained header actions reachable and disables every unresumable composer control', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFixture(page);
    await expect(page.getByTestId('session-stop')).toHaveCount(0);
    await expect(page.getByTestId('session-model')).toHaveCount(0);
    await expect(page.getByTestId('session-thinking')).toHaveCount(0);
    await expect(page.getByTestId('session-fast')).toHaveCount(0);
    await expect(page.getByTestId('composer-cancel')).toBeVisible();
    await expect(page.getByTestId('composer-model')).toBeVisible();
    await expect(page.getByTestId('composer-thinking')).toBeVisible();
    await expect(page.getByTestId('composer-fast')).toBeVisible();
    await expect(page.getByTestId('prepare-project')).toBeVisible();
    await page.getByTestId('prepare-project').click();
    await expect(page.getByTestId('prepare-project-dialog')).toBeVisible();
    await page.getByTestId('prepare-project-dialog-close').click();

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.getByTestId('session-actions').click();
    await expect(page.getByTestId('session-actions-prepare')).toBeVisible();
    await page.getByTestId('session-actions-prepare').click();
    await expect(page.getByTestId('prepare-project-dialog')).toBeVisible();
    await page.getByTestId('prepare-project-dialog-close').click();

    await chooseDemo(page, 'completed');
    for (const testId of ['composer-input', 'composer-send', 'composer-profile', 'composer-model', 'composer-permission-mode', 'composer-thinking', 'composer-fast', 'composer-attach']) {
      await expect(page.getByTestId(testId)).toBeDisabled();
    }
    await expect(page.getByText('Resume this completed session before sending.').first()).toBeVisible();
  });

  test('audits every Agents tool page for named controls, real state changes, and blocking accessibility violations', async ({ page }) => {
    const tools = ['brain', 'deep-research', 'tasks', 'webhooks', 'skills', 'playbooks', 'cookbook', 'review', 'report-card', 'email', 'gallery'];
    const safeAction: Record<string, string> = { brain: 'brain-refresh', 'deep-research': 'research-copy', tasks: 'schedules-refresh', webhooks: 'webhooks-refresh', skills: 'skills-refresh', playbooks: 'playbooks-refresh', cookbook: 'cookbook-refresh', review: 'review-refresh', 'report-card': 'report-refresh', email: 'email-refresh', gallery: 'gallery-refresh' };
    for (const slug of tools) {
      await openFixture(page, `#/tools/${slug}`);
      const unnamed = await page.locator('button:visible').evaluateAll((buttons) => buttons.filter((button) => !(button.getAttribute('aria-label') || button.textContent || '').trim()).length);
      expect(unnamed, `${slug} has an unnamed visible button`).toBe(0);
      const before = await page.getByTestId('tool-trace').textContent();
      await page.getByTestId(safeAction[slug]).click();
      const after = await page.getByTestId('tool-trace').textContent();
      expect(after, `${slug} action did not produce observable endpoint trace`).not.toBe(before);
      const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
      const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
      expect(blocking, `${slug}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
    }
  });
});
