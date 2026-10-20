import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, responseFor, assertResponse, localRows, expectedRevision, API } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { OwnedMemoryFixture } from './private-memory-fixture';
import { aiSurfaces, openAiSurface, readAiCollection } from './ai-surfaces';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI memory] private source and created/updated metadata agree in API, SQLite, vault, and selected Details';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor).toBeDefined();
  const surface = aiSurfaces.find(item => item.slug === 'brain')!;
  const initial = await openAiSurface(page, surface);
  await readAiCollection(initial, surface); // Consume the CDP body before navigation/reload.
  expect(new URL(initial.url()).origin).toBe(API);
  expect(initial.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
  const api = ObservedApi.from(initial);
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
    user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
  });
  const owned = new OwnedMemoryFixture(api);
  try {
    const indexId = await owned.create();
    const sourceId = owned.sourceId!;
    const file = join(owned.root, sourceId); // create() already verified canonical owned vault path.
    expect(lstatSync(file).isFile()).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain(`id: ${owned.id}`);
    const durable = localRows('SELECT id,content,source,source_id,created_at,updated_at FROM agent_memory WHERE id=?', indexId);
    expect(durable).toMatchObject([{ id: indexId, content: owned.content,
      source: 'obsidian-memory', source_id: sourceId, created_at: expect.any(String), updated_at: expect.any(String) }]);

    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    await page.getByRole('heading', { name: 'Choose a workspace', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    const pending = responseFor(page, 'GET', '/agent-memory');
    await page.goto('rhythm://app/index.html#/tools/brain');
    const listed = await pending;
    await assertResponse(listed, 'GET', '/agent-memory', 200);
    const rows = await readAiCollection(listed, surface);
    const row = rows.find(item => item.id === indexId);
    expect(row, 'exact normal-API mirror row must be listed').toBeDefined();
    await page.getByTestId(`memory-${indexId}`).click();
    await expect(page).toHaveURL(new RegExp(`memoryId=${indexId}`));
    const detail = await api.json<{ id: string; content: string; sourceId: string;
      createdAt: string; updatedAt: string }>(`/agent-memory/${indexId}`);
    expect(detail).toMatchObject({ id: indexId, content: owned.content, sourceId,
      createdAt: durable[0].created_at, updatedAt: durable[0].updated_at });
    const inspector = page.getByTestId('brain-inspector-detail');
    await expect(inspector.getByRole('heading', { name: String(row!.title || row!.content), exact: true })).toBeVisible();
    await expect(page.getByTestId('brain-memory-content')).toContainText(owned.content);
    const property = (label: string) => inspector.getByText(label, { exact: true }).locator('xpath=..').locator('dd');
    await expect(property('Source')).toHaveText(sourceId);
    for (const [label, value] of [['Created', detail.createdAt], ['Updated', detail.updatedAt]] as const) {
      const time = property(label).locator('time');
      await expect(time).toHaveAttribute('datetime', value);
      const full = await time.getAttribute('title');
      expect(full, `${label} must expose a full accessible timestamp`).toContain(new Date(value).getFullYear().toString());
      await expect(time.locator('.sr-only')).toHaveText(full!);
    }

    // Delete only this exact owned selected note; Refresh must clear stale
    // selection and metadata, while normal API, mirror and vault agree.
    const beforeDelete = await api.json<{ id: string; content: string; sourceId: string }>(`/agent-memory/${indexId}`);
    expect(beforeDelete).toMatchObject({ id: indexId, content: owned.content, sourceId });
    const deleted = await api.fetch(`/agent-memory/${indexId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    const refresh = responseFor(page, 'GET', '/agent-memory');
    await page.getByTestId('brain-refresh').click();
    const refreshed = await refresh;
    await assertResponse(refreshed, 'GET', '/agent-memory', 200);
    expect((await readAiCollection(refreshed, surface)).some(item => item.id === indexId)).toBe(false);
    await expect(page.getByTestId(`memory-${indexId}`)).toHaveCount(0);
    await expect(inspector).toContainText('Select a memory to inspect its details.');
    await expect(inspector.getByText('Source', { exact: true })).toHaveCount(0);
    await expect(inspector.getByText('Created', { exact: true })).toHaveCount(0);
    await expect(inspector.getByText('Updated', { exact: true })).toHaveCount(0);
    expect(localRows('SELECT id FROM agent_memory WHERE id=?', indexId)).toEqual([]);
    expect(lstatSync(file, { throwIfNoEntry: false })).toBeUndefined();
  } finally { await owned.cleanup(); }
});
