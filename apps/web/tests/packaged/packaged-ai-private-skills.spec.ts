import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test as unverified, type Frame, type Request } from '@playwright/test';
import { test, expect, ObservedApi, responseFor, assertResponse, expectedRevision, API, ENGINE } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Skill = { name: string; description: string; location: string; managed?: boolean;
  source?: string; content?: string };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI skills] private managed SKILL.md create, edit, reload, and delete reach both primed engine catalogs';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor).toBeDefined();
  const nonce = randomUUID().replaceAll('-', '');
  const name = `smoke-skill-${nonce}`;
  const description = `[smoke] harmless private skill ${nonce}`;
  const original = `# Private observation ${nonce}\n\nThis text labels a disposable test record. It has no external action.`;
  const edited = `${original}\n\nEdited private marker ${nonce}.`;
  const configRoot = join(manifest.fixtureRoot, 'opencode-config');
  const skillsRoot = join(configRoot, 'skills');
  const directory = join(skillsRoot, name);
  const file = join(directory, 'SKILL.md');
  const home = join(manifest.fixtureRoot, 'home');
  for (const path of [manifest.fixtureRoot, configRoot, skillsRoot, home]) {
    const st = lstatSync(path);
    expect(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid?.()
      && realpathSync(path) === path, 'managed skill must remain in canonical private state').toBe(true);
  }
  expect(lstatSync(file, { throwIfNoEntry: false }), 'nonce skill must not preexist').toBeUndefined();
  const privateSkillFile = () => {
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    expect(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.uid === process.getuid?.()
      && realpathSync(file) === file, 'refuse a replaced or foreign SKILL.md').toBe(true);
    return readFileSync(file, 'utf8');
  };
  const engine = async (sameApiDirectory: boolean) => {
    const route = sameApiDirectory ? `/skill?directory=${encodeURIComponent(home)}` : '/skill';
    const response = await fetch(`${ENGINE}${route}`, { signal: AbortSignal.timeout(20_000) });
    expect(response.status, 'actual engine skill catalog').toBe(200);
    return await response.json() as Skill[];
  };
  let api: ObservedApi | null = null;
  const catalog = async () => api!.json<Skill[]>('/opencode/skills?withMetadata=true');
  const content = async () => api!.json<{ name: string; content: string }>(`/opencode/skills/${name}/content`);
  try {
    // Warm two independently cached engine directory instances before create.
    for (const instance of [await engine(false), await engine(true)])
      expect(instance.some(item => item.name === name)).toBe(false);
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    await page.getByRole('heading', { name: 'Choose a workspace', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    const initial = responseFor(page, 'GET', '/opencode/skills');
    await page.goto('rhythm://app/index.html#/tools/skills');
    const loaded = await initial;
    await assertResponse(loaded, 'GET', '/opencode/skills', 200);
    await loaded.json(); // Consume the CDP body before subsequent navigation.
    expect(new URL(loaded.url()).origin).toBe(API);
    expect(loaded.request().headers().authorization).toBe(`Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
    api = ObservedApi.from(loaded);
    expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
      user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
    });
    expect((await catalog()).some(item => item.name === name)).toBe(false);

    await page.getByTestId('skills-new').click();
    const form = page.getByTestId('skills-editor');
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Description', { exact: true }).fill(description);
    await form.getByLabel('SKILL.md content').fill(original);
    const created = responseFor(page, 'POST', '/opencode/skills');
    await form.getByTestId('skills-save').click();
    const createdResponse = await created;
    await assertResponse(createdResponse, 'POST', '/opencode/skills', 200);
    expect(await createdResponse.json()).toMatchObject({ name, description, location: file, managed: true });
    expect(privateSkillFile()).toContain(original);
    expect(privateSkillFile()).toContain(`name: ${name}`);
    const listed = (await catalog()).find(item => item.name === name);
    expect(listed).toMatchObject({ name, description, location: file, managed: true, source: 'managed' });
    expect(await content()).toMatchObject({ name, content: expect.stringContaining(original) });
    await page.getByTestId(`skills-item-${name}`).click();
    await expect(page.getByTestId('list-inspector-detail').locator('pre.managed-body')).toContainText(original);
    for (const sameDirectory of [false, true]) {
      await expect.poll(async () => (await engine(sameDirectory)).find(item => item.name === name)?.content?.trim(),
        { timeout: 15_000 }).toBe(original);
    }

    await page.getByTestId('skills-edit').click();
    const edit = page.getByTestId('skills-editor');
    await expect(edit.getByLabel('Description', { exact: true })).toHaveValue(description);
    await edit.getByLabel('SKILL.md content').fill(edited);
    const saved = responseFor(page, 'PUT', `/opencode/skills/${name}`);
    await edit.getByTestId('skills-save').click();
    const savedResponse = await saved;
    await assertResponse(savedResponse, 'PUT', `/opencode/skills/${name}`, 200);
    expect(await savedResponse.json()).toMatchObject({ name, description, location: file, managed: true });
    expect(privateSkillFile()).toContain(edited);
    expect(await content()).toMatchObject({ name, content: expect.stringContaining(edited) });
    for (const sameDirectory of [false, true]) {
      await expect.poll(async () => (await engine(sameDirectory)).find(item => item.name === name)?.content?.trim(),
        { timeout: 15_000 }).toBe(edited);
    }

    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    await page.getByRole('heading', { name: 'Choose a workspace', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    const currentCatalog = responseFor(page, 'GET', '/opencode/skills');
    await page.goto('rhythm://app/index.html#/tools/skills');
    await page.getByTestId('skills-new').waitFor({ state: 'visible', timeout: 10_000 });
    const currentResponse = await currentCatalog;
    await assertResponse(currentResponse, 'GET', '/opencode/skills', 200);
    await currentResponse.json();

    const reloadRequests = new Set<Request>();
    let reloadDocumentCommitted = false;
    const markReloadDocument = (frame: Frame) => {
      if (frame === page.mainFrame()) reloadDocumentCommitted = true;
    };
    const captureReloadCatalog = (request: Request) => {
      if (!reloadDocumentCommitted || request.method() !== 'GET') return;
      const url = new URL(request.url());
      if (url.origin === API && url.pathname === '/opencode/skills') reloadRequests.add(request);
    };
    page.on('framenavigated', markReloadDocument);
    page.on('request', captureReloadCatalog);
    try {
      const reload = page.waitForResponse(response => reloadRequests.has(response.request()));
      await page.reload();
      const reloaded = await reload;
      await assertResponse(reloaded, 'GET', '/opencode/skills', 200);
      expect((await reloaded.json() as Skill[]).some(item => item.name === name)).toBe(true);
      await page.getByTestId(`skills-item-${name}`).click();
      await expect(page.getByTestId('list-inspector-detail').locator('pre.managed-body')).toContainText(edited);
      expect(await content()).toMatchObject({ name, content: expect.stringContaining(edited) });
    } finally {
      page.off('framenavigated', markReloadDocument);
      page.off('request', captureReloadCatalog);
    }

    await page.getByTestId('skills-delete').click();
    const deleted = responseFor(page, 'DELETE', `/opencode/skills/${name}`);
    await page.getByTestId('skills-delete-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await assertResponse(await deleted, 'DELETE', `/opencode/skills/${name}`, 204);
    expect(privateSkillFile()).toBeNull();
    await expect(page.getByTestId(`skills-item-${name}`)).toHaveCount(0);
    expect((await catalog()).some(item => item.name === name)).toBe(false);
    for (const sameDirectory of [false, true])
      await expect.poll(async () => (await engine(sameDirectory)).some(item => item.name === name),
        { timeout: 15_000 }).toBe(false);
  } finally {
    const raw = privateSkillFile();
    if (raw) {
      expect(raw, 'refuse cleanup of another skill').toContain(name);
      expect(raw).toContain(nonce);
      expect(raw.includes(original) || raw.includes(edited)).toBe(true);
      expect(api, 'normal API authority required for cleanup').not.toBeNull();
      const item = (await catalog()).find(entry => entry.name === name);
      expect(item).toMatchObject({ name, location: file, managed: true, source: 'managed' });
      expect(await content()).toMatchObject({ name, content: expect.stringContaining(nonce) });
      const removed = await api!.fetch(`/opencode/skills/${name}`, { method: 'DELETE' });
      expect(removed.status).toBe(204);
      expect(privateSkillFile()).toBeNull();
    }
  }
});
