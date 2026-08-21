import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test.describe('product shell', () => {
  test('renders and toggles theme when Studio storage access is sandboxed', async ({ page }) => {
    const uncaughtErrors: string[] = [];
    page.on('pageerror', (error) => uncaughtErrors.push(error.message));
    await page.setContent(`<!doctype html><html><body style="margin:0"><iframe data-testid="studio-sandbox" title="Sandboxed Studio preview" sandbox="allow-scripts" src="http://127.0.0.1:4174/index.html#/agents" style="display:block;width:100vw;height:100vh;border:0"></iframe></body></html>`);

    const studio = page.frameLocator('[data-testid="studio-sandbox"]');
    await expect(studio.getByTestId('connection-status')).toBeVisible();
    await expect(studio.locator('html')).toHaveAttribute('data-theme', 'dark');
    await studio.getByTestId('account-button').click();
    await studio.getByTestId('theme-toggle').click();
    await expect(studio.locator('html')).toHaveAttribute('data-theme', 'light');
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
