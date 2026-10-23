import { createHash } from 'node:crypto';
import { test, expect, ObservedApi, responseFor, assertResponse } from './parity-fixture';
import { OwnedMissingGalleryFixture } from './owned-web-gallery-fixture';

type DesignRow = { id: string; artifactUrl: string | null; thumbnailUrl: string | null; artifactType: string | null; createdAt?: string };
const identity = (row: DesignRow) => createHash('sha256').update(JSON.stringify([
  row.id, row.artifactType, row.artifactUrl, row.thumbnailUrl, row.createdAt ?? null,
])).digest('hex');

test('#30: [AI Gallery] missing media row remains inspectable and unavailable without changing its record', async ({ page, parity }) => {
  let owned: OwnedMissingGalleryFixture | undefined;
  const writes: string[] = [];
  const observe = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname.startsWith('/agent-designs') && request.method() !== 'GET') writes.push(request.method());
  };
  try {
    const initial = responseFor(page, 'GET', '/agent-designs');
    await page.goto('/#/tools/gallery');
    const response = await initial;
    await assertResponse(response, 'GET', '/agent-designs', 200);
    await response.json();
    const api = ObservedApi.from(response, parity);
    owned = new OwnedMissingGalleryFixture(api);
    const created = await owned.create();
    const reload = responseFor(page, 'GET', '/agent-designs');
    await page.reload();
    const catalog = await reload;
    await assertResponse(catalog, 'GET', '/agent-designs', 200);
    const rows = await catalog.json() as DesignRow[];
    const mediaTypes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'webm', 'mov']);
    const candidates = rows.filter(row => row.id === created.id && row.artifactUrl === null
      && row.thumbnailUrl === null && mediaTypes.has(String(row.artifactType).toLowerCase()));
    expect(candidates).toHaveLength(1);
    page.on('request', observe);
    const before = (await api.json<DesignRow[]>('/agent-designs')).find(row => row.id === created.id);
    expect(before).toBeDefined();
    await page.getByTestId(`design-${created.id}`).click();
    await expect(page.getByTestId('gallery-detail')).toBeVisible();
    const open = page.getByTestId(`gallery-open-${created.id}`);
    await expect(open).toBeVisible();
    await expect(open).toBeDisabled();
    await expect(open).toHaveText('Deliverable unavailable');
    const after = (await api.json<DesignRow[]>('/agent-designs')).find(row => row.id === created.id);
    expect(after).toBeDefined();
    expect(identity(after!)).toBe(identity(before!));
    expect(writes).toEqual([]);
  } finally { page.off('request', observe); await owned?.cleanup(); }
});
