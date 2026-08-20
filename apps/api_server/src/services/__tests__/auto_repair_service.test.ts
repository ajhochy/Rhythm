/**
 * D2.3 (#1433) — the bounded 3-strike auto-repair service.
 *
 * SECOND PASS: `runAutoRepairAsync` now processes ONE decision per call (one
 * sweep tick) and never declares a repair successful without REAL post-repair
 * evidence at/after its own recheck floor. These tests drive the state
 * machine across multiple calls, the same way `sweepPostApplyLifecycleAsync`
 * would across multiple ticks — never a single call that fabricates evidence
 * via a same-tick timestamp trick.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { projectAgentProfileAfterWrite } = vi.hoisted(() => ({
  projectAgentProfileAfterWrite: vi.fn(),
}));

vi.mock('../agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite,
  // Real implementation (not a mock) — a plain predicate over whatever
  // ProjectionOutcome-shaped object the test's projectAgentProfileAfterWrite
  // mock returns for that call, exactly like the un-mocked module exports.
  isProjectionSettled: (outcome: { kind: string }) =>
    outcome.kind !== 'blocked' && outcome.kind !== 'failed' && outcome.kind !== 'missing',
}));

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { resetProposalPluginsForTests } from '../org_proposal_apply_service';
import { parseRepairProposalIds } from '../../models/post_apply_event';
import type { DiagnoseCall } from '../generators/workflow_signal_generator';
import {
  registerAutoRevertTrigger,
  resetAutoRevertTriggerForTests,
  runAutoRepairAsync,
} from '../auto_repair_service';

let db: Database.Database;
let proposalsRepo: AgentOrgProposalsRepository;
let eventsRepo: PostApplyEventsRepository;
let configsRepo: AgentConfigsRepository;

function insertOutcome(over: { id: string; profileId: string; finalizedAt: string; terminalStatus?: string }): void {
  db.prepare(
    `INSERT INTO agent_run_outcomes
       (id, session_id, root_session_id, profile_id, terminal_status, objective_verdict, finalized_at)
     VALUES (?, ?, ?, ?, ?, 'success', ?)`,
  ).run(over.id, over.id, over.id, over.profileId, over.terminalStatus ?? 'completed', over.finalizedAt);
}

let evidenceSeq = 0;

/** Seed N outcomes at/after `sinceIso`, all with the same terminal status. */
function seedEvidence(profileId: string, sinceIso: string, terminalStatus: 'error' | 'completed', count = 5): void {
  const base = new Date(sinceIso).getTime();
  for (let i = 0; i < count; i += 1) {
    evidenceSeq += 1;
    insertOutcome({
      id: `${terminalStatus}-${evidenceSeq}-${i}`,
      profileId,
      finalizedAt: new Date(base + i).toISOString(),
      terminalStatus,
    });
  }
}

/** A diagnose double that always finds a config-change fix for the failing profile. */
function fakeDiagnose(): DiagnoseCall {
  let call = 0;
  return async (ctx) => {
    call += 1;
    return {
      diagnosis: `Root cause for ${ctx.affectedSkill}, attempt ${call}`,
      rootCause: 'config',
      fixType: 'config-change',
      concreteFix: `model: anthropic/claude-sonnet-${call}`,
      confidence: 'high',
      configPatch: { agentConfigId: 'ATTACKER-ID', field: 'model', value: `anthropic/claude-sonnet-${call}` },
    };
  };
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  resetProposalPluginsForTests();
  resetAutoRevertTriggerForTests();
  projectAgentProfileAfterWrite.mockReset();
  // Default: projection settles immediately (matches the real, common case).
  // Individual tests override this per-call to exercise the
  // blocked/failed/missing gating (landConfigFieldWithProjection).
  projectAgentProfileAfterWrite.mockImplementation((config: { id: string; revision?: number }) => ({
    kind: 'projected',
    revision: config.revision ?? 0,
    write: 'written',
  }));
  proposalsRepo = new AgentOrgProposalsRepository(db);
  eventsRepo = new PostApplyEventsRepository(db);
  configsRepo = new AgentConfigsRepository();
  configsRepo.insert({ id: 'profile-1', label: 'Profile 1', icon: 'x' });
  // 'measuring' mirrors the real D2.5 lifecycle (finalizePostApplyLifecycleAsync
  // transitions applied -> measuring right after enrollment), so a settled
  // repair's measuring -> active transition below is exercised for real.
  await proposalsRepo.createAsync({
    id: 'proposal-1',
    kind: 'refine-config',
    risk: 'high',
    title: 'test proposal',
    status: 'measuring',
  });
});

async function trippedEvent(options: { seedBreach?: boolean } = {}) {
  await eventsRepo.createAsync({
    proposalId: 'proposal-1',
    profileId: 'profile-1',
    changeType: 'prompt',
    preChangeSnapshotJson: '{}',
    monitoringWindowStart: '2026-08-18T00:00:00.000Z',
    monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
  });
  const tripped = await eventsRepo.updateStatusAsync('proposal-1', { guardrailStatus: 'tripped' });
  if (options.seedBreach !== false) {
    seedEvidence('profile-1', '2026-08-18T00:00:00.000Z', 'error', 5);
  }
  return tripped!;
}

describe('D2.3 runAutoRepairAsync', () => {
  it('passes the exact breached post-apply guardrail signal into a new diagnosis', async () => {
    const event = await trippedEvent({ seedBreach: false });
    const finalizedAt = '2026-08-18T00:00:00.000Z';
    for (let i = 0; i < 6; i += 1) {
      insertOutcome({ id: `diagnosis-outcome-${i}`, profileId: 'profile-1', finalizedAt, terminalStatus: 'error' });
    }
    const diagnose = vi.fn(fakeDiagnose());

    await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(diagnose.mock.calls[0][0].signals).toEqual([
      {
        category: 'post-apply-regression',
        sessionIds: [
          'diagnosis-outcome-0',
          'diagnosis-outcome-1',
          'diagnosis-outcome-2',
          'diagnosis-outcome-3',
          'diagnosis-outcome-4',
        ],
        agentConfigId: 'profile-1',
        count: 6,
        confidence: 'high',
        evidence:
          'proposalId=proposal-1 guardrail=terminal-error-rate rate=1 sampleCount=6 windowStart=2026-08-18T00:00:00.000Z windowEnd=2099-01-01T00:00:00.000Z',
        dedupToken: 'proposal-1:terminal-error-rate',
      },
    ]);
  });

  it('defers without diagnosing or consuming a strike when no breached guardrail has sufficient evidence', async () => {
    const event = await trippedEvent({ seedBreach: false });
    const diagnose = vi.fn(fakeDiagnose());

    const result = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });

    expect(result).toMatchObject({ outcome: 'deferred', attempts: 0 });
    expect(result.event.repairAttemptCount).toBe(0);
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('attempt 1 lands the mutation and reports pending until sufficient evidence exists', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-19T00:00:00.000Z');
    const triggerAutoRevert = vi.fn();

    const applied = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
      triggerAutoRevert,
    });
    expect(applied.outcome).toBe('pending');
    expect(applied.attempts).toBe(1);
    expect(applied.event.guardrailStatus).toBe('tripped');
    const ids = parseRepairProposalIds(applied.event.repairProposalIdsJson);
    expect(ids).toHaveLength(1);
    // The corrective proposal was actually applied through the existing CAS
    // path — untrusted LLM agentConfigId was never trusted (server
    // re-resolved it to the real failing profile).
    const repairProposal = await proposalsRepo.findByIdAsync(ids[0]);
    expect(repairProposal?.status).toBe('applied');
    const change = JSON.parse(repairProposal!.changeJson!);
    expect(change).toMatchObject({ source: 'auto-repair-service', profileId: 'profile-1', field: 'model' });
    expect(change).not.toHaveProperty('configPatch');
    const config = configsRepo.getById('profile-1');
    expect(config?.modelProvider).toBe('anthropic');
    expect(config?.modelId).toBe('claude-sonnet-1');
    expect(projectAgentProfileAfterWrite).toHaveBeenCalledWith(config, 'config-update');

    // No evidence at all yet — must remain pending, not silently pass.
    const stillPending = await runAutoRepairAsync(applied.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
      triggerAutoRevert,
    });
    expect(stillPending.outcome).toBe('pending');
    expect(stillPending.attempts).toBe(1);
    expect(stillPending.event.guardrailStatus).toBe('tripped');
    expect(triggerAutoRevert).not.toHaveBeenCalled();
  });

  it('below-threshold evidence stays pending; sufficient clean evidence reports repaired', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-19T00:00:00.000Z');
    const applied = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
    });
    const recheckAfter = applied.event.repairRecheckAfter!;

    // Only 2 clean outcomes — below DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT (5).
    seedEvidence('profile-1', recheckAfter, 'completed', 2);
    const stillInsufficient = await runAutoRepairAsync(applied.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
    });
    expect(stillInsufficient.outcome).toBe('pending');
    expect(stillInsufficient.event.repairRecheckAfter).toBe(recheckAfter);
    expect(stillInsufficient.event.guardrailStatus).toBe('tripped');

    // 3 more clean outcomes brings the sample to 5 — now enough to trust.
    seedEvidence('profile-1', recheckAfter, 'completed', 3);
    const repaired = await runAutoRepairAsync(stillInsufficient.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
    });
    expect(repaired.outcome).toBe('repaired');
    expect(repaired.attempts).toBe(1);
    expect(repaired.event.guardrailStatus).toBe('clear');
    expect(repaired.event.revertStatus).toBe('not_needed');
    expect(repaired.event.repairRecheckAfter).toBeNull();
    expect((await proposalsRepo.findByIdAsync('proposal-1'))?.status).toBe('active');
  });

  it('still-breaching evidence with sufficient sample advances to the next attempt', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-19T00:00:00.000Z');
    const attempt1 = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
    });
    seedEvidence('profile-1', attempt1.event.repairRecheckAfter!, 'error', 5);

    const advanced = await runAutoRepairAsync(attempt1.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
    });
    expect(advanced.outcome).toBe('advancing');
    expect(advanced.attempts).toBe(1);
    expect(advanced.event.repairRecheckAfter).toBeNull();
    expect(advanced.event.guardrailStatus).toBe('tripped');

    // Next tick makes attempt 2 — a fresh diagnose call, a second proposal.
    const attempt2 = await runAutoRepairAsync(advanced.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
    });
    expect(attempt2.outcome).toBe('pending');
    expect(attempt2.attempts).toBe(2);
    expect(parseRepairProposalIds(attempt2.event.repairProposalIdsJson)).toHaveLength(2);
  });

  it('all 3 attempts fail with evidence-confirmed breaches: triggers auto-revert with all 3 attempts recorded', async () => {
    let event = await trippedEvent();
    const triggerAutoRevert = vi.fn();
    const diagnose = fakeDiagnose();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const applied = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo }, triggerAutoRevert });
      expect(applied.outcome).toBe('pending');
      seedEvidence('profile-1', applied.event.repairRecheckAfter!, 'error', 5);
      const evaluated = await runAutoRepairAsync(applied.event, { diagnosis: { diagnose, configsRepo }, triggerAutoRevert });
      event = evaluated.event;
      if (attempt < 3) {
        expect(evaluated.outcome).toBe('advancing');
      } else {
        expect(evaluated.outcome).toBe('exhausted');
      }
    }

    expect(event.guardrailStatus).toBe('tripped');
    expect(parseRepairProposalIds(event.repairProposalIdsJson)).toHaveLength(3);
    expect(triggerAutoRevert).toHaveBeenCalledTimes(1);
    expect(triggerAutoRevert.mock.calls[0][0].proposalId).toBe('proposal-1');

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-1');
    expect(persisted?.guardrailStatus).toBe('tripped');
    expect(parseRepairProposalIds(persisted!.repairProposalIdsJson)).toHaveLength(3);
  });

  it('is a no-op when the event is not currently tripped', async () => {
    await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
    });
    const stillMonitoring = await eventsRepo.findByProposalIdAsync('proposal-1');

    const diagnose = vi.fn(fakeDiagnose());
    const result = await runAutoRepairAsync(stillMonitoring!, { diagnosis: { diagnose, configsRepo } });

    expect(result.outcome).toBe('not-tripped');
    expect(result.attempts).toBe(0);
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('falls back to the globally registered auto-revert trigger when no per-call trigger is given', async () => {
    let event = await trippedEvent();
    const diagnose = fakeDiagnose();
    const registered = vi.fn();
    registerAutoRevertTrigger(registered);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const applied = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });
      seedEvidence('profile-1', applied.event.repairRecheckAfter!, 'error', 5);
      const evaluated = await runAutoRepairAsync(applied.event, { diagnosis: { diagnose, configsRepo } });
      event = evaluated.event;
    }

    expect(registered).toHaveBeenCalledTimes(1);
  });

  it('awaits auto-revert persistence before reporting exhausted', async () => {
    let event = await trippedEvent();
    const diagnose = fakeDiagnose();
    let persisted = false;
    let outcome = '';

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const applied = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });
      seedEvidence('profile-1', applied.event.repairRecheckAfter!, 'error', 5);
      const evaluated = await runAutoRepairAsync(applied.event, {
        diagnosis: { diagnose, configsRepo },
        triggerAutoRevert: async () => {
          await Promise.resolve();
          persisted = true;
        },
      });
      event = evaluated.event;
      outcome = evaluated.outcome;
    }

    expect(outcome).toBe('exhausted');
    expect(persisted).toBe(true);
  });

  it('defers a transient diagnosis failure without exhausting attempts or reverting', async () => {
    const event = await trippedEvent();
    const triggerAutoRevert = vi.fn();
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: async () => { throw new Error('temporary provider outage'); }, configsRepo },
      triggerAutoRevert,
    });
    expect(result).toMatchObject({ outcome: 'deferred', attempts: 0 });
    expect(result.event.repairAttemptCount).toBe(0);
    expect(triggerAutoRevert).not.toHaveBeenCalled();
  });

  it('defers a null diagnosis response (provider down / unparseable) without consuming a strike', async () => {
    const event = await trippedEvent();
    const triggerAutoRevert = vi.fn();
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: async () => null, configsRepo },
      triggerAutoRevert,
    });
    expect(result).toMatchObject({ outcome: 'deferred', attempts: 0 });
    expect(triggerAutoRevert).not.toHaveBeenCalled();
  });

  it('defers a hung diagnosis call once the per-event timeout elapses, without consuming a strike', async () => {
    const event = await trippedEvent();
    const triggerAutoRevert = vi.fn();
    // Never resolves — the per-event timeout must still return within the
    // test's lifetime rather than hanging the whole sweep.
    const hungDiagnose: DiagnoseCall = () => new Promise(() => {});
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: hungDiagnose, configsRepo },
      diagnosisTimeoutMs: 20,
      triggerAutoRevert,
    });
    expect(result).toMatchObject({ outcome: 'deferred', attempts: 0 });
    expect(triggerAutoRevert).not.toHaveBeenCalled();
  });

  it('does not let unattended repair mutate protected allowedSkillsJson scope, and truthfully records the attempt', async () => {
    let event = await trippedEvent();
    configsRepo.update('profile-1', { allowedSkillsJson: '["existing"]' });
    const triggerAutoRevert = vi.fn();
    const diagnose: DiagnoseCall = async () => ({
      diagnosis: 'Add a skill grant',
      rootCause: 'config',
      fixType: 'config-change',
      concreteFix: 'grant unrestricted skill access',
      confidence: 'high',
      configPatch: {
        agentConfigId: 'profile-1',
        field: 'allowedSkillsJson',
        value: '["existing","admin"]',
      },
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo }, triggerAutoRevert });
      // Non-actionable diagnosis: a real strike is recorded immediately
      // (nothing to wait evidence on), never a proposal.
      expect(result.attempts).toBe(attempt);
      event = result.event;
    }

    expect(event.guardrailStatus).toBe('tripped');
    expect(triggerAutoRevert).toHaveBeenCalledTimes(1);
    // Truthful accounting: 3 attempts consumed, but zero proposals — nothing
    // was ever mutated.
    expect(parseRepairProposalIds(event.repairProposalIdsJson)).toHaveLength(0);
    expect(configsRepo.getById('profile-1')?.allowedSkillsJson).toBe('["existing"]');
    expect(projectAgentProfileAfterWrite).not.toHaveBeenCalled();
  });

  it('a genuine but non-actionable diagnosis (wrong fixType) consumes a truthful attempt with no proposal', async () => {
    const event = await trippedEvent();
    const diagnose: DiagnoseCall = async () => ({
      diagnosis: 'The skill body itself is wrong',
      rootCause: 'skill',
      fixType: 'skill-edit',
      concreteFix: 'rewrite the skill body',
      confidence: 'high',
    });
    const result = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });
    expect(result.outcome).toBe('advancing');
    expect(result.attempts).toBe(1);
    expect(parseRepairProposalIds(result.event.repairProposalIdsJson)).toHaveLength(0);
    expect(result.event.repairRecheckAfter).toBeNull();
  });

  it('CAS write conflict (concurrent edit during proposal creation) defers without consuming a strike', async () => {
    const event = await trippedEvent();
    // Simulate a human/other-automation edit landing on the SAME field
    // during the (awaited) proposal-creation step, between this attempt's
    // pre-mutation read and its write.
    class ConcurrentEditProposalsRepo extends AgentOrgProposalsRepository {
      async createAsync(input: Parameters<AgentOrgProposalsRepository['createAsync']>[0]) {
        configsRepo.update('profile-1', { modelProvider: 'openai', modelId: 'concurrent-edit' });
        return super.createAsync(input);
      }
    }
    const conflictingProposalsRepo = new ConcurrentEditProposalsRepo(db);
    const triggerAutoRevert = vi.fn();

    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      proposalsRepo: conflictingProposalsRepo,
      triggerAutoRevert,
    });

    expect(result.outcome).toBe('deferred');
    expect(result.attempts).toBe(0);
    expect(triggerAutoRevert).not.toHaveBeenCalled();
    // The concurrent edit survives untouched — the repair never overwrote it.
    const config = configsRepo.getById('profile-1');
    expect(config?.modelProvider).toBe('openai');
    expect(config?.modelId).toBe('concurrent-edit');
  });

  it('crash/resume: a proposed-but-not-yet-claimed attempt resumes without a second mutation', async () => {
    const event = await trippedEvent();
    const diagnose = fakeDiagnose();
    // Pre-create the exact durable state a crash right after the config
    // mutation (but before claimAppliedWithSnapshotAsync) would leave: the
    // dedup-keyed proposal exists, `proposed`, with the pre-mutation
    // snapshot already durable, and the live config already mutated.
    const dedupKey = 'post-apply-repair:proposal-1:attempt:1';
    configsRepo.update('profile-1', { modelProvider: 'anthropic', modelId: 'claude-sonnet-1' });
    const revisionAfterCrash = configsRepo.getById('profile-1')!.revision;
    await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'Post-apply repair attempt 1',
      targetRef: 'profile:profile-1',
      changeJson: JSON.stringify({ source: 'auto-repair-service', profileId: 'profile-1', field: 'model' }),
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'profile-1',
        field: 'model',
        priorValue: null,
        expectedAppliedValue: 'anthropic/claude-sonnet-1',
      }),
      dedupKey,
    });

    const result = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo } });

    expect(result.outcome).toBe('pending');
    expect(result.attempts).toBe(1);
    const ids = parseRepairProposalIds(result.event.repairProposalIdsJson);
    expect(ids).toHaveLength(1);
    // Resumed the SAME proposal — never minted a second one for attempt 1.
    const allProposalsForKey = db
      .prepare(`SELECT COUNT(*) AS count FROM agent_org_proposals WHERE dedup_key = ?`)
      .get(dedupKey) as { count: number };
    expect(allProposalsForKey.count).toBe(1);
    // The config was NOT mutated a second time — its revision is exactly
    // what it was right after the (simulated) crashed write, plus the +1
    // the claim's own transition does not touch (claim only advances the
    // PROPOSAL, never re-writes the config).
    expect(configsRepo.getById('profile-1')?.revision).toBe(revisionAfterCrash);
    expect(configsRepo.getById('profile-1')?.modelId).toBe('claude-sonnet-1');
    expect((await proposalsRepo.findByIdAsync(ids[0]))?.status).toBe('applied');
  });

  it('finding #1: a landed config mutation is NOT claimed while the profile-file projection is blocked; a retry that projects cleanly settles without re-mutating', async () => {
    const event = await trippedEvent();
    const triggerAutoRevert = vi.fn();
    projectAgentProfileAfterWrite.mockReturnValueOnce({ kind: 'blocked', revision: 1 });

    const first = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      triggerAutoRevert,
    });

    // The DB half of the mutation DID land...
    const configAfterFirst = configsRepo.getById('profile-1');
    expect(configAfterFirst?.modelId).toBe('claude-sonnet-1');
    // ...but nothing was claimed/settled: no strike consumed, the event
    // stays exactly where it started — a caller can safely retry, and no
    // proposal is left sitting 'applied' behind an unprojected profile file.
    expect(first.outcome).toBe('deferred');
    expect(first.attempts).toBe(0);
    expect(first.event.repairAttemptCount).toBe(0);
    expect(parseRepairProposalIds(first.event.repairProposalIdsJson)).toHaveLength(0);
    const dedupKey = 'post-apply-repair:proposal-1:attempt:1';
    const pending = db
      .prepare(`SELECT status FROM agent_org_proposals WHERE dedup_key = ?`)
      .get(dedupKey) as { status: string } | undefined;
    expect(pending?.status).toBe('proposed');
    expect(triggerAutoRevert).not.toHaveBeenCalled();

    // Next tick: projection now settles. Must NOT re-mutate (same revision)
    // and must now claim + record the attempt.
    const revisionAfterFirst = configAfterFirst?.revision;
    const second = await runAutoRepairAsync(first.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      triggerAutoRevert,
    });
    expect(second.outcome).toBe('pending');
    expect(second.attempts).toBe(1);
    expect(configsRepo.getById('profile-1')?.revision).toBe(revisionAfterFirst);
    const settled = db
      .prepare(`SELECT status FROM agent_org_proposals WHERE dedup_key = ?`)
      .get(dedupKey) as { status: string };
    expect(settled.status).toBe('applied');
  });

  it('finding #2: resumes a durable proposed-but-unmutated attempt BEFORE diagnosing again — a failing diagnose must never be invoked when a durable attempt already exists', async () => {
    const event = await trippedEvent();
    const dedupKey = 'post-apply-repair:proposal-1:attempt:1';
    // Exact durable state a crash right after CREATING the proposal (but
    // BEFORE the config mutation) would leave: the row exists, 'proposed',
    // with its pre-mutation snapshot durable — the LIVE config has NOT been
    // mutated yet.
    await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'Post-apply repair attempt 1',
      targetRef: 'profile:profile-1',
      changeJson: JSON.stringify({ source: 'auto-repair-service', profileId: 'profile-1', field: 'model' }),
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'profile-1',
        field: 'model',
        priorValue: null,
        expectedAppliedValue: 'anthropic/claude-sonnet-1',
      }),
      dedupKey,
    });

    const diagnose = vi.fn(async () => {
      throw new Error('provider outage — must never be reached when a durable attempt already exists');
    });
    const outcomesRepo = new AgentRunOutcomesRepository(db);
    const deriveSignals = vi.spyOn(outcomesRepo, 'listByProfileSinceAsync');

    const result = await runAutoRepairAsync(event, { diagnosis: { diagnose, configsRepo }, outcomesRepo });

    expect(diagnose).not.toHaveBeenCalled();
    expect(deriveSignals).not.toHaveBeenCalled();
    expect(result.outcome).toBe('pending');
    expect(result.attempts).toBe(1);
    expect(configsRepo.getById('profile-1')?.modelId).toBe('claude-sonnet-1');
    const landed = db
      .prepare(`SELECT status FROM agent_org_proposals WHERE dedup_key = ?`)
      .get(dedupKey) as { status: string };
    expect(landed.status).toBe('applied');
  });

  it('never persists raw secrets from the diagnosis evidence into PostApplyEvent', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    const applied = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
    });
    seedEvidence('profile-1', applied.event.repairRecheckAfter!, 'completed', 5);
    const repaired = await runAutoRepairAsync(applied.event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
    });
    expect(repaired.outcome).toBe('repaired');
    const raw = db.prepare(`SELECT * FROM agent_org_post_apply_events WHERE proposal_id = ?`).get('proposal-1');
    expect(JSON.stringify(raw)).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/);
  });
});
