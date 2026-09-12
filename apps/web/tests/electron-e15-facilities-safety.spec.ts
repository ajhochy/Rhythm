import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const facility = { id: 7, name: 'Sanctuary', description: null, capacity: 500, location: null, building: 'Main', createdAt: '', updatedAt: '' };
const chapel = { ...facility, id: 8, name: 'Chapel' };
const reservation = { id: 9, facilityId: 7, seriesId: null, groupId: null, title: 'Sunday service', requesterName: 'AJ', requesterUserId: 1, createdByName: 'AJ', createdByUserId: 1, startTime: '2026-09-13T09:00:00', endTime: '2026-09-13T10:00:00', notes: null, externalEventId: null, externalSource: null, createdByRhythm: false, isConflicted: false, conflictReason: null, createdAt: '', updatedAt: '' };

async function intercept(page: Page) {
  const deletes: string[] = [];
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let failRoomDelete = true;
  let delayPreview = false;
  let releasePreview: (() => void) | null = null;
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
        if (url.pathname === '/facilities') return reply([facility, chapel]);
        if (url.pathname === '/facilities/reservations') return reply(url.searchParams.get('grouped') === 'true' ? [] : [reservation]);
        if (url.pathname === '/facilities/7/reservation-series') return reply([]);
        if (url.pathname === '/facilities/automation-reservations/preview') {
          if (delayPreview) await new Promise<void>((resolve) => { releasePreview = resolve; });
          return reply({ total: 2, byFacility: [{ facilityId: 7, facilityName: 'Sanctuary', count: 2 }] });
        }
      }
      if (request.method() === 'PATCH' && url.pathname === '/facilities/7') { writes.push({ method: 'PATCH', path: url.pathname, body: request.postDataJSON() }); return reply({ ...facility, ...request.postDataJSON() }); }
      if (request.method() === 'PATCH' && url.pathname === '/facilities/7/reservations/9') { writes.push({ method: 'PATCH', path: url.pathname, body: request.postDataJSON() }); return reply({ ...reservation, ...request.postDataJSON(), requesterName: request.postDataJSON().requester_name, startTime: request.postDataJSON().start_time, endTime: request.postDataJSON().end_time }); }
      if (request.method() === 'POST' && url.pathname === '/facilities/7/reservations') { const body = request.postDataJSON(); writes.push({ method: 'POST', path: url.pathname, body }); return reply({ group: { id: 'group-1' }, reservations: [{ ...reservation, id: 10, title: body.title }], conflicts: [] }); }
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
  return { deletes, writes, allowRoomDelete: () => { failRoomDelete = false; }, delayPreview: () => { delayPreview = true; }, previewPending: () => releasePreview !== null, releasePreview: () => releasePreview?.() };
}

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
  await page.getByTestId('facilities-reservation-edit-9').click();
  await page.getByTestId('facilities-reservation-notes').fill('Updated notes');
  await page.getByTestId('facilities-reservation-save').click();
  await page.getByTestId('facilities-reserve-space').click();
  await page.getByTestId('facilities-reservation-title').fill('Two rooms');
  await page.getByTestId('facilities-reservation-requester').fill('Casey');
  await page.getByTestId('facilities-reservation-start').fill('2026-09-14T09:00');
  await page.getByTestId('facilities-reservation-end').fill('2026-09-14T10:00');
  await page.getByLabel('Chapel').check();
  await page.getByTestId('facilities-reservation-save').click();
  expect(state.writes).toContainEqual({ method: 'PATCH', path: '/facilities/7', body: { name: 'Main Sanctuary', building: 'Main' } });
  expect(state.writes.find((write) => write.path.endsWith('/reservations/9'))?.body.notes).toBe('Updated notes');
  await expect.poll(() => state.writes).toContainEqual({
    method: 'POST', path: '/facilities/7/reservations',
    body: { title: 'Two rooms', requester_name: 'Casey', start_time: '2026-09-14T09:00', end_time: '2026-09-14T10:00', notes: null, facility_ids: [7, 8] },
  });
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
