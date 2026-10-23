import { test, expect, responseFor, assertResponse } from './parity-fixture';

// Browser ports of packaged-sessions.spec.ts; no provider turns are sent.

test('#1: sessions: named session persists correct cwd/profile and deletes from API, DB and engine', async ({ page, sessions, parity }) => {
  // Catches fixture-backed creation, lost profile/cwd association, stale reload selection and soft-delete masquerading as permanent deletion.
  await sessions.open();
  const row = await sessions.create(' café "quoted" 😀');
  expect(row.sdkSessionId, 'real create must allocate an engine identity').toEqual(expect.any(String));
  const id = String(row.id);
  await expect(page.getByTestId(`session-${id}`)).toContainText(String(row.name));
  expect(await sessions.read(id)).toMatchObject({ name: row.name, cwd: sessions.directory, profileId: row.profileId });
  expect(parity.rows('SELECT id,name,cwd,profile_id FROM agent_sessions WHERE id=?', id)).toMatchObject([{ id, name: row.name, cwd: sessions.directory, profile_id: row.profileId }]);
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
  expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', id)).toEqual([]);
  if (typeof row.sdkSessionId === 'string') {
    const engine = await parity.engineFetch(`/session/${row.sdkSessionId}`);
    expect(engine.status, 'engine session leaked after permanent deletion').toBe(404);
  }
});

test('#2: sessions: blank names, cancel and reload cannot allocate an unnamed session', async ({ page, sessions, parity }) => {
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

test('#3: sessions: failed creation keeps the name and permits recovery', async ({ page, sessions, parity }) => {
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

test('#4: sessions: long Unicode name persists without truncating stored identity', async ({ page, sessions, parity }) => {
  // Catches UI or API truncation changing the identity/name after a reload.
  await sessions.open();
  const suffix = ` ${'long café 😀 '.repeat(60)}`.trimEnd();
  const row = await sessions.create(suffix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix + suffix });
  expect(parity.rows('SELECT name FROM agent_sessions WHERE id=?', row.id)).toMatchObject([{ name: sessions.prefix + suffix }]);
  await page.reload();
  await expect(page.getByTestId(`session-${row.id}`)).toContainText(sessions.prefix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix + suffix });
});

test('#5: sessions: cancel permanent deletion leaves the owned session intact', async ({ page, sessions, parity }) => {
  // Catches deleting on menu activation rather than on deliberate confirmation.
  await sessions.open();
  const row = await sessions.create();
  await page.getByTestId(`session-menu-${row.id}`).click();
  await page.getByTestId(`delete-${row.id}`).click();
  await page.getByTestId('delete-session-dialog-close').click();
  await page.reload();
  await expect(page.getByTestId(`session-${row.id}`)).toContainText(sessions.prefix);
  expect(await sessions.read(row.id)).toMatchObject({ name: sessions.prefix });
  expect(parity.rows('SELECT id FROM agent_sessions WHERE id=?', row.id)).toHaveLength(1);
});
