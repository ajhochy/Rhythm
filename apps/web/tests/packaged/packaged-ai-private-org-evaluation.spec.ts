import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, API, ObservedApi, expectedRevision, responseFor } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

// RED packaged contract for the first UI slice. It uses only a disposable actor,
// does not start a Reviewer/model turn, and restores its exact settings preimage.
type Settings = { tokenLimit: number; candidateCount: 2 | 3 };
type EvaluationList = { jobs: unknown[] };
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Org Reviewer] private evaluation settings persist and empty activity is honest';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: exact disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'configuration write must use a disposable actor').toBeDefined();
  expect(process.env.RHYTHM_FEATURE_MODEL, 'settings contract must not spend a model loan').not.toBe('1');
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number } }>('/auth/me'))
    .toMatchObject({ user: { id: manifest.ownerUserId } });
  const before = await api.json<Settings>('/agent-org-proposals/evaluations/settings');
  expect(before.tokenLimit).toBeGreaterThan(0);
  expect([2, 3]).toContain(before.candidateCount);
  expect(await api.json<EvaluationList>('/agent-org-proposals/evaluations')).toEqual({ jobs: [] });

  const changed: Settings = {
    tokenLimit: before.tokenLimit === 100_000 ? 110_000 : 100_000,
    candidateCount: before.candidateCount === 2 ? 3 : 2,
  };
  let writeAttempted = false;
  try {
    const loaded = responseFor(page, 'GET', '/agent-org-proposals/evaluations/settings');
    await page.goto('rhythm://app/index.html#/tools/review');
    const loadedResponse = await loaded;
    expect(loadedResponse.status()).toBe(200);
    expect(loadedResponse.request().headers().authorization).toBe(`Bearer ${token}`);
    const settings = page.getByRole('region', { name: 'Evaluation settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel('Whole-run token limit')).toHaveValue(String(before.tokenLimit));
    await expect(settings.getByLabel('Candidates per review')).toHaveValue(String(before.candidateCount));
    await settings.getByLabel('Whole-run token limit').fill(String(changed.tokenLimit));
    await settings.getByLabel('Candidates per review').selectOption(String(changed.candidateCount));
    const saved = responseFor(page, 'PATCH', '/agent-org-proposals/evaluations/settings');
    writeAttempted = true;
    await settings.getByRole('button', { name: 'Save evaluation settings' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual(changed);
    expect(await api.json<Settings>('/agent-org-proposals/evaluations/settings')).toEqual(changed);
    await page.reload();
    const reloaded = page.getByRole('region', { name: 'Evaluation settings' });
    await expect(reloaded.getByLabel('Whole-run token limit')).toHaveValue(String(changed.tokenLimit));
    await expect(reloaded.getByLabel('Candidates per review')).toHaveValue(String(changed.candidateCount));

    const activity = page.getByRole('region', { name: 'Evaluation activity' });
    await expect(activity).toBeVisible();
    await expect(activity).toContainText('No evaluations yet');
    await expect(activity.getByRole('button', { name: /^Approve$/ })).toHaveCount(0);
    expect(await api.json<EvaluationList>('/agent-org-proposals/evaluations')).toEqual({ jobs: [] });
  } finally {
    if (writeAttempted) {
      const restored = await api.fetch('/agent-org-proposals/evaluations/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(before),
      });
      expect(restored.status, 'restore exact disposable settings preimage').toBe(200);
      expect(await api.json<Settings>('/agent-org-proposals/evaluations/settings')).toEqual(before);
    }
  }
});
