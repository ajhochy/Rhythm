import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, OwnedRecords, type Row, type ParitySandbox } from './parity-fixture';
export { expect, responseFor, assertResponse, ObservedApi, type Row } from './parity-fixture';

export interface ArtifactLedger {
  artifact: Row;
  bundleRevisions: { revision: number; hash: string; actorUserId: number }[];
  stateRevisions: { revision: number; hash: string; actorUserId: number }[];
  contents: { kind: string; hash: string; body: string }[];
}
interface CloudLedger {
  fixture: 'rhythm-web-cloud-parity-v1'; ownerUserId: 99; workspaceId: 9099;
  tasks: Row[]; artifacts: ArtifactLedger[]; artifactTabIds: string[];
}

/** Read-only oracle at the explicit synthetic loopback upstream; never accepts an arbitrary URL. */
export class SyntheticCloud {
  constructor(readonly parity: ParitySandbox) {}
  async ledger(id?: string): Promise<CloudLedger> {
    assert.equal(process.env.RHYTHM_WEB_CLOUD_TEST, '1');
    assert.equal(process.env.RHYTHM_WEB_CLOUD_CREDENTIAL_PATH,
      path.join(`${this.parity.sandbox}-fixtures`, 'private', 'cloud.json'));
    const result = await new Promise<CloudLedger>((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: 7097,
        path: `/_cloud/ledger${id ? `?id=${encodeURIComponent(id)}` : ''}` }, response => {
        let body = ''; response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; }); response.on('error', reject);
        response.on('end', () => {
          try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      });
      request.setTimeout(5_000, () => request.destroy(new Error('Synthetic cloud oracle timed out')));
      request.on('error', reject);
    });
    expect(result).toMatchObject({ fixture: 'rhythm-web-cloud-parity-v1', ownerUserId: 99, workspaceId: 9099 });
    return result;
  }
}

export const test = base.extend<{ cloud: SyntheticCloud; tasks: OwnedRecords }>({
  cloud: [async ({ parity }, use) => {
    base.skip(process.env.RHYTHM_WEB_CLOUD_TEST !== '1', 'Requires the disposable synthetic cloud upstream; not a real-account spec');
    const cloud = new SyntheticCloud(parity);
    await cloud.ledger();
    expect(await parity.api.json('/web/bootstrap')).toMatchObject({ mode: 'web', owner: { id: 1 }, capabilities: { cloud: true } });
    expect(await parity.api.json('/cloud/auth/me')).toMatchObject({ user: { id: 99, email: 'admin@example.invalid' }, workspace: { id: 9099 } });
    // This endpoint is a test oracle, never exposed by the actual browser forwarder.
    const inaccessible = await parity.api.fetch('/cloud/_cloud/ledger');
    expect(inaccessible.status).toBe(404);
    expect(await inaccessible.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    await use(cloud);
  }, { auto: true }],
  tasks: async ({ page, parity, cloud }, use) => {
    void cloud;
    await use(new OwnedRecords(page, parity, 'tasks', 'cloud tasks', '/cloud/tasks'));
  },
});

export async function openTaskDialog(page: Page) {
  const empty = page.getByTestId('tasks-empty-create');
  await (await empty.isVisible() ? empty : page.getByTestId('tasks-header-add-task')).click();
}
export async function navigate(page: Page, key: 'tasks' | 'agents') {
  const direct = page.getByTestId(`nav-${key}`);
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByTestId('nav-more').click();
    await page.getByTestId(`nav-${key}-overflow`).click();
  }
  await expect(page).toHaveURL(new RegExp(`#/${key}(\\?.*)?$`));
}
