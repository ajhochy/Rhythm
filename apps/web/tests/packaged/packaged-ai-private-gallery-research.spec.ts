import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, localRows, expectedRevision, API } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { OwnedMissingGalleryFixture } from './private-gallery-fixture';

type Design = { id: string; title: string; provider: string; artifactUrl: string | null; thumbnailUrl: string | null; folderId: string | null };
type Folder = { id: string; name: string };
type Project = { id: string; name: string; question: string; ownerUserId: number; archivedAt: string | null };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
const pngSha = createHash('sha256').update(png).digest('hex');
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));

function privateManifest() {
  expect(manifestPath, 'UNVERIFIED: explicit disposable synthetic actor manifest required').toBeTruthy();
  const manifest = readQualificationFixture(manifestPath!, expectedRevision).manifest;
  expect(manifest.syntheticActor).toBeDefined();
  return manifest;
}

async function observedApi(page: import('@playwright/test').Page, route: string, collection: string) {
  await page.goto(`rhythm://app/index.html#/tools/${route}`);
  await page.getByTestId(`tool-page-${route}`).waitFor({ state: 'visible' });
  const pending = responseFor(page, 'GET', collection);
  await page.reload();
  const response = await pending;
  await assertResponse(response, 'GET', collection, 200);
  await response.json(); // Consume while this document still owns the CDP response body.
  const manifest = privateManifest();
  expect(new URL(response.url()).origin).toBe(API);
  expect(response.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
  const api = ObservedApi.from(response);
  expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
    user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
  });
  return api;
}

function ownedStudio(root: string) {
  let dir = root;
  for (const name of ['home', 'Downloads', 'Rhythm Studio']) {
    dir = join(dir, name);
    if (!lstatSync(dir, { throwIfNoEntry: false })) mkdirSync(dir, { mode: 0o700 });
    const stat = lstatSync(dir);
    if (!stat) throw new Error('Owned studio directory disappeared');
    expect(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
      && (stat.mode & 0o077) === 0 && realpathSync(dir) === dir).toBe(true);
  }
  return dir;
}

class OwnedGallery {
  readonly nonce = randomUUID();
  readonly entries: Array<{ id?: string; title: string; file: string; stat: Stats }> = [];
  folder: Folder | null = null;
  constructor(readonly api: ObservedApi, readonly root: string) {}

  async create(suffix: string) {
    const title = `[smoke] gallery ${suffix} ${this.nonce}`;
    const file = join(ownedStudio(this.root), `[smoke]-gallery-${suffix}-${this.nonce}.png`);
    writeFileSync(file, png, { mode: 0o600, flag: 'wx' });
    const stat = lstatSync(file);
    if (!stat) throw new Error('Owned PNG disappeared after creation');
    const entry: { id?: string; title: string; file: string; stat: Stats } = { title, file, stat };
    this.entries.push(entry);
    const response = await this.api.fetch('/agent-designs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, provider: 'smoke', localPath: file }) });
    expect(response.status).toBe(201);
    const design = await response.json() as Design;
    expect(design).toMatchObject({ id: expect.any(String), title, artifactUrl: `/agent-designs/${design.id}/artifact` });
    entry.id = design.id;
    expect(localRows('SELECT id,title,provider,file_path FROM agent_designs WHERE id=?', design.id)).toMatchObject([
      { id: design.id, title, provider: 'smoke', file_path: file },
    ]);
    return design;
  }

  async createFolder() {
    const name = `[smoke] gallery folder ${this.nonce}`;
    const response = await this.api.fetch('/agent-designs/folders', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }) });
    expect(response.status).toBe(201);
    const folder = await response.json() as Folder;
    expect(folder).toMatchObject({ id: expect.any(String), name });
    this.folder = folder;
    return folder;
  }

  async cleanup() {
    try {
      for (const entry of this.entries) {
        const candidates = localRows('SELECT id,title,provider,file_path FROM agent_designs WHERE title=?', entry.title);
        expect(candidates.length).toBeLessThanOrEqual(1);
        for (const row of candidates) {
          expect(row).toMatchObject({ title: entry.title, provider: 'smoke', file_path: entry.file });
          if (entry.id) expect(row.id).toBe(entry.id);
          const design = await this.api.json<Design>(`/agent-designs/${row.id}`);
          expect(design).toMatchObject({ id: row.id, title: entry.title, provider: 'smoke' });
          const deleted = await this.api.fetch(`/agent-designs/${row.id}`, { method: 'DELETE' });
          expect(deleted.status).toBe(204);
        }
        expect(localRows('SELECT id FROM agent_designs WHERE title=?', entry.title)).toEqual([]);
      }
      const folders = localRows('SELECT id,name FROM agent_design_folders WHERE name LIKE ?', `%${this.nonce}%`);
      expect(folders.length).toBeLessThanOrEqual(1);
      if (folders.length === 1) {
        const folderId = String(folders[0].id);
        if (this.folder) expect(folderId).toBe(this.folder.id);
        const rows = localRows('SELECT id,name FROM agent_design_folders WHERE id=?', folderId);
        expect(rows).toMatchObject([{ id: folderId }]);
        expect(String(rows[0].name)).toContain(this.nonce);
        expect(localRows('SELECT id FROM agent_designs WHERE folder_id=?', folderId)).toEqual([]);
        const deleted = await this.api.fetch(`/agent-designs/folders/${folderId}`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);
        expect(localRows('SELECT id FROM agent_design_folders WHERE id=?', folderId)).toEqual([]);
      }
    } finally {
      for (const entry of this.entries) {
        const stat = lstatSync(entry.file, { throwIfNoEntry: false });
        if (!stat) continue;
        expect(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()
          && stat.dev === entry.stat.dev && stat.ino === entry.stat.ino && stat.size === png.length
          && createHash('sha256').update(readFileSync(entry.file)).digest('hex') === pngSha).toBe(true);
        unlinkSync(entry.file);
      }
    }
  }
}

function projectLinks(id: string) {
  const tables = ['agent_research_project_runs', 'agent_research_jobs', 'agent_research_artifacts',
    'agent_research_curated_sources', 'agent_research_qa_links'];
  return tables.map(table => Number(localRows(`SELECT count(*) AS count FROM ${table} WHERE project_id=?`, id)[0].count));
}

async function cleanupProject(api: ObservedApi, ownerUserId: number, id: string, name: string, question: string) {
  const rows = localRows('SELECT id,owner_user_id,name,question,archived_at,magazine_artifact_id FROM agent_research_projects WHERE id=?', id);
  expect(rows).toMatchObject([{ id, owner_user_id: ownerUserId, name, question }]);
  const project = await api.json<Project>(`/agent-research/projects/${id}`);
  expect(project).toMatchObject({ id, ownerUserId, name, question });
  expect(await api.json<unknown[]>(`/agent-research/projects/${id}/runs`)).toEqual([]);
  if (!project.archivedAt) {
    const archived = await api.fetch(`/agent-research/projects/${id}/archive`, { method: 'POST' });
    expect(archived.status).toBe(200);
    expect((await archived.json() as Project).archivedAt).toBeTruthy();
  }
  expect(projectLinks(id)).toEqual([0, 0, 0, 0, 0]);
  expect(localRows('SELECT magazine_artifact_id FROM agent_research_projects WHERE id=?', id)).toMatchObject([{ magazine_artifact_id: null }]);
  // There is no project DELETE route. Remove only this archived, owner-confirmed, link-free row
  // from the wholly synthetic SQLite, under exact predicate guards in one transaction.
  const manifest = privateManifest();
  const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: true }) => {
    pragma(value: string): void;
    prepare(sql: string): { run(...args: unknown[]): { changes: number } };
    transaction<T>(fn: () => T): () => T;
    close(): void;
  };
  const db = new Database(manifest.dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const deleted = db.transaction(() => db.prepare(`DELETE FROM agent_research_projects
      WHERE id=? AND owner_user_id=? AND name=? AND question=?
      AND archived_at IS NOT NULL AND magazine_artifact_id IS NULL`).run(id, ownerUserId, name, question))();
    expect(deleted.changes).toBe(1);
  } finally { db.close(); }
  expect(localRows('SELECT id FROM agent_research_projects WHERE id=?', id)).toEqual([]);
}

const titles = [
  '[AI Gallery] private image preview decodes and missing media remains inspectable',
  '[AI Gallery] private folder move/rename persists and catalog error recovers',
  '[AI Research] private empty report inspector, archive, and catalog recovery persist',
];
if (!manifestPath) {
  for (const title of titles) unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else {
  test(titles[0], async ({ page }) => {
    const manifest = privateManifest();
    const api = await observedApi(page, 'gallery', '/agent-designs');
    const owned = new OwnedGallery(api, manifest.fixtureRoot);
    const missingFixture = new OwnedMissingGalleryFixture(api);
    try {
      const available = await owned.create('available');
      const missing = await missingFixture.create();
      await page.reload();
      await page.getByTestId(`design-${available.id}`).click();
      const assetPending = responseFor(page, 'GET', `/agent-designs/${available.id}/artifact`);
      await page.getByTestId(`gallery-open-${available.id}`).click();
      const asset = await assetPending;
      await assertResponse(asset, 'GET', `/agent-designs/${available.id}/artifact`, 200);
      expect(asset.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
      const direct = await api.fetch(`/agent-designs/${available.id}/artifact`);
      expect(direct.status).toBe(200);
      expect(createHash('sha256').update(Buffer.from(await direct.arrayBuffer())).digest('hex')).toBe(pngSha);
      const image = page.getByTestId('gallery-viewer-image');
      await expect(image).toBeVisible();
      expect(await image.evaluate(async element => {
        const img = element as HTMLImageElement;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight, img.complete];
      })).toEqual([1, 1, true]);
      await page.getByTestId('gallery-viewer-close').click();
      await expect(image).toBeHidden();

      const catalogPending = responseFor(page, 'GET', '/agent-designs');
      await page.reload();
      const catalog = await catalogPending;
      await assertResponse(catalog, 'GET', '/agent-designs', 200);
      const rows = await catalog.json() as Design[];
      expect(rows.find(row => row.id === missing.id)).toMatchObject({ artifactUrl: null, thumbnailUrl: null });
      await page.getByTestId(`design-${missing.id}`).click();
      await expect(page.getByTestId('gallery-detail')).toBeVisible();
      await expect(page.getByTestId(`gallery-open-${missing.id}`)).toBeDisabled();
      await expect(page.getByTestId(`gallery-open-${missing.id}`)).toHaveText('Deliverable unavailable');
      expect(await api.json<Design>(`/agent-designs/${missing.id}`)).toMatchObject({ id: missing.id, title: missing.title,
        artifactUrl: null, thumbnailUrl: null });
    } finally {
      try { await missingFixture.cleanup(); }
      finally { await owned.cleanup(); }
    }
  });

  test(titles[1], async ({ page }) => {
    const manifest = privateManifest();
    const api = await observedApi(page, 'gallery', '/agent-designs');
    const owned = new OwnedGallery(api, manifest.fixtureRoot);
    try {
      const design = await owned.create('folder');
      const folder = await owned.createFolder();
      await page.reload();
      await page.getByTestId(`design-${design.id}`).click();
      const movePending = responseFor(page, 'PATCH', `/agent-designs/${design.id}`);
      await page.getByTestId('gallery-move-select').selectOption(folder.id);
      await assertResponse(await movePending, 'PATCH', `/agent-designs/${design.id}`, 200);
      expect(await api.json<Design>(`/agent-designs/${design.id}`)).toMatchObject({ id: design.id, folderId: folder.id });
      expect(localRows('SELECT folder_id FROM agent_designs WHERE id=?', design.id)).toMatchObject([{ folder_id: folder.id }]);
      const renamedName = `${folder.name} renamed`;
      const renamed = await api.fetch(`/agent-designs/folders/${folder.id}`, { method: 'PATCH',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: renamedName }) });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ id: folder.id, name: renamedName });
      const folderPending = responseFor(page, 'GET', '/agent-designs/folders');
      await page.reload();
      const folders = await folderPending;
      await assertResponse(folders, 'GET', '/agent-designs/folders', 200);
      expect(await folders.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: folder.id, name: renamedName })]));
      await expect(page.getByTestId(`gallery-folder-${folder.id}`)).toBeVisible();

      let injected = false;
      const handler = async (route: import('@playwright/test').Route) => {
        if (!injected && route.request().method() === 'GET') {
          injected = true;
          await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] gallery catalog unavailable' } } });
        } else await route.fallback();
      };
      await page.route('**/agent-designs', handler);
      try {
        const failedPending = responseFor(page, 'GET', '/agent-designs');
        await page.reload();
        const failed = await failedPending;
        await assertResponse(failed, 'GET', '/agent-designs', 503);
        await failed.json();
        expect(injected).toBe(true);
        await expect(page.getByTestId('gallery-error')).toBeVisible();
      } finally { await page.unroute('**/agent-designs', handler); }
      const recoveredPending = responseFor(page, 'GET', '/agent-designs');
      await page.reload();
      const recovered = await recoveredPending;
      await assertResponse(recovered, 'GET', '/agent-designs', 200);
      expect((await recovered.json() as Design[]).some(row => row.id === design.id)).toBe(true);
      await expect(page.getByTestId(`design-${design.id}`)).toBeVisible();
    } finally { await owned.cleanup(); }
  });

  test(titles[2], async ({ page }) => {
    const manifest = privateManifest();
    const api = await observedApi(page, 'deep-research', '/agent-research/projects');
    const nonce = randomUUID();
    const name = `[smoke] research inspector ${nonce}`;
    const question = `[smoke] What does the empty private research report show for ${nonce}?`;
    let id: string | null = null;
    try {
      await page.getByTestId('research-new-project').click();
      const dialog = page.getByTestId('research-project-dialog');
      await dialog.getByLabel('Project name').fill(name);
      await dialog.getByLabel('Research question').fill(question);
      await dialog.getByTestId('research-lead-model').selectOption('');
      await dialog.getByTestId('research-researcher-model').selectOption('');
      const createdPending = responseFor(page, 'POST', '/agent-research/projects');
      await page.getByTestId('research-project-create').click();
      const created = await createdPending;
      await assertResponse(created, 'POST', '/agent-research/projects', 201);
      const project = await created.json() as Project;
      expect(project).toMatchObject({ id: expect.any(String), name, question, ownerUserId: manifest.ownerUserId });
      id = project.id;
      expect(localRows('SELECT id,owner_user_id,name,question FROM agent_research_projects WHERE id=?', id)).toMatchObject([
        { id, owner_user_id: manifest.ownerUserId, name, question },
      ]);
      await expect(page.getByTestId(`research-project-${id}`)).toBeVisible();
      await expect(page.getByText('No runs yet for this project.')).toBeVisible();
      expect(await api.json<unknown[]>(`/agent-research/projects/${id}/runs`)).toEqual([]);

      const archivePending = responseFor(page, 'POST', `/agent-research/projects/${id}/archive`);
      await page.getByTestId('research-archive').click();
      const archived = await archivePending;
      await assertResponse(archived, 'POST', `/agent-research/projects/${id}/archive`, 200);
      expect((await archived.json() as Project).archivedAt).toBeTruthy();
      expect((await api.json<Project[]>('/agent-research/projects')).some(row => row.id === id)).toBe(false);
      expect((await api.json<Project[]>('/agent-research/projects?includeArchived=true')).some(row => row.id === id)).toBe(true);

      let injected = false;
      const handler = async (route: import('@playwright/test').Route) => {
        if (!injected && route.request().method() === 'GET') {
          injected = true;
          await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] research catalog unavailable' } } });
        } else await route.fallback();
      };
      await page.route('**/agent-research/projects', handler);
      try {
        const failedPending = responseFor(page, 'GET', '/agent-research/projects');
        await page.reload();
        const failed = await failedPending;
        await assertResponse(failed, 'GET', '/agent-research/projects', 503);
        await failed.json();
        expect(injected).toBe(true);
        await expect(page.getByTestId('research-error')).toBeVisible();
      } finally { await page.unroute('**/agent-research/projects', handler); }
      const recoveredPending = responseFor(page, 'GET', '/agent-research/projects');
      await page.reload();
      const recovered = await recoveredPending;
      await assertResponse(recovered, 'GET', '/agent-research/projects', 200);
      expect((await recovered.json() as Project[]).some(row => row.id === id)).toBe(false);
      expect((await api.json<Project[]>('/agent-research/projects')).some(row => row.id === id)).toBe(false);
    } finally {
      const candidates = localRows('SELECT id,owner_user_id,name,question FROM agent_research_projects WHERE owner_user_id=? AND name=? AND question=?',
        manifest.ownerUserId, name, question);
      expect(candidates.length).toBeLessThanOrEqual(1);
      if (candidates.length === 1) {
        if (id) expect(candidates[0].id).toBe(id);
        await cleanupProject(api, manifest.ownerUserId, String(candidates[0].id), name, question);
      }
    }
  });
}
