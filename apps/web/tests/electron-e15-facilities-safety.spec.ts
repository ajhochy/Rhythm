import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const facility = { id: 7, name: 'Sanctuary', description: null, capacity: 500, location: null, building: 'Main', createdAt: '', updatedAt: '' };
const chapel = { ...facility, id: 8, name: 'Chapel' };
const reservation = { id: 9, facilityId: 7, seriesId: null, groupId: null, title: 'Sunday service', requesterName: 'AJ', requesterUserId: 1, createdByName: 'AJ', createdByUserId: 1, startTime: '2026-09-13T09:00:00', endTime: '2026-09-13T10:00:00', notes: null, externalEventId: null, externalSource: null, createdByRhythm: false, isConflicted: false, conflictReason: null, createdAt: '', updatedAt: '' };

async function intercept(page: Page) {
  const deletes: string[] = [];
  const writes: Array<{ method: string; path: string; body: any }> = [];
  const reservationQueries: string[] = [];
  let facilities = [facility, chapel];
  let defaultReservations = [reservation];
  let failRoomDelete = true;
  let delayPreview = false;
  let releasePreview: (() => void) | null = null;
  let delayInitialFacilities = false;
  let facilitiesRequestCount = 0;
  let facilitiesPending = false;
  let releaseFacilities: (() => void) | null = null;
  let multiRoomSuccess = false;
  const reservationResponses = new Map<string, typeof defaultReservations>();
  const delayedReservationStarts = new Set<string>();
  const pendingReservationStarts = new Set<string>();
  const releaseReservation = new Map<string, () => void>();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4180') return route.continue();
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4180', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    const reply = (body: unknown) => route.fulfill({ headers, json: body });
    if (['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'https://api.vcrcapps.com'].includes(url.origin)) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() === 'GET') {
        if (['/message-threads', '/agent-configs', '/agent-sessions', '/agent-approvals', '/notifications'].includes(url.pathname)) return reply([]);
        if (url.pathname === '/health') return reply({ status: 'ok', healthy: true });
        if (url.pathname === '/facilities') {
          const response = [...facilities];
          const requestIndex = facilitiesRequestCount++;
          if (delayInitialFacilities && requestIndex === 0) {
            facilitiesPending = true;
            await new Promise<void>((resolve) => { releaseFacilities = resolve; });
          }
          return reply(response);
        }
        if (url.pathname === '/facilities/reservations') {
          if (url.searchParams.get('grouped') === 'true') return reply([]);
          reservationQueries.push(url.search);
          const start = url.searchParams.get('start') ?? '';
          const response = reservationResponses.get(start) ?? defaultReservations;
          if (delayedReservationStarts.has(start)) {
            pendingReservationStarts.add(start);
            await new Promise<void>((resolve) => { releaseReservation.set(start, resolve); });
          }
          return reply(response);
        }
        if (/^\/facilities\/\d+\/reservation-series$/.test(url.pathname)) return reply([]);
        if (url.pathname === '/facilities/automation-reservations/preview') {
          if (delayPreview) await new Promise<void>((resolve) => { releasePreview = resolve; });
          return reply({ total: 2, byFacility: [{ facilityId: 7, facilityName: 'Sanctuary', count: 2 }] });
        }
      }
      if (request.method() === 'POST' && url.pathname === '/facilities') {
        const body = request.postDataJSON();
        const created = { ...facility, id: 11, name: body.name, building: body.building, capacity: null };
        facilities = [...facilities, created];
        writes.push({ method: 'POST', path: url.pathname, body });
        return reply(created);
      }
      if (request.method() === 'PATCH' && url.pathname === '/facilities/7') { writes.push({ method: 'PATCH', path: url.pathname, body: request.postDataJSON() }); return reply({ ...facility, ...request.postDataJSON() }); }
      if (request.method() === 'PATCH' && url.pathname === '/facilities/7/reservations/9') { writes.push({ method: 'PATCH', path: url.pathname, body: request.postDataJSON() }); return reply({ ...reservation, ...request.postDataJSON(), requesterName: request.postDataJSON().requester_name, startTime: request.postDataJSON().start_time, endTime: request.postDataJSON().end_time }); }
      if (request.method() === 'POST' && url.pathname === '/facilities/7/reservations') {
        const body = request.postDataJSON();
        writes.push({ method: 'POST', path: url.pathname, body });
        if (multiRoomSuccess) return reply({ group: { id: 'group-1' }, reservations: [{ ...reservation, id: 10, title: body.title }, { ...reservation, id: 11, facilityId: 8, title: body.title }], conflicts: [] });
        return reply({ group: { id: 'group-1' }, reservations: [{ ...reservation, id: 10, title: body.title }], conflicts: [{ facilityId: 8, reason: 'Overlap' }] });
      }
      if (request.method() === 'DELETE') {
        const target = `${url.pathname}${url.search}`;
        if (!['/facilities/7', '/facilities/7/reservations/9', '/facilities/automation-reservations?facilityId=7'].includes(target)) return route.abort('blockedbyclient');
        deletes.push(target);
        if (url.pathname === '/facilities/7' && failRoomDelete) return route.fulfill({ status: 403, headers, json: {} });
        return route.fulfill({ status: 204, headers });
      }
    }
    return route.abort('blockedbyclient');
  });
  return {
    deletes,
    writes,
    reservationQueries,
    allowRoomDelete: () => { failRoomDelete = false; },
    delayPreview: () => { delayPreview = true; },
    previewPending: () => releasePreview !== null,
    releasePreview: () => releasePreview?.(),
    delayInitialFacilities: () => { delayInitialFacilities = true; },
    facilitiesPending: () => facilitiesPending,
    releaseFacilities: () => releaseFacilities?.(),
    useMultiRoomSuccess: () => { multiRoomSuccess = true; },
    setFacilities: (next: typeof facilities) => { facilities = next; },
    setDefaultReservations: (next: typeof defaultReservations) => { defaultReservations = next; },
    setReservationResponse: (start: string, next: typeof defaultReservations, delayed = false) => {
      reservationResponses.set(start, next);
      if (delayed) delayedReservationStarts.add(start);
    },
    reservationPending: (start: string) => pendingReservationStarts.has(start),
    releaseReservation: (start: string) => releaseReservation.get(start)?.(),
  };
}

test('1515:facilities-live-stale-load-race:1 keeps a room created while the initial load is pending', async ({ page }) => {
  const state = await intercept(page);
  state.delayInitialFacilities();
  await page.goto('/#/facilities');
  await expect.poll(state.facilitiesPending).toBe(true);
  await page.getByTestId('facilities-add-room').click();
  await page.getByTestId('facilities-room-name').fill('New hosted room');
  await page.getByTestId('facilities-room-save').click();
  await expect(page.getByTestId('facilities-room-11')).toHaveAttribute('aria-selected', 'true');
  state.releaseFacilities();
  await expect(page.getByTestId('facilities-room-11')).toBeVisible();
  await expect(page.getByTestId('list-inspector-detail').getByRole('heading', { name: 'New hosted room' })).toBeVisible();
  await expect(page.getByTestId('list-inspector-detail')).not.toContainText('Item not found');
});

test('1515:facilities-live-stale-load-race:2 keeps every reservation returned by a multi-room create', async ({ page }) => {
  const state = await intercept(page);
  state.useMultiRoomSuccess();
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-reserve-space').click();
  await page.getByTestId('facilities-reservation-title').fill('Two-room gathering');
  await page.getByTestId('facilities-reservation-requester').fill('Casey');
  await page.getByTestId('facilities-reservation-start').fill('2026-09-14T09:00');
  await page.getByTestId('facilities-reservation-end').fill('2026-09-14T10:00');
  await page.getByRole('checkbox', { name: 'Chapel', exact: true }).check();
  await page.getByTestId('facilities-reservation-save').click();
  await expect(page.getByTestId('facilities-reservation-10')).toBeVisible();
  await page.getByTestId('facilities-room-8').click();
  await expect(page.getByTestId('facilities-reservation-11')).toBeVisible();
});

test('1515:facilities-live-stale-load-race:3 ignores an older range response that resolves last', async ({ page }) => {
  const state = await intercept(page);
  const oldReservation = { ...reservation, id: 12, title: 'Old range reservation' };
  const newReservation = { ...reservation, id: 13, title: 'New range reservation' };
  state.setReservationResponse('2026-09-01', [oldReservation], true);
  state.setReservationResponse('2026-09-15', [newReservation]);
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-range-start').fill('2026-09-01');
  await expect.poll(() => state.reservationPending('2026-09-01')).toBe(true);
  await page.getByTestId('facilities-range-start').fill('2026-09-15');
  await expect(page.getByTestId('facilities-reservation-13')).toBeVisible();
  state.releaseReservation('2026-09-01');
  await expect(page.getByTestId('facilities-reservation-13')).toBeVisible();
  await expect(page.getByTestId('facilities-reservation-12')).toHaveCount(0);
});

test('1545:facilities-ui-parity-apply:1 uses useful room metadata when description is absent', async ({ page }) => {
  await intercept(page);
  await page.goto('/#/facilities');
  const row = page.getByTestId('facilities-room-7');
  await expect(row.locator('small')).toContainText('Capacity 500');
  await expect(row).not.toContainText('No room description');
});

test('1545:facilities-ui-parity-apply:2 uses one compact reservation range in the rail', async ({ page }) => {
  await intercept(page);
  await page.goto('/#/facilities');
  await expect(page.getByTestId('facilities-reservation-9').locator('small')).toContainText('Sep 13, 9:00–10:00 AM');
  await page.getByTestId('facilities-reservation-9').click();
  await expect(page.getByTestId('facilities-reservations-panel')).toContainText('Sunday, September 13, 2026');
});

test('1545:facilities-ui-parity-apply:3 keeps date and building filters in the rail request path', async ({ page }) => {
  const state = await intercept(page);
  await page.goto('/#/facilities');
  const rail = page.getByLabel('Facilities and reservations list');
  await rail.getByTestId('facilities-range-start').fill('2026-09-01');
  await rail.getByTestId('facilities-range-end').fill('2026-09-30');
  await rail.getByTestId('facilities-building-filter').selectOption('Main');
  await expect.poll(() => state.reservationQueries.some((query) => {
    const params = new URLSearchParams(query);
    return params.get('start') === '2026-09-01' && params.get('end') === '2026-09-30' && params.get('building') === 'Main';
  })).toBe(true);
});

test('1545:facilities-ui-parity-apply:4 is axe-clean without horizontal overflow at 390px in both themes', async ({ page }) => {
  const state = await intercept(page);
  state.setFacilities([{ ...facility, name: 'Sanctuary with a deliberately long name that must remain usable at narrow widths' }, chapel]);
  state.setDefaultReservations([{ ...reservation, title: 'A reservation with a deliberately long title and setup metadata' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/#/facilities');
    await expect(page.getByTestId('page-facilities')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-testid="page-facilities"]').analyze()).violations).toEqual([]);
  }
});

test('e15: facility and reservation deletion require confirmation and preserve failed records', async ({ page }) => {
  const state = await intercept(page);
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-room-delete-7').click();
  await expect(page.getByTestId('facilities-delete-dialog')).toContainText('Sanctuary');
  expect(state.deletes).toEqual([]);
  await page.getByTestId('facilities-delete-cancel').click();
  expect(state.deletes).toEqual([]);

  await page.getByTestId('facilities-room-delete-7').click();
  await page.getByTestId('facilities-delete-confirm').click();
  await expect(page.getByTestId('facilities-delete-error')).toContainText('Forbidden');
  await expect(page.getByTestId('facilities-room-7')).toBeVisible();
  state.allowRoomDelete();
  await page.getByTestId('facilities-delete-confirm').click();
  await expect(page.getByTestId('facilities-room-7')).toHaveCount(0);

  await page.reload();
  await page.getByTestId('facilities-reservation-9').click();
  await page.getByTestId('facilities-reservation-delete-9').click();
  await expect(page.getByTestId('facilities-delete-dialog')).toContainText('Sunday service');
  await page.keyboard.press('Escape');
  expect(state.deletes).not.toContain('/facilities/7/reservations/9');
});

test('E31: rooms and reservations edit, and multi-room create submits exact facilities', async ({ page }) => {
  const state = await intercept(page);
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-room-edit-7').click();
  await page.getByTestId('facilities-room-name').fill('Main Sanctuary');
  await page.getByTestId('facilities-room-save').click();
  await page.getByTestId('facilities-reservation-9').click();
  await page.getByTestId('facilities-reservation-edit-9').click();
  await page.getByTestId('facilities-reservation-notes').fill('Updated notes');
  await page.getByTestId('facilities-reservation-save').click();
  await page.getByTestId('facilities-reserve-space').click();
  await page.getByTestId('facilities-reservation-title').fill('Two rooms');
  await page.getByTestId('facilities-reservation-requester').fill('Casey');
  await page.getByTestId('facilities-reservation-start').fill('2026-09-14T09:00');
  await page.getByTestId('facilities-reservation-end').fill('2026-09-14T10:00');
  await page.getByRole('checkbox', { name: 'Chapel', exact: true }).check();
  await page.getByTestId('facilities-reservation-save').click();
  expect(state.writes).toContainEqual({ method: 'PATCH', path: '/facilities/7', body: { name: 'Main Sanctuary', building: 'Main' } });
  expect(state.writes.find((write) => write.path.endsWith('/reservations/9'))?.body.notes).toBe('Updated notes');
  await expect.poll(() => state.writes).toContainEqual({
    method: 'POST', path: '/facilities/7/reservations',
    body: { title: 'Two rooms', requester_name: 'Casey', start_time: '2026-09-14T09:00', end_time: '2026-09-14T10:00', notes: null, facility_ids: [7, 8] },
  });
  await expect(page.getByTestId('facilities-reservation-error')).toContainText('1 requested room conflicted');
});

test('e15: automation cleanup shows and confirms the exact preview', async ({ page }) => {
  const state = await intercept(page);
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-automation-preview').click();
  await expect(page.getByTestId('facilities-automation-preview-result')).toContainText('2 automation reservations');
  await page.getByTestId('facilities-automation-clear').click();
  const dialog = page.getByTestId('facilities-delete-dialog');
  await expect(dialog).toContainText('Remove 2 automation reservations from Sanctuary?');
  await mkdir('../../docs/ai/runs/artifacts/e15', { recursive: true });
  await dialog.screenshot({ path: '../../docs/ai/runs/artifacts/e15/facilities-automation-confirmation.png' });
  await page.getByTestId('facilities-delete-cancel').click();
  expect(state.deletes).not.toContain('/facilities/automation-reservations?facilityId=7');
  await page.getByTestId('facilities-automation-clear').click();
  await page.getByTestId('facilities-delete-confirm').click();
  await expect(page.getByTestId('facilities-automation-preview-result')).toHaveCount(0);
  expect(state.deletes).toEqual(['/facilities/automation-reservations?facilityId=7']);
});

test('e15: a delayed preview cannot cross facility scope', async ({ page }) => {
  const state = await intercept(page);
  state.delayPreview();
  await page.goto('/#/facilities');
  await page.getByTestId('facilities-automation-preview').click();
  await page.getByTestId('facilities-room-8').click();
  await expect.poll(state.previewPending).toBe(true);
  state.releasePreview();
  await expect(page.getByTestId('facilities-automation-preview-result')).toHaveCount(0);
  await expect(page.getByTestId('facilities-automation-clear')).toHaveCount(0);
  expect(state.deletes).toEqual([]);
});
