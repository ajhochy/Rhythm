/**
 * C2-D (S4) / #1448 — interactive WS reservation/receipt at the promptAsync
 * boundary.
 *
 * C1/C2-C already wired reserve-before-dispatch + receipt-finalize-at-dispatch
 * for the scheduled/HTTP path (agent_runner.ts's `_runOnce`, proven by
 * c2_a_reserved_treatment_dispatch.test.ts). This file proves the SAME
 * contract for the interactive WS path: ws_gateway.ts's `handleInputFrame`
 * (session.input frame handler), when the frame carries a `runEpisodeId`
 * bound to a declared system-prompt-v1 experiment, must:
 *
 *   1. Reserve/prepare the cohort's exact bound system prompt and send it as
 *      the effective `system` override to the SDK — unconditionally
 *      replacing the profile's own systemPrompt and any transient
 *      skill/memory preface (the receipt binds the effective-prompt HASH to
 *      exactly what is sent; nothing may be appended after it).
 *   2. Finalize an immutable treatment receipt at the REAL promptAsync
 *      dispatch boundary (the beforeDispatch hook), transitioning the
 *      enrollment reserved -> dispatched.
 *   3. Fail closed (no prompt sent) when the durable target drifts between
 *      reservation and dispatch.
 *
 * Drives the REAL `handleInputFrame` (imported unmocked) and REAL
 * org_proposal_experiment_service functions against a real in-memory SQLite
 * DB. Only the TRUE external boundary is faked: the real opencode engine
 * process (`opencodeClient.promptAsync`) and the model catalog
 * (`resolveModelForSessionTurn`) — mirroring c2_a_reserved_treatment_dispatch
 * .test.ts and issue_1451_contract.test.ts. The mocked `promptAsync`
 * faithfully replays the `beforeDispatch` hook before resolving, exactly as
 * the real OpencodeClientService.promptAsync does (see opencode_client_
 * service.ts's C2-C boundary contract) — otherwise a reserved enrollment
 * could never reach `dispatched` under test even though it does in
 * production.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb, getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { AgentOrgTreatmentReceiptsRepository } from '../repositories/agent_org_treatment_receipts_repository';
import { assignCohort, reserveRunEnrollment } from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

// ---------------------------------------------------------------------------
// Hoisted mocks — the TRUE external boundary only. promptAsync faithfully
// replays `beforeDispatch` (the 7th arg) before resolving, exactly as the
// real OpencodeClientService.promptAsync does.
// ---------------------------------------------------------------------------
const { promptAsyncSpy, sessionMap } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn(
    async (
      _id: string,
      _data: string,
      _model?: unknown,
      _cwd?: string,
      _opts?: unknown,
      _parts?: unknown,
      beforeDispatch?: () => Promise<void>,
    ) => {
      if (beforeDispatch) await beforeDispatch();
      return true;
    },
  ),
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

// Imported AFTER mocks: the module under test (real).
import { handleInputFrame } from '../services/ws_gateway';

function makeFakeWs() {
  return { send: vi.fn(), readyState: 1 } as unknown as import('ws').WebSocket;
}

const PROFILE_ID = 'c2d-s4-ws-profile';
const BASELINE_PROMPT = 'c2d-s4 baseline prompt';
const CANDIDATE_PROMPT = 'c2d-s4 candidate prompt';
const TARGET_REF = `agent_config:${PROFILE_ID}`;
const ASSIGNMENT_KEY = 'c2d-s4-ws-key';

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

async function seedProfileAndExperiment(): Promise<RevisionedAgentConfig> {
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
    title: 'c2d-s4 proposal',
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
  return profile;
}

function insertSession(name: string) {
  return new AgentSessionsRepository().insert({
    agentKind: PROFILE_ID,
    taskId: null,
    cwd: '/tmp',
    name,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  promptAsyncSpy.mockClear();
  sessionMap.clear();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  delete process.env.RHYTHM_OPTIMIZER_MODE;
});

describe('C2-D (S4) — WS interactive dispatch reserves and finalizes a treatment receipt', () => {
  it('sends the exact reserved cohort system prompt through the real WS path and finalizes an immutable receipt', async () => {
    await seedProfileAndExperiment();
    const session = insertSession('c2d-s4-basic');
    sessionMap.set(session.id, 'sdk-c2d-s4-basic');

    const runEpisodeId = 'episode-c2d-s4-basic';
    const expectedCohort = assignCohort(ASSIGNMENT_KEY, runEpisodeId);
    const expectedOverride = expectedCohort === 'baseline' ? BASELINE_PROMPT : CANDIDATE_PROMPT;

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const opts = promptAsyncSpy.mock.calls[0][4] as Record<string, unknown>;
    // Bug this catches: forwarding the profile's own systemPrompt (or a
    // skill/memory preface concatenated onto it) instead of the exact bound
    // cohort override — the receipt's effective-prompt hash would then not
    // match what the model actually saw.
    expect(opts.system).toBe(expectedOverride);

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('dispatched');
    expect(enrollment?.cohort).toBe(expectedCohort);

    const receipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(runEpisodeId);
    expect(receipt).not.toBeNull();
    expect(receipt?.cohort).toBe(expectedCohort);
    expect(receipt?.effectivePromptHash).toBe(
      createHash('sha256').update(expectedOverride).digest('hex'),
    );
  });

  it('proves both cohorts receive distinct bound system prompts through the real WS path', async () => {
    await seedProfileAndExperiment();

    let baselineId: string | null = null;
    let candidateId: string | null = null;
    for (let i = 0; i < 200 && (!baselineId || !candidateId); i += 1) {
      const candidate = `c2d-s4-dual-${i}`;
      const cohort = assignCohort(ASSIGNMENT_KEY, candidate);
      if (cohort === 'baseline' && !baselineId) baselineId = candidate;
      if (cohort === 'candidate' && !candidateId) candidateId = candidate;
    }
    expect(baselineId).not.toBeNull();
    expect(candidateId).not.toBeNull();

    const baselineSession = insertSession('c2d-s4-dual-baseline');
    sessionMap.set(baselineSession.id, 'sdk-c2d-s4-dual-baseline');
    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: baselineSession.id,
      data: 'hello',
      runEpisodeId: baselineId!,
    });
    const baselineOpts = promptAsyncSpy.mock.calls[0][4] as Record<string, unknown>;

    promptAsyncSpy.mockClear();
    const candidateSession = insertSession('c2d-s4-dual-candidate');
    sessionMap.set(candidateSession.id, 'sdk-c2d-s4-dual-candidate');
    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: candidateSession.id,
      data: 'hello',
      runEpisodeId: candidateId!,
    });
    const candidateOpts = promptAsyncSpy.mock.calls[0][4] as Record<string, unknown>;

    expect(baselineOpts.system).toBe(BASELINE_PROMPT);
    expect(candidateOpts.system).toBe(CANDIDATE_PROMPT);
    expect(baselineOpts.system).not.toBe(candidateOpts.system);

    const receiptsRepo = new AgentOrgTreatmentReceiptsRepository();
    const baselineReceipt = await receiptsRepo.findByRunEpisodeIdAsync(baselineId!);
    const candidateReceipt = await receiptsRepo.findByRunEpisodeIdAsync(candidateId!);
    expect(baselineReceipt?.effectivePromptHash).not.toBe(candidateReceipt?.effectivePromptHash);
  });

  it('sends no prompt and fails closed (target_drifted) when the durable target drifts before WS dispatch', async () => {
    await seedProfileAndExperiment();
    const session = insertSession('c2d-s4-drift');
    sessionMap.set(session.id, 'sdk-c2d-s4-drift');

    const runEpisodeId = 'episode-c2d-s4-drift';
    // Reserve BEFORE the target drifts (mirrors the real pre-dispatch state).
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).not.toBeNull();

    // Mutate the durable AgentConfig AFTER reservation but BEFORE WS dispatch.
    new AgentConfigsRepository().update(PROFILE_ID, {
      systemPrompt: 'a completely different prompt nobody reserved against',
    });

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    });

    // Bug this catches: dispatching the turn anyway under a stale/unbound
    // treatment instead of refusing to send a prompt at all.
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('treatment_failed');
    expect(enrollment?.failureCode).toBe('target_drifted');

    const receipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(runEpisodeId);
    expect(receipt).toBeNull();
  });

  it('regression: a runEpisodeId with no matching declared experiment dispatches normally with the profile system prompt', async () => {
    // No seedProfileAndExperiment() — just a bare profile, no declared
    // experiment. reserveRunEnrollment must return null (no eligible
    // experiment) and the turn must proceed exactly as an untreated run.
    await new AgentConfigsRepository().insert({
      id: PROFILE_ID,
      label: PROFILE_ID,
      icon: 'x',
      systemPrompt: BASELINE_PROMPT,
    });
    const session = insertSession('c2d-s4-no-experiment');
    sessionMap.set(session.id, 'sdk-c2d-s4-no-experiment');

    await handleInputFrame(makeFakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId: 'episode-c2d-s4-no-experiment',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const opts = promptAsyncSpy.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(BASELINE_PROMPT);

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      'episode-c2d-s4-no-experiment',
    );
    expect(enrollment).toBeNull();
  });
});

describe('C2-D (S5) — redispatch reuse: the same runEpisodeId re-entering the WS boundary is idempotent', () => {
  it('a WS reconnect/retry that re-sends the same session.input frame (same id, same runEpisodeId) reuses the existing reservation and receipt — no double-reservation, no conflicting second receipt, no error', async () => {
    // Investigation (recorded in the run note): reserveRunEnrollment's
    // idempotency check (findByRunEpisodeIdAsync BEFORE any new-reservation
    // logic, from C1) and dispatchAndFinalizeReceiptAsync's existing-receipt
    // check (BEFORE the reserved-state guard, from C2-B/C2-C) already make
    // the full reserve -> prepare -> commit chain idempotent on repeat calls
    // with the same runEpisodeId — proven in isolation by
    // org_proposal_experiment_service.test.ts's "same-profile idempotent
    // lookup" and "an identical retry ... is idempotent" tests. This test
    // proves the SAME property end-to-end through the real WS boundary S4
    // just wired: calling the real handleInputFrame a second time for the
    // same turn (simulating a WS reconnect re-sending the unacknowledged
    // frame) must not fabricate a second enrollment row, must not throw a
    // binding_mismatch/illegal_transition error, and must not write a
    // second, conflicting treatment receipt.
    await seedProfileAndExperiment();
    const session = insertSession('c2d-s5-redispatch');
    sessionMap.set(session.id, 'sdk-c2d-s5-redispatch');

    const runEpisodeId = 'episode-c2d-s5-redispatch';
    const expectedCohort = assignCohort(ASSIGNMENT_KEY, runEpisodeId);
    const expectedOverride = expectedCohort === 'baseline' ? BASELINE_PROMPT : CANDIDATE_PROMPT;
    const frame = {
      v: 1 as const,
      type: 'session.input',
      id: session.id,
      data: 'hello',
      runEpisodeId,
    };

    // First dispatch attempt.
    await handleInputFrame(makeFakeWs(), frame);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);

    const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
    const receiptsRepo = new AgentOrgTreatmentReceiptsRepository();
    const firstEnrollment = await enrollmentsRepo.findByRunEpisodeIdAsync(runEpisodeId);
    const firstReceipt = await receiptsRepo.findByRunEpisodeIdAsync(runEpisodeId);
    expect(firstEnrollment?.state).toBe('dispatched');
    expect(firstReceipt).not.toBeNull();

    // Redispatch: the exact same frame re-enters handleInputFrame a second
    // time (a fresh WS mock, matching a reconnect's fresh socket).
    await handleInputFrame(makeFakeWs(), frame);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(2);
    const secondOpts = promptAsyncSpy.mock.calls[1][4] as Record<string, unknown>;
    // Bug this catches: a redispatch that fails preparation/commit would
    // either throw (surfaced as a WS error frame, no dispatch) or silently
    // dispatch under a DIFFERENT (re-derived, not reused) prompt/receipt.
    expect(secondOpts.system).toBe(expectedOverride);

    const secondEnrollment = await enrollmentsRepo.findByRunEpisodeIdAsync(runEpisodeId);
    const secondReceipt = await receiptsRepo.findByRunEpisodeIdAsync(runEpisodeId);
    expect(secondEnrollment).toEqual(firstEnrollment);
    expect(secondReceipt).toEqual(firstReceipt);
    expect(secondReceipt?.id).toBe(firstReceipt?.id);

    // Exactly one enrollment row and exactly one receipt row exist for this
    // episode — a raw count, not just a single-row lookup, so a redispatch
    // that inserted a SECOND (unreachable-by-unique-lookup) row would fail
    // this even if findByRunEpisodeIdAsync happened to still return one.
    const enrollmentCount = getDb()
      .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get(runEpisodeId) as { n: number };
    const receiptCount = getDb()
      .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`)
      .get(runEpisodeId) as { n: number };
    expect(enrollmentCount.n).toBe(1);
    expect(receiptCount.n).toBe(1);
  });
});
