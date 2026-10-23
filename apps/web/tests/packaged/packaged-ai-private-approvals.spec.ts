import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { test as unverified } from '@playwright/test';
import { test, expect, assertResponse, responseFor, localRows,
  expectExpiredOwnedApprovalDenial, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { OwnedPendingApprovalFixture, type OwnedApproval } from './owned-approval-fixture';

type Approval = OwnedApproval;
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const rejectTitle = '[AI approvals] private native Reject clears an inert owned card without a continuation';
const staleTitle = '[AI approvals] controlled stale card denies Approve and leaves the owned decision unconsumed';
const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type WritableDb = { prepare(sql: string): { run(...args: unknown[]): { changes: number } }; close(): void };

class OwnedApprovals extends OwnedPendingApprovalFixture {
  constructor(readonly page: Page) { super(manifestPath!, expectedRevision); }
  async open() {
    const pending = responseFor(this.page, 'GET', '/agent-approvals');
    await this.page.goto('rhythm://app/index.html#/agents');
    await this.page.reload();
    const response = await pending;
    await this.bind(response);
  }
  async refresh(id: string, action: string) {
    const menu = this.page.getByTestId('notifications-button');
    if (!await this.page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).isVisible().catch(() => false)) await menu.click();
    const pending = responseFor(this.page, 'GET', '/agent-approvals');
    await this.page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
    const response = await pending;
    await assertResponse(response, 'GET', '/agent-approvals', 200);
    const rows = await response.json() as Approval[];
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id, action, status: 'pending' })]));
    await expect(this.page.getByTestId(`approval-card-${id}`)).toBeVisible();
  }
}

if (!manifestPath) {
  for (const title of [rejectTitle, staleTitle])
    unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else {
  test(rejectTitle, async ({ page }) => {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    expect(manifest.syntheticActor.approvalSigner, 'native private approval signer required').toBeDefined();
    const actor = new OwnedApprovals(page);
    try {
      await actor.open();
      const row = await actor.create(0);
      await actor.refresh(row.id, row.action);
      const card = page.getByTestId(`approval-card-${row.id}`);
      const pending = responseFor(page, 'PATCH', `/agent-approvals/${row.id}`);
      await card.getByRole('menuitem', { name: 'Reject', exact: true }).click();
      const response = await pending;
      await assertResponse(response, 'PATCH', `/agent-approvals/${row.id}`, 200);
      const rejected = await response.json() as Approval;
      expect(rejected).toMatchObject({ id: row.id, action: row.action, status: 'rejected',
        sessionId: null, agentConfigId: 'coding-agent' });
      expect(Boolean(rejected.decisionNonce)).toBe(false);
      await expect(card).toBeHidden();
      const history = await actor.api!.json<Approval[]>('/agent-approvals?status=all');
      const persisted = history.find(item => item.id === row.id && item.action === row.action);
      expect(persisted?.status).toBe('rejected');
      expect(Boolean(persisted?.decisionNonce)).toBe(false);
      expect(localRows('SELECT status,session_id,continuation_state,decision_nonce FROM agent_approvals WHERE id=? AND action=?', row.id, row.action))
        .toEqual([{ status: 'rejected', session_id: null, continuation_state: null, decision_nonce: null }]);
    } finally { await actor.cleanup(); }
  });

  test(staleTitle, async ({ page }) => {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    expect(manifest.syntheticActor.approvalSigner, 'native private approval signer required').toBeDefined();
    const actor = new OwnedApprovals(page);
    try {
      await actor.open();
      const row = await actor.create(1);
      await actor.refresh(row.id, row.action);
      const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: true }) => WritableDb;
      const db = new Database(manifest.dbPath, { fileMustExist: true });
      try {
        const expiry = new Date(Date.now() - 2_000).toISOString();
        expect(db.prepare(`UPDATE agent_approvals SET expires_at=? WHERE id=? AND action=? AND decision_nonce=?
          AND status='pending' AND session_id IS NULL AND expires_at IS NULL`).run(expiry, row.id, row.action, row.decisionNonce).changes).toBe(1);
      } finally { db.close(); }
      // The strict app audit permits only this exact owned row's expected expired-card denial.
      expectExpiredOwnedApprovalDenial(row.id, row.action, row.decisionNonce!);
      const pending = responseFor(page, 'PATCH', `/agent-approvals/${row.id}`);
      await page.getByTestId(`approval-card-${row.id}`).getByRole('menuitem', { name: 'Approve', exact: true }).click();
      const response = await pending;
      await assertResponse(response, 'PATCH', `/agent-approvals/${row.id}`, 403);
      await expect(page.getByTestId('approval-queue-error')).toContainText('This approval expired; ask for a new proposal');
      expect((await actor.api!.json<Approval[]>('/agent-approvals?status=pending')).some(item => item.id === row.id)).toBe(false);
      expect(await actor.api!.json<Approval[]>('/agent-approvals?status=all')).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: row.id, action: row.action, status: 'pending', decisionNonce: row.decisionNonce }),
      ]));
      const database = localRows(`SELECT status,session_id,continuation_state,consumed_at,decision_nonce,expires_at
        FROM agent_approvals WHERE id=? AND action=?`, row.id, row.action);
      expect(database).toHaveLength(1);
      expect(database[0]).toMatchObject({ status: 'pending', session_id: null, continuation_state: null,
        consumed_at: null, decision_nonce: row.decisionNonce });
      expect(Date.parse(String(database[0].expires_at))).toBeLessThan(Date.now());
    } finally { await actor.cleanup(); }
  });
}
