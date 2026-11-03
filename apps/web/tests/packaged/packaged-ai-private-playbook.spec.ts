import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, responseFor, assertResponse, expectedRevision, API, ENGINE } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Command = { name: string; description?: string | null; template?: string; managed?: boolean };
type Content = { name: string; template: string; frontmatter: { description?: string } };

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Playbooks] private managed command survives create, edit and reload in the real engine catalog';

function ownedFile(root: string, name: string) {
  const config = join(root, 'opencode-config');
  const commands = join(config, 'commands');
  for (const directory of [root, config, commands]) {
    const stat = lstatSync(directory, { throwIfNoEntry: false });
    if (!stat) {
      if (directory !== commands) throw new Error('Private actor configuration directory is missing');
      return null;
    }
    expect(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()).toBe(true);
    expect(realpathSync(directory)).toBe(directory);
    if (directory !== commands) expect(stat.mode & 0o077).toBe(0);
  }
  const path = join(commands, `${name}.md`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    && stat.uid === process.getuid?.()).toBe(true);
  expect(realpathSync(path)).toBe(path);
  return { path, dev: stat.dev, ino: stat.ino, text: readFileSync(path, 'utf8') };
}

async function engineCommand(name: string): Promise<Command | undefined> {
  const response = await fetch(`${ENGINE}/command`, { signal: AbortSignal.timeout(20_000) });
  expect(response.status, 'real engine command catalog').toBe(200);
  const commands = await response.json() as Command[];
  expect(Array.isArray(commands)).toBe(true);
  return commands.find(command => command.name === name);
}

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else {
  test(title, async ({ page }) => {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    const nonce = randomUUID().replaceAll('-', '');
    const name = `smoke-playbook-${nonce}`;
    const description = `[smoke] private playbook ${nonce}`;
    const template = `[smoke] inert playbook ${nonce}. Do not invoke.`;
    const edited = `${template} Edited marker.`;
    let api: ObservedApi | null = null;
    try {
      expect(ownedFile(manifest.fixtureRoot, name)).toBeNull();
      await page.goto('rhythm://app/index.html#/tools/agent-tools');
      const initialRead = responseFor(page, 'GET', '/opencode/commands');
      await page.goto('rhythm://app/index.html#/tools/playbooks');
      const initial = await initialRead;
      await assertResponse(initial, 'GET', '/opencode/commands', 200);
      await initial.json();
      expect(new URL(initial.url()).origin).toBe(API);
      expect(initial.request().headers().authorization).toBe(
        `Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`);
      api = ObservedApi.from(initial);
      const me = await api.json<{ user: { id: number; email: string } }>('/auth/me');
      expect(me.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
      expect((await api.json<Command[]>('/opencode/commands')).some(item => item.name === name)).toBe(false);
      expect(await engineCommand(name)).toBeUndefined();

      await page.getByTestId('playbooks-new').click();
      const editor = page.getByTestId('playbooks-editor');
      await editor.getByLabel('Name', { exact: true }).fill(name);
      await editor.getByLabel('Description').fill(description);
      await editor.getByLabel('Command template').fill(template);
      const createWait = responseFor(page, 'POST', '/opencode/commands');
      await editor.getByTestId('playbooks-save').click();
      const createdResponse = await createWait;
      await assertResponse(createdResponse, 'POST', '/opencode/commands', 200);
      const created = await createdResponse.json() as Content;
      expect(created).toMatchObject({ name, template, frontmatter: { description } });
      const file = ownedFile(manifest.fixtureRoot, name);
      expect(file?.text).toContain(`description: ${JSON.stringify(description)}`);
      expect(file?.text).toContain(template);
      expect(await api.json<Content>(`/opencode/commands/${name}/content`)).toMatchObject({
        name, template, frontmatter: { description },
      });
      expect((await api.json<Command[]>('/opencode/commands')).find(item => item.name === name))
        .toMatchObject({ name, description, managed: true });
      expect(await engineCommand(name)).toMatchObject({ name, description, template });
      await expect(page.getByTestId(`playbook-${name}`)).toContainText(description);
      await page.getByTestId(`playbook-${name}`).click();
      await expect(page.getByTestId('list-inspector-detail')).toContainText(template);

      await page.getByTestId('playbooks-edit').click();
      const editing = page.getByTestId('playbooks-editor');
      await expect(editing.getByLabel('Description')).toHaveValue(description);
      await editing.getByLabel('Command template').fill(edited);
      const editWait = responseFor(page, 'PUT', `/opencode/commands/${name}`);
      await editing.getByTestId('playbooks-save').click();
      const editedResponse = await editWait;
      await assertResponse(editedResponse, 'PUT', `/opencode/commands/${name}`, 200);
      expect(await editedResponse.json() as Content).toMatchObject({
        name, template: edited, frontmatter: { description },
      });
      expect(await api.json<Content>(`/opencode/commands/${name}/content`)).toMatchObject({
        name, template: edited, frontmatter: { description },
      });
      expect(await engineCommand(name)).toMatchObject({ name, description, template: edited });
      expect(ownedFile(manifest.fixtureRoot, name)?.text).toContain(edited);

      const reloadWait = responseFor(page, 'GET', '/opencode/commands');
      await page.reload();
      const reloaded = await reloadWait;
      await assertResponse(reloaded, 'GET', '/opencode/commands', 200);
      await reloaded.json(); // Consume before later UI navigation.
      await expect(page.getByTestId(`playbook-${name}`)).toContainText(description);
      await page.getByTestId(`playbook-${name}`).click();
      await expect(page.getByTestId('list-inspector-detail')).toContainText(edited);
      expect(await engineCommand(name)).toMatchObject({ name, description, template: edited });

      await page.getByTestId('playbooks-delete').click();
      const deleteWait = responseFor(page, 'DELETE', `/opencode/commands/${name}`);
      await page.getByTestId('playbooks-delete-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await assertResponse(await deleteWait, 'DELETE', `/opencode/commands/${name}`, 204);
      expect(ownedFile(manifest.fixtureRoot, name)).toBeNull();
      expect((await api.json<Command[]>('/opencode/commands')).some(item => item.name === name)).toBe(false);
      expect(await engineCommand(name)).toBeUndefined();
    } finally {
      const file = ownedFile(manifest.fixtureRoot, name);
      if (file) {
        expect(file.text).toContain(nonce);
        await (api ?? new ObservedApi(API, {
          authorization: `Bearer ${readFileSync(manifest.syntheticActor.tokenPath, 'utf8')}`,
        })).fetch(`/opencode/commands/${name}`, { method: 'DELETE' });
        const unchanged = ownedFile(manifest.fixtureRoot, name);
        if (unchanged && unchanged.dev === file.dev && unchanged.ino === file.ino
          && unchanged.text === file.text) rmSync(file.path);
      }
      expect(ownedFile(manifest.fixtureRoot, name), 'private playbook cleanup must remove only the nonce file').toBeNull();
    }
  });
}
