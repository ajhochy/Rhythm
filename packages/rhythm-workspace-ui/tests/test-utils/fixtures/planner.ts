import type { PlannerGateway, RhythmPlannerTask, RhythmPlannerWeek, RhythmWorkspaceMember } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

export const fixturePlannerMembers: RhythmWorkspaceMember[] = [
  { id: 'workspace-user-2', name: 'Riley Chen', initials: 'RC' },
  { id: 'workspace-user-3', name: 'Morgan Lee', initials: 'ML' },
];

function seedPlannerTasks(): RhythmPlannerTask[] {
  return [
    { id: 'task-wed', source: 'task', title: 'Prepare Sunday service handoff', notes: 'Bring the latest service plan.', status: 'open', scheduledDate: '2026-08-12', dueDate: '2026-08-12', scheduledOrder: 100, energy: '⚡', collaborators: [{ id: 'workspace-user-2', name: 'Riley Chen', initials: 'RC' }], readonly: false },
    { id: 'step-thu', source: 'project-step', title: 'Confirm volunteer stations', notes: 'Review welcome desk coverage.', status: 'open', scheduledDate: '2026-08-13', dueDate: '2026-08-13', scheduledOrder: 200, projectName: 'Weekend service rollout', collaborators: [], readonly: true },
    { id: 'task-done', source: 'task', title: 'Print welcome desk roster', notes: 'Delivered to the lobby team.', status: 'done', scheduledDate: '2026-08-11', dueDate: '2026-08-11', scheduledOrder: 80, energy: '🌱', collaborators: [], readonly: false },
    { id: 'task-backlog', source: 'task', title: 'Vendor equipment follow-up', notes: 'Confirm the delivery window.', status: 'open', scheduledOrder: 400, energy: '🌱', collaborators: [], readonly: false },
  ];
}

export function fixturePlannerGateway(): PlannerGateway {
  let tasks = seedPlannerTasks();
  const members = fixturePlannerMembers;
  const buildWeek = (weekLabel: string): RhythmPlannerWeek => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map((date, index) => ({
      date,
      // Non-null: `index` always ranges over the same 7-day span as this label list.
      label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]!,
      tasks: tasks.filter((task) => task.scheduledDate === date),
      events: [],
    }));
    return { weekLabel, weekStart: '2026-08-10', days, backlog: tasks.filter((task) => !task.scheduledDate) };
  };
  return {
    week: async (weekLabel) => buildWeek(weekLabel),
    members: async () => members,
    scheduleTask: async (id, input) => {
      const existing = tasks.find((task) => task.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown task ${id}`);
      const updated = { ...existing, ...input };
      tasks = tasks.map((task) => (task.id === id ? updated : task));
      return updated;
    },
    create: async (input) => {
      const created: RhythmPlannerTask = { id: `task-${tasks.length + 1}`, source: 'task', status: 'open', scheduledOrder: 900, collaborators: [], readonly: false, notes: '', ...input };
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
  };
}

export function failingPlannerGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): PlannerGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { week: fail, members: fail, scheduleTask: fail, create: fail, update: fail };
}

export function emptyPlannerGateway(): PlannerGateway {
  const gateway = fixturePlannerGateway();
  return { ...gateway, week: async (weekLabel) => ({ weekLabel, weekStart: '2026-08-10', days: [], backlog: [] }) };
}
