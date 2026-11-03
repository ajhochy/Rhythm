import { createHash, randomUUID } from 'node:crypto';
import { test, expect, assertResponse, responseFor, type Row } from './cloud-parity-fixture';

// Port of packaged-ai-private-live-artifact.spec.ts. This checks browser + web proxy against
// a stateful synthetic upstream. Its loopback ledger replaces private fixture DB evidence;
// production account/storage qualification remains separate and must never use SQL purges.
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('#71: [cloud fixture] private HTML import, sandboxed render, revisioned edit and picker use one owned artifact', async ({ page, parity, cloud }) => {
  const api = parity.api;
  const me = await api.json<{ user: { id: number; email: string; artifactTabIds: string[] }; workspace: { id: number } }>('/cloud/auth/me');
  expect(me).toMatchObject({ user: { id: 99, email: 'admin@example.invalid', artifactTabIds: [] }, workspace: { id: 9099 } });
  expect((await cloud.ledger()).artifacts.filter(entry => !entry.artifact.deletedAt)).toEqual([]);
  const workspaceId = me.workspace.id;
  const nonce = randomUUID();
  const initialTitle = `${parity.prefix} Live artifact ${nonce}`;
  const editedTitle = `${initialTitle} edited`;
  const firstMarker = `first-${nonce}`;
  const secondMarker = `second-${nonce}`;
  const firstBundle = { html: `<!doctype html><html><head><title>${initialTitle}</title></head><body><main id="owned-marker">${firstMarker}</main></body></html>`, css: '', js: '' };
  const secondBundle = { html: `<!doctype html><html><head><title>${editedTitle}</title></head><body><main id="owned-marker">${secondMarker}</main></body></html>`, css: '', js: '' };
  const ownedIds = new Set<string>();
  const missingId = randomUUID();
  expect((await cloud.ledger(missingId)).artifacts).toEqual([]);
  const cleanupErrors: string[] = [];
  const post = async (route: string, method: 'PATCH' | 'PUT', body: unknown) => {
    const response = await api.request(method, route, body);
    expect(response.status, `${method} ${route}`).toBe(200);
    return await response.json() as Row;
  };
  try {
    await page.goto('/#/dashboard');
    await page.getByRole('button', { name: 'Import HTML', exact: true }).click();
    const dialog = page.getByTestId('html-import-dialog');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `smoke-${nonce}.html`, mimeType: 'text/html', buffer: Buffer.from(firstBundle.html),
    });
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(initialTitle);
    await expect(dialog.getByTestId('html-import-source')).toContainText(firstMarker);
    const created = responseFor(page, 'POST', '/cloud/live-artifacts');
    await dialog.getByRole('button', { name: 'Confirm import', exact: true }).click();
    const createdResponse = await created;
    await assertResponse(createdResponse, 'POST', '/cloud/live-artifacts', 201);
    expect(new URL(createdResponse.url()).origin).toBe(parity.origin);
    expect(createdResponse.request().postDataJSON()).toMatchObject({
      type: 'html', title: initialTitle, workspaceId, visibility: 'private', bundle: firstBundle, state: {},
    });
    const result = await createdResponse.json() as Row;
    expect(result).toMatchObject({ id: expect.any(String), title: initialTitle, ownerUserId: 99,
      workspaceId, visibility: 'private', currentBundleRevision: 1, currentStateRevision: 1 });
    ownedIds.add(result.id);
    const id = result.id;
    const firstHash = sha(firstBundle);
    const firstStateHash = sha({});
    expect(result.currentBundleHash).toBe(firstHash);
    expect(result.currentStateHash).toBe(firstStateHash);
    const initialLedger = (await cloud.ledger(id)).artifacts;
    expect(initialLedger).toHaveLength(1);
    expect(initialLedger[0].artifact).toMatchObject({ id, title: initialTitle, ownerUserId: 99,
      workspaceId, visibility: 'private', currentBundleRevision: 1, currentBundleHash: firstHash,
      currentStateRevision: 1, currentStateHash: firstStateHash, deletedAt: null });
    expect(initialLedger[0].contents).toEqual([
      { kind: 'bundle', hash: firstHash, body: JSON.stringify(firstBundle) },
      { kind: 'state', hash: firstStateHash, body: '{}' },
    ]);
    expect(await api.json(`/cloud/live-artifacts/${id}`)).toMatchObject({ id, title: initialTitle, state: {} });
    const rendered = await api.fetch(`/cloud/live-artifacts/${id}/render`);
    expect(rendered.status).toBe(200);
    expect(rendered.headers.get('content-type')).toContain('text/html');
    expect(await rendered.text()).toContain(firstMarker);
    const tab = page.locator(`[role="tab"][data-artifact-id="${id}"]`);
    await expect(tab).toHaveAttribute('aria-label', initialTitle);
    const surface = page.locator(`[data-testid="live-artifact-surface"][data-artifact-id="${id}"]`);
    await expect(surface).toContainText('bundle revision 1 · state revision 1 · private');
    await expect(surface.getByTestId('live-artifact-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(firstMarker);

    expect(await post(`/cloud/live-artifacts/${id}`, 'PATCH', { title: editedTitle }))
      .toMatchObject({ id, title: editedTitle, currentBundleRevision: 1, currentStateRevision: 1 });
    expect(await post(`/cloud/live-artifacts/${id}/bundle`, 'PUT', { expectedBundleRevision: 1, bundle: secondBundle }))
      .toMatchObject({ id, title: editedTitle, currentBundleRevision: 2, currentStateRevision: 1 });
    const nextState = { marker: secondMarker };
    const saved = await post(`/cloud/live-artifacts/${id}/state`, 'PUT', { expectedStateRevision: 1, state: nextState });
    expect(saved).toMatchObject({ id, title: editedTitle, currentBundleRevision: 2, currentStateRevision: 2 });
    const secondHash = sha(secondBundle);
    const secondStateHash = sha(nextState);
    expect(saved.currentBundleHash).toBe(secondHash);
    expect(saved.currentStateHash).toBe(secondStateHash);
    const updatedLedger = (await cloud.ledger(id)).artifacts[0];
    expect(updatedLedger.artifact).toMatchObject({ id, title: editedTitle, ownerUserId: 99, workspaceId,
      visibility: 'private', currentBundleRevision: 2, currentBundleHash: secondHash,
      currentStateRevision: 2, currentStateHash: secondStateHash, deletedAt: null });
    expect(updatedLedger.bundleRevisions).toEqual([
      { revision: 1, hash: firstHash, actorUserId: 99 }, { revision: 2, hash: secondHash, actorUserId: 99 },
    ]);
    expect(updatedLedger.stateRevisions).toEqual([
      { revision: 1, hash: firstStateHash, actorUserId: 99 }, { revision: 2, hash: secondStateHash, actorUserId: 99 },
    ]);
    expect(updatedLedger.contents).toHaveLength(4);
    expect(updatedLedger.contents).toEqual(expect.arrayContaining([
      { kind: 'bundle', hash: firstHash, body: JSON.stringify(firstBundle) },
      { kind: 'bundle', hash: secondHash, body: JSON.stringify(secondBundle) },
      { kind: 'state', hash: firstStateHash, body: '{}' },
      { kind: 'state', hash: secondStateHash, body: JSON.stringify(nextState) },
    ]));
    await surface.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(tab).toHaveAttribute('aria-label', editedTitle);
    await expect(surface).toContainText('bundle revision 2 · state revision 2 · private');
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(secondMarker);
    expect(await api.json(`/cloud/live-artifacts/${id}`)).toMatchObject({ id, title: editedTitle, state: nextState });

    await tab.locator('button[aria-label^="Close "]').click();
    await page.getByRole('button', { name: 'Add live artifact', exact: true }).click();
    const picker = page.getByTestId('live-artifact-picker');
    await picker.getByRole('searchbox', { name: 'Search live artifacts' }).fill(nonce);
    await expect(picker.getByRole('option', { name: editedTitle, exact: true })).toBeVisible();
    const catalog = await api.json<Row[]>(`/cloud/live-artifacts?type=html&search=${encodeURIComponent(nonce)}`);
    expect(catalog.filter(item => item.id === id).map(item => ({ id: item.id, title: item.title })))
      .toEqual([{ id, title: editedTitle }]);
    await picker.getByRole('option', { name: editedTitle, exact: true }).click();
    await expect(tab).toHaveAttribute('aria-label', editedTitle);
    await expect(page.frameLocator('[data-testid="live-artifact-frame"]').locator('#owned-marker')).toHaveText(secondMarker);

    // No browser stub: an absent upstream UUID must traverse the real proxy as 404.
    const missing = responseFor(page, 'GET', `/cloud/live-artifacts/${missingId}`);
    await page.goto(`/#/dashboard?artifactId=${missingId}`);
    const missingResponse = await missing;
    await assertResponse(missingResponse, 'GET', `/cloud/live-artifacts/${missingId}`, 404);
    expect(await missingResponse.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Live artifact not found' } });
    const missingSurface = page.locator(`[data-testid="live-artifact-surface"][data-artifact-id="${missingId}"]`);
    await expect(missingSurface.getByText('This live artifact is unavailable.', { exact: true })).toBeVisible();
    await expect(page.locator(`[role="tab"][data-artifact-id="${missingId}"]`)).toBeVisible();
    expect((await cloud.ledger(missingId)).artifacts).toEqual([]);
  } finally {
    for (const id of [missingId, ...ownedIds]) {
      try {
        const tab = page.locator(`[role="tab"][data-artifact-id="${id}"]`);
        if (await tab.count()) await tab.locator('button[aria-label^="Close "]').click({ timeout: 5000 });
      } catch (error) { cleanupErrors.push(`close ${id}: ${String(error)}`); }
    }
    try {
      const latest = await api.json<{ user: { artifactTabIds: string[] } }>('/cloud/auth/me');
      const tabs = latest.user.artifactTabIds;
      if (!Array.isArray(tabs) || tabs.some(id => id !== missingId && !ownedIds.has(id))) throw new Error('Refusing foreign tab preference');
      if (tabs.length) {
        const restored = await api.request('PATCH', '/cloud/users/me/preferences', { artifactTabIds: [] });
        expect(restored.status).toBe(200);
      }
      await expect.poll(async () => (await api.json<{ user: { artifactTabIds: string[] } }>('/cloud/auth/me')).user.artifactTabIds).toEqual([]);
    } catch (error) { cleanupErrors.push(`preferences: ${String(error)}`); }
    // A failed acknowledgement can leave a created nonce record; recover only exact owned titles.
    try {
      for (const row of await api.json<Row[]>(`/cloud/live-artifacts?type=html&search=${encodeURIComponent(nonce)}`)) {
        if (row.ownerUserId === 99 && row.workspaceId === workspaceId && [initialTitle, editedTitle].includes(String(row.title))) ownedIds.add(row.id);
      }
    } catch (error) { cleanupErrors.push(`discover owned artifacts: ${String(error)}`); }
    for (const id of ownedIds) {
      try {
        const row = await api.json<Row>(`/cloud/live-artifacts/${id}`);
        expect(row).toMatchObject({ id, ownerUserId: 99, workspaceId, visibility: 'private' });
        expect([initialTitle, editedTitle]).toContain(row.title);
        expect(await api.json(`/cloud/live-artifacts/${id}/collaborators`)).toEqual([]);
        expect((await api.request('DELETE', `/cloud/live-artifacts/${id}`)).status).toBe(204);
        const absent = await api.fetch(`/cloud/live-artifacts/${id}`);
        expect(absent.status).toBe(410); // Production owner GET returns an explicit tombstone after normal DELETE.
        expect(await absent.json()).toEqual({ error: { code: 'artifact_deleted', message: 'Artifact deleted' } });
        expect((await cloud.ledger(id)).artifacts[0].artifact.deletedAt).toEqual(expect.any(String));
        expect(await api.json<Row[]>(`/cloud/live-artifacts?type=html&search=${encodeURIComponent(nonce)}`)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
      } catch (error) { cleanupErrors.push(`artifact ${id}: ${String(error)}`); }
    }
    expect((await api.json<{ user: { artifactTabIds: string[] } }>('/cloud/auth/me')).user.artifactTabIds).toEqual([]);
    expect(cleanupErrors, `Owned cleanup failed; inspect only these run IDs: ${[...ownedIds].join(', ')}`).toEqual([]);
  }
});
