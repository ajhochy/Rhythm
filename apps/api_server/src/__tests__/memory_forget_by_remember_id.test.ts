/**
 * CONTRACT TEST — Issue #859d (forget-404 bug): `DELETE /agent-memory/:id`
 * (agentMemoryService.forget) must resolve by the id `remember` RETURNS to its
 * caller — the frontmatter ULID (`RememberResult.id`) — not only the derived
 * SQLite index row's internal `agent_memory.id` (a separate randomUUID minted
 * by `AgentMemoryRepository.upsertBySourceAsync`).
 *
 * Prior bug: `rememberToVault` returns `{ id: <ULID>, path, kind }`, but
 * `agentMemoryService.forget(id)` only calls `memRepo.findByIdAsync(id)`,
 * which looks up the DB row's OWN randomly generated id — a completely
 * different string. A caller (e.g. the `rhythm_forget_memory` MCP tool) that
 * naively forgets using the id `remember` just gave it therefore always 404s.
 *
 * Real in-memory SQLite + real FS temp dir. No module mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { agentMemoryService } from '../services/agentMemoryService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

function fileFor(rel: string): string {
  return path.join(vaultRoot, rel);
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memforget-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('forget resolves by the id remember() returns (#859d)', () => {
  it('forgets successfully using the ULID from RememberResult.id (the frontmatter id), not just the DB row id', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Forget-by-remember-id regression marker.' },
      { memoryDir, index },
    );

    // Sanity: the ULID is NOT the same string as the DB row id (proves this
    // isn't accidentally passing because they happen to match).
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(result.id);

    // The bug: calling forget with the id `remember` returned used to 404
    // (findByIdAsync looked up the wrong id space). It must now succeed.
    const deleted = await agentMemoryService.forget(result.id, { memoryDir, index });
    expect(deleted).toBe(true);

    expect(existsSync(fileFor(result.path))).toBe(false);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('still forgets successfully using the DB row id (back-compat, no regression)', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Forget-by-db-id regression marker.' },
      { memoryDir, index },
    );
    const rows = await repo.listAsync(undefined, undefined, 100);
    const dbId = rows[0].id;

    const deleted = await agentMemoryService.forget(dbId, { memoryDir, index });
    expect(deleted).toBe(true);
    expect(existsSync(fileFor(result.path))).toBe(false);
  });

  it('an id matching neither the ULID nor a DB row is still a safe no-op (false)', async () => {
    await rememberToVault({ kind: 'fact', content: 'Untouched marker.' }, { memoryDir, index });
    const deleted = await agentMemoryService.forget('totally-unknown-id', { memoryDir, index });
    expect(deleted).toBe(false);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });
});
