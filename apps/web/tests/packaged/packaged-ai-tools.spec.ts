import { randomUUID } from 'node:crypto';
import { mkdtempSync, lstatSync, rmdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, ObservedApi, OwnedRecords, responseFor, localRows, expectedRevision, API, ENGINE } from './feature-test';
import { aiSurfaces, openAiSurface, readAiCollection, type AiRow } from './ai-surfaces';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { OwnedMemoryFixture } from './private-memory-fixture';

test('[AI memory] selected inspector contains authoritative content and kind filtering and reload stay truthful', async ({ page }) => {
  // Catches the former title-only memory inspector and a filter that displays another kind's rows.
  const surface = aiSurfaces.find(s => s.slug === 'brain')!;
  let response = await openAiSurface(page, surface);
  let rows = await readAiCollection(response, surface);
  let owned: OwnedMemoryFixture | null = null;
  try {
    const fixturePath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
    if (fixturePath) {
      const manifest = readQualificationFixture(fixturePath, expectedRevision).manifest;
      expect(manifest.syntheticActor).toBeDefined();
      expect(new URL(response.url()).origin).toBe(API);
      expect(response.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
      const api = ObservedApi.from(response);
      expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
        user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
      });
      owned = new OwnedMemoryFixture(api);
      await owned.create();
      const seededPending = responseFor(page, 'GET', '/agent-memory');
      await page.reload();
      response = await seededPending;
      rows = await readAiCollection(response, surface);
    }
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

test('[AI quality] empty agent kind keeps its authoritative Unknown agent identity and exact counts', async ({ page }) => {
  // Catches blank report-card identities when the real rollup contains an empty kind.
  const surface = aiSurfaces.find(s => s.slug === 'report-card')!;
  let response = await openAiSurface(page, surface);
  let body = await response.json();
  let records: OwnedRecords | null = null;
  let cwd: string | null = null;
  let cwdIdentity: { dev: number; ino: number } | null = null;
  let sdkId: string | null = null;
  try {
    const fixturePath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
    if (fixturePath) {
      const manifest = readQualificationFixture(fixturePath, expectedRevision).manifest;
      expect(manifest.syntheticActor).toBeDefined();
      expect(new URL(response.url()).origin).toBe(API);
      expect(response.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
      const api = ObservedApi.from(response);
      expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
        user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
      });
      records = new OwnedRecords(page, 'sessions', 'report-card-agentless');
      records.api = api;
      cwd = mkdtempSync(join(manifest.fixtureRoot, 'agentless-cwd-'));
      const stat = lstatSync(cwd);
      expect(stat?.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
        && (stat.mode & 0o077) === 0).toBe(true);
      cwdIdentity = { dev: stat!.dev, ino: stat!.ino };
      records.directory = cwd;
      const name = `${records.prefix} agentless`;
      const created = await api.fetch('/agent-sessions', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, profileId: null, cwd, isolateWorktree: false, permissionMode: 'default' }) });
      expect(created.status).toBe(201);
      const session = await created.json() as { id: string; name: string; profileId: null; agentKind: string;
        ownerUserId: number; cwd: string; sdkSessionId: string };
      expect(session).toMatchObject({ id: expect.any(String), name, profileId: null, agentKind: '',
        ownerUserId: manifest.ownerUserId, cwd, sdkSessionId: expect.any(String) });
      records.remember(session);
      sdkId = session.sdkSessionId;
      expect(localRows('SELECT id,name,agent_kind,profile_id,owner_user_id,cwd,sdk_session_id FROM agent_sessions WHERE id=?', session.id))
        .toMatchObject([{ id: session.id, name, agent_kind: '', profile_id: null, owner_user_id: manifest.ownerUserId,
          cwd, sdk_session_id: sdkId }]);
      const engine = await fetch(`${ENGINE}/session/${encodeURIComponent(sdkId)}?directory=${encodeURIComponent(cwd)}`,
        { signal: AbortSignal.timeout(20_000) });
      expect(engine.status).toBe(200);
      expect(await engine.json()).toMatchObject({ id: sdkId, directory: cwd, title: name });
      const pending = responseFor(page, 'GET', '/agents/run-quality');
      await page.reload();
      response = await pending;
      expect(response.status()).toBe(200);
      body = await response.json();
      expect(body.windowDays).toBe(30);
    }
    const rows = body.agents as AiRow[];
    const row = rows.find(item => typeof item.agentKind === 'string' && item.agentKind.trim() === '');
    expect(row, 'UNVERIFIED: the live rollup has no real empty-kind agent row').toBeDefined();
    expect(row!.agentLabel).toBe('Unknown agent');
    if (records) expect(Number(row!.totalRuns)).toBeGreaterThanOrEqual(1);

    const rowView = page.getByTestId(`report-agent-${row!.agentKind}`);
    await expect(rowView).toBeVisible();
    await expect(rowView).toContainText('Unknown agent');
    await expect(rowView).toContainText(`${row!.totalRuns} runs`);
    await expect(rowView).toContainText(`${row!.completedRuns} completed`);
    await rowView.click();
    const inspector = page.getByTestId('list-inspector-detail');
    await expect(inspector).toContainText(`${row!.totalRuns} runs`);
    await expect(inspector).toContainText(`${row!.completedRuns} completed`);
    if (row!.notEnoughData) await expect(inspector).toContainText('Not enough data to score this agent yet.');

    // Re-read the exact API surface after selection; selection is view-local and must not mutate rollup data.
    const canonical = await ObservedApi.from(response).json<{ agents: AiRow[] }>('/agents/run-quality?windowDays=30');
    expect(canonical.agents).toEqual(rows);
  } finally {
    try {
      if (records) await records.cleanup({ keepDirectory: true });
      if (sdkId && cwd) {
        const list = await fetch(`${ENGINE}/session?directory=${encodeURIComponent(cwd)}`,
          { signal: AbortSignal.timeout(20_000) });
        expect(list.status).toBe(200);
        const sessions = await list.json() as Array<{ id: string }>;
        expect(sessions.some(session => session.id === sdkId)).toBe(false);
      }
    } finally {
      if (cwd && cwdIdentity) {
        const stat = lstatSync(cwd, { throwIfNoEntry: false });
        if (stat && stat.isDirectory() && !stat.isSymbolicLink()
          && stat.dev === cwdIdentity.dev && stat.ino === cwdIdentity.ino
          && localRows('SELECT id FROM agent_sessions WHERE cwd=?', cwd).length === 0) rmdirSync(cwd);
      }
    }
  }
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
