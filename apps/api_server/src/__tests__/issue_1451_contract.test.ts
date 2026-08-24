/**
 * Contract test for issue #1451 — C2-D (S3): thread runEpisodeId through the
 * WebSocket bridge to the terminal outcome hook.
 *
 * Drives the REAL production code: ws_gateway.ts's `handleInputFrame` (the
 * WS "session.input" frame handler) and the REAL `streamBridge` singleton
 * from opencode_stream_bridge.ts (fed synthetic engine events via its
 * `_relayEvent`, the same technique issue_636_contract.test.ts uses). Only
 * the TRUE external boundary is faked: the real opencode engine process
 * (`opencodeClient.promptAsync`/`createSession`/allowlist calls) and the
 * model catalog (`resolveModelForSessionTurn`).
 *
 * See docs/ai/contracts/issue-1451.json for the criterion -> test mapping.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import {
  reserveRunEnrollment,
  markRunEnrollmentDispatched,
} from '../services/org_proposal_experiment_service';
import { recordTerminalOutcome } from '../services/run_outcome_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

// ---------------------------------------------------------------------------
// Hoisted mocks — the TRUE external boundary only: the real opencode engine
// process, and the model catalog `resolveModelForSessionTurn` reads from.
// opencode_stream_bridge.ts and ws_gateway.ts are NEVER mocked below.
// ---------------------------------------------------------------------------

const { promptAsyncSpy, sessionMap } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    promptAsync: promptAsyncSpy,
    createSession: vi.fn().mockResolvedValue({ id: 'unused' }),
    getSession: vi.fn().mockResolvedValue(null),
    updateSessionAllowlist: vi.fn().mockResolvedValue(undefined),
    updateSessionSkillAllowlist: vi.fn().mockResolvedValue(undefined),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: vi.fn().mockResolvedValue(true),
    dispatchCommand: vi.fn().mockResolvedValue(null),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/agent_model_resolver', () => ({
  resolveModelForSessionTurn: vi.fn().mockResolvedValue({
    providerID: 'anthropic',
    modelID: 'claude-opus-4-7',
  }),
}));

// Imported AFTER mocks: the module under test (real) and the real stream
// bridge singleton, used to synthesize the engine's terminal SSE event.
import { handleInputFrame } from '../services/ws_gateway';
import { streamBridge } from '../services/opencode_stream_bridge';

function relay(event: Record<string, unknown>): void {
  (streamBridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

function makeFakeWs() {
  return { send: vi.fn(), readyState: 1 } as unknown as import('ws').WebSocket;
}

let db: Database.Database;

const PROFILE_ID = 'issue-1451-ws-profile';
const BASELINE_PROMPT = 'issue-1451 baseline prompt';
const CANDIDATE_PROMPT = 'issue-1451 candidate prompt';
const TARGET_REF = `agent_config:${PROFILE_ID}`;
const ASSIGNMENT_KEY = 'issue-1451-ws-key';

function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalizeForHash).join(',')}]`;
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

function fingerprint(p: RevisionedAgentConfig): string {
  return `sha256:${createHash('sha256')
    .update(canonicalizeForHash({ id: p.id, revision: p.revision, systemPrompt: p.systemPrompt ?? '__null__' }))
    .digest('hex')}`;
}

function spec(candidateValue: string, hash: string): Record<string, unknown> {
  return {
    agentConfigId: PROFILE_ID,
    field: 'system_prompt',
    priorValue: BASELINE_PROMPT,
    currentValue: BASELINE_PROMPT,
    candidateValue,
    evidenceTarget: { ref: TARGET_REF, hash },
  };
}

function bundle(hash: string): Record<string, unknown> {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['seed'], eventIds: ['seed'] },
    counterEvidenceSearch: { query: 'q', searchedAt: new Date().toISOString(), contradictingCount: 0 },
    target: { ref: TARGET_REF, hash },
    expectedOutcome: 'success',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['terminal-error-rate'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'revert',
    generatorVersion: 'v1',
    confidenceCalibrationVersion: 'v1',
  };
}

/** Reserve + dispatch a real enrollment for `runEpisodeId`, exactly as C2-D (S4)'s
 *  future WS reservation boundary is expected to do BEFORE the prompt is sent.
 *  This slice (S3) only threads the id through — it does not add that
 *  reservation call to ws_gateway.ts itself (tracked separately as S4). */
async function seedReservedEnrollment(runEpisodeId: string): Promise<{ proposalId: string; cohort: string }> {
  const profile = await new AgentConfigsRepository().insert({
    id: PROFILE_ID,
    label: PROFILE_ID,
    icon: 'x',
    systemPrompt: BASELINE_PROMPT,
  });
  const hash = fingerprint(profile);
  const proposal = await new AgentOrgProposalsRepository().createAsync({
    kind: 'refine-config',
    risk: 'low',
    status: 'active',
    title: 'issue-1451 proposal',
    targetRef: TARGET_REF,
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
    }),
  });
  await new AgentOrgExperimentsRepository().declareAsync({
    proposalId: proposal.id,
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify(bundle(hash)),
    baselineSpecJson: JSON.stringify(spec(BASELINE_PROMPT, hash)),
    candidateSpecJson: JSON.stringify(spec(CANDIDATE_PROMPT, hash)),
    assignmentKey: ASSIGNMENT_KEY,
    stoppingRule: { minSamplesPerCohort: 1, minEffect: 0.1 },
    maxExposure: 100,
  });
  const enrollment = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
  if (!enrollment) throw new Error('test setup: expected a reservation');
  await markRunEnrollmentDispatched(runEpisodeId);
  return { proposalId: enrollment.proposalId, cohort: enrollment.cohort };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMap.clear();
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  process.env.RHYTHM_OPTIMIZER_MODE = 'shadow';
});

describe('issue-1451-c1 — WS session.input frame accepts an optional runEpisodeId', () => {
  it('forwards it to the real streamBridge (setPendingRunEpisodeId), not just an internal variable', async () => {
    const SDK_ID = 'sdk-1451-c1';
    const session = new AgentSessionsRepository().insert({
      agentKind: PROFILE_ID,
      taskId: null,
      cwd: '/tmp',
      name: 'issue-1451-c1',
    } as never);
    sessionMap.set(session.id, SDK_ID);

    const runEpisodeId = 'episode-1451-c1';
    const setSpy = vi.spyOn(streamBridge, 'setPendingRunEpisodeId');

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledWith(session.id, runEpisodeId);
    setSpy.mockRestore();
  });
});

describe('issue-1451-c2/c3/c4 — an interactive WS run with an explicit runEpisodeId produces an outcome bound to the correct cohort/proposal, through the real WS bridge code path', () => {
  it('session.idle (successful turn) finalizes with the reserved cohort and proposal', async () => {
    const SDK_ID = 'sdk-1451-idle';
    const session = new AgentSessionsRepository().insert({
      agentKind: PROFILE_ID,
      taskId: null,
      cwd: '/tmp',
      name: 'issue-1451-idle',
    } as never);
    sessionMap.set(session.id, SDK_ID);

    const runEpisodeId = 'episode-1451-idle';
    const { proposalId, cohort } = await seedReservedEnrollment(runEpisodeId);

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    });
    expect(promptAsyncSpy).toHaveBeenCalledOnce();

    // Simulate the engine streaming some tokens, then going idle — the REAL
    // bridge event-handling path (message.part.delta + session.idle).
    relay({
      type: 'message.part.delta',
      properties: { part: { sessionID: SDK_ID }, delta: 'hi there', field: 'text' },
    });
    relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });

    // recordTerminalOutcome is fire-and-forget (`void`) — give its promise a
    // tick to settle before reading the ledger back.
    await new Promise((resolve) => setImmediate(resolve));

    const outcomesRepo = new AgentRunOutcomesRepository(db);
    const outcome = await outcomesRepo.findOutcomeAsync(session.id);
    expect(outcome).not.toBeNull();
    expect(outcome!.runEpisodeId).toBe(runEpisodeId);
    expect(outcome!.proposalId).toBe(proposalId);
    expect(outcome!.experimentVariant).toBe(cohort);
  });

  it('session.error (failed turn) also finalizes with the reserved cohort and proposal', async () => {
    const SDK_ID = 'sdk-1451-error';
    const session = new AgentSessionsRepository().insert({
      agentKind: PROFILE_ID,
      taskId: null,
      cwd: '/tmp',
      name: 'issue-1451-error',
    } as never);
    sessionMap.set(session.id, SDK_ID);

    const runEpisodeId = 'episode-1451-error';
    const { proposalId, cohort } = await seedReservedEnrollment(runEpisodeId);

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    });

    relay({
      type: 'session.error',
      properties: { sessionID: SDK_ID, error: { name: 'UnknownError', data: { message: 'boom' } } },
    });

    await new Promise((resolve) => setImmediate(resolve));

    const outcomesRepo = new AgentRunOutcomesRepository(db);
    const outcome = await outcomesRepo.findOutcomeAsync(session.id);
    expect(outcome).not.toBeNull();
    expect(outcome!.runEpisodeId).toBe(runEpisodeId);
    expect(outcome!.proposalId).toBe(proposalId);
    expect(outcome!.experimentVariant).toBe(cohort);
  });
});

describe('issue-1451-c5 — regression: an ordinary interactive turn with NO runEpisodeId is unaffected', () => {
  it('finalizes with the rootSessionId fallback exactly as before, through the real bridge', async () => {
    const SDK_ID = 'sdk-1451-no-episode';
    const session = new AgentSessionsRepository().insert({
      agentKind: PROFILE_ID,
      taskId: null,
      cwd: '/tmp',
      name: 'issue-1451-no-episode',
    } as never);
    sessionMap.set(session.id, SDK_ID);

    const setSpy = vi.spyOn(streamBridge, 'setPendingRunEpisodeId');

    // No `runEpisodeId` field on the frame — the ordinary human-chat shape.
    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
    });
    expect(setSpy).not.toHaveBeenCalled();

    relay({
      type: 'message.part.delta',
      properties: { part: { sessionID: SDK_ID }, delta: 'hi', field: 'text' },
    });
    relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });
    await new Promise((resolve) => setImmediate(resolve));

    const outcomesRepo = new AgentRunOutcomesRepository(db);
    const outcome = await outcomesRepo.findOutcomeAsync(session.id);
    expect(outcome).not.toBeNull();
    // Unchanged fallback: run_outcome_service.ts computes
    // `event.runEpisodeId ?? rootSessionId`.
    expect(outcome!.runEpisodeId).toBe(session.id);
    expect(outcome!.proposalId).toBeNull();
    setSpy.mockRestore();
  });
});

describe('issue-1451-c6 — regression: the scheduled/HTTP path (agent_runner.ts shape) is unaffected', () => {
  it('recordTerminalOutcome called directly with an explicit runEpisodeId (no WS bridge involved) still resolves the correct enrollment', async () => {
    // Mirrors exactly how agent_runner.ts calls recordTerminalOutcome
    // (services/agent_runner.ts ~L1543): sessionId is the rhythm session id,
    // runEpisodeId is passed explicitly, no WS frame or bridge involved at all.
    const session = new AgentSessionsRepository().insert({
      agentKind: PROFILE_ID,
      taskId: null,
      cwd: '/tmp',
      name: 'issue-1451-http-path',
    } as never);

    const runEpisodeId = 'episode-1451-http-path';
    const { proposalId, cohort } = await seedReservedEnrollment(runEpisodeId);

    await recordTerminalOutcome({
      sessionId: session.id,
      terminalStatus: 'completed',
      runEpisodeId,
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    const outcomesRepo = new AgentRunOutcomesRepository(db);
    const outcome = await outcomesRepo.findOutcomeAsync(session.id);
    expect(outcome).not.toBeNull();
    expect(outcome!.runEpisodeId).toBe(runEpisodeId);
    expect(outcome!.proposalId).toBe(proposalId);
    expect(outcome!.experimentVariant).toBe(cohort);
  });
});
