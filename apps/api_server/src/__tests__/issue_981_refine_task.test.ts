/**
 * CONTRACT TEST for issue #981 — the `refine-task` org-optimizer proposal kind
 * (edit a scheduled-task definition: instructions/prompt, schedule, or agent
 * binding). Mirrors the refine-config validator/applier/revert machinery.
 *
 * Covers:
 *  - #981-risk: classifyProposalRisk('refine-task') === 'high' (human-gated).
 *  - #981-validate: validateProposalChange refuses a prose-only proposal (no
 *    taskPatch) and a stale scheduledTaskId; accepts a well-formed patch on a
 *    live task.
 *  - #981-apply: applyProposal snapshots the prior field value, mutates the
 *    agent_scheduled_tasks row via the repository (never raw SQL), returns
 *    {measurable:true, beforeSnapshotJson}; a text (prompt) edit reshapes
 *    change_json into a BodyRefinementChange for the LLM-judge measure path.
 *  - #981-revert: revertProposal restores the exact prior field value.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { classifyProposalRisk } from '../services/org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import {
  applyProposal,
  validateProposalChange,
  registerProposalApplier,
  registerProposalValidator,
  resetProposalPluginsForTests,
} from '../services/org_proposal_apply_service';
import { revertProposal } from '../services/org_proposal_apply';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(async () => {
  setDb(makeDb());
  resetProposalPluginsForTests();
  const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
  registerAllProposalAppliers({ registerProposalApplier, registerProposalValidator });
});

describe('#981-risk: refine-task is human-gated (high risk)', () => {
  it('classifies refine-task as high even with a well-formed taskPatch', () => {
    expect(
      classifyProposalRisk({
        kind: 'refine-task',
        changeJson: JSON.stringify({ taskPatch: { scheduledTaskId: 't1', field: 'prompt', value: 'x' } }),
      }),
    ).toBe('high');
  });
});

describe('#981-validate: refine-task re-validation at apply time', () => {
  it('refuses a prose-only proposal that carries no taskPatch', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-task',
      risk: 'high',
      title: 'Fix the scheduled task instructions',
      changeJson: JSON.stringify({ concreteFix: 'rewrite the instructions', fixType: 'task-change' }),
      dedupKey: 'refine-task:prose-only',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
    expect(validation.reason ?? '').toMatch(/taskPatch/);
  });

  it('refuses a taskPatch whose scheduledTaskId no longer exists', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-task',
      risk: 'high',
      title: 'Fix a since-deleted task',
      changeJson: JSON.stringify({
        taskPatch: { scheduledTaskId: 'does-not-exist', field: 'prompt', value: 'new' },
      }),
      dedupKey: 'refine-task:stale',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
    expect(validation.reason ?? '').toMatch(/no longer exists/);
  });

  it('accepts a well-formed taskPatch on a live scheduled task', async () => {
    const task = await new AgentScheduledTasksRepository().createAsync({
      name: 'Daily digest',
      scheduleType: 'daily',
      prompt: 'old instructions',
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-task',
      risk: 'high',
      title: 'Sharpen the digest instructions',
      changeJson: JSON.stringify({
        taskPatch: { scheduledTaskId: task.id, field: 'prompt', value: 'new instructions' },
      }),
      dedupKey: `refine-task:${task.id}`,
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(true);
  });
});

describe('#981-apply/revert: mutate the scheduled task, then restore it', () => {
  it('snapshots the prior prompt, applies the new one, reshapes change_json, and reverts cleanly', async () => {
    const tasksRepo = new AgentScheduledTasksRepository();
    const task = await tasksRepo.createAsync({
      name: 'Weekly report',
      scheduleType: 'weekly',
      prompt: 'old instructions',
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-task',
      risk: 'high',
      title: 'Rewrite the weekly report instructions',
      changeJson: JSON.stringify({
        affectedSkill: 'reporter',
        sessionIds: [],
        taskPatch: { scheduledTaskId: task.id, field: 'prompt', value: 'new instructions' },
      }),
      dedupKey: `refine-task:${task.id}`,
    });

    // Apply — mutates the live task row and returns a measurable result.
    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    expect(result.beforeSnapshotJson).toBeTruthy();
    const snapshot = JSON.parse(result.beforeSnapshotJson!);
    expect(snapshot).toEqual({ scheduledTaskId: task.id, field: 'prompt', priorValue: 'old instructions' });
    // A text edit reshapes change_json into the BodyRefinementChange the
    // LLM-judge measure path reads (additively — taskPatch is preserved).
    const reshaped = JSON.parse(result.changeJson!);
    expect(reshaped.priorBody).toBe('old instructions');
    expect(reshaped.revisedBody).toBe('new instructions');
    expect(reshaped.taskPatch.field).toBe('prompt');

    const after = await tasksRepo.findByIdAsync(task.id);
    expect(after?.prompt).toBe('new instructions');

    // Drive the real approve-flow persistence, then revert from the snapshot.
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
      beforeSnapshotJson: result.beforeSnapshotJson,
      changeJson: result.changeJson,
    });
    const measuring = await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const outcome = await revertProposal(measuring!);
    expect(outcome).toBe('reverted');

    const restored = await tasksRepo.findByIdAsync(task.id);
    expect(restored?.prompt).toBe('old instructions');
  });

  it('applies a schedule (cronExpression) edit without reshaping change_json (behavioral measure path)', async () => {
    const tasksRepo = new AgentScheduledTasksRepository();
    const task = await tasksRepo.createAsync({
      name: 'Cron task',
      scheduleType: 'cron',
      cronExpression: '0 8 * * *',
      prompt: 'do it',
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-task',
      risk: 'high',
      title: 'Move the cron to Mondays 9am',
      changeJson: JSON.stringify({
        affectedSkill: 'reporter',
        sessionIds: [],
        taskPatch: { scheduledTaskId: task.id, field: 'cronExpression', value: '0 9 * * 1' },
      }),
      dedupKey: `refine-task:${task.id}:cron`,
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    // Non-text edit: change_json left intact for the behavioral re-run path.
    expect(result.changeJson).toBeUndefined();
    const after = await tasksRepo.findByIdAsync(task.id);
    expect(after?.cronExpression).toBe('0 9 * * 1');
  });
});
