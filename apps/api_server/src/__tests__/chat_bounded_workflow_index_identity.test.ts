import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { MemoryIndexService } from '../services/memory_index_service';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { WorkstreamArtifactAuthorityResolver } from '../services/workstream_artifact_verifier';

let db: Database.Database;
let root: string;
let previousSubdir: string | undefined;
beforeEach(() => {
  previousSubdir = process.env.MEMORY_VAULT_SUBDIR;
  process.env.MEMORY_VAULT_SUBDIR = '';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-index-identity-'));
  db = new Database(':memory:'); runMigrations(db); setDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = previousSubdir;
  fs.rmSync(root, { recursive: true, force: true });
});

it('holds a colliding prior UUID without associating it with the freshly rebuilt note', async () => {
  fs.writeFileSync(path.join(root, 'note.md'), 'An invented note.');
  const index = new MemoryIndexService();
  await index.rebuildIndexFromVault(root);
  const before = db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get() as { id: string };
  const upsert = index.upsertNote.bind(index);
  vi.spyOn(index, 'upsertNote').mockImplementation(async note => {
    await upsert(note);
    db.prepare('INSERT INTO agent_memory(id,kind,content,source,source_id) VALUES(?,?,?,?,?)')
      .run(before.id, 'fact', 'Invented collision.', 'invented-collision', 'other.md');
  });
  await expect(index.rebuildIndexFromVault(root)).rejects.toThrow('identity collides');
  expect(db.prepare('SELECT source,source_id FROM agent_memory WHERE id=?').get(before.id))
    .toEqual({ source: 'invented-collision', source_id: 'other.md' });
  expect((db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get() as { id: string }).id).not.toBe(before.id);
});

it('preserves one canonical UUID across rebuild and still holds an approved old source version after file change', async () => {
  const raw = '---\nkind: fact\nstatus: stable\n---\nAn invented owner and deadline.\n';
  const file = path.join(root, 'note.md'); fs.writeFileSync(file, raw);
  const index = new MemoryIndexService();
  await index.rebuildIndexFromVault(root);
  const before = db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get() as { id: string };
  const reference = { sourceId: `memory:${before.id}`, expectedVersion: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    scope: 'project-index-proof', provenance: 'user_reference' as const };
  const resolver = new WorkstreamArtifactAuthorityResolver({ memoryRoot: () => root });
  const resolve = () => resolver.resolveReference({ ownerUserId: 1, projectId: reference.scope,
    workstreamId: 'proposal', workstreamRevision: 1, reference });
  expect((await resolve()).eligible).toBe(true);
  await index.rebuildIndexFromVault(root);
  expect(db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get()).toEqual(before);
  expect((await resolve()).eligible).toBe(true);
  fs.writeFileSync(file, raw.replace('owner and deadline', 'revised owner and deadline'));
  await index.rebuildIndexFromVault(root);
  expect(db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get()).toEqual(before);
  expect((await resolve()).eligible).toBe(false);
});

it('does not select an ambiguous prior UUID or carry an owner-scoped UUID into the global index', async () => {
  fs.writeFileSync(path.join(root, 'note.md'), 'Invented note.');
  const repo = new AgentMemoryRepository();
  const first = await repo.createAsync({ kind: 'fact', content: 'First.', source: 'obsidian-memory', sourceId: 'note.md' });
  const second = await repo.createAsync({ kind: 'fact', content: 'Second.', source: 'obsidian-memory', sourceId: 'note.md' });
  await new MemoryIndexService().rebuildIndexFromVault(root);
  const rebuilt = db.prepare("SELECT id FROM agent_memory WHERE source_id='note.md'").get() as { id: string };
  expect([first.id, second.id]).not.toContain(rebuilt.id);
  db.prepare('INSERT INTO users(id,name,email) VALUES(7,?,?)').run('Invented other owner','other@example.invalid');
  db.prepare('UPDATE agent_memory SET owner_user_id=7 WHERE id=?').run(rebuilt.id);
  await new MemoryIndexService().rebuildIndexFromVault(root);
  const global = db.prepare("SELECT id,owner_user_id FROM agent_memory WHERE source_id='note.md'").get() as { id: string; owner_user_id: number | null };
  expect(global.id).not.toBe(rebuilt.id);
  expect(global.owner_user_id).toBeNull();
});
