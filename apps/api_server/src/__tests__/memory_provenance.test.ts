/**
 * CONTRACT TESTS — Issue #862 (memory trust, part 2): explain-which-memories.
 *
 * Capture the top-5 injected memory IDs for a turn (the engine memory
 * injection path — `buildMemoryPreface` called from `ws_gateway.ts` /
 * `agent_runner.ts`) and expose them via
 * `AgentSessionMemoryProvenanceRepository` so the desktop app can render
 * "Memories used in this reply: …". When no memories were used, the caller
 * must be able to state that clearly (an explicit empty-list record, not an
 * absent/ambiguous one).
 *
 * Real in-memory SQLite. No module mocks.
 *
 * Acceptance criteria proven here:
 *   AC1: recording provenance for a session, then reading it back, returns
 *        the same memory ids + note paths in order.
 *   AC2: a turn that injected NO memories is recorded as an explicit
 *        empty-list record (distinguishable from "no turn recorded yet").
 *   AC3: recording a second turn for the same session overwrites/replaces the
 *        first (provenance reflects the LATEST reply, not a growing log).
 *   AC4: a session with no recorded turn returns null (distinct from the
 *        empty-list case in AC2) — the caller can render "no data yet" vs.
 *        "this reply used no memories".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('agent session memory provenance (#862)', () => {
  it('AC1: records and reads back memory ids + note paths for a session turn', () => {
    const repo = new AgentSessionMemoryProvenanceRepository();
    repo.record('session-1', ['mem-a', 'mem-b'], ['memory/fact/a.md', 'memory/fact/b.md']);

    const result = repo.getLatest('session-1');
    expect(result).not.toBeNull();
    expect(result!.memoryIds).toEqual(['mem-a', 'mem-b']);
    expect(result!.notePaths).toEqual(['memory/fact/a.md', 'memory/fact/b.md']);
  });

  it('AC2: a turn with no memories injected is an explicit empty-list record', () => {
    const repo = new AgentSessionMemoryProvenanceRepository();
    repo.record('session-2', [], []);

    const result = repo.getLatest('session-2');
    expect(result).not.toBeNull();
    expect(result!.memoryIds).toEqual([]);
  });

  it('AC3: a second record() call for the same session replaces the first', () => {
    const repo = new AgentSessionMemoryProvenanceRepository();
    repo.record('session-3', ['mem-old'], ['memory/fact/old.md']);
    repo.record('session-3', ['mem-new'], ['memory/fact/new.md']);

    const result = repo.getLatest('session-3');
    expect(result!.memoryIds).toEqual(['mem-new']);
    expect(result!.notePaths).toEqual(['memory/fact/new.md']);
  });

  it('AC4: a session with no recorded turn returns null (distinct from an empty-list turn)', () => {
    const repo = new AgentSessionMemoryProvenanceRepository();
    const result = repo.getLatest('never-recorded-session');
    expect(result).toBeNull();
  });

  it('caps at 5 memory ids (top-5 per the injection contract)', () => {
    const repo = new AgentSessionMemoryProvenanceRepository();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    repo.record('session-cap', ids, ids.map((i) => `memory/fact/${i}.md`));
    const result = repo.getLatest('session-cap');
    expect(result!.memoryIds).toHaveLength(5);
    expect(result!.memoryIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
