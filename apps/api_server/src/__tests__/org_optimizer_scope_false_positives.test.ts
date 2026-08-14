/**
 * REGRESSION SUITE — the Org Self-Optimizer must stop filing scope proposals
 * built on a misread of a profile's actual scope.
 *
 * Both false proposals this locks out were generated live on 2026-08-04:
 *
 *  1. `refine-scope` / risk=high against `profile:planning-agent`:
 *     "planning-agent repeatedly tried to use gitnexus_query (3 denied events)
 *      ... However, the agent profile has allowedMcps: [] (empty)".
 *     Reality: planning-agent's allowedMcpsJson is
 *     {"gitnexus":null,"memory":null,"rhythm":[...]} — gitnexus IS granted, and a
 *     `null`/`[]` value means ALL tools of that server. The audit parsed the
 *     column with an array-only helper, got [] for the tools-map shape, and fed
 *     the LLM "allowedMcps: []".
 *
 *  2. `refine-scope` / risk=high against `profile:creative-media`:
 *     "lacks access to image generation ... the agent's MCP scope does not
 *      include 'image-generation'".
 *     Reality: `imageGenerationEnabled = true`, set ~10h earlier — and
 *     `image_generation` is not an MCP server at all (#1094: a provider-EXECUTED
 *     tool granted by that flag / permission.image_generation). The optimizer
 *     searched the wrong surface and concluded absence.
 *
 * The last describe is the control: a profile GENUINELY missing a server it needs
 * must still produce a gap/proposal. Without it these tests would only prove the
 * detectors were switched off.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import type { OrgAuditSnapshot } from '../services/org_audit_service';
import type { WorkflowFailureSignal } from '../services/workflow_failure_signal_extractor';
import type { DiagnosisResult } from '../services/org_diagnosis_types';

// ── opencode_engine mock — same pattern as org_audit_service.test.ts ──
const listMcp = vi.fn();
const listSkills = vi.fn();
let mockIsReady = true;

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listMcp: (...a: unknown[]) => listMcp(...a),
      listSkills: (...a: unknown[]) => listSkills(...a),
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

beforeEach(() => {
  setDb(makeDb());
  mockIsReady = true;
  listMcp.mockReset().mockResolvedValue({
    gitnexus: { name: 'gitnexus' },
    rhythm: { name: 'rhythm' },
    'gmail-work': { name: 'gmail-work' },
  });
  listSkills.mockReset().mockResolvedValue([]);
});

function baseSnapshot(overrides: Partial<OrgAuditSnapshot> = {}): OrgAuditSnapshot {
  return {
    auditRunId: 'audit-run-1',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles: [],
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: [],
    drift: [],
    gaps: [],
    workflowFailureSignals: [],
    ...overrides,
  };
}

function retryLoopSignal(agentConfigId: string): WorkflowFailureSignal {
  return {
    category: 'retry-loop',
    agentConfigId,
    count: 17,
    confidence: 'high',
    sessionIds: ['f2b6c2e1-99ed-4a7f-b4d3-ac3f5ce6cdef'],
    evidence: `retryPhraseCount=17 agentConfigId=${agentConfigId}`,
    dedupToken: agentConfigId,
  };
}

/** A diagnosis shaped exactly like the false live one: "add the server it already has". */
function scopeChangeDiagnosis(add: string[]): DiagnosisResult {
  return {
    diagnosis: `The agent cannot reach ${add.join(', ')}; its MCP scope is empty.`,
    rootCause: 'scope',
    fixType: 'scope-change',
    concreteFix: `Add '${add.join("', '")}' to the profile's MCP allowlist.`,
    confidence: 'high',
    scopePatch: { agentConfigId: 'ignored-llm-value', field: 'allowedMcpsJson', add },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('the audit snapshot reads BOTH stored scope shapes', () => {
  it('a tools-map grant with a null value is ALL tools of that server, not "no access"', async () => {
    // Bug this catches: parseJsonStringArray returns [] for {"gitnexus":null},
    // so the whole org digest reports a fully-scoped profile as having none.
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, rhythm: ['rhythm_ping'] }),
    });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    const profile = snapshot.profiles.find((p) => p.id === 'planning-agent')!;

    expect(profile.allowedMcps).toEqual(['gitnexus', 'rhythm']);
    expect(profile.mcpScopeShape).toBe('tools-map');
    expect(profile.allowedMcpTools.gitnexus).toEqual([]); // [] = every tool
    expect(profile.allowedMcpTools.rhythm).toEqual(['rhythm_ping']);
    // gitnexus is live, so it is NOT a dead name — no prune gap may be invented.
    expect(snapshot.gaps.filter((g) => g.evidence.includes('gitnexus'))).toEqual([]);
  });

  it('an empty-array grant is likewise ALL tools of that server', async () => {
    new AgentConfigsRepository().insert({
      id: 'librarian',
      label: 'Librarian',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: [] }),
    });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    const profile = snapshot.profiles.find((p) => p.id === 'librarian')!;

    expect(profile.allowedMcps).toEqual(['gitnexus']);
    expect(profile.allowedMcpTools.gitnexus).toEqual([]);
    expect(snapshot.gaps.filter((g) => g.evidence.includes('gitnexus'))).toEqual([]);
  });

  it('a NULL column is unrestricted, which an empty array must never be confused with', async () => {
    new AgentConfigsRepository().insert({ id: 'unscoped-agent', label: 'Unscoped', icon: 'x' });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    const profile = snapshot.profiles.find((p) => p.id === 'unscoped-agent')!;

    expect(profile.mcpScopeShape).toBe('unrestricted');
  });

  it('the dispatch guard agrees: a null/[] per-server value grants that server', async () => {
    const { isToolAllowed } = await import('../services/mcp_dispatch_guard');

    expect(isToolAllowed('gitnexus_query', JSON.stringify({ gitnexus: null }))).toBe(true);
    expect(isToolAllowed('gitnexus_query', JSON.stringify({ gitnexus: [] }))).toBe(true);
    // Narrowing still narrows: an explicit tool list denies everything else.
    expect(isToolAllowed('rhythm_delete_task', JSON.stringify({ rhythm: ['rhythm_ping'] }))).toBe(false);
    expect(isToolAllowed('gitnexus_query', JSON.stringify({ rhythm: null }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('false proposal 1 — a denied tool that is IN SCOPE is not a scope gap', () => {
  it('files no refine-scope when the diagnosis asks to add a server the profile already grants', async () => {
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, memory: null, rhythm: ['rhythm_ping'] }),
    });

    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateDiagnosisProposals(
      baseSnapshot({ workflowFailureSignals: [retryLoopSignal('planning-agent')] }),
      { diagnose: async () => scopeChangeDiagnosis(['gitnexus']) },
    );

    expect(created).toEqual([]);
    expect(await new AgentOrgProposalsRepository().listProposedAsync()).toEqual([]);
  });

  it('the deterministic lane files no broaden-scope for a denial on an in-scope tool', async () => {
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, rhythm: ['rhythm_ping'] }),
    });

    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(
      baseSnapshot({
        workflowFailureSignals: [
          {
            category: 'missing-scope',
            agentConfigId: 'planning-agent',
            count: 3,
            confidence: 'high',
            sessionIds: ['s1'],
            evidence: 'profile=planning-agent deniedTool=gitnexus_query count=3 sessionIds=s1',
            dedupToken: 'planning-agent:gitnexus_query',
          },
        ],
      }),
    );

    expect(created).toEqual([]);
  });

  it('the extractor emits no missing-scope signal for a denial on an in-scope tool', async () => {
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, rhythm: ['rhythm_ping'] }),
    });
    const denied = new DeniedToolEventsRepository();
    await denied.recordAsync({ sessionId: null, agentConfigId: 'planning-agent', toolName: 'gitnexus_query' });

    const { detectMissingScopeSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await detectMissingScopeSignals(denied, new AgentConfigsRepository());

    expect(signals).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('false proposal 2 — image_generation is not an MCP server', () => {
  it('files no refine-scope claiming a profile with imageGenerationEnabled lacks image generation', async () => {
    new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['canva', 'openmontage']),
      imageGenerationEnabled: true,
    });

    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateDiagnosisProposals(
      baseSnapshot({ workflowFailureSignals: [retryLoopSignal('creative-media')] }),
      // The live diagnosis spelled it 'image-generation' and aimed it at the MCP
      // allowlist; both spellings resolve to the same core capability.
      { diagnose: async () => scopeChangeDiagnosis(['image-generation']) },
    );

    expect(created).toEqual([]);
  });

  it('never proposes a core/provider-executed capability as an MCP server, even when NOT granted', async () => {
    new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['canva']),
      imageGenerationEnabled: false,
    });

    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateDiagnosisProposals(
      baseSnapshot({ workflowFailureSignals: [retryLoopSignal('creative-media')] }),
      { diagnose: async () => scopeChangeDiagnosis(['image_generation']) },
    );

    // The gap is real here, so the prose proposal survives for the human gate —
    // but it must NOT carry a patch adding a fake 'image_generation' MCP server.
    expect(created).toHaveLength(1);
    const change = JSON.parse(created[0].changeJson ?? '{}');
    expect(change.scopePatch).toBeUndefined();
  });

  it('reports image generation as granted on the capability surface, not the MCP surface', async () => {
    const config = new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['canva']),
      imageGenerationEnabled: true,
    });

    const { resolveCoreCapabilitySurface, grantsCoreCapability } = await import(
      '../services/profile_capability_surface'
    );
    expect(resolveCoreCapabilitySurface(config).granted).toContain('image_generation');
    expect(grantsCoreCapability(config, 'image-generation')).toBe(true);
    expect(grantsCoreCapability(config, 'canva')).toBe(false); // an MCP server is not a core capability
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTROL — a genuine scope gap still produces a proposal', () => {
  it('files a refine-scope with a patch when the profile really lacks the server', async () => {
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_ping'] }),
    });

    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateDiagnosisProposals(
      baseSnapshot({ workflowFailureSignals: [retryLoopSignal('secretary')] }),
      { diagnose: async () => scopeChangeDiagnosis(['gmail-work']) },
    );

    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('refine-scope');
    const change = JSON.parse(created[0].changeJson ?? '{}');
    expect(change.scopePatch).toEqual({
      agentConfigId: 'secretary',
      field: 'allowedMcpsJson',
      add: ['gmail-work'],
    });
  });

  it('files a broaden-scope for a denial on a genuinely un-granted server', async () => {
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_ping'] }),
    });

    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(
      baseSnapshot({
        workflowFailureSignals: [
          {
            category: 'missing-scope',
            agentConfigId: 'secretary',
            count: 3,
            confidence: 'high',
            sessionIds: ['s1'],
            evidence: 'profile=secretary deniedTool=gitnexus_query count=3 sessionIds=s1',
            dedupToken: 'secretary:gitnexus_query',
          },
        ],
      }),
    );

    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('broaden-scope');
    expect(JSON.parse(created[0].changeJson ?? '{}').add).toEqual(['gitnexus']);
  });

  it('still flags a DEAD allowlist name inside a tools-map profile', async () => {
    // The corrected read must not only stop false positives: a name the live
    // engine does not know is still drift, whichever shape holds it.
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, 'ghost-server': null }),
    });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(snapshot.drift.filter((d) => d.profileId === 'planning-agent')).toEqual([
      { profileId: 'planning-agent', scopeKind: 'mcp', name: 'ghost-server', matched: false },
    ]);
    expect(snapshot.gaps.map((g) => g.evidence)).toContain(
      'profile=planning-agent scopeKind=mcp deadName=ghost-server',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the tighten lane requires available canonical usage telemetry', () => {
  it('blocks used servers, judges available-empty evidence, and skips unavailable evidence', async () => {
    const { detectTightenGaps } = await import('../services/org_audit_service');
    const live = new Set(['gitnexus']);
    const sessions = new Map([['p', 50]]);
    const days = new Map([['p', 60]]);
    const base = {
      id: 'p',
      label: 'P',
      isManager: false,
      enabled: true,
      allowedMcps: ['gitnexus'],
      allowedMcpTools: { gitnexus: [] },
      allowedSkills: [],
      allowedDelegates: [],
    };

    expect(
      detectTightenGaps(
        [{ ...base, mcpScopeShape: 'tools-map' }],
        live,
        new Set(),
        sessions,
        days,
        { availability: 'available', canonicalPairs: new Set(['p::gitnexus']), unavailableProfileIds: new Set() },
      ),
    ).toEqual([]);
    expect(
      detectTightenGaps(
        [{ ...base, mcpScopeShape: 'tools-map' }],
        live,
        new Set(),
        sessions,
        days,
        { availability: 'available', canonicalPairs: new Set(), unavailableProfileIds: new Set() },
      ),
    ).toHaveLength(1);
    expect(
      detectTightenGaps(
        [{ ...base, mcpScopeShape: 'tools-map' }],
        live,
        new Set(),
        sessions,
        days,
        { availability: 'unavailable' },
      ),
    ).toEqual([]);
    expect(
      detectTightenGaps(
        [{ ...base, mcpScopeShape: 'tools-map' }],
        live,
        new Set(),
        sessions,
        days,
      ),
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('applying a scope change to a tools-map profile keeps its sibling grants', () => {
  it('preserves the map shape and every other server instead of flattening to an array', async () => {
    // Bug this catches: computeScopeList parsed the column as an array only, so
    // applying `add:['gitnexus']` to {"gitnexus":null,"memory":null,"rhythm":[...]}
    // wrote `["gitnexus"]` — deleting memory and rhythm's 9 tool grants outright.
    const { computeScopeList } = await import('../services/org_proposal_apply');
    const prior = JSON.stringify({ gitnexus: null, memory: null, rhythm: ['rhythm_ping'] });

    expect(JSON.parse(computeScopeList(prior, { add: ['gmail-work'] }))).toEqual({
      gitnexus: null,
      memory: null,
      rhythm: ['rhythm_ping'],
      'gmail-work': [],
    });
    expect(JSON.parse(computeScopeList(prior, { remove: ['memory'] }))).toEqual({
      gitnexus: null,
      rhythm: ['rhythm_ping'],
    });
    // The server-name-array shape is untouched.
    expect(computeScopeList('["rhythm"]', { add: ['gitnexus'] })).toBe('["rhythm","gitnexus"]');
  });
});
