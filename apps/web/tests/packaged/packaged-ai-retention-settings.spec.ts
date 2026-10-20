import { createRequire } from 'node:module';
import { test as unverified } from '@playwright/test';
import { test, expect, ObservedApi, assertResponse, responseFor, localRows, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Retention = { mode: string; source: string; setting: string | null };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI settings] private retention On cancel writes nothing and Off persists until owned restore';
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type WritableDb = { prepare(sql: string): { run(...args: unknown[]): { changes: number } }; close(): void };

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'retention writes require the private signed-in actor').toBeDefined();
  const beforeRows = localRows("SELECT content,updated_at FROM org_settings WHERE id='session_retention_mode'");
  expect(beforeRows, 'UNVERIFIED: this private fixture already has a retention override').toEqual([]);
  const writes: Array<string | null> = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/system/session-retention')
      writes.push((request.postDataJSON() as { mode?: string } | null)?.mode ?? null);
  };
  page.on('request', onRequest);
  let offAttempted = false;
  let api: ObservedApi | undefined;
  try {
    const initial = responseFor(page, 'GET', '/system/session-retention');
    await page.goto('rhythm://app/index.html#/settings?settingsSection=session-retention');
    await page.reload();
    const response = await initial;
    await assertResponse(response, 'GET', '/system/session-retention', 200);
    api = ObservedApi.from(response);
    expect(await response.json()).toMatchObject({ mode: 'dry-run', source: 'default', setting: null });
    const panel = page.getByTestId('session-retention-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('session-retention-env')).toHaveCount(0);
    await expect(panel.locator('input[name="session-retention"]:checked')).toHaveValue('dry-run');

    await panel.locator('input[name="session-retention"][value="on"]').click();
    const dialog = panel.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes, 'cancel must not save an activating mode').toEqual([]);
    expect(await api.json<Retention>('/system/session-retention')).toMatchObject({ mode: 'dry-run', source: 'default', setting: null });

    const saved = responseFor(page, 'PUT', '/system/session-retention');
    offAttempted = true;
    await panel.locator('input[name="session-retention"][value="off"]').click();
    const saveResponse = await saved;
    await assertResponse(saveResponse, 'PUT', '/system/session-retention', 200);
    expect(saveResponse.request().postDataJSON()).toMatchObject({ mode: 'off' });
    expect(writes).toEqual(['off']);
    expect(await api.json<Retention>('/system/session-retention')).toMatchObject({ mode: 'off', source: 'setting', setting: 'off' });
    expect(localRows("SELECT content FROM org_settings WHERE id='session_retention_mode'")).toEqual([{ content: 'off' }]);
    const reloaded = responseFor(page, 'GET', '/system/session-retention');
    await page.reload();
    await assertResponse(await reloaded, 'GET', '/system/session-retention', 200);
    await expect(page.getByTestId('session-retention-panel').locator('input[name="session-retention"]:checked')).toHaveValue('off');
  } finally {
    page.off('request', onRequest);
    if (offAttempted) {
      const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: true }) => WritableDb;
      const db = new Database(manifest.dbPath, { fileMustExist: true });
      try {
        // This fixture began at the default with no row. Remove only our Off write.
        expect(db.prepare("DELETE FROM org_settings WHERE id='session_retention_mode' AND content='off'").run().changes).toBe(1);
      } finally { db.close(); }
      expect(localRows("SELECT content FROM org_settings WHERE id='session_retention_mode'")).toEqual([]);
      if (api) expect(await api.json<Retention>('/system/session-retention'))
        .toMatchObject({ mode: 'dry-run', source: 'default', setting: null });
    }
  }
});
