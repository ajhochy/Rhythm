/**
 * Live behavioral contract for #1152 — approving a workflow-prompt-fix
 * proposal whose diagnosis names a MISSING skill (rootCause: 'skill', no
 * live skill resolves) must scaffold the skill and grant it, instead of
 * 400-ing with "could not resolve a live skill / re-point the proposal".
 *
 * Drives the REAL sandbox api_server over HTTP end to end: POST
 * /agent-org-proposals/:id/approve, then confirms (a) the managed SKILL.md
 * now exists on disk and (b) the target profile's allowedSkillsJson was
 * granted via GET /agent-configs/:id — the observable outcome, not "the
 * applier function ran".
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — skipped in the normal `vitest run` suite.
 *
 * Run it against a sandbox built from THIS branch's source:
 *   tools/dev/sandbox.sh up
 *   SB="${RHYTHM_SANDBOX_DIR:-${TMPDIR:-/tmp}/rhythm-dev-sandbox}"
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *     RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     DB_PATH="$SB/rhythm.db" RHYTHM_LIVE_DB_PATH="$SB/rhythm.db" \
 *     RHYTHM_MANAGED_SKILLS_DIR="$SB/home/.config/opencode/skills" \
 *     npx vitest run src/__tests__/issue_1152_skill_create_live.e2e.test.ts
 *   tools/dev/sandbox.sh down
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

function baseUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

function managedSkillsDir(): string {
  return process.env.RHYTHM_MANAGED_SKILLS_DIR ?? join(homedir(), '.config', 'opencode', 'skills');
}

interface AgentConfigResponse {
  id: string;
  allowedSkillsJson: string | null;
}

describeLive('issue #1152 live acceptance contract', () => {
  let db: Database.Database;
  let configId: string;
  let proposalId: string;

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
    if (configId) {
      await fetch(`${baseUrl()}/opencode/skills/${encodeURIComponent(configId)}`, { method: 'DELETE' });
    }
    if (db) {
      if (proposalId) db.prepare('DELETE FROM agent_org_proposals WHERE id = ?').run(proposalId);
      if (configId) {
        db.prepare('DELETE FROM agent_skills WHERE title = ?').run(configId);
        db.prepare('DELETE FROM agent_configs WHERE id = ?').run(configId);
      }
      db.close();
    }
  });

  it('issue-1152: approving a missing-skill diagnosis scaffolds the SKILL.md and grants it', async () => {
    const createConfig = await fetch(`${baseUrl()}/agent-configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: `e2e-1152 creative-media ${Date.now()}`,
        icon: 'camera',
        allowedSkillsJson: JSON.stringify([]),
      }),
    });
    expect(createConfig.status).toBe(200);
    const config = (await createConfig.json()) as AgentConfigResponse;
    configId = config.id;

    proposalId = randomUUID();
    const concreteFix = 'Add a render time budget guard: cap the render loop at 16ms and log overruns.';
    db.prepare(
      `INSERT INTO agent_org_proposals
       (id, kind, risk, status, title, target_ref, change_json, dedup_key)
       VALUES (?, 'workflow-prompt-fix', 'high', 'proposed', ?, ?, ?, ?)`,
    ).run(
      proposalId,
      `Fix skill issue in ${configId} (e2e-1152)`,
      `skill:${configId}`,
      JSON.stringify({
        rootCause: 'skill',
        diagnosis: 'No skill exists for this workflow yet.',
        concreteFix,
      }),
      `contract-1152-live:${configId}`,
    );

    // ── The bug: this used to 400 with "could not resolve a live skill" ──────
    const approve = await fetch(
      `${baseUrl()}/agent-org-proposals/${encodeURIComponent(proposalId)}/approve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    const approveBody = await approve.text();
    expect(approve.ok, `approve should not 400 — got ${approve.status}: ${approveBody}`).toBe(true);
    expect(approveBody).not.toMatch(/could not resolve a live skill/);

    // ── Behavioral outcome (a): the SKILL.md now exists on disk ──────────────
    const skillFile = join(managedSkillsDir(), configId, 'SKILL.md');
    expect(existsSync(skillFile), `expected managed SKILL.md at ${skillFile}`).toBe(true);

    // ── Behavioral outcome (b): the profile was granted the new skill ────────
    const after = await fetch(`${baseUrl()}/agent-configs/${configId}`);
    expect(after.status).toBe(200);
    const afterConfig = (await after.json()) as AgentConfigResponse;
    const granted = JSON.parse(afterConfig.allowedSkillsJson ?? '[]') as string[];
    expect(granted).toContain(configId);
  }, 30_000);
});
