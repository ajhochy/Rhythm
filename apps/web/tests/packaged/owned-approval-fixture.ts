import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { Response } from '@playwright/test';
import { expect, ObservedApi, assertResponse } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

export type OwnedApproval = { id: string; status: string; action: string; sessionId: string | null;
  agentConfigId: string; decisionNonce?: string | null };

const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
type WritableDb = { prepare(sql: string): { all(...args: unknown[]): Array<Record<string, unknown>>;
  run(...args: unknown[]): { changes: number } }; close(): void };

/** Normal POST through the UI-observed native capability; cleanup is exact private-DB ownership. */
export class OwnedPendingApprovalFixture {
  readonly prefix = `[smoke] approval private ${randomUUID()}`;
  readonly ids = new Map<string, string>();
  readonly token: string;
  api?: ObservedApi;

  constructor(readonly manifestPath: string, readonly expectedRevision: string) {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    expect(manifest.syntheticActor, 'inert approval setup requires a private actor').toBeDefined();
    this.token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  }

  async bind(response: Response) {
    await assertResponse(response, 'GET', '/agent-approvals', 200);
    expect(new URL(response.url()).origin).toBe('http://127.0.0.1:4001');
    expect(response.request().headers().authorization).toBe(`Bearer ${this.token}`);
    expect(response.request().headers()['x-rhythm-human-approval']).toEqual(expect.any(String));
    this.api = ObservedApi.from(response);
  }

  async create(index: number): Promise<OwnedApproval> {
    expect(this.api, 'actual UI must establish authenticated approval authority').toBeDefined();
    const action = `${this.prefix} ${index}`;
    const response = await this.api!.fetch('/agent-approvals', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: null, agentConfigId: 'coding-agent', action,
        preview: `${action}: harmless owned card; no external operation`, consequence: 'No action is performed.' }) });
    expect(response.status).toBe(201);
    const row = await response.json() as OwnedApproval;
    expect(row).toMatchObject({ id: expect.any(String), status: 'pending', action,
      sessionId: null, agentConfigId: 'coding-agent', decisionNonce: expect.any(String) });
    this.ids.set(row.id, action);
    return row;
  }

  async cleanup() {
    if (!this.api) { expect(this.ids.size).toBe(0); return; }
    const manifest = readQualificationFixture(this.manifestPath, this.expectedRevision).manifest;
    const Database = requireApi('better-sqlite3') as new (file: string, options: { fileMustExist: true }) => WritableDb;
    const db = new Database(manifest.dbPath, { fileMustExist: true });
    try {
      // Recover a lost POST acknowledgement without requiring another API read.
      for (const row of db.prepare('SELECT id,action,session_id FROM agent_approvals WHERE action LIKE ?').all(`${this.prefix} %`)) {
        if (typeof row.id === 'string' && typeof row.action === 'string'
          && row.action.startsWith(`${this.prefix} `) && row.session_id === null)
          this.ids.set(row.id, row.action);
      }
      for (const [id, action] of this.ids) {
        expect(action.startsWith(`${this.prefix} `), 'refuse foreign approval cleanup').toBe(true);
        expect(db.prepare('SELECT id,action,session_id FROM agent_approvals WHERE id=? AND action=?').all(id, action))
          .toEqual([{ id, action, session_id: null }]);
        expect(db.prepare('DELETE FROM agent_approvals WHERE id=? AND action=? AND session_id IS NULL').run(id, action).changes).toBe(1);
        expect(db.prepare('SELECT id FROM agent_approvals WHERE id=?').all(id)).toEqual([]);
      }
    } finally { db.close(); }
  }
}
