import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { endpointContracts } from '../src/endpointMap';
import { chooseDemo, openFixture } from './helpers';

test.describe('determinism, contracts, accessibility, and control audit', () => {
  test('loads every required deterministic demo state and resets fixtures', async ({ page }) => {
    await openFixture(page);
    for (const state of ['empty', 'loading', 'error', 'no-provider', 'offline', 'completed']) {
      await chooseDemo(page, state);
      await expect(page.getByTestId('toast-status')).toContainText(state);
    }
    await page.getByTestId('account-button').click();
    await page.getByTestId('demo-states-button').click();
    await page.getByTestId('fixture-reset').click();
    await expect(page.getByTestId('toast-status')).toContainText('reset');
    await expect(page.getByRole('heading', { name: 'Sunday service handoff' })).toBeVisible();
  });

  test('renders and searches the complete endpoint map', async ({ page }) => {
    await openFixture(page, '#/endpoint-map');
    await expect(page.getByTestId('endpoint-table').locator('tbody tr')).toHaveCount(endpointContracts.length);
    await page.getByTestId('endpoint-search').fill('session.input');
    await expect(page.getByTestId('endpoint-row-session-input')).toBeVisible();
    await expect(page.getByTestId('endpoint-row-session-input')).toContainText('{id,data} or {id,parts}');
    await expect(page.getByTestId('endpoint-row-session-input')).toContainText('local UI state until reconnect');
    await page.getByTestId('endpoint-search').fill('session.subscribe');
    await expect(page.getByTestId('endpoint-row-session-subscribe')).toContainText('{id}');
    await page.getByTestId('endpoint-search').fill('session.command');
    await expect(page.getByTestId('endpoint-row-session-command')).toContainText('{id,command,arguments}');
    await page.getByTestId('endpoint-search').fill('session.resize');
    await expect(page.getByTestId('endpoint-row-session-resize')).toContainText('{id,cols,rows}');
    await page.getByTestId('endpoint-search').fill('session.input');
    await page.getByTestId('endpoint-method').selectOption('POST');
    await expect(page.getByTestId('endpoint-row-session-input')).toHaveCount(0);
    await page.getByTestId('endpoint-search').fill('permission');
    const permissionReply = page.getByTestId('endpoint-row-permission-reply');
    for (const reply of ['once', 'always', 'reject']) await expect(permissionReply).toContainText(`"${reply}"`);
    await page.getByTestId('endpoint-search').fill('webhook receive');
    await expect(page.getByTestId('endpoint-row-webhooks-receive')).toContainText('/agent-webhooks/:id/receive');
    await page.getByTestId('endpoint-search').fill('New memory');
    await expect(page.getByTestId('endpoint-table').locator('tbody tr')).toHaveCount(0);
    await page.getByTestId('endpoint-search').fill('Edit Recipe');
    await expect(page.getByTestId('endpoint-table').locator('tbody tr')).toHaveCount(0);
  });

  test('supports a keyboard-only critical path and visible focus', async ({ page }) => {
    await openFixture(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.getByTestId('scope-chats').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('scope-scheduled')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('inspector-context').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('inspector-changes')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('inspector-content').focus();
    await expect(page.getByTestId('inspector-content')).toBeFocused();
    await page.getByTestId('session-search-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-search')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-search-toggle')).toBeFocused();
    await page.getByTestId('new-session-advanced').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('advanced-session-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-session-advanced')).toBeFocused();
  });

  test('has no serious or critical automated accessibility violations', async ({ page }) => {
    await openFixture(page);
    const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
    const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  });

  test('activates every visible primary workbench control with an observable result', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('sessions-refresh').click(); await expect(page.getByTestId('toast-status')).toContainText('refreshed');
    await page.getByTestId('new-chat-instant').click(); await expect(page.getByRole('heading', { name: 'New chat 1' })).toBeVisible();
    await page.getByTestId('prepare-project').click(); await expect(page.getByTestId('prepare-project-dialog')).toBeVisible(); await page.getByTestId('confirm-prepare-project').click();
    const composerFast = page.getByTestId('composer-fast');
    const fastBefore = await composerFast.getAttribute('aria-pressed');
    await composerFast.click();
    await expect(composerFast).toHaveAttribute('aria-pressed', fastBefore === 'true' ? 'false' : 'true');
    await page.getByTestId('inspector-context').click(); await expect(page.getByTestId('context-panel')).toBeVisible();
    await page.getByTestId('tool-profiles').click(); await expect(page).toHaveURL(/#\/profiles/);
  });
});
