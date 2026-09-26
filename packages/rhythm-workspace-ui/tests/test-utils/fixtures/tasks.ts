import type { RhythmTask, RhythmWorkspaceMember, TasksGateway } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

/** Seeded in-memory TasksGateway modeled on apps/web/src/pages/tasks/fixtures.ts — real
 * bucket/priority/tag/collaborator/source-readonly richness so characterization tests can
 * exercise search, filters, sort, board, and the collaborator/ownership permission model. */
export const fixtureTasksMembers: RhythmWorkspaceMember[] = [
  { id: 'workspace-user-1', name: 'AJ Hochhalter', initials: 'AH' },
  { id: 'workspace-user-2', name: 'Riley Chen', initials: 'RC' },
  { id: 'workspace-user-3', name: 'Morgan Lee', initials: 'ML' },
];

export function seedTasks(): RhythmTask[] {
  return [
    { id: 't1', title: 'Confirm Sunday greeter schedule', notes: 'Check with the welcome team.', status: 'open', bucket: 'today', priority: 2, tags: ['ops'], dueDate: '2026-08-23', createdAt: '2026-08-10T09:00:00-07:00', createdBy: 'AJ Hochhalter', ownerId: 'workspace-user-1', isShared: false, sourceType: 'manual', preferredAgent: '', energy: '', collaborators: [] },
    { id: 't2', title: 'Reply to facilities request', notes: '', status: 'in_progress', bucket: 'week', priority: 1, tags: [], scheduledDate: '2026-08-25', createdAt: '2026-08-09T09:00:00-07:00', createdBy: 'Riley Chen', ownerId: 'workspace-user-2', isShared: true, sourceType: 'manual', preferredAgent: '', energy: '⚡', collaborators: [{ id: 'workspace-user-1', name: 'AJ Hochhalter', initials: 'AH' }] },
    { id: 't3', title: 'Weekly service cadence prep', notes: 'Rhythm-owned step.', status: 'open', bucket: 'past-due', priority: 0, tags: ['rhythm'], dueDate: '2026-08-10', createdAt: '2026-08-01T09:00:00-07:00', createdBy: 'Rhythm', ownerId: 'workspace-user-1', isShared: false, sourceType: 'rhythm', sourceName: 'Weekend service cadence', preferredAgent: '', energy: '', collaborators: [] },
    { id: 't4', title: 'Sanctuary reset (calendar)', notes: '', status: 'done', bucket: 'completed', priority: 0, tags: [], createdAt: '2026-08-05T09:00:00-07:00', createdBy: 'Automation', ownerId: 'workspace-user-1', isShared: false, sourceType: 'calendar_shadow_event', sourceName: 'Facilities calendar', preferredAgent: '', energy: '', collaborators: [] },
  ];
}

export function fixtureTasksGateway(): TasksGateway {
  let tasks = seedTasks();
  const members = fixtureTasksMembers;
  return {
    list: async () => tasks,
    members: async () => members,
    create: async (input) => {
      const created: RhythmTask = {
        id: `t${tasks.length + 1}`, status: 'open', bucket: 'no-due', priority: 0, tags: [], createdAt: '2026-08-12T15:48:00-07:00',
        createdBy: 'AJ Hochhalter', ownerId: 'workspace-user-1', isShared: false, sourceType: 'manual', preferredAgent: '', energy: '', collaborators: [],
        notes: '', ...input,
      };
      tasks = [...tasks, created];
      return created;
    },
    update: async (id, input) => {
      const existing = tasks.find((task) => task.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown task ${id}`);
      const updated = { ...existing, ...input };
      tasks = tasks.map((task) => (task.id === id ? updated : task));
      return updated;
    },
    delete: async (id) => {
      tasks = tasks.filter((task) => task.id !== id);
    },
    addCollaborator: async (id, memberId) => {
      const member = members.find((candidate) => candidate.id === memberId);
      if (!member) throw new RhythmGatewayError('not_found', `unknown member ${memberId}`);
      const existing = tasks.find((task) => task.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown task ${id}`);
      const updated = { ...existing, collaborators: [...existing.collaborators, member] };
      tasks = tasks.map((task) => (task.id === id ? updated : task));
      return updated;
    },
    removeCollaborator: async (id, memberId) => {
      const existing = tasks.find((task) => task.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown task ${id}`);
      const updated = { ...existing, collaborators: existing.collaborators.filter((person) => person.id !== memberId) };
      tasks = tasks.map((task) => (task.id === id ? updated : task));
      return updated;
    },
  };
}

/** A gateway whose every call rejects with a chosen error kind — for state-panel tests. */
export function failingTasksGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): TasksGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { list: fail, members: fail, create: fail, update: fail, delete: fail, addCollaborator: fail, removeCollaborator: fail };
}

export function emptyTasksGateway(): TasksGateway {
  const gateway = fixtureTasksGateway();
  return { ...gateway, list: async () => [] };
}
