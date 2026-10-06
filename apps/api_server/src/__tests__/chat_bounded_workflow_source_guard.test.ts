import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { WorkstreamArtifactAuthorityResolver } from '../services/workstream_artifact_verifier';

let root: string;
let db: Database.Database;
let previousSubdir: string | undefined;
afterEach(() => { if (previousSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR; else process.env.MEMORY_VAULT_SUBDIR = previousSubdir; vi.restoreAllMocks(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
it('holds a grown source before the synchronous file read, and rejects index or database drift', async () => {
  previousSubdir = process.env.MEMORY_VAULT_SUBDIR; process.env.MEMORY_VAULT_SUBDIR = '';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-workflow-source-proof-'));
  db = new Database(':memory:'); runMigrations(db); setDb(db);
  const raw = '---\nkind: fact\nstatus: stable\n---\nAn invented owner and deadline.\n';
  const source = path.join(root, 'note.md'); fs.writeFileSync(source, raw);
  const memory = await new AgentMemoryRepository().createAsync({ kind: 'fact', content: 'An invented owner and deadline.',
    source: 'obsidian-memory', sourceId: 'note.md' });
  const resolver = new WorkstreamArtifactAuthorityResolver({ memoryRoot: () => root });
  const resolved = await resolver.resolveReference({ ownerUserId: 1, projectId: 'project-source-guard', workstreamId: 'proposal',
    workstreamRevision: 1, reference: { sourceId: `memory:${memory.id}`, expectedVersion: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
      scope: 'project-source-guard', provenance: 'user_reference' } });
  expect(resolved.isCurrent?.()).toBe(true);
  fs.appendFileSync(source, 'grew');
  const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Error('source must not be read after size drift'); });
  expect(resolved.isCurrent?.()).toBe(false);
  expect(read).not.toHaveBeenCalled();
  read.mockRestore(); fs.writeFileSync(source, raw);
  db.prepare("UPDATE agent_memory SET status='deprecated' WHERE id=?").run(memory.id);
  expect(resolved.isCurrent?.()).toBe(false);
  db.prepare("UPDATE agent_memory SET status='stable' WHERE id=?").run(memory.id);
  expect(resolved.isCurrent?.()).toBe(true);
  setDb(new Database(':memory:'));
  expect(resolved.isCurrent?.()).toBe(false);
});
