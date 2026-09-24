import { expect, test } from '@playwright/test';
import { openFixture, openPage } from './helpers';

test('issue-1565: transcript and owned fixture surfaces show semantic timestamps without horizontal overflow', async ({ page }, info) => {
  test.setTimeout(90_000);
  const surfaces = [
    ['transcript', 'agents', true, '2:01 PM'],
    ['messages', 'messages', false, '3:36 PM'],
    ['schedules', 'tools/tasks', true, 'Aug 11, 8:00 AM'],
    ['email', 'tools/email', true, 'Aug 12, 3:36 PM'],
    ['mobile', 'mobile-access', false, 'Aug 10, 5:00 AM'],
    ['facilities', 'facilities', false, '10:00 AM'],
    ['integrations', 'integrations', false, '3:32 PM'],
    ['automations', 'automations', false, '2:35 PM'],
  ] as const;
  for (const [name, route, tool, expectedLabel] of surfaces) {
    if (tool) await openFixture(page, `#/${route}`);
    else await openPage(page, route);
    if (name === 'messages') await page.getByRole('option', { name: 'Weekend Team' }).click();
    if (name === 'schedules') await page.getByTestId('schedule-schedule-health').click();
    if (name === 'facilities') await page.getByRole('option', { name: /Leadership sync/ }).first().click();
    if (name === 'automations') await page.getByRole('option', { name: /Nudge owners before tasks are due/ }).click();
    await expect(page.getByText(expectedLabel, { exact: true }).first(), `${name} exact timestamp`).toBeVisible();
    const times = page.locator('#main-content time[datetime][title]');
    if (['transcript', 'messages', 'mobile', 'facilities'].includes(name)) {
      await expect(times.first(), `${name} must show a formatted time`).toBeVisible();
      const full = await times.first().getAttribute('title');
      expect(full, `${name} retains seconds, year and zone`).toMatch(/2026.*\d+:\d{2}:\d{2}.*(?:PDT|PST)/);
      await expect(times.first().locator('[aria-hidden="true"]')).toBeVisible();
      await expect(times.first().locator('.sr-only')).toHaveText(full!);
    }
    await expect(page.locator('#main-content')).not.toContainText('Time unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`).toBe(true);
    await page.screenshot({ path: info.outputPath(`issue-1565-${name}.png`), fullPage: true });
  }
});

test.describe('second timezone', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });
  test('issue-1565: zoned reservation renders in viewer zone without unavailable time', async ({ page }, info) => {
    await openPage(page, 'facilities');
    await page.getByRole('option', { name: /Leadership sync/ }).first().click();
    const time = page.locator('#main-content time[datetime][title]').first();
    await expect(time).toBeVisible();
    await expect(time.locator('[aria-hidden="true"]')).toHaveText('Aug 12, 10:30 PM');
    await expect(page.locator('#main-content')).not.toContainText('Time unavailable');
    await page.screenshot({ path: info.outputPath('issue-1565-kolkata.png'), fullPage: true });
  });
});
