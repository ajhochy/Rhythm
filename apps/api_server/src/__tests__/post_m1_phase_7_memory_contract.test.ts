import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { UsersRepository } from '../repositories/users_repository';

describe('post-m1 Phase 7 canonical memory persistence contract', () => {
  let db: Database.Database;
  let repo: AgentMemoryRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentMemoryRepository();
  });

  afterEach(() => db.close());

  it('post-m1-p7-c1c-api: owner-scoped list/search preserve canonical IDs and instance-global retrieval policy', async () => {
    // Regression caught: owner predicates leak a private row or hide the explicitly global owner-null row.
    const users = new UsersRepository();
    const ownerUser = users.create({ name: 'Phase 7 owner', email: 'phase-7-memory-owner@example.invalid' });
    const foreignUser = users.create({ name: 'Phase 7 foreign', email: 'phase-7-memory-foreign@example.invalid' });
    const owner = await repo.createAsync({
      kind: 'context',
      content: 'phase-seven-owner-canary',
      source: 'agent',
      sourceId: 'session-owner-7',
      tagsJson: '["phase-7"]',
      autoInjectable: true,
      ownerUserId: ownerUser.id,
    });
    const foreign = await repo.createAsync({
      kind: 'fact',
      content: 'phase-seven-foreign-canary',
      source: 'agent',
      sourceId: 'session-foreign-8',
      ownerUserId: foreignUser.id,
    });
    const global = await repo.createAsync({
      kind: 'project',
      content: 'phase-seven-global-canary',
      source: 'obsidian-memory',
      sourceId: 'project/phase-seven.md',
    });

    const ownerRows = await repo.listAsync(ownerUser.id, undefined, 20);
    expect(ownerRows.map((row) => row.id)).toEqual(expect.arrayContaining([owner.id, global.id]));
    expect(ownerRows.map((row) => row.id)).not.toContain(foreign.id);
    await expect(repo.searchAsync('phase-seven-owner-canary', ownerUser.id)).resolves.toMatchObject([{ id: owner.id }]);
    await expect(repo.searchAsync('phase-seven-foreign-canary', ownerUser.id)).resolves.toEqual([]);

    expect(owner).toMatchObject({
      id: expect.any(String),
      kind: 'context',
      content: 'phase-seven-owner-canary',
      source: 'agent',
      sourceId: 'session-owner-7',
      tagsJson: '["phase-7"]',
      status: 'stable',
      staleAfter: null,
      verifiedJson: '[]',
      sourcesJson: '[]',
      generatedBy: null,
      generatedAt: null,
      trustTier: 'unverified',
      autoInjectable: true,
      ownerUserId: ownerUser.id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      lifecycleState: 'active',
      unverifiable: true,
    });
  });
});
