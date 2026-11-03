import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, localRows, expectedRevision, API } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type MemoryRow = { id: string; content: string; source: string; source_id: string };
type MemoryPage = { items: Array<{ id: string; content: string; sourceId: string }>; total: number; offset: number; limit: number };

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI memory] 51 private vault notes page into the inspector and deleting the selected last-page note clears it';
const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let time = '';
  let now = Date.now();
  for (let index = 0; index < 10; index++) {
    time = crockford[now % 32] + time;
    now = Math.floor(now / 32);
  }
  return time + Array.from(randomBytes(16), byte => crockford[byte % 32]).join('');
}

function ownedRows(marker: string): MemoryRow[] {
  return localRows('SELECT id,content,source,source_id FROM agent_memory WHERE content LIKE ?', `%${marker}%`)
    .filter((row): row is MemoryRow => typeof row.id === 'string' && typeof row.content === 'string'
      && typeof row.source_id === 'string' && row.content.startsWith('[smoke] ')
      && row.content.includes(marker));
}

function ownedNote(root: string, sourceId: string): string {
  if (!sourceId || isAbsolute(sourceId) || sourceId.split(/[\\/]/).includes('..'))
    throw new Error('Owned memory note escaped the private fixture');
  const memory = join(root, 'memory');
  const dir = lstatSync(memory);
  expect(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid?.()).toBe(true);
  expect(realpathSync(memory)).toBe(memory);
  const file = resolve(memory, sourceId);
  expect(relative(memory, file).startsWith('..') || file === memory).toBe(false);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat) {
    expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true);
    expect(realpathSync(file).startsWith(`${memory}/`)).toBe(true);
  }
  return file;
}

function remainingOwnedNotes(root: string, marker: string, requested: Map<string, string>) {
  const fact = join(root, 'memory', 'fact');
  const dir = lstatSync(fact, { throwIfNoEntry: false });
  if (!dir) return [];
  expect(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid?.()).toBe(true);
  expect(realpathSync(fact)).toBe(fact);
  const found: Array<{ id: string; file: string }> = [];
  for (const name of readdirSync(fact)) {
    const file = ownedNote(root, join('fact', name));
    const raw = readFileSync(file, 'utf8');
    if (!raw.includes(marker)) continue;
    const matched = [...requested].find(([id, content]) => raw.includes(`id: ${id}`) && raw.includes(content));
    expect(matched, 'private vault file with nonce must match an exact requested ID and content').toBeDefined();
    found.push({ id: matched![0], file });
  }
  return found;
}

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else {
  test(title, async ({ page }) => {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    const marker = ` memory paging ${randomUUID()} item `;
    const requested = new Map<string, string>();
    let api: ObservedApi | null = null;
    try {
      await page.goto('rhythm://app/index.html#/tools/agent-tools');
      await page.goto('rhythm://app/index.html#/tools/brain');
      await page.getByTestId('tool-page-brain').waitFor({ state: 'visible' });
      await page.getByRole('heading', { name: 'No memories found', exact: true }).waitFor({ state: 'visible' });
      const firstRead = responseFor(page, 'GET', '/agent-memory');
      await page.reload();
      const firstResponse = await firstRead;
      await assertResponse(firstResponse, 'GET', '/agent-memory', 200);
      await firstResponse.json();
      expect(new URL(firstResponse.url()).origin).toBe(API);
      expect(firstResponse.request().headers().authorization).toBe(
        `Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
      api = ObservedApi.from(firstResponse);
      const me = await api.json<{ user: { id: number; email: string } }>('/auth/me');
      expect(me.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
      const baseline = await api.json<MemoryPage>('/agent-memory?withCounts=true&limit=50');
      expect(baseline.total, 'private memory paging requires an empty disposable actor vault').toBe(0);
      expect(ownedRows(marker)).toEqual([]);

      for (let index = 0; index < 51; index++) {
        const id = ulid();
        const content = `[smoke] ${String(index).padStart(2, '0')}-${randomUUID()}${marker}${index}. Harmless private paging observation.\n`
          + `Unique synthetic markers: ${randomUUID()} ${randomUUID()} ${randomUUID()}.`;
        requested.set(id, content);
        const response = await api.fetch('/agent-memory', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, kind: 'fact', source: 'manual', content, tags: ['smoke', marker] }) });
        expect(response.status, `owned memory POST ${index}`).toBe(201);
        const body = await response.json() as { id: string; path: string; kind: string };
        expect(body).toMatchObject({ id, kind: 'fact' });
        expect(typeof body.path).toBe('string');
      }

      const indexRows = ownedRows(marker);
      expect(indexRows).toHaveLength(51);
      expect(new Set(indexRows.map(row => row.id)).size).toBe(51);
      expect(indexRows.every(row => row.source === 'obsidian-memory')).toBe(true);
      for (const [noteId, content] of requested) {
        const row = indexRows.find(candidate => candidate.content === content);
        expect(row, 'each requested note has one derived index row').toBeDefined();
        const note = ownedNote(manifest.fixtureRoot, row!.source_id);
        const raw = readFileSync(note, 'utf8');
        expect(raw).toContain(`id: ${noteId}`);
        expect(raw).toContain(content);
      }
      const all = await api.json<MemoryPage>('/agent-memory?withCounts=true&limit=200');
      expect(all.total).toBe(51);
      expect(new Set(all.items.map(item => item.id))).toEqual(new Set(indexRows.map(row => row.id)));

      await page.goto('rhythm://app/index.html#/tools/agent-tools');
      await page.goto('rhythm://app/index.html#/tools/brain');
      await page.getByTestId('tool-page-brain').waitFor({ state: 'visible' });
      await page.getByTestId('brain-load-more').waitFor({ state: 'visible' });
      const firstPagePending = responseFor(page, 'GET', '/agent-memory');
      await page.reload();
      const renderedFirst = await firstPagePending;
      const firstPage = await renderedFirst.json() as MemoryPage;
      await assertResponse(renderedFirst, 'GET', '/agent-memory', 200);
      expect(firstPage).toMatchObject({ total: 51, offset: 0, limit: 50 });
      expect(firstPage.items).toHaveLength(50);
      expect(firstPage.items.every(item => indexRows.some(row => row.id === item.id && row.content === item.content))).toBe(true);
      await expect(page.getByTestId('brain-load-more')).toBeVisible();
      await expect(page.getByTestId('brain-column-memories').getByTestId(/^memory-/)).toHaveCount(50);

      const lastPagePending = responseFor(page, 'GET', '/agent-memory');
      await page.getByTestId('brain-load-more').click();
      const renderedLast = await lastPagePending;
      await assertResponse(renderedLast, 'GET', '/agent-memory', 200);
      expect(new URL(renderedLast.url()).searchParams.get('offset')).toBe('50');
      const lastPage = await renderedLast.json() as MemoryPage;
      expect(lastPage).toMatchObject({ total: 51, offset: 50 });
      expect(lastPage.items).toHaveLength(1);
      const last = lastPage.items[0];
      const lastRow = indexRows.find(row => row.id === last.id);
      expect(lastRow).toBeDefined();
      await expect(page.getByTestId(`memory-${last.id}`)).toBeVisible();
      await expect(page.getByTestId('brain-load-more')).toHaveCount(0);
      await expect(page.getByTestId('brain-column-memories').getByTestId(/^memory-/)).toHaveCount(51);

      await page.getByTestId(`memory-${last.id}`).click();
      await expect(page).toHaveURL(new RegExp(`memoryId=${last.id}`));
      await expect(page.getByTestId('brain-memory-content')).toContainText(last.content.split('\n')[0]);
      const selected = await api.json<{ id: string; content: string; sourceId: string }>(`/agent-memory/${last.id}`);
      expect(selected).toMatchObject({ id: last.id, content: last.content, sourceId: lastRow!.source_id });
      const deleted = await api.fetch(`/agent-memory/${last.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
      expect(localRows('SELECT id FROM agent_memory WHERE id=?', last.id)).toEqual([]);
      expect(lstatSync(ownedNote(manifest.fixtureRoot, lastRow!.source_id), { throwIfNoEntry: false })).toBeUndefined();
      const refreshedPending = responseFor(page, 'GET', '/agent-memory');
      await page.getByTestId('brain-refresh').click();
      const refreshed = await refreshedPending;
      await assertResponse(refreshed, 'GET', '/agent-memory', 200);
      await expect(page.getByTestId(`memory-${last.id}`)).toHaveCount(0);
      await expect(page.getByTestId('brain-column-inspector')).not.toContainText(last.content);
      expect((await api.json<MemoryPage>('/agent-memory?withCounts=true&limit=200')).total).toBe(50);
    } finally {
      if (api) {
        const cleanupErrors: string[] = [];
        for (const row of ownedRows(marker)) {
          try {
            expect(row.source).toBe('obsidian-memory');
            const note = ownedNote(manifest.fixtureRoot, row.source_id);
            const detail = await api.fetch(`/agent-memory/${encodeURIComponent(row.id)}`);
            expect(detail.status, 'cleanup must establish exact normal API identity').toBe(200);
            const body = await detail.json() as { id: string; content: string; sourceId: string };
            expect(body).toMatchObject({ id: row.id, content: row.content, sourceId: row.source_id });
            expect(row.content.startsWith('[smoke] ') && row.content.includes(marker)).toBe(true);
            const deleted = await api.fetch(`/agent-memory/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
            expect(deleted.status, 'owned vault note deletion').toBe(204);
            expect(lstatSync(note, { throwIfNoEntry: false })).toBeUndefined();
          } catch (error) { cleanupErrors.push(`index ${row.id}: ${String(error)}`); }
        }
        // An index write could fail after the canonical note succeeds. Delete only a still-existing
        // file whose frontmatter ID and content match one of this test's explicit requests.
        for (const orphan of remainingOwnedNotes(manifest.fixtureRoot, marker, requested)) {
          try {
            const deleted = await api.fetch(`/agent-memory/${encodeURIComponent(orphan.id)}`, { method: 'DELETE' });
            expect(deleted.status, 'exact owned canonical note deletion').toBe(204);
            expect(lstatSync(orphan.file, { throwIfNoEntry: false })).toBeUndefined();
          } catch (error) { cleanupErrors.push(`canonical ${orphan.id}: ${String(error)}`); }
        }
        expect(ownedRows(marker), 'nonce-owned memory rows leaked').toEqual([]);
        expect(remainingOwnedNotes(manifest.fixtureRoot, marker, requested), 'nonce-owned canonical notes leaked').toEqual([]);
        expect(cleanupErrors, 'owned memory cleanup errors').toEqual([]);
      } else expect(requested.size, 'created memory notes without a normal API cleanup handle').toBe(0);
    }
  });
}
