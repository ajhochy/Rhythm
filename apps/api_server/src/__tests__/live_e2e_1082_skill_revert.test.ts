/**
 * Live behavioral contract for #1082.
 *
 * This test drives the running sandbox api_server over HTTP. It creates the
 * DB/file divergence through the production PUT route, approves a real
 * refine-skill proposal, waits for the real measure/revert lane, and observes
 * the restored SKILL.md through the production content route. It is gated so
 * normal Vitest runs never contact a running backend.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

function baseUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

async function waitForReverted(id: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl()}/agent-org-proposals?status=reverted`);
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    if (rows.some((row) => row.id === id)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`proposal ${id} did not reach status=reverted within ${timeoutMs}ms`);
}

describeLive('issue #1082 live acceptance contract', () => {
  let db: Database.Database;
  let skillId: string;
  let proposalId: string;
  let name: string;

  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = baseUrl();
    if (!url) throw new Error('RHYTHM_LIVE_URL is required');
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error(`RHYTHM_LIVE_URL must target localhost, got ${parsed.hostname}`);
    }
    if (parsed.port === '4001' || parsed.port === '4000' || parsed.port === '') {
      throw new Error(`RHYTHM_LIVE_URL must use a non-default sandbox port, got ${parsed.port || '(default)'}`);
    }

    const dbPath = process.env.DB_PATH;
    const declaredLiveDb = process.env.RHYTHM_LIVE_DB_PATH;
    if (!dbPath || !declaredLiveDb || resolve(dbPath) !== resolve(declaredLiveDb)) {
      throw new Error('DB_PATH and RHYTHM_LIVE_DB_PATH must name the same sandbox DB');
    }
    db = new Database(dbPath);

    const health = await fetch(`${url}/health`);
    if (!health.ok) throw new Error(`sandbox api_server health failed: ${health.status}`);
  });

  afterAll(async () => {
    if (name) {
      await fetch(`${baseUrl()}/opencode/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
    }
    if (db) {
      if (proposalId) db.prepare('DELETE FROM agent_org_proposals WHERE id = ?').run(proposalId);
      if (skillId) db.prepare('DELETE FROM agent_skills WHERE id = ?').run(skillId);
      db.close();
    }
  });

  it('issue-1082-c2: sandboxed PUT then proposal approve and measure/revert restores the HTTP-visible SKILL.md bytes', async () => {
    name = `contract-1082-${Date.now()}`;
    skillId = randomUUID();
    proposalId = randomUUID();
    const staleDbBody = 'STALE DATABASE BODY — must never overwrite the edited file';
    const editedBody = '# User-edited body\n\nThis content came through PUT and is authoritative.\n';

    db.prepare(
      `INSERT INTO agent_skills (id, title, description, body, status, confidence, uses, version)
       VALUES (?, ?, ?, ?, 'active', 0, 0, 1)`,
    ).run(skillId, name, 'stale DB description', staleDbBody);

    const create = await fetch(`${baseUrl()}/opencode/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description: 'initial description', content: 'initial body' }),
    });
    expect(create.status).toBe(200);

    const put = await fetch(`${baseUrl()}/opencode/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'description edited through PUT',
        content: editedBody,
      }),
    });
    expect(put.status).toBe(200);

    const beforeResponse = await fetch(
      `${baseUrl()}/opencode/skills/${encodeURIComponent(name)}/content`,
    );
    expect(beforeResponse.status).toBe(200);
    const before = (await beforeResponse.json()) as { content: string };
    expect(before.content).toContain(editedBody.trim());
    expect(before.content).not.toContain(staleDbBody);

    db.prepare(
      `INSERT INTO agent_org_proposals
       (id, kind, risk, status, title, target_ref, change_json, dedup_key)
       VALUES (?, 'refine-skill', 'low', 'proposed', ?, ?, ?, ?)`,
    ).run(
      proposalId,
      `Contract revision for ${name}`,
      `skill:${skillId}`,
      JSON.stringify({
        skillName: name,
        priorBody: staleDbBody,
        // An empty/low-quality candidate makes the real judge tie or lose;
        // scorer failure also fails closed to a tie and therefore reverts.
        revisedBody: 'x',
      }),
      `contract-1082-live:${name}`,
    );

    const approve = await fetch(
      `${baseUrl()}/agent-org-proposals/${encodeURIComponent(proposalId)}/approve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(approve.status).toBe(200);
    const measuring = (await approve.json()) as { status: string; beforeSnapshotJson?: string };
    expect(measuring.status).toBe('measuring');
    expect(measuring.beforeSnapshotJson).toBeTruthy();

    await waitForReverted(proposalId);

    const afterResponse = await fetch(
      `${baseUrl()}/opencode/skills/${encodeURIComponent(name)}/content`,
    );
    expect(afterResponse.status).toBe(200);
    const after = (await afterResponse.json()) as { content: string };
    expect(after.content).toBe(before.content);
    expect(after.content).not.toContain(staleDbBody);
  }, 130_000);
});
