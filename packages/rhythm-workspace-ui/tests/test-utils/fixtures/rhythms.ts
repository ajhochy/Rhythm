import type { RhythmRhythm, RhythmWorkspaceMember, RhythmsGateway } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

export const fixtureRhythmsMembers: RhythmWorkspaceMember[] = [
  { id: 'workspace-user-1', name: 'AJ Hochhalter', initials: 'AH' },
  { id: 'workspace-user-3', name: 'Morgan Lee', initials: 'ML' },
  { id: 'workspace-user-4', name: 'Jordan Patel', initials: 'JP' },
];

function seedRhythms(): RhythmRhythm[] {
  return [
    {
      id: 'rhythm-weekend-service', title: 'Weekend service cadence', frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, month: 1, sequential: true, enabled: true,
      ownerId: 'workspace-user-1', ownerName: 'AJ Hochhalter', collaborators: [fixtureRhythmsMembers[1]!],
      steps: [{ id: 'weekend-step-1', title: 'Prepare service handoff', assigneeId: 'workspace-user-3' }],
      generatedCount: 4, completedCount: 3, remainingCount: 1, waitingOn: 'Morgan Lee', nextDueDate: '2026-08-16', completionRatio: 0.75, createdAt: '2026-07-05T09:00:00-07:00',
    },
    {
      id: 'rhythm-monthly-care', title: 'Monthly care follow-through', frequency: 'monthly', dayOfWeek: 1, dayOfMonth: 15, month: 1, sequential: false, enabled: false,
      ownerId: 'workspace-user-1', ownerName: 'AJ Hochhalter', collaborators: [], steps: [],
      generatedCount: 6, completedCount: 4, remainingCount: 2, waitingOn: null, nextDueDate: null, completionRatio: 2 / 3, createdAt: '2026-07-12T10:30:00-07:00',
    },
  ];
}

export function fixtureRhythmsGateway(): RhythmsGateway {
  let rhythms = seedRhythms();
  const members = fixtureRhythmsMembers;
  return {
    list: async () => rhythms,
    members: async () => members,
    create: async (input) => {
      const created: RhythmRhythm = {
        id: `rhythm-${rhythms.length + 1}`, dayOfWeek: 0, dayOfMonth: 1, month: 1, sequential: false, enabled: true,
        ...input,
        ownerId: 'workspace-user-1', ownerName: 'AJ Hochhalter', collaborators: [], steps: (input.steps ?? []).map((step, index) => ({ id: `rhythm-${rhythms.length + 1}-step-${index + 1}`, title: step.title, ...(step.assigneeId ? { assigneeId: step.assigneeId } : {}) })),
        generatedCount: 0, completedCount: 0, remainingCount: 0, waitingOn: null, nextDueDate: null, completionRatio: 0, createdAt: '2026-08-12T15:48:00-07:00',
      };
      rhythms = [...rhythms, created];
      return created;
    },
    update: async (id, input) => {
      const existing = rhythms.find((rhythm) => rhythm.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown rhythm ${id}`);
      const updated = { ...existing, ...input };
      rhythms = rhythms.map((rhythm) => (rhythm.id === id ? updated : rhythm));
      return updated;
    },
    delete: async (id) => {
      rhythms = rhythms.filter((rhythm) => rhythm.id !== id);
    },
    addStep: async (id, input) => {
      const existing = rhythms.find((rhythm) => rhythm.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown rhythm ${id}`);
      const step = { id: `${id}-step-${existing.steps.length + 1}`, ...input };
      rhythms = rhythms.map((rhythm) => (rhythm.id === id ? { ...rhythm, steps: [...rhythm.steps, step] } : rhythm));
      return step;
    },
    replaceSteps: async (id, steps) => {
      const existing = rhythms.find((rhythm) => rhythm.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown rhythm ${id}`);
      const updated = { ...existing, steps: steps.map((step, index) => ({ id: `${id}-step-${index + 1}`, ...step })) };
      rhythms = rhythms.map((rhythm) => rhythm.id === id ? updated : rhythm);
      return updated;
    },
    addCollaborator: async (id, memberId) => {
      const member = members.find((candidate) => candidate.id === memberId);
      const existing = rhythms.find((rhythm) => rhythm.id === id);
      if (!member || !existing) throw new RhythmGatewayError('not_found', 'unknown rhythm or member');
      const updated = { ...existing, collaborators: [...existing.collaborators, member] };
      rhythms = rhythms.map((rhythm) => (rhythm.id === id ? updated : rhythm));
      return updated;
    },
    removeCollaborator: async (id, memberId) => {
      const existing = rhythms.find((rhythm) => rhythm.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown rhythm ${id}`);
      const updated = { ...existing, collaborators: existing.collaborators.filter((member) => member.id !== memberId) };
      rhythms = rhythms.map((rhythm) => (rhythm.id === id ? updated : rhythm));
      return updated;
    },
  };
}

export function failingRhythmsGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): RhythmsGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { list: fail, members: fail, create: fail, update: fail, delete: fail, addStep: fail, replaceSteps: fail, addCollaborator: fail, removeCollaborator: fail };
}

export function emptyRhythmsGateway(): RhythmsGateway {
  const gateway = fixtureRhythmsGateway();
  return { ...gateway, list: async () => [] };
}
