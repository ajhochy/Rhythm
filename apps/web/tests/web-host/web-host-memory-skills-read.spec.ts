import { randomUUID } from 'node:crypto';
import { test, expect, ObservedApi, responseFor } from './parity-fixture';
import { aiSurfaces, openAiSurface, readAiCollection, type AiRow } from './parity-ai-surfaces';
import { OwnedMemoryFixture } from './owned-web-memory-fixture';

test('#37: [AI memory] selected inspector contains authoritative content and kind filtering and reload stay truthful', async ({ page, parity }) => {
  // Catches the former title-only memory inspector and a filter that displays another kind's rows.
  const surface = aiSurfaces.find(s => s.slug === 'brain')!;
  let response = await openAiSurface(page, surface);
  let rows = await readAiCollection(response, surface);
  let owned: OwnedMemoryFixture | null = null;
  try {
    expect(new URL(response.url()).origin).toBe(parity.origin);
    expect(response.request().headers().authorization).toBeUndefined();
    const api = ObservedApi.from(response, parity);
    expect(await api.json('/web/bootstrap')).toMatchObject({ owner: { id: 1, displayName: 'Synthetic Admin' } });
    owned = new OwnedMemoryFixture(api);
    await owned.create();
    const seededPending = responseFor(page, 'GET', '/agent-memory');
    await page.reload();
    response = await seededPending;
    rows = await readAiCollection(response, surface);
    expect(rows.length, 'UNVERIFIED: memory inspector needs a populated read-only fixture').toBeGreaterThan(0);
    const row = owned ? rows.find(item => item.id === owned!.indexId) : rows[0];
    expect(row, 'exact private memory must appear in the normal catalog').toBeDefined();
    await page.getByTestId(`memory-${row!.id}`).click();
    await expect(page.getByTestId('brain-inspector-detail').getByRole('heading', { name: String(row!.title || row!.content), exact: true })).toBeVisible();
    const content = page.getByTestId('brain-memory-content');
    // Markdown formatting may differ from source bytes; compare actual words in their order.
    const words = String(row!.content).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const visible = (await content.innerText()).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
    expect(visible).toContain(words.slice(0, 20).join(' '));
    const pending = responseFor(page, 'GET', '/agent-memory');
    await page.getByTestId(`brain-kind-${row!.kind}`).click();
    const filtered = await pending;
    expect(new URL(filtered.url()).searchParams.get('kind')).toBe(row!.kind);
    const filteredRows = await readAiCollection(filtered, surface);
    expect(filteredRows.length).toBeGreaterThan(0);
    expect(filteredRows.every(item => item.kind === row!.kind)).toBe(true);
    if (owned) expect(filteredRows.some(item => item.id === owned!.indexId)).toBe(true);
    // Kind is intentionally view-local; reload must restore a truthful unfiltered collection.
    const reload = responseFor(page, 'GET', '/agent-memory');
    await page.reload();
    const reopened = await reload;
    expect(new URL(reopened.url()).searchParams.has('kind')).toBe(false);
    expect((await readAiCollection(reopened, surface)).some(item => item.id === row!.id)).toBe(true);
  } finally { if (owned) await owned.cleanup(); }
});

test('#38: [AI memory] no-match search is empty and clearing it restores real rows', async ({ page, parity }) => {
  const owned = new OwnedMemoryFixture(parity.api);
  try {
  await owned.create();
  // Catches stale rows masquerading as search results and a search clear that leaves an empty cache.
  const surface = aiSurfaces.find(s => s.slug === 'brain')!;
  const response = await openAiSurface(page, surface);
  const original = await readAiCollection(response, surface);
  expect(original.some(row => row.id === owned.indexId)).toBe(true);
  const nonce = `smoke-no-memory-${randomUUID()}`;
  const pending = responseFor(page, 'GET', '/agent-memory/search');
  await page.getByTestId('brain-search').fill(nonce);
  const searched = await pending;
  expect(new URL(searched.url()).searchParams.get('q')).toBe(nonce);
  expect(searched.status()).toBe(200);
  expect(await searched.json()).toEqual([]);
  await expect(page.getByRole('heading', { name: 'No memories found', exact: true })).toBeVisible();
  const restored = responseFor(page, 'GET', '/agent-memory');
  await page.getByTestId('brain-search').fill('');
  const rows = await readAiCollection(await restored, surface);
  expect(rows.some(row => row.id === owned.indexId)).toBe(true);
  if (original.length) {
    expect(rows.some(row => row.id === original[0].id)).toBe(true);
    await expect(page.getByTestId(`memory-${original[0].id}`)).toBeVisible();
  }
  } finally { await owned.cleanup(); }
});

test('#36: [AI skills] engine content matches the selected skill; cancel and blank save make no write', async ({ page, parity }) => {
  // Catches a catalog-only facade with missing/stale SKILL.md and an editor that saves on cancel.
  const surface = aiSurfaces.find(s => s.slug === 'skills')!;
  const response = await openAiSurface(page, surface);
  const rows = await readAiCollection(response, surface);
  expect(rows.length, 'UNVERIFIED: no engine skill available').toBeGreaterThan(0);
  const row = rows[0];
  const api = ObservedApi.from(response, parity);
  const body = await api.json<{ name: string; content: string }>(`/opencode/skills/${encodeURIComponent(String(row.name))}/content`);
  expect(body.name).toBe(row.name);
  expect(body.content.trim().length).toBeGreaterThan(0);
  await page.getByTestId(`skills-item-${row.name}`).click();
  await expect(page.getByTestId('list-inspector-detail').locator('pre')).toHaveText(body.content);
  const writes: string[] = [];
  const listener = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname.startsWith('/opencode/skills') && request.method() !== 'GET') writes.push(request.method());
  };
  page.on('request', listener);
  try {
    await page.getByTestId('skills-new').click();
    await page.getByTestId('skills-save').click();
    await expect(page.getByTestId('skills-editor')).toBeVisible();
    await page.getByTestId('skills-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('skills-editor')).toHaveCount(0);
    expect(writes).toEqual([]);
    const readback = await api.json<AiRow[]>('/opencode/skills?withMetadata=true');
    expect(readback.map(item => item.name).sort()).toEqual(rows.map(item => item.name).sort());
  } finally { page.off('request', listener); }
});
