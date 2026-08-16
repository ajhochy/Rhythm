import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

const tools = [
  { slug: 'brain', endpoint: '/agent-memory' },
  { slug: 'deep-research', endpoint: '/agent-research/projects' },
  { slug: 'tasks', endpoint: '/agent-schedules' },
  { slug: 'webhooks', endpoint: '/agent-webhooks' },
  { slug: 'skills', endpoint: '/opencode/skills?withMetadata=true' },
  { slug: 'playbooks', endpoint: '/opencode/commands' },
  { slug: 'cookbook', endpoint: '/agent-cookbook' },
  { slug: 'review', endpoint: '/agent-org-proposals?status=proposed' },
  { slug: 'report-card', endpoint: '/agents/run-quality?windowDays=30' },
  { slug: 'email', endpoint: '/integrations/gmail-signals' },
  { slug: 'gallery', endpoint: '/agent-designs' },
  { slug: 'agent-settings', endpoint: 'fixture://agent-settings' },
] as const;

for (const tool of tools) {
  test(`${tool.slug}: deterministic loading, empty, error, recovery, permission, unavailable, and read-only states`, async ({ page }) => {
    await openFixture(page, `#/tools/${tool.slug}?state=loading`);
    await expect(page.getByTestId('tool-workspace-content')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('tool-state-loading')).toContainText(tool.endpoint);
    await expect(page.getByTestId('tool-content-action-gate')).toHaveCount(0);

    await page.getByTestId('tool-state-select').selectOption('empty');
    await expect(page.getByTestId('tool-state-empty')).toBeVisible();
    await page.getByTestId('tool-load-example').click();
    await expect(page.getByTestId('tool-content-action-gate')).toBeVisible();
    await expect(page.getByTestId('tool-trace')).toContainText(tool.endpoint);
    await expect(page.getByTestId('tool-trace')).toContainText('Recovered');

    await page.getByTestId('tool-state-select').selectOption('server-error');
    await expect(page.getByTestId('tool-state-server-error')).toContainText('503');
    await expect(page.getByTestId('tool-state-server-error')).toContainText(tool.endpoint);
    await page.getByTestId('tool-retry').click();
    await expect(page.getByTestId('tool-state-select')).toHaveValue('ready');
    await expect(page.getByTestId('tool-trace')).toContainText('attempt 2');

    await page.getByTestId('tool-state-select').selectOption('forbidden');
    await expect(page.getByTestId('tool-state-forbidden')).toContainText('403');
    await expect(page.getByTestId('tool-state-forbidden')).toContainText(tool.endpoint);
    await expect(page.getByTestId('tool-content-action-gate')).toHaveCount(0);

    await page.getByTestId('tool-state-select').selectOption('unavailable');
    await expect(page.getByTestId('tool-state-unavailable')).toContainText('Service unavailable');
    await page.getByTestId('tool-check-again').click();
    await expect(page.getByTestId('tool-state-select')).toHaveValue('ready');
    await expect(page.getByTestId('tool-trace')).toContainText('attempt 3');

    await page.getByTestId('tool-state-select').selectOption('readonly');
    await expect(page.getByTestId('tool-state-readonly')).toContainText('Read-only access');
    const enabledContentControls = await page.getByTestId('tool-content-action-gate').locator('button:enabled, input:enabled, select:enabled, textarea:enabled').count();
    expect(enabledContentControls, `${tool.slug} exposes an enabled content action in read-only mode`).toBe(0);
    const headerGate = page.getByTestId('tool-header-action-gate');
    if (await headerGate.count()) {
      await expect(headerGate).toHaveAttribute('disabled', '');
      await expect(headerGate.locator('button:enabled')).toHaveCount(0);
    }

    const axe = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
    const blocking = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(blocking, `${tool.slug}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);

    await page.getByTestId('tool-state-select').selectOption('ready');
    await expect(page.getByTestId('tool-state-readonly')).toHaveCount(0);
    await expect(page.getByTestId('tool-content-action-gate')).not.toHaveAttribute('disabled');
  });
}
