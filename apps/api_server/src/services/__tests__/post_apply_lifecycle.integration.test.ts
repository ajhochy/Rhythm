/**
 * Acceptance contract for #1435.
 *
 * Regression pinned: a successful profile apply must be owned by one durable
 * monitor which settles the original proposal exactly once after clear,
 * repair, or revert. Assertions below fail if enrollment, trigger wiring,
 * sweeping, awaited revert, or terminal-state exclusion is removed.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import type { DiagnoseCall } from '../generators/workflow_signal_generator';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { resetProposalPluginsForTests } from '../org_proposal_apply_service';
import { OrgProposalsController } from '../../controllers/org_proposals_controller';

const lifecycleModule = '../post_apply_lifecycle';
const SECRET = 'Bearer issue1435_unique_sentinel_0123456789';

let db: Database.Database;
let configsRepo: AgentConfigsRepository;
let proposalsRepo: AgentOrgProposalsRepository;
let eventsRepo: PostApplyEventsRepository;

async function lifecycle() {
  return import(lifecycleModule);
}

function insertOutcome(id: string, profileId: string, finalizedAt: Date, terminalStatus: string): void {
  db.prepare(
    `INSERT INTO agent_run_outcomes
       (id, session_id, root_session_id, profile_id, terminal_status, objective_verdict, finalized_at)
     VALUES (?, ?, ?, ?, ?, 'success', ?)`,
  ).run(id, id, id, profileId, terminalStatus, finalizedAt.toISOString());
}

async function approveModelChange(id: string, value: string) {
  const proposal = await proposalsRepo.createAsync({
    id,
    kind: 'refine-config',
    risk: 'high',
    status: 'proposed',
    title: `model change ${id}`,
    targetRef: 'profile:profile-1',
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: 'profile-1', field: 'model', value },
    }),
  });
  const response = { json: vi.fn() };
  const next = vi.fn();
  await new OrgProposalsController().approve(
    { params: { id }, auth: { user: { id: 7 } } } as never,
    response as never,
    next,
  );
  expect(next).not.toHaveBeenCalled();
  return proposal;
}

function repairDiagnose(): DiagnoseCall {
  let attempt = 0;
  return async () => {
    attempt += 1;
    return {
      diagnosis: `${SECRET} diagnosis ${attempt}`,
      rootCause: 'config',
      fixType: 'config-change',
      concreteFix: `${SECRET} concrete fix ${attempt}`,
      confidence: 'high',
      configPatch: {
        agentConfigId: 'untrusted-id',
        field: 'model',
        value: `anthropic/repair-${attempt}`,
      },
    };
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  resetProposalPluginsForTests();
  registerAllProposalAppliers();
  configsRepo = new AgentConfigsRepository();
  proposalsRepo = new AgentOrgProposalsRepository(db);
  eventsRepo = new PostApplyEventsRepository(db);
  configsRepo.insert({
    id: 'profile-1',
    label: 'Profile 1',
    icon: 'x',
    modelProvider: 'anthropic',
    modelId: 'before',
  });
});

afterEach(async () => {
  try {
    const mod = await lifecycle();
    mod.resetPostApplyLifecycleForTests?.();
  } catch {
    // Expected during the required pre-implementation red run.
  }
  vi.restoreAllMocks();
  db.close();
});

describe('D2.5 post-apply lifecycle integration', () => {
  it('bad apply trips and repair attempt 1 succeeds without revert or alert', async () => {
    await approveModelChange('proposal-repaired', 'anthropic/applied');
    const event = await eventsRepo.findByProposalIdAsync('proposal-repaired');
    expect(event, 'successful profile apply must enroll exactly one event').not.toBeNull();

    // Trip evidence lands WITHIN the window but strictly before the sweep
    // instant, so attempt 1's own recheck floor (set to `sweepAt`) correctly
    // excludes it as stale — it must never be re-blamed on the fix.
    const tripAt = new Date(new Date(event!.monitoringWindowStart).getTime() + 1_000);
    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`trip-success-${index}`, 'profile-1', tripAt, 'error');
    }
    const sweepAt = new Date(new Date(event!.monitoringWindowStart).getTime() + 60_000);

    const mod = await lifecycle();
    mod.registerPostApplyLifecycleTriggers({
      diagnosis: { diagnose: repairDiagnose(), configsRepo },
      diagnosisReady: () => true,
      now: () => sweepAt,
    });

    // Sweep 1: trips the guardrail and lands repair attempt 1 — no REAL
    // evidence exists for it yet, so it must NOT be declared clear here.
    await mod.sweepPostApplyLifecycleAsync({ now: sweepAt });
    const afterAttempt1 = await eventsRepo.findByProposalIdAsync('proposal-repaired');
    expect(afterAttempt1).toMatchObject({ guardrailStatus: 'tripped', revertStatus: 'none' });
    const repairIds = JSON.parse(afterAttempt1!.repairProposalIdsJson) as string[];
    expect(repairIds).toHaveLength(1);
    expect(await proposalsRepo.findByIdAsync(repairIds[0])).toMatchObject({ status: 'applied' });
    expect(configsRepo.getById('profile-1')).toMatchObject({
      modelProvider: 'anthropic',
      modelId: 'repair-1',
    });

    // Real post-repair evidence: 5 clean outcomes finalized after the
    // repair's own recheck floor.
    const recheckAfter = new Date(afterAttempt1!.repairRecheckAfter!);
    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`post-repair-clean-${index}`, 'profile-1', new Date(recheckAfter.getTime() + 1_000 + index), 'completed');
    }

    // Sweep 2: sufficient clean evidence clears the guardrail for real.
    await mod.sweepPostApplyLifecycleAsync({ now: sweepAt });

    const settledEvent = await eventsRepo.findByProposalIdAsync('proposal-repaired');
    const original = await proposalsRepo.findByIdAsync('proposal-repaired');
    expect(await Promise.all(repairIds.map((id) => eventsRepo.findByProposalIdAsync(id))))
      .toEqual([null]);
    expect((db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events').get() as { count: number }).count)
      .toBe(1);
    expect(settledEvent).toMatchObject({ guardrailStatus: 'clear', revertStatus: 'not_needed' });
    expect(settledEvent?.alertPayloadJson).toBeNull();
    expect(original?.status).toBe('active');
    expect(configsRepo.getById('profile-1')).toMatchObject({
      modelProvider: 'anthropic',
      modelId: 'repair-1',
    });
  });

  it('three failed repairs (each evidence-confirmed) await auto-revert, restore bytes, revert original, and persist a safe alert', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await approveModelChange('proposal-reverted', 'anthropic/applied');
    const event = await eventsRepo.findByProposalIdAsync('proposal-reverted');
    expect(event).not.toBeNull();
    const tripAt = new Date(new Date(event!.monitoringWindowStart).getTime() + 1_000);
    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`trip-fail-${index}`, 'profile-1', tripAt, 'error');
    }
    const sweepAt = new Date(new Date(event!.monitoringWindowStart).getTime() + 60_000);

    const mod = await lifecycle();
    mod.registerPostApplyLifecycleTriggers({
      diagnosis: { diagnose: repairDiagnose(), configsRepo },
      diagnosisReady: () => true,
      now: () => sweepAt,
    });

    // Sweep 1: trips + lands repair attempt 1.
    await mod.sweepPostApplyLifecycleAsync({ now: sweepAt });
    let current = await eventsRepo.findByProposalIdAsync('proposal-reverted');
    let failSeq = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // Real evidence for THIS attempt: 5 fresh error outcomes after its
      // own recheck floor — every attempt is genuinely re-evaluated.
      const recheckAfter = new Date(current!.repairRecheckAfter!);
      for (let i = 0; i < 5; i += 1, failSeq += 1) {
        insertOutcome(`repair-fail-${failSeq}`, 'profile-1', new Date(recheckAfter.getTime() + 1_000 + i), 'error');
      }
      await mod.sweepPostApplyLifecycleAsync({ now: sweepAt }); // evaluate this attempt
      current = await eventsRepo.findByProposalIdAsync('proposal-reverted');
      if (attempt < 3) {
        await mod.sweepPostApplyLifecycleAsync({ now: sweepAt }); // land the next attempt
        current = await eventsRepo.findByProposalIdAsync('proposal-reverted');
      }
    }

    const settledEvent = current;
    const repairIds = JSON.parse(settledEvent!.repairProposalIdsJson) as string[];
    expect(repairIds).toHaveLength(3);
    expect(await Promise.all(repairIds.map((id) => proposalsRepo.findByIdAsync(id))))
      .toSatisfy((rows: unknown[]) => rows.every((row) => (row as { status: string }).status === 'applied'));
    expect(settledEvent).toMatchObject({ guardrailStatus: 'tripped', revertStatus: 'reverted' });
    expect((await proposalsRepo.findByIdAsync('proposal-reverted'))?.status).toBe('reverted');
    expect(`${configsRepo.getById('profile-1')?.modelProvider}/${configsRepo.getById('profile-1')?.modelId}`)
      .toBe('anthropic/before');
    expect(settledEvent?.alertPayloadJson).toBeTruthy();

    const newAuditRows = db.prepare(
      `SELECT change_json, rationale, title FROM agent_org_proposals
        WHERE id IN (${repairIds.map(() => '?').join(',')})`,
    ).all(...repairIds);
    const persistedNewData = JSON.stringify({ event: settledEvent, repairs: newAuditRows });
    expect(persistedNewData).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });

  it('an expired clear settles active and later outcomes cannot reopen the terminal event', async () => {
    await approveModelChange('proposal-clear', 'anthropic/applied');
    const event = await eventsRepo.findByProposalIdAsync('proposal-clear');
    expect(event).not.toBeNull();
    const expiredAt = new Date(new Date(event!.monitoringWindowEnd).getTime() + 1);

    const mod = await lifecycle();
    const diagnose = vi.fn(repairDiagnose());
    mod.registerPostApplyLifecycleTriggers({
      diagnosis: { diagnose, configsRepo },
      diagnosisReady: () => true,
      now: () => expiredAt,
    });
    await mod.sweepPostApplyLifecycleAsync({ now: expiredAt });
    expect(await eventsRepo.findByProposalIdAsync('proposal-clear')).toMatchObject({
      guardrailStatus: 'clear',
      revertStatus: 'not_needed',
    });
    expect((await proposalsRepo.findByIdAsync('proposal-clear'))?.status).toBe('active');

    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`late-${index}`, 'profile-1', new Date(expiredAt.getTime() + index + 1), 'error');
    }
    await mod.sweepPostApplyLifecycleAsync({ now: new Date(expiredAt.getTime() + 60_000) });
    expect(await eventsRepo.findByProposalIdAsync('proposal-clear')).toMatchObject({
      guardrailStatus: 'clear',
      repairProposalIdsJson: '[]',
      revertStatus: 'not_needed',
    });
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('defers a tripped event while diagnosis is not ready without consuming repair or reverting', async () => {
    // Regression caught: engine readiness false still consumes attempts or
    // reverts a committed human mutation instead of leaving the trip pending.
    await approveModelChange('proposal-deferred', 'anthropic/applied');
    await eventsRepo.updateStatusAsync('proposal-deferred', { guardrailStatus: 'tripped' });
    const mod = await lifecycle();
    const diagnose = vi.fn(repairDiagnose());
    mod.registerPostApplyLifecycleTriggers({
      diagnosis: { diagnose, configsRepo },
      diagnosisReady: () => false,
    });

    expect(await mod.sweepPostApplyLifecycleAsync()).toEqual({ processed: 1, skipped: false });
    expect(diagnose).not.toHaveBeenCalled();
    expect(await eventsRepo.findByProposalIdAsync('proposal-deferred')).toMatchObject({
      guardrailStatus: 'tripped',
      repairProposalIdsJson: '[]',
      revertStatus: 'none',
    });
    expect((await proposalsRepo.findByIdAsync('proposal-deferred'))?.status).toBe('measuring');
    expect(configsRepo.getById('profile-1')?.modelId).toBe('applied');
  });

  it('isolates a rejected event trigger so the next actionable event still repairs and clears', async () => {
    await approveModelChange('proposal-trigger-rejects', 'anthropic/first');
    await approveModelChange('proposal-after-rejection', 'anthropic/second');
    const repairableEvent = await eventsRepo.findByProposalIdAsync('proposal-after-rejection');
    const windowStart = new Date(repairableEvent!.monitoringWindowStart);
    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`trip-evidence-${index}`, 'profile-1', new Date(windowStart.getTime() + 1_000 + index), 'error');
    }
    await eventsRepo.updateStatusAsync('proposal-trigger-rejects', { guardrailStatus: 'tripped' });
    await eventsRepo.updateStatusAsync('proposal-after-rejection', { guardrailStatus: 'tripped' });
    const mod = await lifecycle();
    let readinessCalls = 0;
    // The repair floor must follow the real breach evidence so the next
    // evidence window does not re-blame the repair for the original trip.
    const sweepAt = new Date(windowStart.getTime() + 10_000);
    mod.registerPostApplyLifecycleTriggers({
      diagnosis: { diagnose: repairDiagnose(), configsRepo },
      diagnosisReady: () => {
        readinessCalls += 1;
        if (readinessCalls === 1) throw new Error(`${SECRET} trigger rejected`);
        return true;
      },
      now: () => sweepAt,
    });

    expect(await mod.sweepPostApplyLifecycleAsync()).toEqual({ processed: 1, skipped: false });
    expect(await eventsRepo.findByProposalIdAsync('proposal-trigger-rejects')).toMatchObject({
      guardrailStatus: 'tripped', repairProposalIdsJson: '[]', revertStatus: 'none',
    });
    // Attempt 1 landed for the isolated event, but with no REAL evidence yet
    // it must stay tripped, not be declared clear on the same tick.
    const afterAttempt1 = await eventsRepo.findByProposalIdAsync('proposal-after-rejection');
    expect(afterAttempt1).toMatchObject({ guardrailStatus: 'tripped', revertStatus: 'none' });
    expect(JSON.parse(afterAttempt1!.repairProposalIdsJson)).toHaveLength(1);

    // Real post-repair evidence + another sweep: the isolated event still
    // repairs and clears on its own — one rejected trigger did not
    // permanently wedge it.
    const recheckAfter = new Date(afterAttempt1!.repairRecheckAfter!);
    for (let index = 0; index < 5; index += 1) {
      insertOutcome(`clear-evidence-${index}`, 'profile-1', new Date(recheckAfter.getTime() + 1_000 + index), 'completed');
    }
    await mod.sweepPostApplyLifecycleAsync();
    expect(await eventsRepo.findByProposalIdAsync('proposal-after-rejection')).toMatchObject({
      guardrailStatus: 'clear', revertStatus: 'not_needed',
    });
  });

  it('skips an overlapping sweep while the first actionable-list read is in flight', async () => {
    const mod = await lifecycle();
    let release!: (events: never[]) => void;
    const held = new Promise<never[]>((resolve) => { release = resolve; });
    const list = vi.spyOn(PostApplyEventsRepository.prototype, 'listActionableAsync')
      .mockImplementationOnce(() => held);

    const first = mod.sweepPostApplyLifecycleAsync();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(await mod.sweepPostApplyLifecycleAsync()).toEqual({ processed: 0, skipped: true });
    expect(list).toHaveBeenCalledTimes(1);
    release([]);
    expect(await first).toEqual({ processed: 0, skipped: false });
  });

  it('passes the requested bound to the repository and never processes beyond it', async () => {
    await approveModelChange('proposal-bound-1', 'anthropic/one');
    await approveModelChange('proposal-bound-2', 'anthropic/two');
    await approveModelChange('proposal-bound-3', 'anthropic/three');
    const list = vi.spyOn(PostApplyEventsRepository.prototype, 'listActionableAsync');
    const mod = await lifecycle();

    const result = await mod.sweepPostApplyLifecycleAsync({ limit: 2 });

    expect(list).toHaveBeenCalledWith(2);
    expect(result.processed).toBeLessThanOrEqual(2);
  });

  it('Postgres skips enrollment and sweeping without constructing the SQLite event repository', async () => {
    const priorDbClient = env.dbClient;
    const create = vi.spyOn(PostApplyEventsRepository.prototype, 'createAsync');
    const list = vi.spyOn(PostApplyEventsRepository.prototype, 'listActionableAsync');
    const proposal = (await proposalsRepo.createAsync({
      id: 'postgres-skip', kind: 'refine-config', risk: 'high', status: 'applied',
      title: 'postgres skip', changeJson: '{}', beforeSnapshotJson: '{}',
    }));
    try {
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';
      const mod = await lifecycle();
      expect(await mod.finalizePostApplyLifecycleAsync(proposal, {
        profileId: 'profile-1', changeType: 'prompt',
      })).toBeNull();
      expect(await mod.sweepPostApplyLifecycleAsync()).toEqual({ processed: 0, skipped: true });
      expect(create).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    } finally {
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = priorDbClient;
    }
  });
});
