/**
 * Unify-3 — agent_profile_sync derives skill allowlists from the LIVE fork skill
 * set, not just the hand-kept WORKFLOW_CHAIN_SKILLS constant.
 *
 * Guarantees:
 *  - a derived allowlist is intersected with the fork's live `GET /skill` names,
 *    so a renamed/removed engine skill is DROPPED rather than persisted as a dead
 *    name (the #775 hazard: a dead name silently scopes to nothing);
 *  - unknown agents stay fail-open (null = unrestricted);
 *  - when the engine is unavailable (live set empty) the derivation falls back to
 *    the static map unchanged — it never empties a scope just because the engine
 *    was momentarily down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import type { SdkAgent } from '@opencode-ai/sdk';

const listSkills = vi.fn();

vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
  },
  opencodeSessionMap: new Map(),
}));

// Imported AFTER the mock is registered.
import { syncOpencodeAgentProfiles } from '../agent_profile_sync';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function ocAgent(name: string, mode: 'primary' | 'subagent' = 'subagent'): SdkAgent {
  return { name, mode, builtIn: false } as unknown as SdkAgent;
}

describe('agent_profile_sync — live skill-name alignment (Unify-3)', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    vi.clearAllMocks();
  });

  it('intersects a derived allowlist with the live set, dropping dead names', async () => {
    // Live fork knows only two of the workflow-chain skills.
    listSkills.mockResolvedValue([
      { name: 'planning-agent', location: '/x/planning-agent/SKILL.md' },
      { name: 'coding-agent', location: '/x/coding-agent/SKILL.md' },
    ]);

    await syncOpencodeAgentProfiles([ocAgent('workflow-orchestrator', 'primary')]);

    const row = repo.getById('workflow-orchestrator')!;
    const names = JSON.parse(row.allowedSkillsJson!) as string[];
    // Only the live names survive — every dead workflow-chain name is dropped.
    expect(new Set(names)).toEqual(new Set(['planning-agent', 'coding-agent']));
    expect(names).not.toContain('verification-gate'); // absent from the live set
  });

  it('keeps an unknown agent fail-open (null allowlist)', async () => {
    listSkills.mockResolvedValue([
      { name: 'planning-agent', location: '/x/planning-agent/SKILL.md' },
    ]);

    await syncOpencodeAgentProfiles([ocAgent('totally-unknown-agent')]);

    const row = repo.getById('totally-unknown-agent')!;
    expect(row.allowedSkillsJson).toBeNull();
  });

  it('falls back to the static derivation when the engine is unavailable (empty live set)', async () => {
    listSkills.mockResolvedValue([]); // engine down → no filtering

    await syncOpencodeAgentProfiles([ocAgent('coding-agent')]);

    const row = repo.getById('coding-agent')!;
    // coding-agent's static map entry is preserved verbatim (not emptied).
    const names = JSON.parse(row.allowedSkillsJson!) as string[];
    expect(names).toContain('coding-agent');
    expect(names).toContain('acceptance-contract');
  });
});
