import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BROAD_TABLES,
  INSTALL_TABLES,
  diffTableRows,
  snapshotBytes,
  snapshotTables,
  waitForBroadRowsToSettle,
} from '../__tests__/_s4_harness_rows';
import * as harnessRows from '../__tests__/_s4_harness_rows';

describe('PR #1489 final harness race repair', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const { name, key } of [...BROAD_TABLES, ...INSTALL_TABLES]) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${key} TEXT PRIMARY KEY, value TEXT, unchanged TEXT)`);
    }
  });

  afterEach(() => db.close());

  it('snapshots broad and install surfaces in stable declared-key order', () => {
    db.prepare("INSERT INTO agent_configs (id, value) VALUES ('b', '2'), ('a', '1')").run();
    db.prepare("INSERT INTO agent_profile_projections (profile_id, value) VALUES ('z', '3'), ('c', '4')").run();

    expect(snapshotTables(db, BROAD_TABLES).agent_configs.map((row) => row.id)).toEqual(['a', 'b']);
    expect(snapshotTables(db, INSTALL_TABLES).agent_profile_projections.map((row) => row.profile_id))
      .toEqual(['c', 'z']);
  });

  it('reports only exact changed tables, rows, and fields', () => {
    db.prepare("INSERT INTO agent_sessions (id, value, unchanged) VALUES ('session-1', 'before', 'same')").run();
    const before = snapshotTables(db, BROAD_TABLES);
    db.prepare("UPDATE agent_sessions SET value = 'after' WHERE id = 'session-1'").run();
    const after = snapshotTables(db, BROAD_TABLES);

    expect(diffTableRows(before, after, BROAD_TABLES)).toEqual([{
      table: 'agent_sessions', row: 'session-1', status: 'changed',
      fields: { value: { before: 'before', after: 'after' } },
    }]);
  });

  it('waits through one late stream update and returns the stable broad snapshot', async () => {
    db.prepare("INSERT INTO agent_session_messages (id, value) VALUES ('message-1', 'pending')").run();
    let waits = 0;
    const settled = await waitForBroadRowsToSettle(db, {
      intervalMs: 0,
      timeoutMs: 100,
      sleep: async () => {
        if (waits++ === 0) db.prepare("UPDATE agent_session_messages SET value = 'settled' WHERE id = 'message-1'").run();
      },
    });

    expect(settled.agent_session_messages).toEqual([{ id: 'message-1', value: 'settled', unchanged: null }]);
  });

  it('bounds non-settlement errors to the exact latest row-field diff', async () => {
    db.prepare("INSERT INTO agent_sessions (id, value, unchanged) VALUES ('session-1', '0', 'do-not-dump')").run();
    let update = 0;
    await expect(waitForBroadRowsToSettle(db, {
      intervalMs: 1,
      timeoutMs: 3,
      sleep: async () => {
        db.prepare('UPDATE agent_sessions SET value = ? WHERE id = ?').run(String(++update), 'session-1');
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    })).rejects.toThrow(/agent_sessions.*session-1.*value(?!.*do-not-dump)/);
  });

  it('compares declared install snapshots byte-for-byte', () => {
    const before = snapshotTables(db, INSTALL_TABLES);
    expect(snapshotBytes(snapshotTables(db, INSTALL_TABLES))).toBe(snapshotBytes(before));
  });

  it('pr-1489-final-c1: live external-adoption candidate is unique per run', () => {
    const source = readFileSync(resolve('src/__tests__/live_e2e_1480_1481_1483_1484.test.ts'), 'utf8');

    expect(source).not.toContain('Unique deployment audit');
    expect(source).toMatch(/candidateSlug.*randomUUID/s);
    expect(source).toMatch(/candidateBody/);
    expect(source).toMatch(/contentSha256.*candidateBody/s);
  });

  it('pr-1489-final-c2: teardown stops producers before status cleanup and bounded settlement', () => {
    const source = readFileSync(resolve('src/__tests__/live_e2e_1480_1481_1483_1484.test.ts'), 'utf8');
    const teardown = source.slice(source.indexOf('afterAll(async () =>'));
    const firstSettlement = teardown.indexOf('waitForBroadRowsToSettle');
    const sessionStop = teardown.indexOf('/session/${encodeURIComponent');
    const providerRestore = teardown.indexOf("attempt('restore anthropic provider'");

    expect(sessionStop).toBeGreaterThan(-1);
    expect(providerRestore).toBeLessThan(sessionStop);
    expect(firstSettlement).toBeGreaterThan(sessionStop);
    expect(teardown).toMatch(/Promise\.allSettled/);
    expect(teardown).toMatch(/AggregateError/);
    expect(teardown).toMatch(/timeoutMs:\s*10_000/);
    expect(teardown).toMatch(/timeoutMs:\s*2_500/);
    expect(teardown).toMatch(/finally\s*{[\s\S]*db\.close\(\)/);
    expect(teardown).toMatch(/},\s*45_000\);/);
  });

  it('pr-1489-last-c1: parses only the exact scoring body from controlled Anthropic JSON', async () => {
    expect(typeof harnessRows.parseScoringPrompt).toBe('function');
    const request = JSON.stringify({
      system: [{ type: 'text', text: 'Judge only the body.' }],
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'PURPOSE:\ndeployment audit\n\nBODY:\nfirst body\nwith title text elsewhere\n\nScore (0-100) + one-sentence reason:' },
      ] }],
      metadata: { decoy: 'BODY:\nwrong\n\nScore (0-100) + one-sentence reason:' },
    });

    expect(harnessRows.parseScoringPrompt(request)).toEqual({
      purpose: 'deployment audit',
      body: 'first body\nwith title text elsewhere',
    });
  });

  it('pr-1489-last-c2: scorer identity requires the exact purpose/body pair', async () => {
    expect(typeof harnessRows.classifyScoringPrompt).toBe('function');
    const purpose = 'name: deployment audit\ndescription: Verify immutable deployment provenance\nwhenToUse: deployment';
    const candidate = '# S4 deployment audit 0123456789abcdef\nInspect deployment provenance for run 0123456789abcdef.';
    const exactDraft = '# deployment audit\n\n## Problem\n\nVerify immutable deployment provenance\n\n## Topics\n\n- deployment';
    expect(harnessRows.classifyScoringPrompt({ purpose, body: candidate }, candidate, exactDraft, purpose))
      .toBe('candidate');
    expect(harnessRows.classifyScoringPrompt({ purpose, body: exactDraft }, candidate, exactDraft, purpose))
      .toBe('uniqueDraft');
    expect(harnessRows.classifyScoringPrompt({ purpose, body: `${exactDraft}\nextra overlap` }, candidate, exactDraft, purpose))
      .toBe('otherScore');
    expect(harnessRows.classifyScoringPrompt({ purpose: 'wrong purpose', body: candidate }, candidate, exactDraft, purpose))
      .toBe('otherScore');

    const source = readFileSync(resolve('src/__tests__/live_e2e_1480_1481_1483_1484.test.ts'), 'utf8');
    expect(source).toMatch(/candidateScoreRequests[^\n]*toHaveLength\(1\)/s);
    expect(source).toMatch(/uniqueDraftScoreRequests[^\n]*toHaveLength\(1\)/s);
    expect(source).toMatch(/otherScoreRequests/);
    expect(source).toMatch(/candidateScoreRequests[^\n]*toEqual\(\[candidateBody\]\)/s);
    expect(source).toMatch(/uniqueDraftScoreRequests[^\n]*toEqual\(\[expectedDraftBody\]\)/s);
  });

  it('pr-1489-last-c3: teardown aborts active owned top-level sessions before top-level-only delete', async () => {
    let active = 0;
    let peak = 0;
    const results = await harnessRows.runBoundedPhase([1, 2, 3, 4, 5, 6, 7, 8], {
      maxConcurrency: 4,
      phaseTimeoutMs: 1_000,
      requestTimeoutMs: 500,
      operation: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
    });
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);

    const source = readFileSync(resolve('src/__tests__/live_e2e_1480_1481_1483_1484.test.ts'), 'utf8');
    const teardown = source.slice(source.indexOf('afterAll(async () =>'));
    const abort = teardown.indexOf('/abort');
    const remove = teardown.indexOf("method: 'DELETE'");

    expect(teardown).toMatch(/SELECT id, sdk_session_id, parent_session_id, cwd FROM agent_sessions/);
    expect(teardown).toMatch(/topLevelSessions/);
    expect(teardown).toMatch(/\/session\/status/);
    expect(teardown).toMatch(/busy|retry/);
    expect(abort).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(abort);
    expect(teardown).toMatch(/maxConcurrency:\s*4/g);
    expect(teardown).toMatch(/pollOwnedSessionsIdle/);
    expect(teardown).toMatch(/runBoundedPhase\(topLevelSessions/);
    expect(teardown).toMatch(/response\.status\s*!==\s*404/);
  });

  it('pr-1489-last-c4: fixture closure and provider restoration precede status proof and cannot be skipped', () => {
    const source = readFileSync(resolve('src/__tests__/live_e2e_1480_1481_1483_1484.test.ts'), 'utf8');
    const teardown = source.slice(source.indexOf('afterAll(async () =>'));
    const closeFixture = teardown.indexOf("attempt('close fixture server'");
    const restoreProvider = teardown.indexOf("attempt('restore anthropic provider'");
    const statusProof = teardown.indexOf("attempt('identify active owned top-level sessions'");
    expect(closeFixture).toBeGreaterThan(-1);
    expect(restoreProvider).toBeGreaterThan(-1);
    expect(statusProof).toBeGreaterThan(closeFixture);
    expect(statusProof).toBeGreaterThan(restoreProvider);
    expect(teardown).toMatch(/cleanupErrors\.push/);
    expect(teardown).toMatch(/throw new AggregateError\(cleanupErrors/);
  });
});
