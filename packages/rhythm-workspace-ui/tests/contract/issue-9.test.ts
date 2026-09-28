import { describe, expect, it } from 'vitest';
import type { RhythmCurrentUser, RhythmWorkspaceOperationConfirmation } from '../../src/host/types';

describe('issue-9 M5 public host contract', () => {
  it('exposes only affirmative semantic M5 capabilities and an exact foreground confirmation shape', () => {
    const host: RhythmCurrentUser = { displayName: 'Hermes', initials: 'H', capabilities: ['planner.schedule-task', 'rhythms.update-rule', 'rhythms.create-step', 'rhythms.delete-step', 'rhythms.reorder-step', 'projects.create-template', 'projects.update-template', 'projects.delete-template', 'projects.create-instance', 'projects.update-instance', 'projects.delete-instance', 'projects.create-step', 'projects.update-step', 'projects.delete-step', 'projects.reorder-step', 'projects.create-milestone', 'projects.update-milestone', 'projects.delete-milestone'] };
    const receipt: RhythmWorkspaceOperationConfirmation = { operation: 'planner.schedule-task', entityId: 'task_1', payload: { scheduledDate: '2026-08-21' }, generation: 'connection:profile:1' };
    expect(host.capabilities).not.toContain('tasks.write');
    expect(Object.keys(receipt.payload)).toEqual(['scheduledDate']);
    expect(host.capabilities).not.toContain('projects.manage-members');
  });
});
