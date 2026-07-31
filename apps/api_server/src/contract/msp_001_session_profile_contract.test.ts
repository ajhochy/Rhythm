import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  asOpenCodeAgentId,
  asRhythmProfileId,
} from '../models/agent_session';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

function freshRepository(): AgentSessionsRepository {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return new AgentSessionsRepository();
}

describe('MSP-001 authoritative session/profile contract', () => {
  let repository: AgentSessionsRepository;

  beforeEach(() => {
    repository = freshRepository();
  });

  it('issue-1-c1: profile and OpenCode agent identifiers remain distinct', () => {
    // Regression caught: a UUID Rhythm profile is overwritten by its engine
    // agent handle, making later hydration unable to identify the profile.
    const inserted = repository.insert({
      agentKind: 'codex',
      profileId: asRhythmProfileId('profile-coding-workflow'),
      opencodeAgentId: asOpenCodeAgentId('build'),
      taskId: null,
      cwd: '/tmp/msp-001',
      name: 'Distinct identities',
    });

    expect(inserted).toMatchObject({
      profileId: 'profile-coding-workflow',
      opencodeAgentId: 'build',
    });
    expect(inserted.profileId).not.toBe(inserted.opencodeAgentId);
  });

  it('issue-1-c2: repository persists and hydrates authoritative session execution state', () => {
    // Regression caught: reopening a session returns null/default state, so the
    // phone silently reuses its last global profile/model selection.
    const inserted = repository.insert({
      agentKind: 'codex',
      profileId: asRhythmProfileId('profile-research'),
      opencodeAgentId: asOpenCodeAgentId('research'),
      taskId: null,
      cwd: '/tmp/msp-001',
      name: 'Pinned state',
    });
    repository.updateFields(inserted.id, {
      providerId: 'openai',
      modelId: 'gpt-5.6-terra',
      thinkingBudget: 8192,
      permissionMode: 'plan',
    });

    const rehydrated = new AgentSessionsRepository().findById(inserted.id);
    expect(rehydrated).toMatchObject({
      profileId: 'profile-research',
      opencodeAgentId: 'research',
      providerId: 'openai',
      modelId: 'gpt-5.6-terra',
      thinkingBudget: 8192,
      permissionMode: 'plan',
    });
  });

  it('issue-1-c3: mobile-created session reconciliation persists engine and Rhythm identities', async () => {
    // Regression caught: session.list reconciliation stores only title/cwd,
    // leaving profile, agent, provider, and model empty after a refresh.
    const projectId = new ProjectsRepository().insert({
      name: 'MSP-001 project',
      cwd: '/tmp',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
    const ownerUserId = new UsersRepository().create({
      name: 'MSP-001 owner',
      email: 'msp-001-reconcile@example.com',
    }).id;
    new AgentConfigsRepository().insert({
      id: 'profile-coding-workflow',
      label: 'Coding Workflow',
      icon: 'terminal',
      enabled: true,
      sessionSelectable: true,
      ocAgent: 'build',
    });
    const proxy = new MobileOpenCodeProxy({
      ownershipRepository: {
        isResourceOwnedBy: () => true,
        isResourceExplicitlyOwnedBy: () => true,
        claimResource: () => true,
        releaseResource: () => true,
      },
      fetchFn: async () => new Response(JSON.stringify({
        id: 'ses_mobile_msp_001',
        title: 'Mobile-created',
        agent: 'build',
        model: {
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4-5',
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const response = await proxy.forward({
      method: 'POST',
      path: '/session',
      query: new URLSearchParams(),
      body: { title: 'Mobile-created' },
      project: { id: projectId, root: '/tmp' },
      userId: ownerUserId,
    });
    const reconciled = repository.findBySdkSessionId(
      'ses_mobile_msp_001',
    );

    expect(reconciled).toMatchObject({
      profileId: 'profile-coding-workflow',
      opencodeAgentId: 'build',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    expect(JSON.parse(Buffer.from(response.body).toString('utf8')))
      .toMatchObject({
        rhythm: {
          profileId: 'profile-coding-workflow',
          opencodeAgentId: 'build',
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
        },
      });
  });

  it('issue-1-c8: additive nullable profile migration is idempotent with Postgres parity', () => {
    // Regression caught: SQLite has profile_id while Postgres bootstrap omits
    // it (production 500), or a second migration run tries to add it again.
    runMigrations(getDb());
    const columns = getDb()
      .pragma('table_info(agent_sessions)') as Array<{
        name: string;
        notnull: number;
      }>;
    expect(columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'profile_id', notnull: 0 }),
    ]));

    const postgresBootstrap = readFileSync(
      resolve(__dirname, '../database/postgres_bootstrap.ts'),
      'utf8',
    );
    expect(postgresBootstrap).toMatch(
      /ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS profile_id TEXT/,
    );
  });
});
