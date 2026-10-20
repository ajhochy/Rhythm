import { createHash, randomUUID } from 'node:crypto';
import { test, expect, ObservedApi, responseFor, assertResponse } from './feature-test';

type ProfileRow = { id: string; label: string; updatedAt?: string };
type DesignRow = { id: string; artifactUrl: string | null; thumbnailUrl: string | null; artifactType: string | null; createdAt?: string };

function profileIdentityDigest(rows: ProfileRow[]) {
  // Keep labels private in the test output while comparing actual persisted identities.
  const identity = rows.map(row => [row.id, row.label, row.updatedAt ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function designIdentityDigest(row: DesignRow) {
  // Include the canonical identity and asset references without exposing values in test failures.
  return createHash('sha256').update(JSON.stringify([row.id, row.artifactType, row.artifactUrl, row.thumbnailUrl, row.createdAt ?? null])).digest('hex');
}

// Recon receipt: exact rebuilt cf49 packaged app returned GET /agent-configs 200 with 54 rows;
// a fresh [smoke] draft showed Unsaved changes and an enabled Save button, Back opened the
// discard dialog, and Discard plus forced reload returned 200 with 54 rows and no write requests.
test('[AI profiles] discarding a new smoke draft leaves the saved profile catalog unchanged', async ({ page }) => {
  const requests: Array<{ method: string; path: string }> = [];
  let ownedDraftLabel: string | null = null;
  const onRequest = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/agent-configs')) requests.push({ method: request.method(), path });
  };
  page.on('request', onRequest);
  try {
    await page.goto('rhythm://app/index.html#/profiles');
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    await expect(page.getByTestId('profile-label')).toBeVisible();
    // Recon showed the shared worker may have warmed the route already. Observe a fresh GET on reload.
    const initialRead = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const initialResponse = await initialRead;
    await assertResponse(initialResponse, 'GET', '/agent-configs', 200);
    const initialRows = await initialResponse.json() as ProfileRow[];
    expect(initialRows.length).toBeGreaterThan(0);
    const api = ObservedApi.from(initialResponse);
    const savedBefore = await api.json<ProfileRow[]>('/agent-configs');
    const beforeDigest = profileIdentityDigest(savedBefore);

    await page.getByTestId('profiles-workspace').waitFor({ state: 'visible' });
    await page.getByTestId('profile-create').click();
    ownedDraftLabel = `[smoke] profile draft ${randomUUID().slice(0, 8)}`;
    await page.getByTestId('profile-label').fill(ownedDraftLabel);
    await expect(page.getByTestId('profile-save-status')).toHaveText('Unsaved changes');
    await expect(page.getByTestId('profile-save')).toBeEnabled();

    await page.getByTestId('profiles-back').click();
    await expect(page.getByTestId('profile-unsaved-dialog')).toBeVisible();
    await page.getByTestId('profile-discard').click();

    // Force a fresh catalog read after dismissal; a hash-only route change can reuse cached data.
    await page.goto('rhythm://app/index.html#/profiles');
    const afterRead = responseFor(page, 'GET', '/agent-configs');
    await page.reload();
    const afterResponse = await afterRead;
    await assertResponse(afterResponse, 'GET', '/agent-configs', 200);
    const savedAfter = await api.json<ProfileRow[]>('/agent-configs');
    expect(savedAfter.length).toBe(savedBefore.length);
    expect(profileIdentityDigest(savedAfter)).toBe(beforeDigest);
    expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  } finally {
    // Recover only the exact unsaved draft created above; never navigate away from a foreign draft.
    if (ownedDraftLabel && new URL(page.url()).hash.startsWith('#/profiles')) {
      const currentLabel = await page.getByTestId('profile-label').inputValue().catch(() => '');
      if (currentLabel === ownedDraftLabel) {
        const discard = page.getByTestId('profile-discard');
        if (await discard.isVisible().catch(() => false)) await discard.click().catch(() => {});
        else {
          await page.getByTestId('profiles-back').click().catch(() => {});
          if (await discard.isVisible().catch(() => false)) await discard.click().catch(() => {});
        }
      }
    }
    page.off('request', onRequest);
  }
});

// Recon receipt: b9 packaged UI GET /agent-designs returned 200 with 22 rows and one image/video
// row whose artifactUrl and thumbnailUrl were null. Selecting that row showed gallery-detail and
// a visible disabled “Deliverable unavailable” button. No open action was taken.
test('[AI Gallery] missing media row remains inspectable and unavailable without changing its record', async ({ page }) => {
  const writes: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/agent-designs') && request.method() !== 'GET') writes.push(request.method());
  };
  page.on('request', onRequest);
  try {
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    const catalogPending = responseFor(page, 'GET', '/agent-designs');
    await page.goto('rhythm://app/index.html#/tools/gallery');
    const response = await catalogPending;
    await assertResponse(response, 'GET', '/agent-designs', 200);
    const rows = await response.json() as DesignRow[];
    const mediaTypes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'webm', 'mov']);
    const candidates = rows.filter(row => row.artifactUrl === null && row.thumbnailUrl === null &&
      mediaTypes.has(String(row.artifactType ?? '').toLowerCase()));
    expect(candidates.length, 'UNVERIFIED: requires a persisted image/video catalog row with both asset URLs missing').toBeGreaterThan(0);
    const candidate = candidates[0];
    const api = ObservedApi.from(response);
    const savedBefore = await api.json<DesignRow[]>('/agent-designs');
    const before = savedBefore.find(row => row.id === candidate.id);
    expect(before, 'selected catalog record must be present in authoritative API readback').toBeDefined();
    const beforeDigest = designIdentityDigest(before!);

    // Use Playwright actionability checks so a hidden or covered row cannot pass as selectable.
    await page.getByTestId(`design-${candidate.id}`).click();
    await expect(page.getByTestId('gallery-detail')).toBeVisible();
    const open = page.getByTestId(`gallery-open-${candidate.id}`);
    await expect(open).toBeVisible();
    await expect(open).toBeDisabled();
    await expect(open).toHaveText('Deliverable unavailable');

    const savedAfter = await api.json<DesignRow[]>('/agent-designs');
    const after = savedAfter.find(row => row.id === candidate.id);
    expect(after, 'selected catalog record must remain in authoritative API readback').toBeDefined();
    expect(designIdentityDigest(after!)).toBe(beforeDigest);
    expect(writes).toEqual([]);
  } finally {
    page.off('request', onRequest);
  }
});
