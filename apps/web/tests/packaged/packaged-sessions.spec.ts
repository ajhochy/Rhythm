import { test, expect, responseFor, assertResponse, localRows } from './feature-test';
import { test as gap } from '@playwright/test';

test('[P0] sessions: named session persists correct cwd/profile and deletes from API, DB and engine', async ({ page, sessions }) => {
  // Catches fixture-backed creation, lost profile/cwd association, stale reload selection and soft-delete masquerading as permanent deletion.
  await sessions.open();
  const row = await sessions.create(' café "quoted" 😀');
  expect(row.sdkSessionId, 'real create must allocate an engine identity').toEqual(expect.any(String));
  const id = String(row.id);
  await expect(page.getByTestId(`session-${id}`)).toContainText(String(row.name));
  expect(await sessions.read(id)).toMatchObject({ name: row.name, cwd: sessions.directory, profileId: row.profileId });
  expect(localRows('SELECT id,name,cwd,profile_id FROM agent_sessions WHERE id=?', id)).toMatchObject([{ id, name: row.name, cwd: sessions.directory, profile_id: row.profileId }]);
  await page.reload();
  await expect(page.getByTestId(`session-${id}`)).toContainText(String(row.name));
  await page.getByTestId(`session-${id}`).click();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  const removed = responseFor(page, 'DELETE', `/agent-sessions/${id}/hard`);
  await page.getByTestId(`session-menu-${id}`).click();
  await page.getByTestId(`delete-${id}`).click();
  await page.getByTestId('confirm-session-delete').click();
  await assertResponse(await removed, 'DELETE', `/agent-sessions/${id}/hard`, 204);
  await expect(page.getByTestId(`session-${id}`)).toHaveCount(0);
  expect((await sessions.api!.fetch(`/agent-sessions/${id}`)).status).toBe(404);
  expect(localRows('SELECT id FROM agent_sessions WHERE id=?', id)).toEqual([]);
  if (typeof row.sdkSessionId === 'string') {
    const engine = await fetch(`http://127.0.0.1:4096/session/${row.sdkSessionId}?directory=${encodeURIComponent(sessions.directory!)}`);
    expect(engine.status, 'engine session leaked after permanent deletion').toBe(404);
  }
});

gap('[P0] sessions: UNVERIFIED child pagination keeps owned ancestry and project scope', () => {
  // Would catch a later child page dropping its parent or appearing under another project.
  throw new Error('UNVERIFIED: collapsed owned groups do not exercise child cursor/ancestor boundaries — requires a disposable app-matched database with nonce-owned parent/child pages; production DB seeding and unremovable automatically named children are forbidden');
});

test('[P0] sessions: blank names, cancel and reload cannot allocate an unnamed session', async ({ page, sessions }) => {
  // Catches validation/cancel paths allocating a durable session before the user chooses Start.
  await sessions.open();
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/agent-sessions') writes.push(request.postData() ?? ''); });
  await sessions.prepare();
  await page.getByTestId('advanced-name').fill('');
  await expect(page.getByTestId('advanced-create')).toBeDisabled();
  await page.getByTestId('advanced-name').fill('   ');
  await expect(page.getByTestId('advanced-create')).toBeDisabled();
  await page.getByTestId('advanced-name').fill(`${sessions.prefix} cancelled`);
  await page.getByTestId('advanced-session-dialog-close').click();
  await sessions.prepare(' reload');
  await page.reload();
  await expect(page.getByTestId('advanced-session-dialog')).toHaveCount(0);
  expect((await sessions.list()).filter(row => sessions.owns(row.name))).toEqual([]);
  expect(writes).toEqual([]);
});

test('[P0] sessions: failed creation keeps the name and permits recovery', async ({ page, sessions }) => {
  // Catches a rejected create closing the form, losing the draft, or adding an optimistic orphan to the rail.
  await sessions.open();
  await sessions.prepare();
  const fail = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] temporary session outage' } } });
  };
  await page.route('**/agent-sessions', fail);
  const failed = responseFor(page, 'POST', '/agent-sessions');
  await page.getByTestId('advanced-create').click();
  await assertResponse(await failed, 'POST', '/agent-sessions', 503);
  await expect(page.getByTestId('advanced-error')).toContainText('Something went wrong');
  await expect(page.getByTestId('advanced-name')).toHaveValue(sessions.prefix);
  expect((await sessions.list()).filter(row => sessions.owns(row.name))).toEqual([]);
  await page.unroute('**/agent-sessions', fail);
  await page.getByTestId('advanced-session-dialog-close').click();
  const row = await sessions.create(' retry');
  await expect(page.getByTestId(`session-${row.id}`)).toContainText(String(row.name));
  expect(await sessions.read(row.id)).toMatchObject({ name: row.name });
});

test('[P0] sessions: long Unicode name persists without truncating stored identity', async ({ page, sessions }) => {
  // Catches UI or API truncation changing the identity/name after a reload.
  await sessions.open();
  const suffix = ` ${'long café 😀 '.repeat(60)}`.trimEnd();
  const row = await sessions.create(suffix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix + suffix });
  expect(localRows('SELECT name FROM agent_sessions WHERE id=?', row.id)).toMatchObject([{ name: sessions.prefix + suffix }]);
  await page.reload();
  await expect(page.getByTestId(`session-${row.id}`)).toContainText(sessions.prefix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix + suffix });
});

test('[P0] sessions: cancel permanent deletion leaves the owned session intact', async ({ page, sessions }) => {
  // Catches deleting on menu activation rather than on deliberate confirmation.
  await sessions.open();
  const row = await sessions.create();
  await page.getByTestId(`session-menu-${row.id}`).click();
  await page.getByTestId(`delete-${row.id}`).click();
  await page.getByTestId('delete-session-dialog-close').click();
  await page.reload();
  await expect(page.getByTestId(`session-${row.id}`)).toContainText(sessions.prefix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix });
  expect(localRows('SELECT id FROM agent_sessions WHERE id=?', row.id)).toHaveLength(1);
});
