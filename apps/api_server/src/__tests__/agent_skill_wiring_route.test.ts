/**
 * Route test for issue #958 — GET /agent-configs/skill-wiring lint surface.
 *
 * Drives the real Express app (via startTestServer) with a mocked opencode
 * engine so the live skill set is controllable. Asserts the observable HTTP
 * outcome: an agent whose body references a skill outside its allowlist / not
 * enabled is reported; a correctly-wired agent is not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// The lint route mounts under the auth-gated /agent-configs router; the real
// server runs with AGENT_LOCAL=true (localhost auth bypass). Set it before any
// import pulls config/env.ts so env.agentLocal is true at router-module load.
vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
});
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { startTestServer } from './helpers/real_server';

const listSkills = vi.fn();
let mockIsReady = true;

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listSkills: (...a: unknown[]) => listSkills(...a),
      reloadSkills: vi.fn().mockResolvedValue([]),
    };
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

interface Mismatch {
  agentId: string;
  skillName: string;
  reasons: string[];
}
interface LintReport {
  engineAvailable: boolean;
  liveSkillCount: number;
  checkedAgents: number;
  mismatchCount: number;
  mismatches: Mismatch[];
}

describe('GET /agent-configs/skill-wiring (#958)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    mockIsReady = true;
    listSkills.mockReset();
    listSkills.mockResolvedValue([
      { name: 'coding-agent', location: 'x' },
      { name: 'obsidian-cli', location: 'x' },
    ]);
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('flags an agent whose body references a skill outside its allowlist AND not enabled', async () => {
    const repo = new AgentConfigsRepository();
    repo.insert({
      id: 'ai-trend',
      label: 'AI Trend',
      icon: 'x',
      systemPrompt: 'Load and follow the `ai-trend` skill for the scan.',
      allowedSkillsJson: JSON.stringify(['obsidian-cli']),
    });

    const res = await fetch(`${baseUrl}/agent-configs/skill-wiring`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LintReport;

    expect(body.engineAvailable).toBe(true);
    expect(body.liveSkillCount).toBe(2);
    const m = body.mismatches.find((x) => x.agentId === 'ai-trend' && x.skillName === 'ai-trend');
    expect(m).toBeDefined();
    expect(m!.reasons.sort()).toEqual(['not-enabled', 'not-in-allowlist']);
  });

  it('does not flag a correctly-wired agent (reference in allowlist + live)', async () => {
    const repo = new AgentConfigsRepository();
    repo.insert({
      id: 'coder',
      label: 'Coder',
      icon: 'x',
      systemPrompt: 'Load the `coding-agent` skill first.',
      allowedSkillsJson: JSON.stringify(['coding-agent']),
    });

    const res = await fetch(`${baseUrl}/agent-configs/skill-wiring`);
    const body = (await res.json()) as LintReport;
    expect(body.mismatches.some((x) => x.agentId === 'coder')).toBe(false);
  });

  it('engine down → report still returns, not-enabled check skipped', async () => {
    mockIsReady = false;
    const repo = new AgentConfigsRepository();
    repo.insert({
      id: 'ai-trend',
      label: 'AI Trend',
      icon: 'x',
      systemPrompt: 'Load and follow the `ai-trend` skill.',
      allowedSkillsJson: JSON.stringify(['obsidian-cli']),
    });

    const res = await fetch(`${baseUrl}/agent-configs/skill-wiring`);
    const body = (await res.json()) as LintReport;
    expect(body.engineAvailable).toBe(false);
    expect(body.liveSkillCount).toBe(0);
    const m = body.mismatches.find((x) => x.agentId === 'ai-trend' && x.skillName === 'ai-trend');
    expect(m).toBeDefined();
    // Only the allowlist gap is judgeable when the engine is down.
    expect(m!.reasons).toEqual(['not-in-allowlist']);
  });
});
