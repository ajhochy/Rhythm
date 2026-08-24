/**
 * D2.2 (#1432) — the post-apply guardrail monitor.
 *
 * Covers: starting monitoring after an apply, tripping on a real guardrail
 * breach (reusing C3's closed `evaluateGuardrails` — never reimplemented),
 * clearing when the window expires with no breach, and the monitor being a
 * permanent no-op once it has left the `monitoring` state (the acceptance
 * criterion "monitor stops after window expires").
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import {
  evaluatePostApplyGuardrailsAsync,
  registerAutoRepairTrigger,
  resetAutoRepairTriggerForTests,
  startPostApplyMonitoringAsync,
} from '../post_apply_monitor';

let db: Database.Database;
let proposalsRepo: AgentOrgProposalsRepository;
let eventsRepo: PostApplyEventsRepository;

function insertOutcome(over: {
  id: string;
  profileId: string;
  finalizedAt: string;
  terminalStatus?: string;
}): void {
  db.prepare(
    `INSERT INTO agent_run_outcomes
       (id, session_id, root_session_id, profile_id, terminal_status, objective_verdict, finalized_at)
     VALUES (?, ?, ?, ?, ?, 'success', ?)`,
  ).run(over.id, over.id, over.id, over.profileId, over.terminalStatus ?? 'completed', over.finalizedAt);
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  proposalsRepo = new AgentOrgProposalsRepository(db);
  eventsRepo = new PostApplyEventsRepository(db);
  await proposalsRepo.createAsync({
    id: 'proposal-1',
    kind: 'refine-config',
    risk: 'high',
    title: 'test proposal',
    status: 'applied',
  });
});

afterEach(() => {
  resetAutoRepairTriggerForTests();
});

describe('D2.2 startPostApplyMonitoringAsync', () => {
  it('creates a monitoring PostApplyEvent with a window offset from now', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const event = await startPostApplyMonitoringAsync(
      {
        proposalId: 'proposal-1',
        profileId: 'profile-1',
        changeType: 'prompt',
        preChangeSnapshotJson: JSON.stringify({ profileId: 'profile-1', revisionBefore: 1 }),
        now,
        windowMs: 60 * 60 * 1000,
      },
      { eventsRepo },
    );
    expect(event.guardrailStatus).toBe('monitoring');
    expect(event.monitoringWindowStart).toBe('2026-08-18T00:00:00.000Z');
    expect(event.monitoringWindowEnd).toBe('2026-08-18T01:00:00.000Z');
  });
});

describe('D2.2 evaluatePostApplyGuardrailsAsync', () => {
  it('trips on a real guardrail breach and triggers auto-repair', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      // Window still open — a trip must fire mid-window, not only at expiry.
      monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
    });

    // 4 errors / 6 total = 0.667 > the terminal-error-rate ceiling (0.5),
    // with enough samples to clear the "avoid tripping on n=1" floor.
    insertOutcome({ id: 'o1', profileId: 'profile-1', finalizedAt: '2026-08-18T00:10:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o2', profileId: 'profile-1', finalizedAt: '2026-08-18T00:11:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o3', profileId: 'profile-1', finalizedAt: '2026-08-18T00:12:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o4', profileId: 'profile-1', finalizedAt: '2026-08-18T00:13:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o5', profileId: 'profile-1', finalizedAt: '2026-08-18T00:14:00.000Z', terminalStatus: 'completed' });
    insertOutcome({ id: 'o6', profileId: 'profile-1', finalizedAt: '2026-08-18T00:15:00.000Z', terminalStatus: 'completed' });

    const triggerAutoRepair = vi.fn();
    const result = await evaluatePostApplyGuardrailsAsync(event, { eventsRepo, triggerAutoRepair });

    expect(result.action).toBe('tripped');
    expect(result.event.guardrailStatus).toBe('tripped');
    expect(result.breaches.some((b) => b.guardrail === 'terminal-error-rate')).toBe(true);
    expect(triggerAutoRepair).toHaveBeenCalledTimes(1);
    expect(triggerAutoRepair.mock.calls[0][0].proposalId).toBe('proposal-1');

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-1');
    expect(persisted?.guardrailStatus).toBe('tripped');
  });

  it('clears with no repair when the window expires with no breach', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });
    insertOutcome({ id: 'o1', profileId: 'profile-1', finalizedAt: '2026-08-18T00:10:00.000Z', terminalStatus: 'completed' });

    const triggerAutoRepair = vi.fn();
    const result = await evaluatePostApplyGuardrailsAsync(event, {
      eventsRepo,
      triggerAutoRepair,
      now: new Date('2026-08-18T02:00:00.000Z'), // after monitoringWindowEnd
    });

    expect(result.action).toBe('cleared');
    expect(result.event.guardrailStatus).toBe('clear');
    expect(triggerAutoRepair).not.toHaveBeenCalled();

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-1');
    expect(persisted?.guardrailStatus).toBe('clear');
  });

  it('ignores outcomes finalized after the monitoring window ended', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });
    for (let i = 0; i < 5; i += 1) {
      insertOutcome({
        id: `late-${i}`,
        profileId: 'profile-1',
        finalizedAt: `2026-08-18T02:0${i}:00.000Z`,
        terminalStatus: 'error',
      });
    }
    const triggerAutoRepair = vi.fn();

    const result = await evaluatePostApplyGuardrailsAsync(event, {
      eventsRepo,
      triggerAutoRepair,
      now: new Date('2026-08-18T03:00:00.000Z'),
    });

    expect(result.action).toBe('cleared');
    expect(triggerAutoRepair).not.toHaveBeenCalled();
  });

  it('stays in monitoring (no action) when the window has not expired and there is no breach', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
    });

    const triggerAutoRepair = vi.fn();
    const result = await evaluatePostApplyGuardrailsAsync(event, {
      eventsRepo,
      triggerAutoRepair,
      now: new Date('2026-08-18T00:30:00.000Z'),
    });

    expect(result.action).toBe('still-monitoring');
    expect(result.event.guardrailStatus).toBe('monitoring');
    expect(triggerAutoRepair).not.toHaveBeenCalled();

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-1');
    expect(persisted?.guardrailStatus).toBe('monitoring');
  });

  it('is a permanent no-op once the monitor has left the monitoring state', async () => {
    await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });
    const cleared = await eventsRepo.updateStatusAsync('proposal-1', { guardrailStatus: 'clear' });

    // Regression this catches: re-evaluating a cleared (or tripped) event
    // re-triggering repair or flapping its status back to 'tripped' on a
    // later, unrelated burst of errors — "monitor stops after window
    // expires" must mean STOPS, not "keeps re-deciding forever".
    insertOutcome({ id: 'o1', profileId: 'profile-1', finalizedAt: '2026-08-18T05:00:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o2', profileId: 'profile-1', finalizedAt: '2026-08-18T05:01:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o3', profileId: 'profile-1', finalizedAt: '2026-08-18T05:02:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o4', profileId: 'profile-1', finalizedAt: '2026-08-18T05:03:00.000Z', terminalStatus: 'error' });
    insertOutcome({ id: 'o5', profileId: 'profile-1', finalizedAt: '2026-08-18T05:04:00.000Z', terminalStatus: 'error' });

    const triggerAutoRepair = vi.fn();
    const result = await evaluatePostApplyGuardrailsAsync(cleared!, { eventsRepo, triggerAutoRepair });

    expect(result.action).toBe('no-op-terminal');
    expect(result.event.guardrailStatus).toBe('clear');
    expect(triggerAutoRepair).not.toHaveBeenCalled();
  });

  it('falls back to the globally registered auto-repair trigger when no per-call trigger is given', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
    });
    for (let i = 0; i < 5; i += 1) {
      insertOutcome({
        id: `reg-o${i}`,
        profileId: 'profile-1',
        finalizedAt: `2026-08-18T00:1${i}:00.000Z`,
        terminalStatus: 'error',
      });
    }

    const registered = vi.fn();
    registerAutoRepairTrigger(registered);

    const result = await evaluatePostApplyGuardrailsAsync(event, { eventsRepo });
    expect(result.action).toBe('tripped');
    expect(registered).toHaveBeenCalledTimes(1);
  });

  it('allows only the conditional monitoring-to-tripped winner to trigger repair', async () => {
    const event = await eventsRepo.createAsync({
      proposalId: 'proposal-1', profileId: 'profile-1', changeType: 'prompt',
      preChangeSnapshotJson: '{}', monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
    });
    for (let i = 0; i < 5; i += 1) {
      insertOutcome({ id: `cas-${i}`, profileId: 'profile-1', finalizedAt: `2026-08-18T00:1${i}:00.000Z`, terminalStatus: 'error' });
    }
    const trigger = vi.fn();
    await Promise.all([
      evaluatePostApplyGuardrailsAsync(event, { eventsRepo, triggerAutoRepair: trigger }),
      evaluatePostApplyGuardrailsAsync(event, { eventsRepo, triggerAutoRepair: trigger }),
    ]);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
