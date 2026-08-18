import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

async function expectNoOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
}

test('Facilities click-through covers schedule, reservation, room, and automation work', async ({ page }) => {
  await openPage(page, 'facilities');
  await expect(page.getByTestId('facilities-range-label')).toHaveText('Aug 10 - Aug 16, 2026');
  const firstReservation = page.locator('[data-testid^="facility-reservation-open-"]').first();
  await firstReservation.click();
  // Regression caught: selected reservations required a second Edit action before fields and save were exposed.
  await expect(page.getByTestId('facility-reservation-direct-editor').getByTestId('facility-reservation-title')).toBeEnabled();
  await page.getByTestId('facilities-range-month').click();
  await expect(page.getByTestId('facilities-range-label')).toHaveText('August 2026');
  await page.getByTestId('facilities-range-week').click();

  await page.getByTestId('facilities-reserve-space').click();
  const reservation = page.getByTestId('facility-reservation-dialog');
  await reservation.getByTestId('facility-reservation-title').fill('Welcome team staging');
  await reservation.getByTestId('facility-reservation-date').fill('2026-08-13');
  await reservation.getByTestId('facility-reservation-start').fill('12:00');
  await reservation.getByTestId('facility-reservation-end').fill('13:00');
  await reservation.getByTestId('facility-reservation-notes').fill('Two check-in tables near the west doors.');
  await reservation.getByTestId('facility-reservation-submit').click();
  await expect(page.getByText('Welcome team staging', { exact: true })).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText('POST /facilities/101/reservations');

  await page.getByTestId('facilities-mode-rooms').click();
  await page.getByTestId('facility-room-103').click();
  await expect(page.getByTestId('facility-room-detail')).toContainText('Prayer Room');
  await page.getByTestId('facility-room-reserve').click();
  await expect(page.getByTestId('facility-room-choice-103')).toBeChecked();
  await page.getByTestId('facility-reservation-cancel').click();

  await page.getByTestId('facility-add-space').click();
  const facilityEditor = page.getByTestId('facility-editor-dialog');
  await facilityEditor.getByTestId('facility-name').fill('Hospitality Studio');
  await facilityEditor.getByTestId('facility-description').fill('A flexible welcome and care workspace.');
  await facilityEditor.getByTestId('facility-editor-submit').click();
  await expect(page.getByTestId('facility-room-105')).toContainText('Hospitality Studio');

  await page.getByTestId('facility-automation-manage').click();
  await page.getByTestId('facility-automation-room-filter').selectOption('102');
  await expect(page.getByTestId('facility-automation-total')).toHaveText('1');
  await page.getByTestId('facility-automation-delete').click();
  await expect(page.getByTestId('toast-status')).toContainText('Deleted 1 automation reservation');
});

test('Facilities destructive confirmations cancel safely and identify their target', async ({ page }) => {
  await openPage(page, 'facilities/rooms');
  const room = page.getByTestId('facility-room-101');
  await room.getByTestId('facility-room-actions-101').click();
  await page.getByRole('menuitem', { name: 'Delete room' }).click();
  const confirmation = page.getByTestId('facility-delete-dialog');
  await expect(confirmation).toContainText('Sanctuary');
  await confirmation.getByTestId('facility-delete-dialog-cancel').click();
  await expect(room).toBeVisible();
  await expect(page.getByTestId('page-trace')).not.toContainText('DELETE /facilities/101');
});

test('Facilities stays usable without horizontal overflow at required widths', async ({ page }) => {
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'facilities/rooms');
    await expect(page.getByTestId('facilities-responsive-primary')).toBeVisible();
    await expect(page.getByTestId('facility-add-space')).toBeVisible();
    await expect(page.getByText('礼拝チーム室 🎵', { exact: true })).toBeVisible();
    await expectNoOverflow(page, width);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await expect(page.getByTestId('facility-add-space')).toBeVisible();
  await expectNoOverflow(page, 390);
});

test('Facilities representative ready, dialog, readonly, and error states are axe-clean', async ({ page }) => {
  await openPage(page, 'facilities');
  await expectNoBlockingAxe(page, 'ready overview');
  await page.getByTestId('facilities-reserve-space').click();
  await expectNoBlockingAxe(page, 'reservation dialog');
  await page.keyboard.press('Escape');

  await openPage(page, 'facilities/rooms', '?state=readonly');
  await expectNoBlockingAxe(page, 'readonly rooms');
  await openPage(page, 'facilities', '?state=server-error');
  await expectNoBlockingAxe(page, 'retryable server error');
});
