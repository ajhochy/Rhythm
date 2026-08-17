import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers';

async function expectTrace(page: Page, value: string) {
  await expect(page.getByTestId('tool-trace')).toContainText(value);
}

test('exercises every secondary Tool path with exact endpoint-ledger receipts', async ({ page }) => {
  test.setTimeout(60_000);
  await openFixture(page, '#/tools/brain');
  await page.getByTestId('brain-refresh').click();
  await expectTrace(page, '/agent-memory');
  await page.getByTestId('brain-search').fill('handoff owner');
  await expectTrace(page, '/agent-memory/search?q=handoff%20owner');

  await openFixture(page, '#/tools/deep-research');
  await page.getByTestId('research-project-research-relay').click();
  await expectTrace(page, '/agent-research/projects/research-relay/runs');
  for (const tab of ['Synthesis', 'Passes', 'Contrarian Review', 'Sources', 'Statistics']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expectTrace(page, '/agent-research/projects/research-relay/runs/run-relay-02');
  }
  await page.getByTestId('research-copy').click();
  await expectTrace(page, 'clipboard.writeText');
  await page.getByTestId('research-magazine').click();
  await expectTrace(page, '/magazine');
  await page.getByTestId('research-export').click();
  await expectTrace(page, '/export?format=html');
  await page.getByTestId('research-discuss').click();
  await expectTrace(page, '/discussions');

  await openFixture(page, '#/tools/tasks');
  await page.getByTestId('schedules-refresh').click();
  await expectTrace(page, '/agent-schedules');
  await page.getByTestId('schedule-schedule-health').click();
  await expectTrace(page, '/agent-sessions?scheduledTaskId=schedule-health');
  await page.getByRole('button', { name: /Integration health sweep · manual run/ }).click();
  await expectTrace(page, '/agent-sessions?scheduledTaskId=schedule-health');

  await openFixture(page, '#/tools/webhooks');
  await page.getByTestId('webhooks-refresh').click();
  await expectTrace(page, '/agent-webhooks');
  await page.getByTestId('webhook-copy-webhook-github').click();
  await expectTrace(page, 'clipboard.writeText');

  await openFixture(page, '#/tools/skills');
  await page.getByTestId('skills-item-research').click();
  await expectTrace(page, '/opencode/skills/research/content');
  await expect(page.getByTestId('skills-edit')).toHaveCount(0);
  await page.getByTestId('skills-refresh').click();
  await expectTrace(page, '/system/refresh');
  await page.getByTestId('skills-search').fill('does-not-exist');
  await expect(page.getByText('No skills match')).toBeVisible();
  await page.getByTestId('skills-clear-search').click();

  await openFixture(page, '#/tools/playbooks');
  await page.getByTestId('playbooks-item-status').click();
  await expectTrace(page, '/opencode/commands/status/content');
  await expect(page.getByTestId('playbooks-edit')).toHaveCount(0);
  await page.getByTestId('playbooks-refresh').click();
  await expectTrace(page, '/opencode/commands');
  await page.getByTestId('playbooks-search').fill('does-not-exist');
  await expect(page.getByText('No playbooks match')).toBeVisible();
  await page.getByTestId('playbooks-clear-search').click();

  await openFixture(page, '#/tools/cookbook');
  await page.getByTestId('cookbook-refresh').click();
  await expectTrace(page, '/agent-cookbook');

  await openFixture(page, '#/tools/review');
  await page.getByTestId('review-filter').selectOption('approved');
  await expectTrace(page, '/agent-org-proposals?status=approved');
  await page.getByTestId('review-refresh').click();
  await expectTrace(page, '/agent-org-proposals?status=approved');

  await openFixture(page, '#/tools/report-card');
  await page.getByRole('button', { name: /Sunday service handoff/ }).click();
  await expectTrace(page, '/agents/run-quality?windowDays=30');
  await page.getByTestId('report-refresh').click();
  await expectTrace(page, '/agents/run-quality?windowDays=30');

  await openFixture(page, '#/tools/email');
  await page.getByTestId('email-refresh').click();
  await expectTrace(page, '/integrations/gmail-signals');
  await page.getByTestId('email-signal-email-relay').click();
  await expect(page.getByRole('heading', { name: 'Relay recovery notes' })).toBeVisible();

  await openFixture(page, '#/tools/gallery');
  await page.getByTestId('gallery-open-design-service-slide').click();
  await expectTrace(page, '/agent-designs/design-service-slide/artifact');
  await page.getByTestId('gallery-project-design-service-slide').click();
  await expect(page).toHaveURL(/#\/projects/);

  await openFixture(page, '#/tools/agent-settings');
  await page.getByRole('button', { name: /Desktop endpoint/ }).click();
  await expectTrace(page, 'fixture://agent-settings/connection');
  await page.getByRole('button', { name: /Offline buffering/ }).click();
  await expectTrace(page, 'fixture://agent-settings/offline-buffer');
});
