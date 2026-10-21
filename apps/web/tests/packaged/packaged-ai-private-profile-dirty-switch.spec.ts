import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ObservedApi, assertResponse, expectedRevision, localRows, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

type Profile = { id: string; label: string; revision: number };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI profiles] private existing-profile dirty switch keeps or discards without saving';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const manifest = readQualificationFixture(manifestPath, expectedRevision).manifest;
  expect(manifest.syntheticActor, 'existing-profile probe requires a private synthetic actor').toBeDefined();
  expect(manifest.publicUserSeed.email).toMatch(/\.invalid$/);
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const nonce = randomUUID();
  const draft = `[smoke] unsaved coding profile ${nonce}`;
  const writes: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    const route = new URL(request.url()).pathname;
    if (route.startsWith('/agent-configs') && request.method() !== 'GET') writes.push(`${request.method()} ${route}`);
  };
  const sqlRows = () => localRows(
    'SELECT id,label,revision,model_provider,model_id FROM agent_configs WHERE id IN (?,?) ORDER BY id',
    'coding-agent', 'secretary',
  );
  page.on('request', onRequest);
  try {
    await page.goto('rhythm://app/index.html#/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    const initialWait = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const initialResponse = await initialWait;
    await assertResponse(initialResponse, 'GET', '/agent-configs', 200);
    expect(new URL(initialResponse.url()).origin).toBe(API);
    expect(initialResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    const api = ObservedApi.from(initialResponse);
    expect(await api.json<{ user: { id: number; email: string } }>('/auth/me')).toMatchObject({
      user: { id: manifest.ownerUserId, email: manifest.publicUserSeed.email },
    });
    const before = await api.json<Profile[]>('/agent-configs');
    const coding = before.find(row => row.id === 'coding-agent');
    const secretary = before.find(row => row.id === 'secretary');
    expect(coding?.label, 'only a fixture-owned smoke profile may be drafted').toMatch(/^\[smoke\] /);
    expect(secretary).toBeDefined();
    const beforeCatalog = digest(before);
    const beforeSql = digest(sqlRows());

    const codingRow = page.getByTestId('profile-coding-agent');
    const secretaryRow = page.getByTestId('profile-secretary');
    const label = page.getByTestId('profile-label');
    const dialog = page.getByTestId('profile-unsaved-dialog');
    await codingRow.click();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    const originalLabel = await label.inputValue();
    expect(originalLabel).toBe(coding!.label);
    await label.fill(draft);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    await secretaryRow.click();
    await expect(dialog).toBeVisible();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(draft);
    expect(writes).toEqual([]);

    await page.getByTestId('profile-keep-editing').click();
    await expect(dialog).toBeHidden();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(draft);
    expect(writes).toEqual([]);

    await secretaryRow.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('profile-discard').click();
    await expect(dialog).toBeHidden();
    await expect(secretaryRow).toHaveAttribute('aria-selected', 'true');
    await expect(codingRow).toHaveAttribute('aria-selected', 'false');
    await expect(label).not.toHaveValue(draft);
    await codingRow.click();
    await expect(codingRow).toHaveAttribute('aria-selected', 'true');
    await expect(label).toHaveValue(originalLabel);

    const afterWait = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    await assertResponse(await afterWait, 'GET', '/agent-configs', 200);
    expect(digest(await api.json<Profile[]>('/agent-configs'))).toBe(beforeCatalog);
    expect(digest(sqlRows())).toBe(beforeSql);
    expect(writes).toEqual([]);
    // Reload may select a different profile. Explicitly reselect the original.
    await page.getByTestId('profile-coding-agent').click();
    await expect(page.getByTestId('profile-coding-agent')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('profile-label')).toHaveValue(originalLabel);
  } finally {
    const dialog = page.getByTestId('profile-unsaved-dialog');
    if (await dialog.isVisible().catch(() => false)) await page.getByTestId('profile-discard').click();
    const label = page.getByTestId('profile-label');
    if (await label.inputValue().catch(() => '') === draft) await page.getByTestId('profile-cancel').click();
    page.off('request', onRequest);
    expect(writes, 'dirty-switch probe must never save a profile').toEqual([]);
  }
});
