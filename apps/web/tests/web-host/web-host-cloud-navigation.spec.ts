// UI + real web proxy + synthetic upstream persistence only; not real-account proof.
import { test, expect, navigate, responseFor, assertResponse, ObservedApi, type Row } from './cloud-parity-fixture';

test('#68: [cloud fixture] navigation: Tasks route shows real collection content after direct navigation and reload', async ({ page, parity }) => {
  // Catches a live route rendering seeded fixtures or a cached page from another service.
  const pending = responseFor(page, 'GET', '/cloud/tasks');
  await page.goto('/#/tasks');
  const response = await pending; await assertResponse(response, 'GET', '/cloud/tasks', 200);
  const rows = await response.json() as Row[]; const api = ObservedApi.from(response, parity);
  expect(Array.isArray(rows)).toBe(true);
  await expect(page.locator('#tasks-title')).toBeVisible();
  if (rows.length) {
    await page.getByTestId('tasks-completion-filter').selectOption('all');
    const row = rows[0];
    expect(row).toMatchObject({ id: expect.any(String), title: expect.any(String), status: expect.any(String) });
    await page.getByTestId('tasks-search').fill(String(row.title));
    await expect(page.getByTestId(`task-row-${row.id}`)).toContainText(String(row.title));
    const read = await api.json<Row>(`/cloud/tasks/${row.id}`); expect(read).toMatchObject({ id: row.id, title: row.title, status: row.status });
  } else await expect(page.getByTestId('page-state-empty')).toBeVisible();
  const reloaded = responseFor(page, 'GET', '/cloud/tasks');
  await page.reload();
  const reloadResponse = await reloaded;
  await assertResponse(reloadResponse, 'GET', '/cloud/tasks', 200);
  const reloadedRows = await reloadResponse.json() as Row[];
  expect(reloadedRows.map(row => row.id).sort()).toEqual(rows.map(row => row.id).sort());
  await expect(page.locator('#tasks-title')).toBeVisible();
  if (rows.length === 0) await expect(page.getByTestId('page-state-empty')).toBeVisible();
});

test('#69: [cloud fixture] navigation: narrow More menu reaches a real data page and Agents remains usable', async ({ page, parity }) => {
  // Catches clipped overflow destinations and a hash changing while the old page stays on screen (#1581).
  await page.setViewportSize({ width: 550, height: 600 });
  try {
    await page.goto('/#/agents');
    const pending = responseFor(page, 'GET', '/cloud/tasks');
    await navigate(page, 'tasks');
    const response = await pending; await assertResponse(response, 'GET', '/cloud/tasks', 200);
    expect(Array.isArray(await response.json())).toBe(true);
    await expect(page.locator('#tasks-title')).toBeVisible();
    await expect(page.getByTestId('route-not-found')).toHaveCount(0);
    const sessions = responseFor(page, 'GET', '/agent-sessions');
    await navigate(page, 'agents');
    const sessionResponse = await sessions;
    await assertResponse(sessionResponse, 'GET', '/agent-sessions', 200);
    expect(await sessionResponse.json()).toMatchObject({ sessions: expect.any(Array) });
    await expect(page.locator('#main-content section[aria-label="Agents workspace"]').first()).toBeVisible();
  } finally { await page.setViewportSize({ width: 1440, height: 900 }); }
});

test('#70: [cloud fixture] navigation: failed collection read is visible and recovers after retry', async ({ page, parity }) => {
  // Catches a backend outage being reported as a healthy empty collection with no recovery action.
  const fail = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] temporary task outage' } } });
    else await route.fallback();
  };
  await page.route(/\/cloud\/tasks(?:\?.*)?$/, fail);
  const failed = responseFor(page, 'GET', '/cloud/tasks');
  await page.goto('/#/tasks');
  await assertResponse(await failed, 'GET', '/cloud/tasks', 503);
  await expect(page.getByTestId('page-state-server-error')).toBeVisible();
  await expect(page.getByTestId('tasks-empty-create')).toHaveCount(0);
  await page.unroute(/\/cloud\/tasks(?:\?.*)?$/, fail);
  const recovered = responseFor(page, 'GET', '/cloud/tasks');
  await page.getByTestId('page-retry').click();
  const response = await recovered; await assertResponse(response, 'GET', '/cloud/tasks', 200);
  const rows = await response.json(); expect(Array.isArray(rows)).toBe(true);
  await expect(page.getByTestId('page-state-server-error')).toHaveCount(0);
  await expect(page.locator('#tasks-title')).toBeVisible();
  const observed = new URL(response.url());
  const readback = await ObservedApi.from(response, parity).json<Row[]>(observed.pathname + observed.search);
  // Compare IDs without dumping private task bodies into assertion output; include the actual status=all filter.
  expect(readback.map(row => row.id).sort()).toEqual(rows.map((row: Row) => row.id).sort());
});
