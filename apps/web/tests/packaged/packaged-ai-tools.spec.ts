import { randomUUID } from 'node:crypto';
import { test, expect, ObservedApi, responseFor } from './feature-test';
import { aiSurfaces, openAiSurface, readAiCollection, type AiRow } from './ai-surfaces';

test('[AI memory] selected inspector contains authoritative content and kind filtering and reload stay truthful', async ({ page }) => {
  // Catches the former title-only memory inspector and a filter that displays another kind's rows.
  const surface = aiSurfaces.find(s => s.slug === 'brain')!;
  const response = await openAiSurface(page, surface);
  const rows = await readAiCollection(response, surface);
  expect(rows.length, 'UNVERIFIED: memory inspector needs a populated read-only fixture').toBeGreaterThan(0);
  const row = rows[0];
  await page.getByTestId(`memory-${row.id}`).click();
  await expect(page.getByTestId('brain-inspector-detail').getByRole('heading', { name: String(row.title || row.content), exact: true })).toBeVisible();
  const content = page.getByTestId('brain-memory-content');
  // Markdown formatting may differ from source bytes; compare actual words in their order.
  const words = String(row.content).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const visible = (await content.innerText()).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
  expect(visible).toContain(words.slice(0, 20).join(' '));
  const pending = responseFor(page, 'GET', '/agent-memory');
  await page.getByTestId(`brain-kind-${row.kind}`).click();
  const filtered = await pending;
  expect(new URL(filtered.url()).searchParams.get('kind')).toBe(row.kind);
  const filteredRows = await readAiCollection(filtered, surface);
  expect(filteredRows.length).toBeGreaterThan(0);
  expect(filteredRows.every(item => item.kind === row.kind)).toBe(true);
  // Kind is intentionally view-local; reload must restore a truthful unfiltered collection.
  const reload = responseFor(page, 'GET', '/agent-memory');
  await page.reload();
  const reopened = await reload;
  expect(new URL(reopened.url()).searchParams.has('kind')).toBe(false);
  expect((await readAiCollection(reopened, surface)).some(item => item.id === row.id)).toBe(true);
});

test('[AI memory] no-match search is empty and clearing it restores real rows', async ({ page }) => {
  // Catches stale rows masquerading as search results and a search clear that leaves an empty cache.
  const surface = aiSurfaces.find(s => s.slug === 'brain')!;
  const response = await openAiSurface(page, surface);
  const original = await readAiCollection(response, surface);
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
  if (original.length) {
    expect(rows.some(row => row.id === original[0].id)).toBe(true);
    await expect(page.getByTestId(`memory-${original[0].id}`)).toBeVisible();
  }
});

test('[AI skills] engine content matches the selected skill; cancel and blank save make no write', async ({ page }) => {
  // Catches a catalog-only facade with missing/stale SKILL.md and an editor that saves on cancel.
  const surface = aiSurfaces.find(s => s.slug === 'skills')!;
  const response = await openAiSurface(page, surface);
  const rows = await readAiCollection(response, surface);
  expect(rows.length, 'UNVERIFIED: no engine skill available').toBeGreaterThan(0);
  const row = rows[0];
  const api = ObservedApi.from(response);
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

test('[AI quality] changing time window changes the API rollup and displayed evidence', async ({ page }) => {
  // Catches a cosmetic window selector that continues showing cached 30-day totals.
  const surface = aiSurfaces.find(s => s.slug === 'report-card')!;
  await readAiCollection(await openAiSurface(page, surface), surface);
  const pending = responseFor(page, 'GET', '/agents/run-quality');
  await page.getByTestId('report-window').selectOption('7');
  const response = await pending;
  expect(new URL(response.url()).searchParams.get('windowDays')).toBe('7');
  const body = await response.json();
  expect(body.windowDays).toBe(7);
  const rows = body.agents as AiRow[];
  expect(Array.isArray(rows)).toBe(true);
  await expect(page.getByTestId('tool-page-report-card')).toContainText('last 7 days');
  if (rows.length) {
    const row = rows.find(item => String(item.agentKind).length > 0) ?? rows[0];
    await page.getByTestId(`report-agent-${row.agentKind}`).click();
    await expect(page.getByTestId('list-inspector-detail')).toContainText(`${row.totalRuns} runs`);
    await expect(page.getByTestId('list-inspector-detail')).toContainText(`${row.completedRuns} completed`);
    if (row.notEnoughData) await expect(page.getByTestId('list-inspector-detail')).toContainText('Not enough data');
  } else await expect(page.getByRole('heading', { name: surface.empty, exact: true })).toBeVisible();
});

test('[AI shared agents] canonical revision and runtime readiness match the real catalog', async ({ page }) => {
  // Catches old per-host agent copies being presented as the canonical shared projection.
  await page.goto('rhythm://app/index.html#/tools/agent-tools');
  const pending = responseFor(page, 'GET', '/shared-agents/v1/catalog');
  await page.goto('rhythm://app/index.html#/tools/shared-agents');
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.agents)).toBe(true);
  expect(body.agents.length, 'UNVERIFIED: shared-agent catalog fixture is empty').toBeGreaterThan(0);
  const row = body.agents[0];
  await page.getByTestId(`shared-agent-${row.id}`).click();
  const screen = page.getByTestId('shared-agents-screen');
  for (const runtime of ['opencode', 'hermes']) {
    const projection = row.runtimes[runtime];
    await expect(screen.getByTestId(`shared-agent-readiness-${runtime}`)).toContainText(new RegExp(projection.readiness.replace(/-/g, ' '), 'i'));
  }
  const api = ObservedApi.from(response);
  const canonical = await api.json<{ agents: AiRow[] }>('/shared-agents/v1/catalog');
  expect(canonical.agents.find(item => item.id === row.id)?.revision).toBe(row.revision);
});
