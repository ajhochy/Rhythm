import { randomUUID } from 'node:crypto';
import { test as base, expect, ObservedApi, localRows, responseFor, type Row } from './feature-test';
import { aiSurfaces, openAiSurface } from './ai-surfaces';

// No recipe is run: only this nonce's inert recipe may be created/deleted.
const test = base.extend<{ cookbookFixture: { title: string; api: ObservedApi } }>({
  cookbookFixture: async ({ page }, use) => {
    const title = `[smoke] cookbook ${randomUUID().slice(0, 8)}`;
    const response = await openAiSurface(page, aiSurfaces.find(s => s.slug === 'cookbook')!);
    expect(response.status()).toBe(200);
    const api = ObservedApi.from(response);
    try { await use({ title, api }); }
    finally {
      await page.goto('rhythm://app/index.html#/tools/agent-tools');
      for (const row of (await api.json<Row[]>('/agent-cookbook')).filter(row => row.title === title)) {
        const detail = await api.json<Row>(`/agent-cookbook/${row.id}`);
        expect(detail.title, 'refuse to delete a foreign recipe').toBe(title);
        expect(localRows('SELECT title FROM agent_cookbook WHERE id=?', row.id)).toEqual([{ title }]);
        expect((await api.fetch(`/agent-cookbook/${row.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(localRows('SELECT id FROM agent_cookbook WHERE id=?', row.id)).toEqual([]);
      }
      expect((await api.json<Row[]>('/agent-cookbook')).filter(row => row.title === title)).toEqual([]);
    }
  },
});

test('[AI cookbook] creates real inert recipe with ordered steps and persists after reload', async ({ page, cookbookFixture: { title, api } }) => {
  // Catches a local-only recipe and double serialization/loss of step order.
  await page.getByTestId('cookbook-new').click();
  const dialog = page.getByTestId('cookbook-editor');
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Description', { exact: true }).fill('Harmless synthetic recipe');
  await dialog.getByLabel('Steps (one per line)', { exact: true }).fill('First synthetic step.\nSecond synthetic step.');
  const pending = responseFor(page, 'POST', '/agent-cookbook');
  await page.getByTestId('cookbook-save').click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const row = await response.json();
  expect(row).toMatchObject({ title, description: 'Harmless synthetic recipe' });
  expect(JSON.parse(row.stepsJson)).toEqual(['First synthetic step.', 'Second synthetic step.']);
  expect(await api.json(`/agent-cookbook/${row.id}`)).toMatchObject({ id: row.id, title, stepsJson: row.stepsJson });
  await page.getByTestId(`recipe-${row.id}`).click();
  await expect(page.getByTestId('list-inspector-detail')).toContainText('Second synthetic step.');
  const reload = responseFor(page, 'GET', '/agent-cookbook');
  await page.reload();
  expect((await (await reload).json()).some((item: Row) => item.id === row.id && item.title === title)).toBe(true);
  await page.getByTestId(`recipe-${row.id}`).click();
  await expect(page.locator('.recipe-steps li')).toHaveText(['First synthetic step.', 'Second synthetic step.']);
});

test('[AI cookbook] blank validation and cancelling a draft leave the backend unchanged', async ({ page, cookbookFixture: { title, api } }) => {
  // Catches accidental creation on cancel/blank submit, without touching an existing recipe.
  const before = (await api.json<Row[]>('/agent-cookbook')).map(row => row.id).sort();
  const writes: string[] = [];
  const listener = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname === '/agent-cookbook' && request.method() === 'POST') writes.push(request.method());
  };
  page.on('request', listener);
  try {
    await page.getByTestId('cookbook-new').click();
    await page.getByTestId('cookbook-save').click();
    await expect(page.getByTestId('cookbook-editor')).toBeVisible();
    await page.getByTestId('cookbook-editor').getByLabel('Title', { exact: true }).fill(title);
    await page.getByTestId('cookbook-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('cookbook-editor')).toHaveCount(0);
    expect(writes).toEqual([]);
    expect((await api.json<Row[]>('/agent-cookbook')).map(row => row.id).sort()).toEqual(before);
  } finally { page.off('request', listener); }
});
