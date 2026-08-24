import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test.describe('remaining Flutter parity edge cases', () => {
  test('navigates nested child sessions and returns one parent at a time', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('open-child-session-coverage-child').click();
    await expect(page.getByRole('heading', { name: 'Volunteer coverage audit' })).toBeVisible();
    await expect(page.getByTestId('child-back')).toContainText('Sunday service handoff');
    await page.getByTestId('open-child-session-coverage-grandchild').click();
    await expect(page.getByRole('heading', { name: 'Livestream reply verification' })).toBeVisible();
    await expect(page.getByTestId('child-back')).toContainText('Volunteer coverage audit');
    await page.getByTestId('child-back').click();
    await expect(page.getByRole('heading', { name: 'Volunteer coverage audit' })).toBeVisible();
    await page.getByTestId('child-back').click();
    await expect(page.getByRole('heading', { name: 'Sunday service handoff' })).toBeVisible();
  });

  test('matches Flutter keyboard resizing semantics for every desktop separator', async ({ page }) => {
    await openFixture(page);
    const tools = page.getByTestId('tools-resizer');
    await tools.focus();
    await expect(tools).toHaveAttribute('aria-valuenow', '224');
    await page.keyboard.press('ArrowUp');
    await expect(tools).toHaveAttribute('aria-valuenow', '240');
    await page.keyboard.press('ArrowDown');
    await expect(tools).toHaveAttribute('aria-valuenow', '224');
    await page.keyboard.press('Home');
    await expect(tools).toHaveAttribute('aria-valuenow', '120');
    await page.keyboard.press('End');
    await expect(tools).toHaveAttribute('aria-valuenow', '320');

    const rail = page.getByTestId('rail-resizer');
    await rail.focus();
    await page.keyboard.press('Home');
    await expect(rail).toHaveAttribute('aria-valuenow', '228');
    await page.keyboard.press('End');
    await expect(rail).toHaveAttribute('aria-valuenow', '380');

    const inspector = page.getByTestId('inspector-resizer');
    await inspector.focus();
    await page.keyboard.press('Home');
    await expect(inspector).toHaveAttribute('aria-valuenow', '286');
    await page.keyboard.press('End');
    await expect(inspector).toHaveAttribute('aria-valuenow', '470');
  });

  test('validates attachments and mentions with observable recovery', async ({ page }) => {
    await openFixture(page);
    const input = page.getByTestId('composer-input');

    await page.getByTestId('composer-attach').click();
    await page.getByTestId('attachment-option-allowed').click();
    await expect(page.getByTestId('attachment-allowed')).toContainText('run-sheet.md');
    await page.getByTestId('attachment-remove-allowed').click();
    await expect(page.getByTestId('attachment-allowed')).toHaveCount(0);

    await input.fill('@full');
    await page.getByTestId('mention-option-large').click();
    await expect(page.getByTestId('attachment-large')).toContainText('first 100 KB');
    await expect(page.getByTestId('attachment-feedback')).toContainText('truncated');

    await input.fill('@rhythm-agent');
    await page.getByTestId('mention-option-binary').click();
    await expect(page.getByTestId('attachment-binary')).toContainText('local file reference');

    await input.fill('@outside');
    await page.getByTestId('mention-option-unsafe').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('PATH_TRAVERSAL');
    await expect(page.getByTestId('attachment-unsafe')).toHaveCount(0);

    await input.fill('@missing');
    await page.getByTestId('mention-option-missing').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('not found');
    await expect(page.getByTestId('attachment-missing')).toHaveCount(0);

    await input.fill('@does-not-exist');
    await expect(page.getByTestId('mention-no-results')).toBeVisible();
    await input.press('Escape');
    await expect(page.getByTestId('composer-suggestions')).toHaveCount(0);

    await input.fill('@run-sheet');
    await input.press('Enter');
    await expect(page.getByTestId('attachment-allowed')).toBeVisible();
    await input.fill('Review these deterministic attachments.');
    await input.press('Enter');
    await expect(page.getByTestId('transcript').getByText('Review these deterministic attachments.')).toBeVisible();
    await expect(page.getByTestId('transcript').getByText('full-transcript.json')).toBeVisible();
  });

  test('exposes every deterministic state on every Tool destination', async ({ page }) => {
    test.setTimeout(90_000);
    const slugs = ['brain', 'deep-research', 'tasks', 'webhooks', 'profiles', 'skills', 'playbooks', 'cookbook', 'review', 'report-card', 'email', 'gallery', 'agent-settings'];
    for (const slug of slugs) {
      const route = slug === 'profiles' ? '#/profiles?state=read-only' : `#/tools/${slug}?state=readonly`;
      await openFixture(page, route);
      await expect(page.getByTestId(slug === 'profiles' ? 'tool-state-read-only' : 'tool-state-readonly')).toBeVisible();
      const enabledMutations = await page.locator('fieldset:disabled button:enabled, fieldset:disabled input:enabled, fieldset:disabled select:enabled, fieldset:disabled textarea:enabled').count();
      expect(enabledMutations, `${slug} exposed a mutable control in read-only state`).toBe(0);
    }

    await openFixture(page, '#/tools/brain');
    for (const state of ['loading', 'empty', 'server-error', 'forbidden', 'unavailable']) {
      await page.getByTestId('tool-state-select').selectOption(state);
      await expect(page.getByTestId(`tool-state-${state}`)).toBeVisible();
      if (state === 'empty') {
        await page.getByTestId('tool-load-example').click();
        await expect(page.getByTestId('brain-list')).toBeVisible();
      }
      if (state === 'server-error' || state === 'unavailable') {
        await page.getByTestId(state === 'server-error' ? 'tool-retry' : 'tool-check-again').click();
        await expect(page.getByTestId('brain-list')).toBeVisible();
      }
    }
  });

  test('keeps core controls reachable at compact width, 200 percent scale, long content, and RTL', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 });
    await openFixture(page);
    await expect(page.getByTestId('rail-expand')).toBeVisible();
    await expect(page.getByTestId('inspector-expand')).toBeVisible();
    await page.getByTestId('rail-expand').click();
    await expect(page.getByTestId('new-chat-instant')).toBeVisible();
    await expect(page.getByTestId('tool-brain')).toBeVisible();
    await page.getByTestId('rail-collapse').click();
    await page.getByTestId('inspector-expand').click();
    await expect(page.getByTestId('inspector-context')).toBeVisible();
    await page.getByTestId('inspector-collapse').click();

    await page.getByTestId('session-actions').click();
    await expect(page.getByTestId('session-actions-settings')).toBeVisible();
    await expect(page.getByTestId('session-actions-prepare')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-more').click();
    await expect(page.getByTestId('nav-messages-overflow')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'zh-Hant';
      document.body.style.zoom = '2';
    });
    await page.getByTestId('session-actions').click();
    await page.getByTestId('session-actions-settings').click();
    await page.getByTestId('session-settings-dialog').getByLabel('Session name').fill('跨團隊服務交接驗證 — 非常長的確定性工作階段名稱 🚦🧪');
    await page.getByTestId('save-session-settings').click();
    await expect(page.getByRole('heading', { name: /跨團隊服務交接驗證/ })).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('session-actions')).toBeVisible();
  });

  test('preserves accessible names, focus visibility, and blocking WCAG checks in edge states', async ({ page }) => {
    await openFixture(page, '#/tools/deep-research?state=forbidden');
    await page.getByTestId('tool-back').focus();
    await expect(page.getByTestId('tool-back')).toBeFocused();
    const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
    const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  });
});
