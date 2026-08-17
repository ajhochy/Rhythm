import { test } from '@playwright/test';
import { openPage } from './helpers';

// Final-gate screenshot sweep (lead-run). Skipped unless RHYTHM_SWEEP=1 so ordinary
// suite runs stay fast. Writes to test-results/sweep/.
const PAGES = ['dashboard', 'planner', 'tasks', 'rhythms', 'projects', 'messages', 'facilities', 'automations', 'integrations', 'agents'];
const WIDTHS = [1440, 1024, 768, 390];

test.skip(process.env.RHYTHM_SWEEP !== '1', 'set RHYTHM_SWEEP=1 for the screenshot sweep');
test.setTimeout(240_000);

test('screenshot sweep: widths, 200% text, RTL, forced colors', async ({ page }) => {
  for (const slug of PAGES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openPage(page, slug === 'agents' ? '/agents' : `/${slug}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/sweep/${slug}-${width}.png`, fullPage: width !== 390 });
    }
  }
  // Representative edge modes on three pages.
  for (const slug of ['dashboard', 'messages', 'facilities']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPage(page, `/${slug}`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/sweep/${slug}-200pct.png` });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dir = 'rtl'; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/sweep/${slug}-rtl.png` });
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/sweep/${slug}-forced-colors.png` });
    await page.emulateMedia({ forcedColors: 'none' });
  }
  // Light theme representative.
  await openPage(page, '/dashboard');
  await page.getByTestId('account-button').click();
  await page.getByTestId('theme-toggle').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/sweep/dashboard-light.png', fullPage: true });
});
