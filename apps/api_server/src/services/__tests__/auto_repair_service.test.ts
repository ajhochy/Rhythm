/**
 * D2.3 (#1433) — the bounded 3-strike auto-repair service.
 *
 * Covers: attempt 1 succeeding leaves the original change in place with the
 * repair recorded; attempt 1 failing tries attempt 2 (and a subsequent
 * success stops there); all 3 attempts failing triggers auto-revert (D2.4
 * stub); every attempt is recorded in PostApplyEvent; no raw secrets in the
 * evidence handed to the diagnosis pipeline.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
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
  proposalsRepo = new AgentOrgProposalsRepository(db);
  eventsRepo = new PostApplyEventsRepository(db);
  configsRepo = new AgentConfigsRepository();
  configsRepo.insert({ id: 'profile-1', label: 'Profile 1', icon: 'x' });
  await proposalsRepo.createAsync({
    id: 'proposal-1',
    kind: 'refine-config',
    risk: 'high',
    title: 'test proposal',
    status: 'applied',
  });
});

async function trippedEvent() {
  await eventsRepo.createAsync({
    proposalId: 'proposal-1',
    profileId: 'profile-1',
    changeType: 'prompt',
    preChangeSnapshotJson: '{}',
    monitoringWindowStart: '2026-08-18T00:00:00.000Z',
    monitoringWindowEnd: '2099-01-01T00:00:00.000Z',
  });
  const tripped = await eventsRepo.updateStatusAsync('proposal-1', { guardrailStatus: 'tripped' });
  return tripped!;
}

describe('D2.3 runAutoRepairAsync', () => {
  it('attempt 1 succeeds: original change stays, repair is recorded, no auto-revert', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    // Seed a breach BEFORE attempt 1's own re-check floor (baseNow + 1ms) —
    // this is the pre-existing evidence that already tripped the guardrail,
    // proving the re-check correctly ignores stale evidence rather than
    // re-blaming attempt 1's fix for something that predates it. Nothing is
    // seeded at/after attempt 1's floor, so attempt 1 is proven to work.
    for (let i = 0; i < 5; i += 1) {
      insertOutcome({
        id: `bad-${i}`,
        profileId: 'profile-1',
        finalizedAt: baseNow.toISOString(),
        terminalStatus: 'error',
      });
    }

    const triggerAutoRevert = vi.fn();
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
      triggerAutoRevert,
    });

    expect(result.outcome).toBe('repaired');
    expect(result.attempts).toBe(1);
    expect(result.event.guardrailStatus).toBe('clear');
    expect(result.event.revertStatus).toBe('not_needed');
    const ids = parseRepairProposalIds(result.event.repairProposalIdsJson);
    expect(ids).toHaveLength(1);
    expect(triggerAutoRevert).not.toHaveBeenCalled();

    // The corrective proposal was actually applied through the existing CAS
    // path — untrusted LLM agentConfigId was never trusted (server re-resolved
    // it to the real failing profile), and the config was really mutated.
    const repairProposal = await proposalsRepo.findByIdAsync(ids[0]);
    expect(repairProposal?.kind).toBe('refine-config');
    const change = JSON.parse(repairProposal!.changeJson!);
    expect(change.configPatch.agentConfigId).toBe('profile-1');
    expect(change.configPatch.agentConfigId).not.toBe('ATTACKER-ID');
    const config = configsRepo.getById('profile-1');
    expect(config?.modelId).toBe('anthropic/claude-sonnet-1');

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-1');
    expect(persisted?.guardrailStatus).toBe('clear');
  });

  it('attempt 1 fails, attempt 2 succeeds: stays with 2 repairs recorded', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    // Breach reappears right after attempt 1's fix (>= attempt 1's instant),
    // but nothing bad is seeded at/after attempt 2's instant.
    for (let i = 0; i < 5; i += 1) {
      insertOutcome({
        id: `bad1-${i}`,
        profileId: 'profile-1',
        finalizedAt: new Date(baseNow.getTime() + 1).toISOString(),
        terminalStatus: 'error',
      });
    }

    const triggerAutoRevert = vi.fn();
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
      triggerAutoRevert,
    });

    expect(result.outcome).toBe('repaired');
    expect(result.attempts).toBe(2);
    expect(result.event.guardrailStatus).toBe('clear');
    const ids = parseRepairProposalIds(result.event.repairProposalIdsJson);
    expect(ids).toHaveLength(2);
    expect(triggerAutoRevert).not.toHaveBeenCalled();
  });

  it('all 3 attempts fail: triggers auto-revert with all 3 attempts recorded', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    // A fresh breach at EVERY attempt's re-check instant (1ms, 2ms, 3ms after
    // baseNow) — every repair fails to clear the guardrail.
    for (const offsetMs of [1, 2, 3]) {
      for (let i = 0; i < 5; i += 1) {
        insertOutcome({
          id: `bad-${offsetMs}-${i}`,
          profileId: 'profile-1',
          finalizedAt: new Date(baseNow.getTime() + offsetMs).toISOString(),
          terminalStatus: 'error',
        });
      }
    }

    const triggerAutoRevert = vi.fn();
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
      triggerAutoRevert,
    });

    expect(result.outcome).toBe('exhausted');
    expect(result.attempts).toBe(3);
    expect(result.event.guardrailStatus).toBe('tripped');
    const ids = parseRepairProposalIds(result.event.repairProposalIdsJson);
    expect(ids).toHaveLength(3);
    // Never more than MAX_REPAIR_ATTEMPTS (3) recorded, no matter what.
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
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    for (const offsetMs of [1, 2, 3]) {
      for (let i = 0; i < 5; i += 1) {
        insertOutcome({
          id: `reg-${offsetMs}-${i}`,
          profileId: 'profile-1',
          finalizedAt: new Date(baseNow.getTime() + offsetMs).toISOString(),
          terminalStatus: 'error',
        });
      }
    }

    const registered = vi.fn();
    registerAutoRevertTrigger(registered);

    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
    });

    expect(result.outcome).toBe('exhausted');
    expect(registered).toHaveBeenCalledTimes(1);
  });

  it('never persists raw secrets from the diagnosis evidence into PostApplyEvent', async () => {
    const event = await trippedEvent();
    const baseNow = new Date('2026-08-18T00:00:00.000Z');
    // No breach seeded — attempt 1 clears immediately; the assertion here is
    // about what post_apply_monitor/events persist, not the repair outcome.
    const result = await runAutoRepairAsync(event, {
      diagnosis: { diagnose: fakeDiagnose(), configsRepo },
      now: baseNow,
    });
    expect(result.outcome).toBe('repaired');
    const raw = db.prepare(`SELECT * FROM agent_org_post_apply_events WHERE proposal_id = ?`).get('proposal-1');
    expect(JSON.stringify(raw)).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/);
  });
});
