import { randomUUID } from 'node:crypto';
import { test, expect, ObservedApi, responseFor } from './feature-test';
import { aiSurfaces, openAiSurface, readAiCollection, type AiRow } from './ai-surfaces';

test('[AI schedules] history belongs to the selected schedule and survives reopening', async ({ page }) => {
  // Catches one schedule's cached history appearing under another schedule.
  const surface = aiSurfaces.find(item => item.slug === 'tasks')!;
  const response = await openAiSurface(page, surface);
  const rows = await readAiCollection(response, surface);
  expect(rows.length, 'UNVERIFIED: schedule history requires two read-only schedule fixtures').toBeGreaterThanOrEqual(2);
  const api = ObservedApi.from(response);
  for (const row of [rows[1], rows[0]]) {
    const path = `/agent-schedules/${row.id}/runs`;
    const pending = responseFor(page, 'GET', path);
    await page.getByTestId(`schedule-${row.id}`).click();
    const loaded = await pending;
    expect(loaded.status()).toBe(200);
    const runs = await loaded.json() as AiRow[];
    const canonical = await api.json<AiRow[]>(path);
    expect(runs.map(run => run.id)).toEqual(canonical.map(run => run.id));
    if (!runs.length) await expect(page.getByTestId('list-inspector-detail')).toContainText('No runs yet.');
    for (const run of runs) await expect(page.getByTestId(`schedule-run-${run.id}`)).toContainText(String(run.status));
    await expect(page.getByTestId('list-inspector-detail')).toContainText(String(row.prompt));
  }
});

test('[AI schedules] blank validation and cancelling a new schedule schedule no work', async ({ page }) => {
  // Catches scheduling on editor open/cancel or an empty Save that bypasses required fields.
  const surface = aiSurfaces.find(item => item.slug === 'tasks')!;
  const response = await openAiSurface(page, surface);
  const api = ObservedApi.from(response);
  const before = await readAiCollection(response, surface);
  const writes: string[] = [];
  const listener = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname.startsWith('/agent-schedules') && request.method() !== 'GET') writes.push(request.method());
  };
  page.on('request', listener);
  try {
    await page.getByTestId('schedule-new').click();
    await page.getByTestId('schedule-save').click();
    const dialog = page.getByTestId('schedule-editor');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(`[smoke] schedule ${randomUUID().slice(0, 8)}`);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);
    expect((await api.json<AiRow[]>('/agent-schedules')).map(row => row.id).sort()).toEqual(before.map(row => row.id).sort());
  } finally { page.off('request', listener); }
});
