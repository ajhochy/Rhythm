import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const roomId = '101';
const secondRoomId = '102';
const ownedReservationId = '501';
const otherReservationId = '502';
const recurringReservationId = '503';
const recurringSeriesId = 'series-choir-weekly';

async function expectFacilitiesPage(page: Page) {
  await expect(page.getByTestId('page-facilities')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Facilities' })).toHaveCount(1);
  await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
}

async function openReservationDialog(page: Page) {
  await page.getByTestId('facilities-reserve-space').click();
  const dialog = page.getByTestId('facility-reservation-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillReservationSlot(
  dialog: Locator,
  values: { title: string; date: string; start: string; end: string },
) {
  await dialog.getByTestId('facility-reservation-title').fill(values.title);
  await dialog.getByTestId('facility-reservation-date').fill(values.date);
  await dialog.getByTestId('facility-reservation-start').fill(values.start);
  await dialog.getByTestId('facility-reservation-end').fill(values.end);
}

test('issue-2007-c1: facilities routes deep links and initial loads render the real surface', async ({ page }) => {
  // Regression caught: #/facilities keeps rendering ModulePlaceholder, deep links lose their selected surface, or initial hydration collapses distinct Flutter endpoints.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  await expect(page.getByTestId('nav-facilities')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('facilities-mode-overview')).toHaveAttribute('aria-pressed', 'true');
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('GET /facilities → 200');
  await expect(trace).toContainText(`GET /facilities/${roomId}/reservations → 200`);
  await expect(trace).toContainText(`GET /facilities/${roomId}/reservation-series → 200`);
  await expect(trace).toContainText('GET /facilities/reservations?start=2026-08-10T00:00:00.000&end=2026-08-16T23:59:59.999 → 200');

  await openPage(page, 'facilities/rooms');
  await expectFacilitiesPage(page);
  await expect(page.getByTestId('facilities-mode-rooms')).toHaveAttribute('aria-pressed', 'true');

  await openPage(page, `facilities/rooms/${roomId}`);
  await expect(page.getByTestId('facility-room-detail')).toContainText('Sanctuary');

  await openPage(page, `facilities/reservations/${ownedReservationId}`);
  await expect(page.getByTestId('facility-reservation-detail')).toContainText('Leadership sync');
});

test('issue-2007-c2: overview range filters indicators and availability match Flutter', async ({ page }) => {
  // Regression caught: overview range math drifts from the fixed Wednesday, filters mutate only labels, or conflict/setup/external signals disagree with visible reservations.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  await expect(page.getByTestId('facilities-range-week')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('facilities-range-label')).toHaveText('Aug 10 - Aug 16, 2026');
  await expect(page.getByTestId('facilities-metric-conflicts')).not.toHaveText('0');
  await expect(page.getByTestId('facilities-metric-setup-notes')).not.toHaveText('0');
  await expect(page.getByTestId('facilities-metric-external')).not.toHaveText('0');
  await expect(page.getByTestId(`facility-reservation-${otherReservationId}`)).toHaveAttribute('data-conflicted', 'true');

  await page.getByTestId('facilities-range-day').click();
  await expect(page.getByTestId('facilities-range-label')).toHaveText('Aug 12, 2026');
  await expect(page.getByTestId('page-trace')).toContainText('GET /facilities/reservations?start=2026-08-12T00:00:00.000&end=2026-08-12T23:59:59.999 → 200');
  await page.getByTestId('facilities-range-forward').click();
  await expect(page.getByTestId('facilities-range-label')).toHaveText('Aug 13, 2026');

  await page.getByTestId('facilities-building-filter').selectOption('Main Campus');
  await page.getByTestId('facilities-room-filter').selectOption(roomId);
  await expect(page.getByTestId('page-trace')).toContainText('building=Main Campus');
  await expect(page.getByTestId('page-trace')).toContainText(`facilityId=${roomId}`);
  await expect(page.getByTestId('facilities-overview-results').locator('[data-facility-id]')).toHaveCount(1);

  const beforeDialog = await page.getByTestId('page-trace').textContent();
  const dialog = await openReservationDialog(page);
  await dialog.getByTestId('facility-reservation-date').fill('2026-08-12');
  await dialog.getByTestId('facility-reservation-start').fill('10:30');
  await dialog.getByTestId('facility-reservation-end').fill('11:00');
  await expect(dialog.getByTestId('facility-availability-status')).toContainText('overlaps');
  await expect(dialog.getByTestId('facility-availability-room-101')).toContainText('Leadership sync');
  await expect(page.getByTestId('page-trace')).toHaveText(beforeDialog ?? '');
});

test('issue-2007-c3: single reservation create validates conflicts and receipts once', async ({ page }) => {
  // Regression caught: Create accepts incomplete/reversed/conflicting input, posts twice, or reports success without adding the booking and exact receipt.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  const dialog = await openReservationDialog(page);
  const trace = page.getByTestId('page-trace');
  const createsBefore = await trace.getByText(/POST \/facilities\/\d+\/reservations \{/).count();

  await dialog.getByTestId('facility-room-clear').click();
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(dialog.getByTestId('facility-room-error')).toContainText('Select at least one room');
  await dialog.getByTestId(`facility-room-choice-${roomId}`).check();
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(dialog.getByTestId('facility-reservation-title-error')).toContainText('Title is required');
  await expect(trace.getByText(/POST \/facilities\/\d+\/reservations \{/)).toHaveCount(createsBefore);

  await fillReservationSlot(dialog, {
    title: 'Pastoral care debrief',
    date: '2026-08-13',
    start: '11:00',
    end: '10:00',
  });
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('End time must be after the start time');

  await dialog.getByTestId('facility-reservation-date').fill('2026-08-12');
  await dialog.getByTestId('facility-reservation-start').fill('10:30');
  await dialog.getByTestId('facility-reservation-end').fill('11:00');
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('overlaps an existing reservation');
  await expect(trace.getByText(/POST \/facilities\/\d+\/reservations \{/)).toHaveCount(createsBefore);

  await dialog.getByTestId('facility-reservation-date').fill('2026-08-13');
  await dialog.getByTestId('facility-reservation-start').fill('09:00');
  await dialog.getByTestId('facility-reservation-end').fill('10:00');
  await dialog.getByTestId('facility-reservation-notes').fill('Set out water and two chairs.');
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(page.getByTestId('toast-status')).toContainText('Reservation created');
  await expect(page.getByText('Pastoral care debrief', { exact: true })).toHaveCount(1);
  await expect(trace.getByText(/POST \/facilities\/\d+\/reservations \{/)).toHaveCount(createsBefore + 1);
  await expect(trace).toContainText(`POST /facilities/${roomId}/reservations {title,requester_name,requester_user_id,start_time,end_time,notes} → 201`);
});

test('issue-2007-c4: linked room groups expose partial success and edit summaries', async ({ page }) => {
  // Regression caught: multi-room submit becomes all-or-nothing, loses facility_ids, or hides created/updated/removed rooms and per-room conflicts.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  const dialog = await openReservationDialog(page);
  await dialog.getByTestId('facility-room-select-all').click();
  await dialog.getByTestId('facility-room-clear').click();
  await dialog.getByTestId(`facility-room-choice-${roomId}`).check();
  await dialog.getByTestId(`facility-room-choice-${secondRoomId}`).check();
  await fillReservationSlot(dialog, {
    title: 'Weekend team briefing',
    date: '2026-08-12',
    start: '10:30',
    end: '11:00',
  });
  await dialog.getByTestId('facility-reservation-submit').click();

  const summary = page.getByTestId('facility-group-summary');
  await expect(summary).toContainText('Created in: Fellowship Hall');
  await expect(summary).toContainText('Conflicts');
  await expect(summary).toContainText('Sanctuary');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /facilities/${roomId}/reservations {title,requester_name,requester_user_id,facility_ids,start_time,end_time} → 201`);
  await summary.getByTestId('facility-group-summary-close').click();

  await page.getByTestId('facility-reservation-actions-504').click();
  await page.getByRole('menuitem', { name: 'Edit reservation group' }).click();
  const edit = page.getByTestId('facility-reservation-dialog');
  await edit.getByTestId(`facility-room-choice-${roomId}`).uncheck();
  await edit.getByTestId('facility-reservation-title').fill('Weekend team briefing — revised');
  await edit.getByTestId('facility-reservation-submit').click();
  await expect(page.getByTestId('facility-group-summary')).toContainText('Removed from: Sanctuary');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /facilities/${roomId}/reservations/504 {title,requester_name,requester_user_id,facility_ids,start_time,end_time,notes} → 200`);
});

test('issue-2007-c5: reservation edit delete and ownership gates stay truthful', async ({ page }) => {
  // Regression caught: edit mutates an unsupported room, delete skips confirmation, or read-only/non-owner reservations expose destructive actions.
  await openPage(page, `facilities/reservations/${ownedReservationId}`);
  await expectFacilitiesPage(page);
  const detail = page.getByTestId('facility-reservation-detail');
  const edit = detail.getByTestId('facility-reservation-direct-editor');
  await expect(edit.getByTestId('facility-reservation-title')).toBeEnabled();
  await edit.getByTestId('facility-reservation-title').fill('Leadership sync — updated');
  await edit.getByTestId('facility-reservation-notes').fill('Bring the revised agenda.');
  await edit.getByTestId('facility-reservation-submit').click();
  await expect(page.getByTestId('toast-status')).toContainText('Reservation updated');
  const patchReceipt = `PATCH /facilities/${roomId}/reservations/${ownedReservationId} {title,requester_name,requester_user_id,start_time,end_time,notes} → 200`;
  await expect(page.getByTestId('page-trace')).toContainText(patchReceipt);
  // Regression caught: the first save cleared selection, so a second save created instead of patching the same reservation.
  await expect(page.getByTestId('facility-reservation-detail')).toBeVisible();
  await edit.getByTestId('facility-reservation-notes').fill('Bring the revised agenda and room key.');
  await edit.getByTestId('facility-reservation-submit').click();
  await expect(page.getByTestId('page-trace').getByText(patchReceipt, { exact: true })).toHaveCount(2);

  await page.getByTestId(`facility-reservation-actions-${ownedReservationId}`).click();
  await page.getByRole('menuitem', { name: 'Delete reservation' }).click();
  const confirm = page.getByTestId('facility-reservation-delete-dialog');
  await expect(confirm).toContainText('remove this reservation');
  await confirm.getByTestId('facility-reservation-delete-cancel').click();
  await expect(page.getByTestId(`facility-reservation-${ownedReservationId}`)).toBeVisible();
  await expect(page.getByTestId('page-trace')).not.toContainText(`DELETE /facilities/${roomId}/reservations/${ownedReservationId}`);
  await page.getByTestId(`facility-reservation-actions-${ownedReservationId}`).click();
  await page.getByRole('menuitem', { name: 'Delete reservation' }).click();
  await page.getByTestId('facility-reservation-delete-confirm').click();
  await expect(page.getByTestId(`facility-reservation-${ownedReservationId}`)).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /facilities/${roomId}/reservations/${ownedReservationId} → 204`);

  await openPage(page, `facilities/reservations/${otherReservationId}`, '?state=readonly');
  await expect(page.getByTestId('facility-reservation-detail')).toContainText('Vendor load-in');
  await expect(page.getByTestId('facility-reservation-direct-editor').getByTestId('facility-reservation-title')).toBeDisabled();
  await expect(page.getByTestId('facility-reservation-delete')).toBeDisabled();
});

test('issue-2007-c6: recurring create validates patterns and reports materialization results', async ({ page }) => {
  // Regression caught: recurring submit omits its end/custom dates, duplicates the primary date, or hides partially materialized conflicts.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  const dialog = await openReservationDialog(page);
  await fillReservationSlot(dialog, {
    title: 'Choir rehearsal series',
    date: '2026-08-19',
    start: '18:30',
    end: '20:00',
  });
  await dialog.getByTestId('facility-recurring-toggle').check();
  for (const type of ['weekly', 'biweekly', 'monthly', 'custom']) {
    await dialog.getByTestId(`facility-recurrence-${type}`).click();
    await expect(dialog.getByTestId(`facility-recurrence-${type}`)).toHaveAttribute('aria-pressed', 'true');
  }
  await dialog.getByTestId('facility-recurrence-weekly').click();
  await dialog.getByTestId('facility-reservation-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a series end date');

  await dialog.getByTestId('facility-recurrence-custom').click();
  await dialog.getByTestId('facility-custom-date-add').click();
  await dialog.getByTestId('facility-custom-date-input').fill('2026-08-26');
  await dialog.getByTestId('facility-custom-date-confirm').click();
  await expect(dialog.getByTestId('facility-custom-date-2026-08-19')).toHaveCount(1);
  await expect(dialog.getByTestId('facility-custom-date-2026-08-26')).toHaveCount(1);
  await dialog.getByTestId('facility-reservation-submit').click();

  const summary = page.getByTestId('facility-recurring-summary');
  await expect(summary).toContainText(/\d+ occurrences? created/);
  await expect(summary).toContainText('Conflicted dates');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /facilities/${roomId}/reservation-series {title,requester_name,requester_user_id,recurrence_type,custom_dates,start_time,end_time,start_date,end_date} → 201`);
});

test('issue-2007-c7: recurring actions mutate the entire series and never invent occurrence controls', async ({ page }) => {
  // Regression caught: one occurrence is silently edited/deleted, whole-series confirmation disappears, or an unsupported occurrence endpoint is fabricated.
  await openPage(page, `facilities/reservations/${recurringReservationId}`);
  await expectFacilitiesPage(page);
  const detail = page.getByTestId('facility-reservation-detail');
  await expect(detail).toContainText('Recurring series');
  await expect(detail.getByTestId('facility-reservation-direct-editor').getByTestId('facility-reservation-title')).toBeEnabled();
  await expect(detail.getByTestId('facility-series-delete')).toHaveText('Delete entire series');
  await expect(detail.getByTestId('facility-occurrence-edit')).toHaveCount(0);
  await expect(detail.getByTestId('facility-occurrence-delete')).toHaveCount(0);

  const edit = detail.getByTestId('facility-reservation-direct-editor');
  await edit.getByTestId('facility-reservation-title').fill('Choir rehearsal — whole series');
  await edit.getByTestId('facility-reservation-submit').click();
  await expect(page.getByTestId('facility-recurring-summary')).toContainText('occurrence');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /facilities/${roomId}/reservation-series/${recurringSeriesId} {title,requester_name,requester_user_id,recurrence_type,recurrence_interval,start_time,end_time,start_date,end_date,notes} → 200`);
  await expect(page.getByTestId('page-trace')).not.toContainText(`/reservations/${recurringReservationId}/occurrence`);
  await page.getByTestId('facility-recurring-summary-close').click();

  await page.getByTestId(`facility-reservation-actions-${recurringReservationId}`).click();
  await page.getByRole('menuitem', { name: 'Delete series' }).click();
  const confirm = page.getByTestId('facility-series-delete-dialog');
  await expect(confirm).toContainText('all generated reservations');
  await confirm.getByTestId('facility-series-delete-confirm').click();
  await expect(page.locator(`[data-series-id="${recurringSeriesId}"]`)).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /facilities/${roomId}/reservation-series/${recurringSeriesId} → 204`);
});

test('issue-2007-c8: manager facility CRUD validates fields and updates room inventory', async ({ page }) => {
  // Regression caught: manager CRUD invents location/capacity fields, accepts a blank name, leaves stale sort order, or deletes without confirmation and exact receipts.
  await openPage(page, 'facilities/rooms');
  await expectFacilitiesPage(page);
  await expect(page.getByTestId('facility-manager-bar')).toBeVisible();
  await page.getByTestId('facility-add-space').click();
  const dialog = page.getByTestId('facility-editor-dialog');
  await expect(dialog.getByTestId('facility-location')).toHaveCount(0);
  await expect(dialog.getByTestId('facility-capacity')).toHaveCount(0);
  await dialog.getByTestId('facility-editor-submit').click();
  await expect(dialog.getByTestId('facility-name-error')).toContainText('Room name is required');
  await dialog.getByTestId('facility-name').fill('Community Care Room');
  await dialog.getByTestId('facility-building').selectOption('__new_building__');
  await dialog.getByTestId('facility-new-building').fill('West Campus');
  await dialog.getByTestId('facility-description').fill('Multilingual care and welcome space.');
  await dialog.getByTestId('facility-editor-submit').click();
  const created = page.getByTestId('facility-room-105');
  await expect(created).toContainText('Community Care Room');
  await expect(page.getByTestId('page-trace')).toContainText('POST /facilities {name,description,building} → 201');

  await created.getByTestId('facility-room-open-105').click();
  const roomEditor = page.getByTestId('facility-room-direct-editor');
  await roomEditor.getByTestId('facility-name').fill('Community Care & Welcome');
  await roomEditor.getByTestId('facility-editor-submit').click();
  await expect(created).toContainText('Community Care & Welcome');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /facilities/105 {name,description,building} → 200');

  await created.getByTestId('facility-room-actions-105').click();
  await page.getByRole('menuitem', { name: 'Delete room' }).click();
  await expect(page.getByTestId('facility-delete-dialog')).toContainText('Community Care & Welcome');
  await page.getByTestId('facility-delete-confirm').click();
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText('DELETE /facilities/105 → 204');
});

test('issue-2007-c9: room inventory detail booking and manager controls match Flutter', async ({ page }) => {
  // Regression caught: Rooms loses building grouping/sort, availability counts, room detail limits, preselection, or exposes management in readonly mode.
  await openPage(page, 'facilities/rooms');
  await expectFacilitiesPage(page);
  const headings = await page.locator('[data-testid^="facility-building-"] [data-testid="facility-building-name"]').allTextContents();
  expect(headings.at(-1)).toBe('Unassigned');
  const mainCampusRooms = await page.getByTestId('facility-building-main-campus').locator('[data-room-name]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-room-name') ?? ''));
  expect(mainCampusRooms).toEqual([...mainCampusRooms].sort((left, right) => left.localeCompare(right)));
  await expect(page.getByTestId(`facility-room-${roomId}`).getByTestId('facility-room-upcoming')).toContainText(/Available|upcoming/);

  await page.getByTestId(`facility-room-${roomId}`).click();
  const detail = page.getByTestId('facility-room-detail');
  const previews = await detail.locator('[data-reservation-preview]').count();
  expect(previews).toBeGreaterThan(0);
  expect(previews).toBeLessThanOrEqual(5);
  await detail.getByTestId('facility-room-reserve').click();
  const dialog = page.getByTestId('facility-reservation-dialog');
  await expect(dialog.getByTestId(`facility-room-choice-${roomId}`)).toBeChecked();
  await dialog.getByTestId('facility-reservation-cancel').click();

  await openPage(page, 'facilities/rooms', '?state=readonly');
  await expect(page.getByTestId('facility-add-space')).toBeDisabled();
  await expect(page.getByTestId('facility-automation-manage')).toBeDisabled();
  await expect(page.locator('[data-testid^="facility-room-actions-"]')).toHaveCount(0);
  await expect(page.getByTestId(`facility-room-${roomId}`)).toBeVisible();
});

test('issue-2007-c10: automation preview cleanup counts confirmation results and receipts are truthful', async ({ page }) => {
  // Regression caught: cleanup deletes before preview, uses stale/unfiltered counts, hides the zero state, or claims a DELETE result without receipt and inventory refresh.
  await openPage(page, 'facilities/rooms');
  await expectFacilitiesPage(page);
  await page.getByTestId('facility-automation-manage').click();
  const dialog = page.getByTestId('facility-automation-dialog');
  await expect(dialog.getByTestId('facility-automation-total')).toHaveText('4');
  await expect(dialog.getByTestId('facility-automation-by-room')).toContainText('Sanctuary: 3');
  await expect(page.getByTestId('page-trace')).toContainText('GET /facilities/automation-reservations/preview → 200');

  await dialog.getByTestId('facility-automation-room-filter').selectOption('104');
  await expect(dialog.getByTestId('facility-automation-zero')).toContainText('No automation-created reservations');
  await expect(dialog.getByTestId('facility-automation-delete')).toHaveCount(0);
  await dialog.getByTestId('facility-automation-room-filter').selectOption(roomId);
  await dialog.getByTestId('facility-automation-start-after').fill('2026-08-12');
  await dialog.getByTestId('facility-automation-end-before').fill('2026-08-31');
  await expect(dialog.getByTestId('facility-automation-total')).toHaveText('2');
  await expect(page.getByTestId('page-trace')).toContainText(`GET /facilities/automation-reservations/preview?facilityId=${roomId}&startAfter=2026-08-12T07:00:00.000Z&endBefore=2026-08-31T07:00:00.000Z → 200`);
  await expect(dialog.getByTestId('facility-automation-delete')).toHaveText('Delete 2 reservations');
  await dialog.getByTestId('facility-automation-delete').click();
  await expect(page.getByTestId('toast-status')).toContainText('Deleted 2 automation reservations');
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /facilities/automation-reservations?facilityId=${roomId}&startAfter=2026-08-12T07:00:00.000Z&endBefore=2026-08-31T07:00:00.000Z → 200`);
  const ledger = await page.getByTestId('page-trace').textContent() ?? '';
  expect(ledger.lastIndexOf('GET /facilities → 200')).toBeGreaterThan(ledger.lastIndexOf('DELETE /facilities/automation-reservations'));
});

test('issue-2007-c11: facilities state matrix exposes recovery permission and empty boundaries', async ({ page }) => {
  // Regression caught: a matrix state is blank/dead, Retry reloads, readonly leaves mutation enabled, or invalid ids masquerade as server failures.
  await openPage(page, 'facilities', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading facilities');

  await openPage(page, 'facilities', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No facilities yet');
  await page.getByTestId('facilities-empty-add-space').click();
  await expect(page.getByTestId('facility-editor-dialog')).toBeVisible();

  await openPage(page, 'facilities', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectFacilitiesPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'facilities', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('authenticated Rhythm workspace');
  await openPage(page, 'facilities', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('local Rhythm API');

  await openPage(page, `facilities/reservations/${ownedReservationId}`, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText('Facilities manager or reservation creator');
  await expect(page.getByTestId('facilities-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('facilities-mutations')).toBeDisabled();
  await expect(page.getByTestId('facilities-building-filter')).toBeEnabled();
  await expect(page.getByTestId('facility-reservation-detail')).toBeVisible();

  await openPage(page, 'facilities/reservations/does-not-exist');
  await expect(page.getByTestId('facility-reservation-not-found')).toContainText('Reservation not found');
  await page.getByTestId('facilities-back').click();
  await expect(page).toHaveURL(/#\/facilities(?:\?|$)/);
});

test('issue-2007-c12: enabled controls are live identifiable and receipt honest', async ({ page }) => {
  // Regression caught: an enabled control is unlabeled/dead, client-only UI fabricates endpoint work, or an API action omits its visible exact receipt.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  const enabled = page.getByTestId('page-facilities').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const trace = page.getByTestId('page-trace');
  const beforeMode = await trace.textContent();
  await page.getByTestId('facilities-mode-rooms').click();
  await expect(page.getByTestId('facilities-rooms-list')).toBeVisible();
  await expect(trace).toHaveText(beforeMode ?? '');

  const addTrigger = page.getByTestId('facility-add-space');
  await addTrigger.click();
  await expect(page.getByTestId('facility-editor-dialog').getByTestId('facility-name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(addTrigger).toBeFocused();
  await expect(trace).toHaveText(beforeMode ?? '');

  await page.getByTestId(`facility-room-${roomId}`).click();
  await expect(page.getByTestId('facility-room-direct-editor').getByTestId('facility-name')).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Edit room' })).toHaveCount(0);
});

test('issue-2007-c13: facilities and its dialogs are accessible with focus recovery', async ({ page }) => {
  // Regression caught: the dense schedule appears usable while axe finds serious violations, live errors are silent, or modal focus escapes and never returns.
  await openPage(page, 'facilities');
  await expectFacilitiesPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  const reserveTrigger = page.getByTestId('facilities-reserve-space');
  await reserveTrigger.click();
  const reservationDialog = page.getByTestId('facility-reservation-dialog');
  await expect(reservationDialog).toHaveAttribute('role', 'dialog');
  await expect(reservationDialog.getByTestId('facility-reservation-title')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(reservationDialog.getByTestId('facility-reservation-close')).toBeFocused();
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(reserveTrigger).toBeFocused();

  await page.getByTestId('facilities-mode-rooms').click();
  const automationTrigger = page.getByTestId('facility-automation-manage');
  await automationTrigger.click();
  await expect(page.getByTestId('facility-automation-dialog')).toHaveAttribute('aria-modal', 'true');
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(automationTrigger).toBeFocused();

  await openPage(page, 'facilities/rooms', '?state=readonly');
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('issue-2007-c14: facilities remains responsive across required presentation modes', async ({ page }) => {
  // Regression caught: Flutter-like fixed rows overflow, hide primary actions, or create undersized touch targets at required widths and localization modes.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'facilities/rooms');
    await expectFacilitiesPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('facilities-responsive-primary')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await expect(page.getByText('礼拝チーム室 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  const undersized = await page.getByTestId('page-facilities').locator('button:visible, input:visible, select:visible, textarea:visible').evaluateAll((elements) => elements.flatMap((element) => {
    const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const rect = element.getBoundingClientRect();
    return control.disabled || rect.width === 0 || rect.height === 0 || (rect.width >= 44 && rect.height >= 44)
      ? []
      : [{ testId: element.getAttribute('data-testid'), width: rect.width, height: rect.height }];
  }));
  expect(undersized).toEqual([]);
});

test('issue-2007-c15: fixture isolation blocks external I O and reload resets deterministically', async ({ page }) => {
  // Regression caught: Facilities contacts a real host, persists CRUD locally, or regenerates time/random-dependent ids, permissions, conflicts, and preview counts after reload.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, 'facilities/rooms');
  await expectFacilitiesPage(page);
  const seededRooms = await page.getByTestId('facilities-rooms-list').locator('[data-room-row="true"]').allTextContents();
  const seededTrace = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('facility-add-space').click();
  const facilityEditor = page.getByTestId('facility-editor-dialog');
  await facilityEditor.getByTestId('facility-name').fill('Temporary fixture room');
  await facilityEditor.getByTestId('facility-editor-submit').click();
  await expect(page.getByText('Temporary fixture room', { exact: true })).toBeVisible();

  await page.reload();
  await expectFacilitiesPage(page);
  await expect(page.getByText('Temporary fixture room', { exact: true })).toHaveCount(0);
  const reloadedRooms = await page.getByTestId('facilities-rooms-list').locator('[data-room-row="true"]').allTextContents();
  expect(reloadedRooms).toEqual(seededRooms);
  await expect(page.getByTestId('page-trace')).toHaveText(seededTrace ?? '');
  expect(attemptedExternal).toEqual([]);
});
