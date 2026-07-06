/**
 * CONTRACT TESTS — Issue #883: secretary → specialist delegation authorization.
 *
 * Proves `agent_delegation_service.delegateToAgent` authorizes secretary
 * (once seeded via `secretary_delegation_seed.ts` from the real
 * `.mcp-roles/secretary.mcp.json`) to delegate to EVERY member of its
 * roster, and that the non-manager rejection path is unaffected (regression).
 *
 * Real in-memory SQLite + real repositories + real seed against the actual
 * `.mcp-roles/secretary.mcp.json` file (no fixture substitution) — proves the
 * shipped role file's roster is genuinely authorized end-to-end through
 * `agent_delegation_service.ts`, not just persisted as JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentKind } from '../models/agent_session';
import { delegateToAgent } from '../services/agent_delegation_service';
import { seedSecretaryDelegation } from '../services/secretary_delegation_seed';

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}));

vi.mock('../services/agent_runner', () => ({
  run: runMock,
}));

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REAL_SECRETARY_ROLE_FILE = path.join(REPO_ROOT, '.mcp-roles', 'secretary.mcp.json');

function realRoster(): string[] {
  const raw = JSON.parse(readFileSync(REAL_SECRETARY_ROLE_FILE, 'utf8'));
  return raw.allowedDelegates as string[];
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('secretary → roster delegation authorization (#883)', () => {
  let repo: AgentConfigsRepository;
  let sessionRepo: AgentSessionsRepository;

  function seedCallerSession(profileId: string): string {
    return sessionRepo.insert({
      agentKind: profileId as AgentKind,
      taskId: null,
      cwd: process.cwd(),
      name: `${profileId} session`,
      mcpRole: profileId,
    }).id;
  }

  beforeEach(async () => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    sessionRepo = new AgentSessionsRepository();

    // Mirrors what agent_profile_sync.syncOpencodeAgentProfiles actually
    // creates in a real deployment: slug-keyed rows (id = opencode agent
    // name), enabled + isAgent, is_manager/allowed_delegates_json still null
    // (the importer never sets these — see agent_profile_sync.ts's
    // "is_manager decoupling" invariant).
    repo.insert({ id: 'secretary', label: 'Secretary', icon: '', isAgent: true });
    for (const delegateId of realRoster()) {
      repo.insert({ id: delegateId, label: delegateId, icon: '', isAgent: true });
    }
    // Also a profile NOT in the roster, to prove the negative case.
    repo.insert({ id: 'unrelated-specialist', label: 'Unrelated', icon: '', isAgent: true });

    // This is the fix under test: backfill is_manager + allowed_delegates_json
    // from the real role file, exactly as agent_profile_sync.ts now does at
    // the end of every syncOpencodeAgentProfiles pass.
    await seedSecretaryDelegation();

    runMock.mockReset();
    runMock.mockResolvedValue({
      sessionId: 'delegate-session',
      status: 'done',
      result: 'delegated result',
    });
  });

  it('secretary is a manager after seeding', () => {
    const secretary = repo.getById('secretary')!;
    expect(secretary.isManager).toBe(true);
    expect(secretary.allowedDelegatesJson).not.toBeNull();
  });

  it('secretary can delegate to every roster member from the real role file', async () => {
    const roster = realRoster();
    expect(roster.length).toBeGreaterThan(0);

    for (const delegateId of roster) {
      const result = await delegateToAgent({
        callerSessionId: seedCallerSession('secretary'),
        targetAgentConfigId: delegateId,
        prompt: `Handle this ${delegateId} task.`,
      });
      expect(result).toMatchObject({
        sessionId: 'delegate-session',
        output: 'delegated result',
        targetAgentConfigId: delegateId,
      });
    }
    expect(runMock).toHaveBeenCalledTimes(roster.length);
  });

  it('rejects delegation to a profile NOT in the roster', async () => {
    await expect(
      delegateToAgent({
        callerSessionId: seedCallerSession('secretary'),
        targetAgentConfigId: 'unrelated-specialist',
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('regression: a non-manager profile still cannot delegate, even to a roster member', async () => {
    repo.insert({
      id: 'plain-agent',
      label: 'Plain Agent',
      icon: '',
      isAgent: true,
      isManager: false,
      allowedDelegatesJson: JSON.stringify(realRoster()),
    });

    await expect(
      delegateToAgent({
        callerSessionId: seedCallerSession('plain-agent'),
        targetAgentConfigId: realRoster()[0],
        prompt: 'Do this.',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(runMock).not.toHaveBeenCalled();
  });
});
