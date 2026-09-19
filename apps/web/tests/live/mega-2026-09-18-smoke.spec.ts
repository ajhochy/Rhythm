import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import {
  expectInspectorHeading,
  expectListInspectorAxeClean,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';
import { liveEnvironment } from '../live-environment';

const environment = liveEnvironment({
  ...process.env,
  RHYTHM_LIVE_API_URL: process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098',
  RHYTHM_LIVE_ENGINE_URL: process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097',
});
const productionOrigin = new URL(environment.productionApiBase).origin;
const localOrigin = new URL(environment.apiBase).origin;
const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const markerPrefix = 'MEGA-SMOKE-2026-09-18-';
const runId = `${Date.now().toString(36)}-${process.pid}`;
const marker = `${markerPrefix}${runId}`;
const bearer = process.env.RHYTHM_LIVE_TOKEN?.trim() ?? '';

type JsonRow = Record<string, unknown>;
type WriteReceipt = { method: string; url: string; body: string; source: 'page' | 'cleanup' };
type JsonResponse = Pick<APIResponse, 'ok' | 'status' | 'statusText' | 'json'>;

const allWrites: WriteReceipt[] = [];
const allowedIds = new Set<string>();
const tempDirectories = new Set<string>();

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Set RHYTHM_LIVE_E2E=1 to acknowledge writes against the live Rhythm services.');

function isApiUrl(raw: string) {
  const origin = new URL(raw).origin;
  return origin === productionOrigin || origin === localOrigin;
}

function recordPageWrites(page: Page): WriteReceipt[] {
  const writes: WriteReceipt[] = [];
  page.on('request', (request: Request) => {
    if (!writeMethods.has(request.method()) || !isApiUrl(request.url())) return;
    const receipt = { method: request.method(), url: request.url(), body: request.postData() ?? '', source: 'page' as const };
    writes.push(receipt);
    allWrites.push(receipt);
  });
  return writes;
}

function rememberId(value: unknown) {
  if (typeof value === 'number' || typeof value === 'string') allowedIds.add(String(value));
}

function rowId(row: JsonRow) {
  return row.id ?? row.profileId ?? row.projectId ?? row.ruleId ?? row.reservationId;
}

function rowsFrom(value: unknown): JsonRow[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRow => Boolean(item && typeof item === 'object'));
  if (!value || typeof value !== 'object') return [];
  const object = value as JsonRow;
  for (const key of ['items', 'data', 'rows', 'projects', 'profiles', 'rules', 'facilities', 'reservations', 'templates']) {
    if (Array.isArray(object[key])) return rowsFrom(object[key]);
  }
  return [];
}

function isMarked(row: JsonRow) {
  return JSON.stringify(row).includes(markerPrefix);
}

function authHeaders(local = false): Record<string, string> {
  return local ? {} : { Authorization: `Bearer ${bearer}` };
}

async function checkedJson(response: JsonResponse, operation: string) {
  expect(response.ok(), `${operation}: ${response.status()} ${response.statusText()}`).toBeTruthy();
  return response.status() === 204 ? null : await response.json();
}

async function directDelete(request: APIRequestContext, base: string, path: string, id: unknown, local = false) {
  rememberId(id);
  const url = `${base}${path}`;
  const receipt = { method: 'DELETE', url, body: '', source: 'cleanup' as const };
  allWrites.push(receipt);
  const response = await request.delete(url, { headers: authHeaders(local) });
  expect([200, 202, 204, 404], `cleanup DELETE ${path}`).toContain(response.status());
}

async function listRows(request: APIRequestContext, base: string, path: string, local = false) {
  const response = await request.get(`${base}${path}`, { headers: authHeaders(local) });
  const body = await checkedJson(response, `cleanup GET ${path}`);
  return rowsFrom(body);
}

async function cleanMarkerRows(request: APIRequestContext) {
  const reservations = (await listRows(request, environment.productionApiBase, '/facilities/reservations')).filter(isMarked);
  for (const reservation of reservations) {
    const facilityId = reservation.facilityId ?? reservation.facility_id;
    const id = rowId(reservation);
    if (facilityId != null && id != null) await directDelete(request, environment.productionApiBase, `/facilities/${encodeURIComponent(String(facilityId))}/reservations/${encodeURIComponent(String(id))}`, id);
  }

  const facilities = (await listRows(request, environment.productionApiBase, '/facilities')).filter(isMarked);
  for (const facility of facilities) {
    const id = rowId(facility);
    if (id != null) await directDelete(request, environment.productionApiBase, `/facilities/${encodeURIComponent(String(id))}`, id);
  }

  const templates = (await listRows(request, environment.productionApiBase, '/project-templates')).filter(isMarked);
  for (const template of templates) {
    const id = rowId(template);
    if (id != null) await directDelete(request, environment.productionApiBase, `/project-templates/${encodeURIComponent(String(id))}`, id);
  }

  const rules = (await listRows(request, environment.productionApiBase, '/automation-rules')).filter(isMarked);
  for (const rule of rules) {
    const id = rowId(rule);
    if (id != null) await directDelete(request, environment.productionApiBase, `/automation-rules/${encodeURIComponent(String(id))}`, id);
  }

  const projects = (await listRows(request, environment.apiBase, '/projects?includeArchived=true', true)).filter(isMarked);
  for (const project of projects) {
    const id = rowId(project);
    if (id != null) await directDelete(request, environment.apiBase, `/projects/${encodeURIComponent(String(id))}`, id, true);
  }

  const profiles = (await listRows(request, environment.apiBase, '/agent-configs', true)).filter(isMarked);
  for (const profile of profiles) {
    const id = rowId(profile);
    if (id != null) await directDelete(request, environment.apiBase, `/agent-configs/${encodeURIComponent(String(id))}`, id, true);
  }
}

function writeIsSafe(write: WriteReceipt) {
  if (write.body.includes(markerPrefix) || decodeURIComponent(write.url).includes(markerPrefix)) return true;
  const decoded = decodeURIComponent(new URL(write.url).pathname);
  return [...allowedIds].some((id) => decoded.split('/').includes(id));
}

async function openLive(page: Page, route: string) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/#${route.startsWith('/') ? route : `/${route}`}`);
  await expect(page.locator('#main-content')).toBeAttached();
  await expect(page.getByRole('alert').filter({ hasText: 'Live gateway could not start' })).toHaveCount(0);
}

async function listIsReady(page: Page, label: string) {
  const list = page.getByRole('listbox', { name: label });
  await expect(list).toBeVisible();
  await expect(list).not.toHaveAttribute('aria-busy', 'true');
  await expect.poll(async () => await list.getByRole('option').count() + await page.locator('.list-inspector-state').count()).toBeGreaterThan(0);
  return list;
}

async function verifyListInspectorSelection(page: Page, label: string, writes: WriteReceipt[], noDataReason: string) {
  const list = await listIsReady(page, label);
  await expect(page.locator('.list-inspector-state[role="alert"]'), `${label} must load successfully`).toHaveCount(0);
  const options = list.getByRole('option');
  const count = await options.count();
  if (count === 0) await expect(page.locator('.list-inspector-state')).toBeVisible();
  else await expect(options.first()).toBeVisible();
  test.skip(count < 2, `${noDataReason}; found ${count} live row${count === 1 ? '' : 's'}.`);
  const first = await options.nth(0).getAttribute('aria-label');
  const second = await options.nth(1).getAttribute('aria-label');
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  const before = writes.length;
  await selectRow(page, first!);
  await expectInspectorHeading(page, first!);
  await selectRow(page, second!);
  await expectInspectorHeading(page, second!);
  await keyboardSelect(page, { fromTitle: first!, presses: ['ArrowDown', 'Enter'] });
  await expectInspectorHeading(page, second!);
  expect(writes.slice(before), `Selecting ${label} rows must not mutate live data`).toEqual([]);
  await expectListInspectorAxeClean(page);
}

async function createdId(response: JsonResponse) {
  const body = await checkedJson(response, 'create request');
  const id = body && typeof body === 'object' ? rowId(body as JsonRow) : null;
  expect(id, 'create response must return an id used by the cleanup guard').not.toBeNull();
  rememberId(id);
  return String(id);
}

async function dragBy(page: Page, splitter: Locator, deltaX: number, deltaY: number) {
  const bounds = await splitter.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds!.x + bounds!.width / 2;
  const startY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 });
  await page.mouse.up();
}

test.beforeAll(async ({ request }) => {
  expect(Boolean(bearer), 'RHYTHM_LIVE_TOKEN must be provided through the process environment').toBeTruthy();
  await cleanMarkerRows(request);
});

test.afterEach(async ({ request }) => {
  await cleanMarkerRows(request);
  await Promise.all([...tempDirectories].map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
    tempDirectories.delete(directory);
  }));
});

test.afterAll(async ({ request }) => {
  await cleanMarkerRows(request);
  const unsafe = allWrites.filter((write) => !writeIsSafe(write));
  expect(unsafe, `Unsafe live writes:\n${unsafe.map((write) => `${write.method} ${write.url}`).join('\n')}`).toEqual([]);
});

test.describe('Agent Tools — #1513/#1515–#1519/#1521/#1514', () => {
  const tools = [
    ['brain', 'Agent memories'],
    ['deep-research', 'Research projects'],
    ['tasks', 'Scheduled agent jobs'],
    ['webhooks', 'Webhook endpoints'],
    ['skills', 'Skills'],
    ['playbooks', 'Playbooks'],
    ['cookbook', 'Cookbook recipes'],
    ['review', 'Organization proposals'],
    ['report-card', 'Agent report cards'],
    ['email', 'Email signals'],
    ['gallery', 'Creative Media artifacts'],
  ] as const;

  for (const [slug, label] of tools) {
    test(`#1513 ${slug}: live ListInspector selection is inert, keyboardable, and axe-clean`, async ({ page }) => {
      const writes = recordPageWrites(page);
      await openLive(page, `/tools/${slug}`);
      await expect(page.getByTestId(`tool-page-${slug}`)).toBeVisible();
      await verifyListInspectorSelection(page, label, writes, `${slug} has fewer than two live records`);
    });
  }
});

test.describe('Facilities — #1515', () => {
  test('live room rows select without mutation and meet the ListInspector contract', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/facilities');
    await expect(page.getByTestId('page-facilities')).toBeVisible();
    await verifyListInspectorSelection(page, 'Facilities and reservations', writes, 'Facilities has fewer than two live rows');
  });

  test('creates, reads back, and deletes a marked room and reservation', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/facilities');
    await expect(page.getByTestId('facilities-add-room')).toBeEnabled();
    const roomName = `${marker}-ROOM`;
    const reservationName = `${marker}-RESERVATION`;

    await page.getByTestId('facilities-add-room').click();
    await page.getByTestId('facilities-room-name').fill(roomName);
    await page.getByTestId('facilities-room-building').fill(`${marker}-BUILDING`);
    const roomPending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === `${environment.productionApiBase}/facilities`);
    await page.getByTestId('facilities-room-save').click();
    const roomId = await createdId(await roomPending);
    await selectRow(page, roomName);
    await expectInspectorHeading(page, roomName);

    await page.getByTestId('facilities-room-reserve').click();
    await page.getByTestId('facilities-reservation-title').fill(reservationName);
    await page.getByTestId('facilities-reservation-requester').fill(marker);
    await page.getByTestId('facilities-reservation-start').fill('2099-09-18T09:00');
    await page.getByTestId('facilities-reservation-end').fill('2099-09-18T10:00');
    const reservationPending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/facilities/${roomId}/reservations`));
    await page.getByTestId('facilities-reservation-save').click();
    const reservationId = await createdId(await reservationPending);
    await selectRow(page, reservationName);
    await expectInspectorHeading(page, reservationName);

    await page.getByTestId(`facilities-reservation-delete-${reservationId}`).click();
    await expect(page.getByTestId('facilities-delete-dialog')).toBeVisible();
    await page.getByTestId('facilities-delete-confirm').click();
    await expect(page.getByRole('option', { name: reservationName, exact: true })).toHaveCount(0);
    await selectRow(page, roomName);
    await page.getByTestId(`facilities-room-delete-${roomId}`).click();
    await page.getByTestId('facilities-delete-confirm').click();
    await expect(page.getByRole('option', { name: roomName, exact: true })).toHaveCount(0);
  });
});

test.describe('Messages — #1516', () => {
  test('live conversations select without mutation and meet the ListInspector contract', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/messages');
    await expect(page.getByTestId('page-messages')).toBeVisible();
    await verifyListInspectorSelection(page, 'Conversations', writes, 'Messages has fewer than two live conversations');
  });

  test('thread plus message create/read-back/delete cycle', async () => {
    test.skip(true, 'The Messages UI and gateway expose createThread/sendMessage but no thread or message delete operation; creating live data would violate cleanup policy.');
  });
});

test.describe('Projects — #1517', () => {
  test('live projects select without mutation and meet the ListInspector contract', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/projects/templates');
    await expect(page.getByTestId('page-projects')).toBeVisible();
    await verifyListInspectorSelection(page, 'Projects', writes, 'Projects has fewer than two live templates or instances');
  });

  test('creates, reads back, and deletes a marked project template', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/projects/templates');
    const name = `${marker}-TEMPLATE`;
    await page.getByTestId('project-template-new').click();
    await page.getByTestId('project-template-name').fill(name);
    await page.getByTestId('project-template-description').fill(`${marker} cleanup-owned template`);
    const pending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === `${environment.productionApiBase}/project-templates`);
    await page.getByTestId('project-template-submit').click();
    const id = await createdId(await pending);
    await selectRow(page, name);
    await expectInspectorHeading(page, name);
    await page.getByTestId(`project-template-delete-${id}`).click();
    await expect(page.getByTestId('project-template-delete-dialog')).toBeVisible();
    await page.getByTestId('project-template-delete-confirm').click();
    await expect(page.getByRole('option', { name, exact: true })).toHaveCount(0);
  });
});

test.describe('Automations — #1518', () => {
  test('live rules select without mutation and meet the ListInspector contract', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/automations');
    await expect(page.getByTestId('page-automations')).toBeVisible();
    await verifyListInspectorSelection(page, 'Automation rules', writes, 'Automations has fewer than two live rules');
  });

  test('paused rule create/read-back/delete cycle', async () => {
    test.skip(true, 'The create UI sends enabled=true and has no atomic paused control; briefly creating an executable live rule violates the smoke safety contract.');
  });
});

test.describe('Integrations — #1519', () => {
  test('provider selection is inert and the no-create panel cancels cleanly', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/integrations');
    await expect(page.getByTestId('page-integrations')).toBeVisible();
    await verifyListInspectorSelection(page, 'Integrations', writes, 'Integrations has fewer than two live rows');
    await selectRow(page, 'Google Calendar');
    await expect(page.getByTestId('integration-inspector')).toBeVisible();
    await selectRow(page, 'AI Import');
    await page.getByTestId('open-ai-import').click();
    await expect(page.getByTestId('ai-import-dialog')).toBeVisible();
    await page.getByTestId('ai-import-cancel').click();
    await expect(page.getByTestId('ai-import-dialog')).toHaveCount(0);
  });
});

test.describe('Settings — #1521', () => {
  test('selection is inert, axe-clean, and a device-local theme preference restores', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/settings');
    await expect(page.getByTestId('page-settings')).toBeVisible();
    await verifyListInspectorSelection(page, 'Settings sections', writes, 'Settings did not render its static sections');
    await selectRow(page, 'Appearance');
    const theme = page.getByLabel('Theme');
    const original = await theme.inputValue();
    const alternate = original === 'dark' ? 'light' : 'dark';
    const before = writes.length;
    await theme.selectOption(alternate);
    await expect(page.locator('html')).toHaveAttribute('data-theme', alternate);
    await theme.selectOption(original);
    await expect(page.locator('html')).toHaveAttribute('data-theme', original);
    expect(writes.slice(before), 'Device-local Settings changes must not call an API').toEqual([]);
  });
});

test.describe('Agent Settings — #1514', () => {
  test('live sections are read-only under selection and meet the ListInspector contract', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/tools/agent-settings');
    await expect(page.getByTestId('tool-page-agent-settings')).toBeVisible();
    await verifyListInspectorSelection(page, 'Agent settings sections', writes, 'Agent Settings has fewer than two sections');
    await expect(page.getByRole('option', { name: 'Profiles overview', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Runtime / OpenCode server', exact: true })).toBeVisible();
  });
});

test.describe('Agents rail — #1511/#1512/#1522', () => {
  test('view options restore active sessions, compact rows, and avoid checkbox rows', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/agents');
    const rail = page.getByRole('complementary', { name: 'Agents' });
    await expect(rail).toBeVisible();
    await rail.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemcheckbox', { name: /View archived sessions/ }).click();
    await expect(rail.getByRole('button', { name: 'Archived sessions — Back to active' })).toBeVisible();
    await rail.getByRole('button', { name: 'Archived sessions — Back to active' }).click();
    await expect(rail.getByRole('button', { name: 'Archived sessions — Back to active' })).toHaveCount(0);
    await rail.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Compact' }).click();
    await expect(rail.locator('.session-list')).toHaveClass(/rail-compact/);
    await expect(rail.getByRole('checkbox')).toHaveCount(0);
    expect(writes, 'Rail view controls must not mutate API data').toEqual([]);
  });

  test('loads one child-session page when live children exist', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/agents');
    await expect(page.locator('.session-list')).not.toHaveAttribute('aria-busy', 'true');
    const loaders = page.locator('[data-load-parent]');
    test.skip(await loaders.count() === 0, 'No live session exposes a compact Load subagents row.');
    await expect(loaders.first()).toContainText(/Load (more )?subagents/);
    await loaders.first().click();
    await expect(loaders.first()).not.toHaveAttribute('aria-busy', 'true');
  });

  test('Cancel creates nothing; marked project creates, selects empty state, and is removed through DELETE /projects/:id', async ({ page, request }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/agents');
    const rail = page.getByRole('complementary', { name: 'Agents' });

    await page.getByTestId('rail-add-project').click();
    await page.getByTestId('project-name').fill(`${marker}-CANCEL`);
    await page.getByTestId('project-cwd').fill('/tmp/never-created');
    const beforeCancel = writes.length;
    await page.getByTestId('add-project-dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(writes.slice(beforeCancel)).toEqual([]);
    await expect(rail.getByText(`${marker}-CANCEL`, { exact: true })).toHaveCount(0);

    const directory = await mkdtemp(join(tmpdir(), `${marker}-`));
    tempDirectories.add(directory);
    const name = `${marker}-AGENT-PROJECT`;
    await page.getByTestId('rail-add-project').click();
    await page.getByTestId('project-name').fill(name);
    await page.getByTestId('project-cwd').fill(directory);
    const pending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === `${environment.apiBase}/projects`);
    await page.getByTestId('add-project-dialog').getByRole('button', { name: 'Create', exact: true }).click();
    const id = await createdId(await pending);
    const group = page.getByTestId(`group-project-${id}`);
    await expect(group).toContainText(name);
    await rail.getByRole('button', { name: new RegExp(`Select project\\s+${marker}`) }).click();
    await expect(page.getByTestId('selected-agent-project')).toContainText(name);
    await directDelete(request, environment.apiBase, `/projects/${encodeURIComponent(id)}`, id, true);
    await page.reload();
    await expect(page.locator('.session-list')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId(`group-project-${id}`)).toHaveCount(0);
  });
});

test.describe('Profiles — #1523', () => {
  test('groups, sticky footer, clean switching, and Advanced JSON render for existing profiles', async ({ page }) => {
    const writes = recordPageWrites(page);
    await openLive(page, '/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    const rows = page.locator('.profile-row');
    test.skip(await rows.count() === 0, 'No pre-existing live profile is available for read-only grouped-section assertions.');
    for (const heading of ['Identity & instructions', 'Provider, model & account', 'Delegation', 'Availability & defaults', 'Capabilities', 'Permissions']) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText('Advanced (JSON)', { exact: true })).toBeVisible();
    await expect(page.locator('.profile-save-footer')).toHaveCSS('position', 'sticky');
    if (await rows.count() > 1) {
      const before = writes.length;
      await rows.nth(1).click();
      await expect(page.getByTestId('profile-unsaved-dialog')).toHaveCount(0);
      expect(writes.slice(before)).toEqual([]);
    } else {
      test.info().annotations.push({ type: 'live-data', description: 'Only one profile exists; no-edit switching could not be exercised.' });
    }
  });

  test('creates, edits, saves, reloads, and deletes only a marked profile', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/profiles');
    const name = `${marker}-PROFILE`;
    await page.getByTestId('profile-create').click();
    await page.getByTestId('profile-label').fill(name);
    await page.getByTestId('profile-system-prompt').fill(`${marker} system prompt`);
    const pending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === `${environment.apiBase}/agent-configs`);
    await page.getByTestId('profile-save').click();
    const id = await createdId(await pending);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Profile saved');
    await page.reload();
    const row = page.getByTestId(`profile-${id}`);
    await expect(row).toContainText(name);
    await row.click();
    await expect(page.getByTestId('profile-system-prompt')).toHaveValue(`${marker} system prompt`);
    await page.getByTestId('profile-delete').click();
    await expect(page.getByTestId('delete-profile-dialog')).toBeVisible();
    await page.getByTestId('confirm-profile-delete').click();
    await expect(page.getByTestId(`profile-${id}`)).toHaveCount(0);
  });
});

test.describe('Reading comfort — #1509', () => {
  test('live task rows keep the shipped typography and completion hit area', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/tasks');
    await expect(page.getByTestId('page-tasks')).toBeVisible();
    const row = page.locator('[data-testid^="task-row-"]').first();
    test.skip(await row.count() === 0, 'No live task row is available for computed typography checks.');
    const title = row.getByTestId('task-title');
    const meta = row.locator('.task-meta');
    const completion = row.locator('.task-completion');
    const metrics = await title.evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
    });
    expect(metrics.size).toBeGreaterThanOrEqual(14);
    expect(metrics.weight).toBeLessThanOrEqual(450);
    expect(await meta.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(11);
    const hit = await completion.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
  });

  test('live transcript body keeps line-height and the 840px/72ch reading measures', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/agents');
    const transcript = page.getByTestId('transcript');
    const prose = transcript.locator('.markdown-copy').first();
    test.skip(await transcript.count() === 0 || await prose.count() === 0, 'No live transcript prose is available for computed reading-measure checks.');
    const measure = await transcript.evaluate((element) => {
      const proseElement = element.querySelector<HTMLElement>('.markdown-copy')!;
      const style = getComputedStyle(proseElement);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return {
        ratio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
        transcript: element.getBoundingClientRect().width,
        available: element.parentElement!.clientWidth,
        markdownMax: parseFloat(style.maxWidth),
        seventyTwoCh: context.measureText('0').width * 72,
      };
    });
    expect(measure.ratio).toBeGreaterThanOrEqual(1.45);
    expect(measure.transcript).toBeCloseTo(Math.min(measure.available, 840), 0);
    expect(Math.abs(measure.markdownMax - measure.seventyTwoCh)).toBeLessThan(1);
  });
});

test.describe('Hermes browser boundary — #1542/#1541', () => {
  test('plain browser hides navigation and renders the disabled route state', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/agents');
    expect(await page.evaluate(() => (window as Window & { rhythmShell?: unknown }).rhythmShell)).toBeUndefined();
    await expect(page.getByRole('navigation', { name: 'Product destinations' }).getByText('Hermes', { exact: true })).toHaveCount(0);
    await openLive(page, '/hermes');
    await expect(page.getByTestId('page-hermes')).toContainText(/disabled|RHYTHM_HERMES_ENABLED=1/i);
  });
});

test.describe('Advanced session directory fallback — #1496', () => {
  test('browser Browse is disabled while manual path entry works', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/agents');
    await page.getByTestId('new-session-advanced').click();
    await expect(page.getByTestId('advanced-browse')).toBeVisible();
    await expect(page.getByTestId('advanced-browse')).toBeDisabled();
    const manualPath = `/tmp/${marker}-MANUAL`;
    await page.getByTestId('advanced-cwd').fill(manualPath);
    await expect(page.getByTestId('advanced-cwd')).toHaveValue(manualPath);
  });
});

test.describe('Persistent splitters — #1524', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('layout.')) localStorage.removeItem(key);
      }
    });
  });

  test('Shell navigation exposes ARIA values, drags by 80px, and persists', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/settings');
    const splitter = page.getByTestId('shell-navigation-resizer');
    await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(splitter).toHaveAttribute('aria-valuenow', /\d+/);
    const before = Number(await splitter.getAttribute('aria-valuenow'));
    await dragBy(page, splitter, 0, 80);
    const after = Number(await splitter.getAttribute('aria-valuenow'));
    expect(after).not.toBe(before);
    await expect.poll(() => page.locator('.app-canvas').evaluate((element) => getComputedStyle(element).getPropertyValue('--app-navigation-height').trim())).toBe(`${after}px`);
    await page.reload();
    await expect(page.getByTestId('shell-navigation-resizer')).toHaveAttribute('aria-valuenow', String(after));
  });

  test('Agents rail exposes ARIA values, drags by 80px, and persists', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/agents');
    const splitter = page.getByTestId('rail-resizer');
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    await expect(splitter).toHaveAttribute('aria-valuenow', /\d+/);
    const inspector = page.getByTestId('inspector-resizer');
    await expect(inspector).toHaveAttribute('aria-orientation', 'vertical');
    await expect(inspector).toHaveAttribute('aria-valuenow', /\d+/);
    const before = Number(await splitter.getAttribute('aria-valuenow'));
    await dragBy(page, splitter, 80, 0);
    const after = Number(await splitter.getAttribute('aria-valuenow'));
    expect(after).not.toBe(before);
    await expect.poll(() => page.locator('.agents-workspace').evaluate((element) => getComputedStyle(element).getPropertyValue('--rail-width').trim())).toBe(`${after}px`);
    await page.reload();
    await expect(page.getByTestId('rail-resizer')).toHaveAttribute('aria-valuenow', String(after));
  });

  test('Settings ListInspector exposes ARIA values, drags by 80px, and persists', async ({ page }) => {
    recordPageWrites(page);
    await openLive(page, '/settings');
    const splitter = page.getByRole('separator', { name: 'Resize Settings sections list' });
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    await expect(splitter).toHaveAttribute('aria-valuenow', /\d+/);
    const before = Number(await splitter.getAttribute('aria-valuenow'));
    await dragBy(page, splitter, 80, 0);
    const after = Number(await splitter.getAttribute('aria-valuenow'));
    expect(after).not.toBe(before);
    await expect.poll(() => page.locator('.settings-list-inspector').evaluate((element) => getComputedStyle(element).getPropertyValue('--list-inspector-list-width').trim())).toBe(`${after}px`);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize Settings sections list' })).toHaveAttribute('aria-valuenow', String(after));
  });
});
