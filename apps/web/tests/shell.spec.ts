import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

const studioDistPort = Number(process.env.RHYTHM_DIST_PORT ?? Number(process.env.RHYTHM_E2E_PORT ?? 4173) + 1);
const studioDevPort = Number(process.env.RHYTHM_E2E_PORT ?? 4173);

test.describe('product shell', () => {
  test('renders and toggles theme when Studio storage access is sandboxed', async ({ page }) => {
    const uncaughtErrors: string[] = [];
    page.on('pageerror', (error) => uncaughtErrors.push(error.message));
    await page.setContent(`<!doctype html><html><body style="margin:0"><iframe data-testid="studio-sandbox" title="Sandboxed Studio preview" sandbox="allow-scripts" src="http://127.0.0.1:${studioDistPort}/index.html#/agents" style="display:block;width:100vw;height:100vh;border:0"></iframe></body></html>`);

    const studio = page.frameLocator('[data-testid="studio-sandbox"]');
    await expect(studio.getByTestId('connection-status')).toBeVisible();
    await expect(studio.locator('html')).toHaveAttribute('data-theme', 'dark');
    await studio.getByTestId('account-button').click();
    await studio.getByTestId('theme-toggle').click();
    await expect(studio.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(uncaughtErrors).toEqual([]);
  });

  test('sandboxed View options report failed persistence without changing the current view', async ({ page }) => {
    const uncaughtErrors: string[] = [];
    page.on('pageerror', (error) => uncaughtErrors.push(error.message));
    await page.setContent(`<!doctype html><html><body style="margin:0"><iframe data-testid="studio-sandbox" title="Sandboxed Studio preview" sandbox="allow-scripts" src="http://127.0.0.1:${studioDistPort}/index.html#/agents" style="display:block;width:100vw;height:100vh;border:0"></iframe></body></html>`);
    const studio = page.frameLocator('[data-testid="studio-sandbox"]');
    await expect(studio.getByTestId('connection-status')).toBeVisible();

    const sort = studio.getByTestId('session-sort');
    await expect(sort).toHaveValue('newest');
    await sort.selectOption('name');
    await expect(sort).toHaveValue('newest');
    await expect(studio.getByTestId('toast-status')).toContainText('View preference could not be saved');

    await studio.getByRole('button', { name: 'View options' }).click();
    await studio.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
    await studio.getByRole('button', { name: 'View options' }).click();
    await expect(studio.getByRole('menuitemcheckbox', { name: 'View archived sessions' })).toHaveAttribute('aria-checked', 'false');
    await studio.getByRole('menuitemradio', { name: 'Compact' }).click();
    await studio.getByRole('button', { name: 'View options' }).click();
    await expect(studio.getByRole('menuitemradio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
    await expect(studio.getByTestId('toast-status')).toContainText('View preference could not be saved');
    expect(uncaughtErrors).toEqual([]);
  });

  test('sandboxed Settings preserve theme and keyboard drafts when device storage rejects changes', async ({ page }) => {
    const uncaughtErrors: string[] = [];
    page.on('pageerror', (error) => uncaughtErrors.push(error.message));
    await page.route(`http://127.0.0.1:${studioDevPort}/**`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    // Permit the form submit event while retaining an opaque origin that rejects localStorage.
    await page.setContent(`<!doctype html><html><body style="margin:0"><iframe data-testid="studio-sandbox" title="Sandboxed Settings preview" sandbox="allow-scripts allow-forms" src="http://127.0.0.1:${studioDevPort}/tests/electron-e40-harness.html#/settings" style="display:block;width:100vw;height:100vh;border:0"></iframe></body></html>`);
    const studio = page.frameLocator('[data-testid="studio-sandbox"]');
    await expect(studio.getByTestId('page-settings')).toBeVisible();

    const theme = studio.getByRole('combobox', { name: 'Theme' });
    await expect(theme).toHaveValue('dark');
    await theme.selectOption('light');
    await expect(theme).toHaveValue('dark');
    await expect(studio.getByRole('alert')).toContainText('Device preference could not be saved');

    await studio.getByRole('option', { name: 'Keyboard & safety' }).click();
    const sendKey = studio.getByRole('combobox', { name: 'Send message key' });
    await sendKey.selectOption('Meta+Enter');
    await studio.getByRole('button', { name: 'Save keyboard preference' }).click();
    await expect(sendKey).toHaveValue('Meta+Enter');
    await expect(studio.getByRole('button', { name: 'Save keyboard preference' })).toBeEnabled();
    await expect(studio.getByRole('option', { name: 'Keyboard & safety' })).toContainText('Unsaved');
    await expect(studio.getByRole('alert')).toContainText('Device preference could not be saved');

    page.once('dialog', (dialog) => dialog.accept());
    await studio.getByRole('option', { name: 'Appearance' }).click();
    await studio.getByRole('option', { name: 'Keyboard & safety' }).click();
    await expect(studio.getByRole('alert')).toHaveCount(0);
    await sendKey.selectOption('Meta+Enter');
    await studio.getByRole('button', { name: 'Reset keyboard preference' }).click();
    await expect(sendKey).toHaveValue('Meta+Enter');
    await expect(studio.getByRole('button', { name: 'Save keyboard preference' })).toBeEnabled();
    await expect(studio.getByRole('alert')).toContainText('Device preference could not be saved');
    expect(uncaughtErrors).toEqual([]);
  });

  test('navigates the shell and uses the responsive More overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openFixture(page);
    await expect(page.getByTestId('nav-agents')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-more').click();
    await expect(page.getByRole('menu', { name: /more/i })).toBeVisible();
    await page.getByTestId('nav-facilities-overflow').click();
    await expect(page).toHaveURL(/#\/facilities/);
    // Issue 2007 replaced the Facilities placeholder with the real page (planned lead update).
    await expect(page.getByTestId('page-facilities')).toBeVisible();
    await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
    await page.getByTestId('nav-agents').click();
    await expect(page).toHaveURL(/#\/agents/);
  });

  test('opens activity, notifications, account, theme, and endpoint controls', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('background-activity-button').click();
    await expect(page.getByRole('menu', { name: 'Background activity' }).getByText('Volunteer coverage audit')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('notifications-button').click();
    await page.getByRole('menuitem', { name: /Mark all read/ }).click();
    await expect(page.getByTestId('toast-status')).toContainText('marked read');
    await page.getByTestId('account-button').click();
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('account-button').click();
    await page.getByTestId('account-profiles').click();
    await expect(page).toHaveURL(/#\/profiles/);
    await page.getByTestId('profiles-back').click();
    await page.getByTestId('account-button').click();
    await page.getByTestId('endpoint-map-button').click();
    await expect(page).toHaveURL(/#\/endpoint-map/);
  });
});
