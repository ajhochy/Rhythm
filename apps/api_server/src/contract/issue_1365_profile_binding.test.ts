import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { asOpenCodeAgentId, asRhythmProfileId } from '../models/agent_session';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { safeMobileSessionProfileState } from '../services/mobile_profile_catalog';
import { assertLiveE2EIsolation } from '../__tests__/_live_e2e_guard';

describe('issue #1365 stored profile binding contract', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  it('issue-1365-c3: mobile state reads the stored profile after refresh', () => {
    // Regression: mobile re-derives a global/default profile instead of using
    // the durable profile_id on the refreshed agent_sessions row.
    const configs = new AgentConfigsRepository();
    configs.insert({
      id: 'profile-coding',
      label: 'Coding',
      icon: 'terminal',
      enabled: true,
      sessionSelectable: true,
      ocAgent: 'build',
    });
    const sessions = new AgentSessionsRepository();
    const inserted = sessions.insert({
      agentKind: 'claude-code',
      profileId: asRhythmProfileId('profile-coding'),
      opencodeAgentId: asOpenCodeAgentId('build'),
      taskId: null,
      cwd: '/tmp/issue-1365',
      name: 'Desktop-created',
    });

    const refreshed = new AgentSessionsRepository().findById(inserted.id)!;
    expect(safeMobileSessionProfileState(refreshed, configs.list())).toMatchObject({
      profileId: 'profile-coding',
      opencodeAgentId: 'build',
      profileAvailability: 'available',
    });
  });
});

const describeLive = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const liveBase = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';

describeLive('issue #1365 live desktop-compatible create', () => {
  it('issue-1365-c4: a newly created session exposes its persisted profile', async () => {
    assertLiveE2EIsolation();
    const profileId = process.env.RHYTHM_LIVE_PROFILE_ID ?? 'secretary';
    const createdResponse = await fetch(`${liveBase}/agent-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profileId,
        cwd: '/tmp',
        name: 'Issue 1365 live profile binding',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; profileId: string | null };
    expect(created.profileId).toBe(profileId);

    const refreshedResponse = await fetch(`${liveBase}/agent-sessions/${created.id}`);
    expect(refreshedResponse.status).toBe(200);
    const refreshed = await refreshedResponse.json() as {
      session: { profileId: string | null };
    };
    expect(refreshed.session.profileId).toBe(profileId);

    await fetch(`${liveBase}/agent-sessions/${created.id}`, { method: 'DELETE' });
  });
});
