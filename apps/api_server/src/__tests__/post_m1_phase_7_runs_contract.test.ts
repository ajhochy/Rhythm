import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentCapabilityGapsRepository } from '../repositories/agent_capability_gaps_repository';
import { AgentResearchRepository } from '../repositories/agent_research_repository';
import { UsersRepository } from '../repositories/users_repository';
import { runGapDrivenDiscoveryPass } from '../services/gap_discovery_scheduler';
import { getRunQualityRollup } from '../services/run_quality_service';

describe('post-m1 Phase 7 research, quality, and bounded-discovery contracts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    env.researchProjectsEnabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RHYTHM_GAP_DISCOVERY_MAX_GAPS_PER_PASS;
    db.close();
  });

  it('post-m1-p7-c2a-api: owner-scoped project CRUD preserves the canonical project vocabulary', async () => {
    // Regression caught: a project loses nested configuration or becomes visible to another owner.
    const users = new UsersRepository();
    const owner = users.create({ name: 'Phase 7 owner', email: 'phase-7-owner@example.invalid' });
    const foreign = users.create({ name: 'Phase 7 foreign', email: 'phase-7-foreign@example.invalid' });
    const repo = new AgentResearchRepository();
    const input = {
      name: 'Phase 7 research',
      question: 'Which evidence survives?',
      goals: ['Preserve evidence'],
      domain: 'operations',
      profileId: 'research',
      passConfig: [{ role: 'evidence', profileId: 'research' }],
      modelPolicy: { default: 'openai/gpt-5.6-terra' },
      criticConfig: { enabled: true },
      synthesisConfig: { enabled: true },
      scheduleRef: null,
      budget: { maxPasses: 1, maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
    };

    const created = await repo.createProject(owner.id, input);
    expect(created).toMatchObject({ ...input, id: expect.any(String), ownerUserId: owner.id, archivedAt: null });
    await expect(repo.listProjects(foreign.id)).resolves.toEqual([]);
    const updated = await repo.updateProject(created.id, owner.id, { name: 'Phase 7 research updated' });
    expect(updated).toMatchObject({ ...input, name: 'Phase 7 research updated', id: created.id, ownerUserId: owner.id });
    const archived = await repo.archiveProject(created.id, owner.id);
    expect(archived?.archivedAt).toEqual(expect.any(String));
  });

  it('post-m1-p7-c2i-api: owner-scoped run-quality keeps thin-history rates null and counts unmeasured runs', () => {
    // Regression caught: unknown outcomes silently become successes or null rates become fixture percentages.
    const owner = new UsersRepository().create({
      name: 'Phase 7 quality owner',
      email: 'phase-7-quality-owner@example.invalid',
    });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_sessions
      (id, task_id, task_title, agent_kind, status, cwd, name, owner_user_id, created_at, updated_at)
      VALUES ('phase-7-working', NULL, NULL, 'research', 'working', '/tmp', 'working', ?, ?, ?)`)
      .run(owner.id, now, now);
    db.prepare(`INSERT INTO agent_sessions
      (id, task_id, task_title, agent_kind, status, cwd, name, owner_user_id, created_at, updated_at)
      VALUES ('phase-7-unknown', NULL, NULL, 'research', 'idle', '/tmp', 'unknown', ?, ?, ?)`)
      .run(owner.id, now, now);

    const rollup = getRunQualityRollup({ ownerUserId: owner.id, windowDays: 30 });
    expect(rollup.agents).toHaveLength(1);
    expect(rollup.agents[0]).toMatchObject({
      agentKind: 'research',
      notEnoughData: true,
      completionRate: null,
      escalationRate: null,
      inProgressRuns: 1,
      unmeasuredRuns: 0,
      totalTokens: expect.any(Number),
      wastedTokens: expect.any(Number),
      totalUserCorrections: expect.any(Number),
      repeatedMistakes: expect.any(Array),
    });
  });

  it('post-m1-p7-c3d: gap discovery is role-gated and exposes bounded skip evidence', async () => {
    // Regression caught: a copied backlog fans out without role gating or a maxGapsPerPass bound.
    env.agentExecutionEnabled = false;
    await expect(runGapDrivenDiscoveryPass()).resolves.toMatchObject({
      gapsConsidered: 0,
      skipped: true,
      skippedReason: expect.any(String),
      errored: false,
    });

    env.agentExecutionEnabled = true;
    process.env.RHYTHM_GAP_DISCOVERY_MAX_GAPS_PER_PASS = '1';
    const gaps = new AgentCapabilityGapsRepository();
    await gaps.insertIfAbsentAsync({ intentTitle: 'Phase 7 gap one', intentTags: ['phase-7'] });
    await gaps.insertIfAbsentAsync({ intentTitle: 'Phase 7 gap two', intentTags: ['phase-7'] });
    const result = await runGapDrivenDiscoveryPass({ discoverCandidates: vi.fn().mockResolvedValue([]) });
    expect(result).toMatchObject({
      gapsConsidered: 1,
      skipped: false,
      errored: false,
    });
  });
});
