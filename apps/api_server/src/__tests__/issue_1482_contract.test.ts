/** Acceptance contract for #1482: false tighten-scope proposals. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { OrgAuditSnapshot, ProfileScopeSnapshot } from '../services/org_audit_service';

const listMcp = vi.fn();
const listMcpToolIds = vi.fn();
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: (...args: unknown[]) => listMcp(...args),
    listMcpToolIds: (...args: unknown[]) => listMcpToolIds(...args),
    listSkills: (...args: unknown[]) => listSkills(...args),
  },
  opencodeSessionMap: new Map(),
}));

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  listMcp.mockReset().mockResolvedValue({ obsidian: { status: 'connected' } });
  listMcpToolIds.mockReset().mockResolvedValue(['obsidian_obsidian_simple_search']);
  listSkills.mockReset().mockResolvedValue([]);
});

function completedToolPart(tool: string, messageID: string) {
  return {
    type: 'tool',
    id: `prt_${tool}`,
    sessionID: 'ses_delegated_child',
    messageID,
    callID: `call_${tool}`,
    tool,
    state: {
      status: 'completed',
      input: {},
      output: 'ok',
      title: tool,
      metadata: {},
      time: { start: 0, end: 1 },
    },
  };
}

function profile(overrides: Partial<ProfileScopeSnapshot>): ProfileScopeSnapshot {
  return {
    id: 'theologian',
    label: 'Theologian',
    isManager: false,
    enabled: true,
    allowedMcps: ['obsidian'],
    mcpScopeShape: 'servers',
    allowedMcpTools: { obsidian: [] },
    allowedSkills: [],
    allowedDelegates: [],
    ...overrides,
  };
}

function snapshot(profiles: ProfileScopeSnapshot[], serverNames: string[]): OrgAuditSnapshot {
  return {
    auditRunId: 'issue-1482',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles,
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: [],
    drift: [],
    gaps: serverNames.map((serverName) => ({
      gapId: `gap-${serverName}`,
      kind: 'tighten-scope' as const,
      evidence: `profile=theologian neverInvokedTool=${serverName} sessionCount=10 observationDays=30`,
    })),
    workflowFailureSignals: [],
  };
}

describe('issue-1482-c1: the floor and usage evidence use the same sessions', () => {
  it('attributes successful usage from legacy agentKind delegated-child sessions', async () => {
    // Regression caught: agentKind children cleared the floor but their tool calls were invisible.
    const configs = new AgentConfigsRepository();
    configs.insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      allowedMcpsJson: JSON.stringify({ obsidian: ['obsidian_simple_search'] }),
    });
    const sessions = new AgentSessionsRepository();
    const messages = new AgentSessionMessagesRepository();
    const parent = sessions.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    for (let index = 0; index < 10; index++) {
      const child = sessions.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `delegated-child-${index}`,
      });
      getDb()
        .prepare(`UPDATE agent_sessions SET parent_session_id = ?, agent_kind = ? WHERE id = ?`)
        .run(parent.id, 'theologian', child.id);
      sessions.updateStatus(child.id, 'idle');
      const messageID = `msg_child_${index}`;
      messages.upsertStructured(
        child.id,
        messageID,
        'output',
        JSON.stringify(index === 0 ? [completedToolPart('obsidian_simple_search', messageID)] : []),
        null,
        null,
      );
    }

    const { resolveExercisedTools } = await import('../services/org_exercised_tools_resolver');
    const telemetry = await resolveExercisedTools('theologian', undefined, ['obsidian']);
    expect(telemetry.availability).toBe('available');
    expect(telemetry.canonicalServerIds).toEqual(new Set(['obsidian']));
  });
});

describe('issue-1482-c2: prompt requirement matching is case-insensitive and alias-aware', () => {
  it('blocks tighten proposals for capitalization and hyphen/suffix aliases', async () => {
    // Regression caught: includes('obsidian') missed "Obsidian" and server-id aliases.
    const configs = new AgentConfigsRepository();
    configs.insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      systemPrompt: 'Read Obsidian folders and prepare NFL analysis.',
      allowedMcpsJson: JSON.stringify(['obsidian', 'nfl-mcp']),
    });
    const created: unknown[] = [];
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');
    await generateScopeHygieneProposals(
      snapshot([profile({ allowedMcps: ['obsidian', 'nfl-mcp'] })], ['obsidian', 'nfl-mcp']),
      {
        proposalsRepo: {
          existsByDedupKeyAsync: async () => false,
          createAsync: async (input) => { created.push(input); return input as never; },
        },
      },
    );
    expect(created).toEqual([]);
  });
});

describe('issue-1482-c3: skills and explicit tool maps establish profile intent', () => {
  it('blocks tighten proposals when an allowed skill names the server or its tools-map is explicit', async () => {
    // Regression caught: the guard ignored already-loaded skill bodies and explicit narrowed grants.
    const skills = new AgentSkillsRepository();
    skills.create({ title: 'PDF study', body: 'Read the PDF_TOOLS library.', source: 'user' });
    const configs = new AgentConfigsRepository();
    configs.insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      systemPrompt: 'Prepare study notes.',
      allowedSkillsJson: JSON.stringify(['PDF study']),
      allowedMcpsJson: JSON.stringify(['pdf-tools']),
    });
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');
    const skillProtected: unknown[] = [];
    await generateScopeHygieneProposals(
      snapshot([
        profile({
          allowedMcps: ['pdf-tools'],
          allowedSkills: ['PDF study'],
        }),
      ], ['pdf-tools']),
      {
        proposalsRepo: {
          existsByDedupKeyAsync: async () => false,
          createAsync: async (input) => { skillProtected.push(input); return input as never; },
        },
      },
    );
    expect(skillProtected).toEqual([]);

    configs.update('theologian', {
      allowedSkillsJson: JSON.stringify([]),
      allowedMcpsJson: JSON.stringify({ 'pdf-tools': ['list_pdfs'] }),
    });
    const mapProtected: unknown[] = [];
    await generateScopeHygieneProposals(
      snapshot([
        profile({
          allowedMcps: ['pdf-tools'],
          mcpScopeShape: 'tools-map',
          allowedMcpTools: { 'pdf-tools': ['list_pdfs'] },
        }),
      ], ['pdf-tools']),
      {
        proposalsRepo: {
          existsByDedupKeyAsync: async () => false,
          createAsync: async (input) => { mapProtected.push(input); return input as never; },
        },
      },
    );
    expect(mapProtected).toEqual([]);
  });
});
