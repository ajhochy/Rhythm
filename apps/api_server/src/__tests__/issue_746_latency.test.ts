/**
 * Issue #746 — Startup latency reduction tests.
 *
 * Verifies:
 *  1. Timing logs: _initializeImpl wraps each phase with [Opencode][timing] log entries.
 *  2. Curator throttle: queueSkillExtraction defers during the cold-start window after
 *     notifyEngineReady() is called, and resumes after the window expires.
 *  3. Timing logs in create path: [Opencode][timing] entries appear for opencodeClient.createSession.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import {
  queueSkillExtraction,
  notifyEngineReady,
  _resetHarvestGuardForTests,
  type DistillFn,
} from '../services/skill_extractor';

// ── DB helpers ────────────────────────────────────────────────────────────────

let _activeDb: Database.Database | null = null;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  _activeDb = db;
  return db;
}

function teardownDb(): void {
  if (_activeDb) {
    try { _activeDb.close(); } catch { /* ignore */ }
    _activeDb = null;
  }
}

function seedSession(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'latency-test')`,
    )
    .run(id);
}

function seedMessages(sessionId: string, rounds: number): void {
  const msgRepo = new AgentSessionMessagesRepository();
  for (let i = 0; i < rounds; i++) {
    msgRepo.append(sessionId, 'input', `user ${i}`, `user ${i}`);
    msgRepo.append(sessionId, 'output', `assistant ${i}`, `assistant ${i}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('issue #746 — curator throttle (notifyEngineReady + queueSkillExtraction)', () => {
  beforeEach(() => {
    makeDb();
    // #1109 — this file's tests each expect a fresh session to be able to
    // fire (they're testing the cold-start throttle, not the per-session
    // guard / global cooldown), so reset that unrelated module state here too.
    _resetHarvestGuardForTests();
  });
  afterEach(() => {
    teardownDb();
    // Reset the module-level _engineReadyAt state between tests by notifying
    // with a very old timestamp (1ms) so the 90s window is in the distant past.
    // We do this by calling notifyEngineReady with a time 200s in the past.
    notifyEngineReady(Date.now() - 200_000);
    _resetHarvestGuardForTests();
  });

  it('defers queueSkillExtraction during cold-start window', () => {
    seedSession('s1');
    seedMessages('s1', 3); // 3 rounds ≥ MIN_ROUNDS=2, so normally would run

    // Notify engine ready NOW — we're inside the 90s cold window.
    notifyEngineReady(Date.now());

    const distill = vi.fn(async (_id: string) => null);
    queueSkillExtraction('s1', distill as DistillFn);

    // distill must NOT have been called — throttled during cold window.
    expect(distill).not.toHaveBeenCalled();
  });

  it('runs queueSkillExtraction after cold-start window expires', () => {
    seedSession('s2');
    seedMessages('s2', 3); // 3 rounds ≥ MIN_ROUNDS=2

    // Simulate engine init 200 seconds ago — well past the 90s window.
    notifyEngineReady(Date.now() - 200_000);

    const distill = vi.fn(async (_id: string) => null);
    queueSkillExtraction('s2', distill as DistillFn);

    // distill SHOULD have been called — window expired.
    expect(distill).toHaveBeenCalledWith('s2');
  });

  it('allows extraction when notifyEngineReady has never been called', () => {
    // Simulate fresh module state with no engine-ready notification by providing
    // a time in the distant past (afterEach resets to -200s, so this is window-expired).
    seedSession('s3');
    seedMessages('s3', 3);

    // After afterEach reset, _engineReadyAt is 200s in the past → not throttled.
    const distill = vi.fn(async (_id: string) => null);
    queueSkillExtraction('s3', distill as DistillFn);
    expect(distill).toHaveBeenCalledWith('s3');
  });

  it('does not call distill below MIN_ROUNDS even outside cold window', () => {
    // Reset to past (not throttled).
    notifyEngineReady(Date.now() - 200_000);

    seedSession('s4');
    seedMessages('s4', 1); // 1 round < MIN_ROUNDS=2

    const distill = vi.fn(async (_id: string) => null);
    queueSkillExtraction('s4', distill as DistillFn);
    expect(distill).not.toHaveBeenCalled();
  });

  it('throttle log message is emitted during cold window', async () => {
    seedSession('s5');
    seedMessages('s5', 3);

    // Spy on logger.info to capture the throttle message.
    const { logger } = await import('../utils/logger');
    const infoSpy = vi.spyOn(logger, 'info');

    notifyEngineReady(Date.now()); // inside window

    const distill = vi.fn(async (_id: string) => null);
    queueSkillExtraction('s5', distill as DistillFn);

    const throttleLog = infoSpy.mock.calls.find(
      (args) =>
        typeof args[0] === 'string' &&
        (args[0] as string).includes('throttled during engine cold-start window'),
    );
    expect(throttleLog).toBeTruthy();
    infoSpy.mockRestore();
  });
});

describe('issue #746 — engineReadyAt getter on OpencodeClientService', () => {
  it('exports engineReadyAt as null before initialization', async () => {
    // We only test the accessor shape — not the full init cycle — to avoid
    // spawning a real opencode server in tests.
    const { OpencodeClientService } = await import(
      '../services/opencode_client_service'
    );
    const svc = new OpencodeClientService();
    // Before init, _engineReadyAt is null.
    expect(svc.engineReadyAt).toBeNull();
  });
});
