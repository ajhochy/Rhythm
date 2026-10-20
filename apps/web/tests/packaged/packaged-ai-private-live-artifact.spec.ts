import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ObservedApi, assertResponse, expectedRevision, expectAbsentPrivateArtifact, localRows, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI live artifacts] private HTML import, sandboxed render, revisioned edit and picker use one owned artifact';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'artifact writes require the private signed-in actor').toBeDefined();
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  const me = await api.json<{ user: { id: number; email: string; artifactTabIds: string[] };
    workspace: { id: number } }>('/auth/me');
  expect(me.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email,
    artifactTabIds: [] });
  expect(Number.isSafeInteger(me.workspace.id)).toBe(true);
  expect(localRows('SELECT id FROM live_artifacts WHERE owner_user_id=?', manifest.ownerUserId),
    'fresh private actor must have no preexisting artifact').toEqual([]);
  const workspaceId = me.workspace.id;
  const nonce = randomUUID();
  const initialTitle = `[smoke] Live artifact ${nonce}`;
  const editedTitle = `${initialTitle} edited`;
  const firstMarker = `first-${nonce}`;
  const secondMarker = `second-${nonce}`;
  const firstBundle = { html: `<!doctype html><html><head><title>${initialTitle}</title></head><body><main id="owned-marker">${firstMarker}</main></body></html>`, css: '', js: '' };
  const secondBundle = { html: `<!doctype html><html><head><title>${editedTitle}</title></head><body><main id="owned-marker">${secondMarker}</main></body></html>`, css: '', js: '' };
  const ownedIds = new Set<string>();
  const missingId = randomUUID();
  expectAbsentPrivateArtifact(missingId);
  const cleanupErrors: string[] = [];
  const artifact = (id: string) => localRows(`SELECT id,title,owner_user_id,workspace_id,visibility,
    current_bundle_revision,current_bundle_hash,current_state_revision,current_state_hash,deleted_at
    FROM live_artifacts WHERE id=?`, id);
  const contents = (id: string) => localRows('SELECT kind,hash,body FROM live_artifact_contents WHERE artifact_id=? ORDER BY kind,hash', id);
  const post = async (route: string, method: 'PATCH' | 'PUT', body: unknown) => {
    const response = await api.fetch(route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status, `${method} ${route}`).toBe(200);
    return response.json() as Promise<{ id: string; title: string; currentBundleRevision: number;
      currentBundleHash: string; currentStateRevision: number; currentStateHash: string }>;
  };
  try {
    await page.goto('rhythm://app/index.html#/dashboard');
    await page.getByRole('button', { name: 'Import HTML', exact: true }).click();
    const dialog = page.getByTestId('html-import-dialog');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `smoke-${nonce}.html`, mimeType: 'text/html', buffer: Buffer.from(firstBundle.html),
    });
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(initialTitle);
    await expect(dialog.getByTestId('html-import-source')).toContainText(firstMarker);
    const created = responseFor(page, 'POST', '/live-artifacts');
    await dialog.getByRole('button', { name: 'Confirm import', exact: true }).click();
    const createdResponse = await created;
    await assertResponse(createdResponse, 'POST', '/live-artifacts', 201);
    expect(new URL(createdResponse.url()).origin).toBe(API);
    expect(createdResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    expect(createdResponse.request().postDataJSON()).toMatchObject({
      type: 'html', title: initialTitle, workspaceId, visibility: 'private', bundle: firstBundle, state: {},
    });
    const result = await createdResponse.json() as { id: string; title: string; ownerUserId: number;
      workspaceId: number; visibility: string; currentBundleRevision: number; currentStateRevision: number;
      currentBundleHash: string; currentStateHash: string };
    expect(result).toMatchObject({ id: expect.any(String), title: initialTitle, ownerUserId: manifest.ownerUserId,
      workspaceId, visibility: 'private', currentBundleRevision: 1, currentStateRevision: 1 });
    ownedIds.add(result.id);
    const id = result.id;
    const firstHash = sha(JSON.stringify(firstBundle));
    const firstStateHash = sha(JSON.stringify({}));
    expect(result.currentBundleHash).toBe(firstHash);
    expect(result.currentStateHash).toBe(firstStateHash);
    expect(artifact(id)).toMatchObject([{ id, title: initialTitle, owner_user_id: manifest.ownerUserId,
      workspace_id: workspaceId, visibility: 'private', current_bundle_revision: 1,
      current_bundle_hash: firstHash, current_state_revision: 1, current_state_hash: firstStateHash,
      deleted_at: null }]);
    expect(contents(id)).toEqual([{ kind: 'bundle', hash: firstHash, body: JSON.stringify(firstBundle) },
      { kind: 'state', hash: firstStateHash, body: '{}' }]);
    const initialDetail = await api.json<{ id: string; title: string; state: unknown }>(`/live-artifacts/${id}`);
    expect(initialDetail).toMatchObject({ id, title: initialTitle, state: {} });
    const rendered = await api.fetch(`/live-artifacts/${id}/render`);
    expect(rendered.status).toBe(200);
    expect(await rendered.text()).toContain(firstMarker);
    const tab = page.locator(`[role="tab"][data-artifact-id="${id}"]`);
    await expect(tab).toHaveAttribute('aria-label', initialTitle);
    const surface = page.locator(`[data-testid="live-artifact-surface"][data-artifact-id="${id}"]`);
    await expect(surface).toContainText('bundle revision 1 · state revision 1 · private');
    await expect(surface.getByTestId('live-artifact-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(firstMarker);

    const renamed = await post(`/live-artifacts/${id}`, 'PATCH', { title: editedTitle });
    expect(renamed).toMatchObject({ id, title: editedTitle, currentBundleRevision: 1, currentStateRevision: 1 });
    const nextBundle = await post(`/live-artifacts/${id}/bundle`, 'PUT', { expectedBundleRevision: 1, bundle: secondBundle });
    expect(nextBundle).toMatchObject({ id, title: editedTitle, currentBundleRevision: 2, currentStateRevision: 1 });
    const nextState = { marker: secondMarker };
    const savedState = await post(`/live-artifacts/${id}/state`, 'PUT', { expectedStateRevision: 1, state: nextState });
    expect(savedState).toMatchObject({ id, title: editedTitle, currentBundleRevision: 2, currentStateRevision: 2 });
    const secondHash = sha(JSON.stringify(secondBundle));
    const secondStateHash = sha(JSON.stringify(nextState));
    expect(savedState.currentBundleHash).toBe(secondHash);
    expect(savedState.currentStateHash).toBe(secondStateHash);
    expect(artifact(id)).toMatchObject([{ id, title: editedTitle, owner_user_id: manifest.ownerUserId,
      workspace_id: workspaceId, visibility: 'private', current_bundle_revision: 2,
      current_bundle_hash: secondHash, current_state_revision: 2, current_state_hash: secondStateHash,
      deleted_at: null }]);
    expect(localRows('SELECT revision,hash,actor_user_id FROM live_artifact_bundle_revisions WHERE artifact_id=? ORDER BY revision', id))
      .toEqual([{ revision: 1, hash: firstHash, actor_user_id: manifest.ownerUserId },
        { revision: 2, hash: secondHash, actor_user_id: manifest.ownerUserId }]);
    expect(localRows('SELECT revision,hash,actor_user_id FROM live_artifact_state_revisions WHERE artifact_id=? ORDER BY revision', id))
      .toEqual([{ revision: 1, hash: firstStateHash, actor_user_id: manifest.ownerUserId },
        { revision: 2, hash: secondStateHash, actor_user_id: manifest.ownerUserId }]);
    expect(contents(id)).toHaveLength(4);
    expect(contents(id)).toEqual(expect.arrayContaining([
      { kind: 'bundle', hash: firstHash, body: JSON.stringify(firstBundle) },
      { kind: 'bundle', hash: secondHash, body: JSON.stringify(secondBundle) },
      { kind: 'state', hash: firstStateHash, body: '{}' },
      { kind: 'state', hash: secondStateHash, body: JSON.stringify(nextState) },
    ]));
    await surface.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(tab).toHaveAttribute('aria-label', editedTitle);
    await expect(surface).toContainText('bundle revision 2 · state revision 2 · private');
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(secondMarker);
    expect(await api.json<{ id: string; title: string; state: unknown }>(`/live-artifacts/${id}`))
      .toMatchObject({ id, title: editedTitle, state: nextState });

    await tab.locator('button[aria-label^="Close "]').click();
    await page.getByRole('button', { name: 'Add live artifact', exact: true }).click();
    const picker = page.getByTestId('live-artifact-picker');
    await picker.getByRole('searchbox', { name: 'Search live artifacts' }).fill(nonce);
    await expect(picker.getByRole('option', { name: editedTitle, exact: true })).toBeVisible();
    const catalog = await api.json<Array<{ id: string; title: string }>>(`/live-artifacts?type=html&search=${encodeURIComponent(nonce)}`);
    expect(catalog.filter(item => item.id === id).map(item => ({ id: item.id, title: item.title })))
      .toEqual([{ id, title: editedTitle }]);
    await picker.getByRole('option', { name: editedTitle, exact: true }).click();
    await expect(tab).toHaveAttribute('aria-label', editedTitle);
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(secondMarker);

    // A genuinely absent UUID must settle into the observed unavailable tab.
    // The live API 404 is intentionally not stubbed; strict runtime audit owns
    // the exact expected error line for this one negative case.
    const missing = responseFor(page, 'GET', `/live-artifacts/${missingId}`);
    await page.goto(`rhythm://app/index.html#/dashboard?artifactId=${missingId}`);
    const missingResponse = await missing;
    await assertResponse(missingResponse, 'GET', `/live-artifacts/${missingId}`, 404);
    expect(await missingResponse.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Live artifact not found' } });
    const missingSurface = page.locator(`[data-testid="live-artifact-surface"][data-artifact-id="${missingId}"]`);
    await expect(missingSurface.getByText('This live artifact is unavailable.', { exact: true })).toBeVisible();
    await expect(page.locator(`[role="tab"][data-artifact-id="${missingId}"]`)).toBeVisible();
    expect(localRows('SELECT id FROM live_artifacts WHERE id=?', missingId)).toEqual([]);
  } finally {
    // Close only tabs introduced by this test. This private actor began with no
    // tabs; never rewrite a preference containing another user's/feature's ID.
    for (const id of [missingId, ...ownedIds]) {
      try {
        const tab = page.locator(`[role="tab"][data-artifact-id="${id}"]`);
        if (await tab.count()) await tab.locator('button[aria-label^="Close "]').click({ timeout: 5000 });
      } catch (error) { cleanupErrors.push(`close ${id}: ${String(error)}`); }
    }
    try {
      const latest = await api.json<{ user: { artifactTabIds: string[] } }>('/auth/me');
      const tabs = latest.user.artifactTabIds;
      if (!Array.isArray(tabs) || tabs.some(id => id !== missingId && !ownedIds.has(id)))
        throw new Error('Refusing foreign tab preference');
      if (tabs.length) {
        const response = await api.fetch('/users/me/preferences', { method: 'PATCH',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artifactTabIds: [] }) });
        if (response.status !== 200) throw new Error(`Private tab preference restore failed: ${response.status}`);
      }
    } catch (error) { cleanupErrors.push(`preferences: ${String(error)}`); }
    // A failed UI acknowledgement can still have created one nonce artifact.
    for (const row of localRows('SELECT id,title,owner_user_id,workspace_id FROM live_artifacts WHERE title IN (?,?)', initialTitle, editedTitle)) {
      if (row.owner_user_id === manifest.ownerUserId && row.workspace_id === workspaceId) ownedIds.add(String(row.id));
    }
    for (const id of ownedIds) {
      try {
        const rows = artifact(id);
        if (!rows.length) continue;
        const row = rows[0];
        if (row.owner_user_id !== manifest.ownerUserId || row.workspace_id !== workspaceId
          || ![initialTitle, editedTitle].includes(String(row.title))) throw new Error('Refusing foreign artifact cleanup');
        if (!row.deleted_at) {
          const deleted = await api.fetch(`/live-artifacts/${id}`, { method: 'DELETE' });
          if (deleted.status !== 204) cleanupErrors.push(`normal delete ${id}: ${deleted.status}`);
        }
        const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: boolean }) => any;
        const db = new Database(manifest.dbPath, { fileMustExist: true });
        try {
          db.pragma('foreign_keys = ON');
          db.transaction(() => {
            const owned = db.prepare('SELECT title,owner_user_id,workspace_id FROM live_artifacts WHERE id=?').get(id);
            if (owned?.owner_user_id !== manifest.ownerUserId || owned?.workspace_id !== workspaceId
              || ![initialTitle, editedTitle].includes(owned.title)) throw new Error('Refusing changed artifact ownership');
            const tabRefs = db.prepare('SELECT id FROM users WHERE artifact_tab_ids_json LIKE ?').all(`%${id}%`);
            if (tabRefs.length) throw new Error('Refusing hard cleanup while an artifact tab remains');
            if (db.prepare('SELECT count(*) n FROM live_artifact_collaborators WHERE artifact_id=?').get(id).n !== 0)
              throw new Error('Refusing hard cleanup of shared artifact');
            db.prepare('DELETE FROM live_artifact_bundle_revisions WHERE artifact_id=?').run(id);
            db.prepare('DELETE FROM live_artifact_state_revisions WHERE artifact_id=?').run(id);
            db.prepare('DELETE FROM live_artifact_contents WHERE artifact_id=?').run(id);
            if (db.prepare('DELETE FROM live_artifacts WHERE id=? AND owner_user_id=? AND workspace_id=?')
              .run(id, manifest.ownerUserId, workspaceId).changes !== 1) throw new Error('Exact hard cleanup failed');
          })();
        } finally { db.close(); }
        const legacy = path.join(manifest.fixtureRoot, 'live-artifacts', id);
        const stat = lstatSync(legacy, { throwIfNoEntry: false });
        if (stat) {
          if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
            || realpathSync(legacy) !== legacy) throw new Error('Refusing foreign legacy artifact directory');
          rmSync(legacy, { recursive: true });
        }
      } catch (error) { cleanupErrors.push(`artifact ${id}: ${String(error)}`); }
    }
    expect(localRows('SELECT id FROM live_artifacts WHERE title IN (?,?)', initialTitle, editedTitle)).toEqual([]);
    expect((await api.json<{ user: { artifactTabIds: string[] } }>('/auth/me')).user.artifactTabIds).toEqual([]);
    expect(cleanupErrors).toEqual([]);
  }
});
