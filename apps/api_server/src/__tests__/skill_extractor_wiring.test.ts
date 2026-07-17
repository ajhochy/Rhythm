/**
 * P2-2 — skill extractor wiring tests.
 *
 * Verifies the FIRE-AND-FORGET contract of queueSkillExtraction and that the
 * AgentRunner success path invokes it without awaiting it.
 *
 * Concerns:
 *  1. Non-blocking: queueSkillExtraction returns BEFORE a slow (100ms-delayed)
 *     distill resolves — the caller's flow is never gated on the distill.
 *  2. Throw-safety: a distill that rejects (or throws synchronously) does NOT
 *     reject / throw out of queueSkillExtraction.
 *  3. Eligibility: distill is called only when rounds >= 2; with 1 round it is
 *     never called.
 *  4. Repo-throw safety: queueSkillExtraction never throws even when the
 *     messages query itself throws (no DB initialized).
 *
 * The AgentRunner-invokes-queueSkillExtraction case lives in a sibling file
 * (skill_extractor_wiring_runner.test.ts) because it vi.mock's the
 * skill_extractor module, which would otherwise shadow the real
 * queueSkillExtraction used by the unit tests below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import {
  queueSkillExtraction,
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
    try {
      _activeDb.close();
    } catch {
      /* ignore */
    }
    _activeDb = null;
  }
}

function seedSession(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'wiring-test')`,
    )
    .run(id);
}

function seedRounds(sessionId: string, rounds: number): void {
  const msgRepo = new AgentSessionMessagesRepository();
  for (let i = 0; i < rounds; i++) {
    msgRepo.append(sessionId, 'input', `user ${i}`, `user ${i}`);
    msgRepo.append(sessionId, 'output', `assistant ${i}`, `assistant ${i}`);
  }
}

// ── 1-4: queueSkillExtraction unit behavior ─────────────────────────────────────

describe('P2-2 — queueSkillExtraction (fire-and-forget)', () => {
  beforeEach(() => {
    makeDb();
    _resetHarvestGuardForTests();
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    _resetHarvestGuardForTests();
  });

  it('is non-blocking: returns before a slow (100ms) distill resolves', async () => {
    seedSession('sess-slow');
    seedRounds('sess-slow', 2);

    let distillResolved = false;
    const slowDistill: DistillFn = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          distillResolved = true;
          resolve(null);
        }, 100);
      });

    const before = Date.now();
    queueSkillExtraction('sess-slow', slowDistill);
    const elapsed = Date.now() - before;

    // The synchronous queue call must return immediately, well before 100ms.
    expect(elapsed).toBeLessThan(50);
    // And the distill must not have resolved yet.
    expect(distillResolved).toBe(false);

    // Give the timer time to fire so we leave no dangling work.
    await new Promise((r) => setTimeout(r, 150));
    expect(distillResolved).toBe(true);
  });

  it('does not throw when the distill REJECTS', async () => {
    seedSession('sess-reject');
    seedRounds('sess-reject', 2);

    const rejectingDistill: DistillFn = () => Promise.reject(new Error('boom'));

    // Synchronous call must not throw.
    expect(() => queueSkillExtraction('sess-reject', rejectingDistill)).not.toThrow();

    // And the rejection must be swallowed (no unhandled rejection escapes).
    await new Promise((r) => setTimeout(r, 20));
  });

  it('does not throw when the distill throws SYNCHRONOUSLY', () => {
    seedSession('sess-sync-throw');
    seedRounds('sess-sync-throw', 2);

    const throwingDistill: DistillFn = () => {
      throw new Error('sync boom');
    };

    expect(() => queueSkillExtraction('sess-sync-throw', throwingDistill)).not.toThrow();
  });

  it('calls distill when rounds >= 2', () => {
    seedSession('sess-2rounds');
    seedRounds('sess-2rounds', 2);

    const distill = vi.fn<DistillFn>().mockResolvedValue(null);
    queueSkillExtraction('sess-2rounds', distill);

    expect(distill).toHaveBeenCalledOnce();
    expect(distill).toHaveBeenCalledWith('sess-2rounds');
  });

  it('does NOT call distill with only 1 round', () => {
    seedSession('sess-1round');
    seedRounds('sess-1round', 1);

    const distill = vi.fn<DistillFn>().mockResolvedValue(null);
    queueSkillExtraction('sess-1round', distill);

    expect(distill).not.toHaveBeenCalled();
  });

  it('never throws even when the round-count query throws', () => {
    // Close the underlying handle so getDb().prepare() throws inside listBySession.
    teardownDb();
    const distill = vi.fn<DistillFn>().mockResolvedValue(null);

    expect(() => queueSkillExtraction('sess-no-db', distill)).not.toThrow();
    // Distill must not be reached when the count failed.
    expect(distill).not.toHaveBeenCalled();
  });
});

// ── #1109 — per-session guard + global cooldown ─────────────────────────────

describe('#1109 — per-session harvest guard + global cooldown', () => {
  const REAL_COOLDOWN = process.env.RHYTHM_HARVEST_COOLDOWN_MS;

  beforeEach(() => {
    makeDb();
    _resetHarvestGuardForTests();
    // Tiny cooldown so tests don't have to wait out the real 5-minute default.
    process.env.RHYTHM_HARVEST_COOLDOWN_MS = '50';
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    _resetHarvestGuardForTests();
    if (REAL_COOLDOWN === undefined) delete process.env.RHYTHM_HARVEST_COOLDOWN_MS;
    else process.env.RHYTHM_HARVEST_COOLDOWN_MS = REAL_COOLDOWN;
  });

  it('a second call for the SAME session never calls distill again (lifetime guard)', async () => {
    seedSession('sess-guard-1');
    seedRounds('sess-guard-1', 2);
    const distill = vi.fn<DistillFn>().mockResolvedValue(null);

    queueSkillExtraction('sess-guard-1', distill);
    expect(distill).toHaveBeenCalledTimes(1);

    // Wait out the cooldown so the SECOND call below is blocked by the
    // per-session guard specifically, not the (also-active) cooldown.
    await new Promise((r) => setTimeout(r, 60));

    seedRounds('sess-guard-1', 2); // more rounds accrue on the same session
    queueSkillExtraction('sess-guard-1', distill);
    expect(distill).toHaveBeenCalledTimes(1); // still just once — lifetime guard
  });

  it('the guard is checked before any model call — rapid repeat calls for one session still fire once', () => {
    seedSession('sess-guard-2');
    seedRounds('sess-guard-2', 2);
    const distill = vi.fn<DistillFn>().mockResolvedValue(null);

    queueSkillExtraction('sess-guard-2', distill);
    queueSkillExtraction('sess-guard-2', distill);
    queueSkillExtraction('sess-guard-2', distill);

    expect(distill).toHaveBeenCalledTimes(1);
  });

  it('a session below the round threshold is NOT guarded — crossing it on a later turn still fires once', () => {
    seedSession('sess-guard-3');
    seedRounds('sess-guard-3', 1); // below MIN_ROUNDS
    const distill = vi.fn<DistillFn>().mockResolvedValue(null);

    queueSkillExtraction('sess-guard-3', distill);
    expect(distill).not.toHaveBeenCalled(); // too few rounds — guard NOT consumed

    seedRounds('sess-guard-3', 1); // now 2 rounds total
    queueSkillExtraction('sess-guard-3', distill);
    expect(distill).toHaveBeenCalledTimes(1); // now qualifies — fires exactly once
  });

  it('cooldown: a DIFFERENT novel session within the cooldown window does not fire', () => {
    seedSession('sess-cool-a');
    seedRounds('sess-cool-a', 2);
    seedSession('sess-cool-b');
    seedRounds('sess-cool-b', 2);
    const distillA = vi.fn<DistillFn>().mockResolvedValue(null);
    const distillB = vi.fn<DistillFn>().mockResolvedValue(null);

    queueSkillExtraction('sess-cool-a', distillA);
    expect(distillA).toHaveBeenCalledTimes(1);

    // A DIFFERENT, otherwise-eligible session fired immediately after —
    // the GLOBAL cooldown (not the per-session guard) blocks it.
    queueSkillExtraction('sess-cool-b', distillB);
    expect(distillB).not.toHaveBeenCalled();
  });

  it('cooldown: once the window passes, a different novel session fires exactly once', async () => {
    seedSession('sess-cool-c');
    seedRounds('sess-cool-c', 2);
    seedSession('sess-cool-d');
    seedRounds('sess-cool-d', 2);
    const distillC = vi.fn<DistillFn>().mockResolvedValue(null);
    const distillD = vi.fn<DistillFn>().mockResolvedValue(null);

    queueSkillExtraction('sess-cool-c', distillC);
    expect(distillC).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 60)); // past the 50ms test cooldown

    queueSkillExtraction('sess-cool-d', distillD);
    expect(distillD).toHaveBeenCalledTimes(1);
  });
});
