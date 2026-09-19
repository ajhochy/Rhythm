import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

test.describe('Facilities shared list and inspector', () => {
  test('selects two reservations and keeps details, editing, conflicts, and every item action in the inspector', async ({ page }) => {
    // Regression caught: reservation rows used to own action buttons and leave editing outside the inspector.
    await openPage(page, 'facilities');
    await expectSelected(page, 'Leadership sync');
    await expectInspectorHeading(page, 'Leadership sync');
    await expect(page.getByTestId('facility-reservation-direct-editor')).toBeVisible();

    await selectRow(page, 'Vendor load-in');
    await expectInspectorHeading(page, 'Vendor load-in');
    await expect(page.getByTestId('facility-reservation-detail')).toContainText('Conflict detected');
    await selectRow(page, 'Leadership sync');
    await page.getByTestId('facility-reservation-actions-501').click();
    await page.getByRole('menuitem', { name: 'Edit reservation' }).click();
    await expect(page.getByTestId('facility-reservation-dialog')).toBeVisible();
    await page.getByTestId('facility-reservation-cancel').click();
    await page.getByTestId('facility-reservation-delete').click();
    await expect(page.getByTestId('facility-reservation-delete-dialog')).toContainText('Leadership sync');
    await page.getByTestId('facility-reservation-delete-cancel').click();

    await page.getByTestId('reservation-504').click();
    await page.getByTestId('facility-reservation-actions-504').click();
    await page.getByRole('menuitem', { name: 'Edit reservation group' }).click();
    await expect(page.getByTestId('facility-reservation-dialog')).toBeVisible();
    await page.getByTestId('facility-reservation-cancel').click();

    await page.getByTestId('reservation-503').click();
    await page.getByTestId('facility-reservation-actions-503').click();
    await page.getByRole('menuitem', { name: 'Edit series' }).click();
    await expect(page.getByTestId('facility-reservation-dialog')).toBeVisible();
    await page.getByTestId('facility-reservation-cancel').click();
    await page.getByTestId('facility-series-delete').click();
    await expect(page.getByTestId('facility-series-delete-dialog')).toContainText('Choir rehearsal');
    await page.getByTestId('facility-series-delete-dialog-cancel').click();

    await page.getByTestId('facilities-mode-rooms').click();
    await expectInspectorHeading(page, 'Sanctuary');
    await expect(page.getByTestId('facility-room-direct-editor')).toBeVisible();
    await page.getByTestId('facility-room-reserve').click();
    await expect(page.getByTestId('facility-reservation-dialog')).toBeVisible();
    await page.getByTestId('facility-reservation-cancel').click();
    await page.getByTestId('facility-room-actions-101').click();
    await page.getByRole('menuitem', { name: 'Delete room' }).click();
    await expect(page.getByTestId('facility-delete-dialog')).toContainText('Sanctuary');
    await page.getByTestId('facility-delete-dialog-cancel').click();
    await page.getByTestId('facility-automation-manage').click();
    await expect(page.getByTestId('facility-automation-dialog')).toBeVisible();
    await page.getByTestId('facility-automation-cancel').click();
    await expect(page.getByTestId('facility-add-space')).toBeVisible();
    await expectListInspectorAxeClean(page);
  });

  test('roves keyboard focus without changing selection until Enter or Space', async ({ page }) => {
    // Regression caught: custom Facility buttons selected immediately while arrowing through rows.
    await openPage(page, 'facilities');
    const list = page.getByRole('listbox', { name: 'Facility reservations' });
    await keyboardSelect(page, { fromTitle: 'Leadership sync', presses: ['ArrowDown'] });
    await expect(list.getByRole('option', { name: 'Vendor load-in', exact: true })).toBeFocused();
    await expectSelected(page, 'Leadership sync');
    await page.keyboard.press('Enter');
    await expectSelected(page, 'Vendor load-in');
    await expectInspectorHeading(page, 'Vendor load-in');
    await keyboardSelect(page, { fromTitle: 'Vendor load-in', presses: ['Home', 'Space'] });
    await expectSelected(page, 'Leadership sync');
    await expectListInspectorAxeClean(page);
  });

  test('restores selection, preserves deep links, and shows stale or deleted IDs clearly', async ({ page }) => {
    // Regression caught: a missing reservation left the previous reservation details and actions visible.
    await openPage(page, 'facilities', '?facilityItemId=reservation-505&retained=keep');
    await expectInspectorHeading(page, 'Community meal setup');
    await page.reload();
    await expectSelected(page, 'Community meal setup');
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('retained')).toBe('keep');

    await openPage(page, 'facilities', '?facilityItemId=reservation-deleted');
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByTestId('facility-reservation-direct-editor')).toHaveCount(0);

    await page.getByTestId('facilities-mode-rooms').click();
    await page.getByTestId('facility-room-actions-101').click();
    await page.getByRole('menuitem', { name: 'Delete room' }).click();
    await page.getByTestId('facility-delete-confirm').click();
    await expect(page.getByTestId('room-101')).toHaveCount(0);
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByTestId('facility-room-direct-editor')).toHaveCount(0);
  });

  test('keeps empty, loading, error, and read-only states usable', async ({ page }) => {
    // Regression caught: page-level states previously removed the selectable shell and exposed stale details.
    await openPage(page, 'facilities', '?state=loading');
    await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('Loading Facility reservations');
    await expect(page.getByTestId('facility-reservation-direct-editor')).toHaveCount(0);

    await openPage(page, 'facilities', '?state=empty');
    await expect(page.getByTestId('page-state-empty')).toContainText('No facilities yet');
    await expect(page.getByRole('listbox', { name: 'Facility reservations' }).getByRole('option')).toHaveCount(0);

    await openPage(page, 'facilities', '?state=server-error');
    await expect(page.getByRole('alert').first()).toContainText('Facilities could not be loaded');
    await expect(page.getByTestId('facility-reservation-direct-editor')).toHaveCount(0);

    await openPage(page, 'facilities', '?state=readonly');
    await selectRow(page, 'Vendor load-in');
    await expectInspectorHeading(page, 'Vendor load-in');
    await expect(page.getByTestId('facility-reservation-title')).toBeDisabled();
    await expect(page.getByTestId('facility-reservation-delete')).toBeDisabled();
    await expectListInspectorAxeClean(page);
  });

  test('distinguishes an empty reservation range from a search with no matches', async ({ page }) => {
    await openPage(page, 'facilities');
    await page.getByTestId('facilities-room-filter').selectOption('104');
    await expect(page.getByRole('listbox', { name: 'Facility reservations' }).getByRole('option')).toHaveCount(0);
    await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('No reservations in this range');

    await page.getByTestId('facilities-room-filter').selectOption('');
    await page.getByPlaceholder('Search reservations').fill('missing reservation title');
    await expect(page.getByRole('listbox', { name: 'Facility reservations' }).getByRole('option')).toHaveCount(0);
    await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('No results match your search.');
  });

  test('keeps long room names and inspector controls reachable at narrow width and 200% zoom', async ({ page }) => {
    // Regression caught: the old split clipped controls and long multilingual room metadata.
    await atNarrow(page);
    await openPage(page, 'facilities/rooms');
    await expectInspectorHeading(page, 'Sanctuary');
    const list = page.getByRole('listbox', { name: 'Facility rooms', includeHidden: true });
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await selectRow(page, '礼拝チーム室 🎵');
    await expectInspectorHeading(page, '礼拝チーム室 🎵');
    await expectListInspectorAxeClean(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await atZoom200(page);
    const back = page.getByRole('button', { name: 'Back to list', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect(list).toBeVisible();
    const longRoom = page.getByRole('option', { name: '礼拝チーム室 🎵', exact: true });
    await expect(longRoom).toBeVisible();
    await expect(longRoom.locator('strong')).toHaveAttribute('title', '礼拝チーム室 🎵');
    await selectRow(page, 'Sanctuary');
    await expect(page.getByTestId('facility-room-reserve')).toBeVisible();
    await expectListInspectorAxeClean(page);
  });
});
