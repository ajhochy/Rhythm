import type { DashboardGateway, RhythmDashboardProject, RhythmDashboardTask, RhythmWorkspaceMember } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

/** Modeled on apps/web/src/pages/dashboard/fixtures.ts — bucketed tasks, a project with
 * steps, and unread thread previews, so characterization tests can exercise the focus
 * cards, planning grid, collaborator handoffs, and both dialogs. */
export const fixtureDashboardMembers: RhythmWorkspaceMember[] = [
  { id: 'workspace-user-2', name: 'Riley Chen', initials: 'RC' },
  { id: 'workspace-user-3', name: 'Morgan Lee', initials: 'ML' },
];

function seedDashboardTasks(): RhythmDashboardTask[] {
  return [
    { id: 'task-team-briefing', title: 'Team briefing', notes: 'Confirm owners.', status: 'open', bucket: 'today', scheduledDate: '2026-08-12', dueLabel: 'Today · 4:30 PM', collaboratorId: 'workspace-user-2', collaboratorName: 'Riley Chen' },
    { id: 'task-review-av-inventory', title: 'Review AV inventory', notes: 'Check the backup audio path.', status: 'open', bucket: 'past-due', scheduledDate: '2026-08-11', dueLabel: '1 day overdue' },
    { id: 'task-finalize-launch-notes', title: 'Finalize launch notes', notes: 'Publish the handoff.', status: 'open', bucket: 'week', scheduledDate: '2026-08-14', dueLabel: 'Friday' },
    { id: 'task-follow-vendor', title: 'Follow up with vendor', notes: '', status: 'open', bucket: 'unscheduled', dueLabel: 'Not scheduled' },
  ];
}

function seedDashboardProject(): RhythmDashboardProject {
  return {
    id: 'weekend-service', title: 'Weekend service', owner: 'AJ Hochhalter', dueLabel: 'Sunday · Aug 16',
    steps: [
      { id: 'step-site-plan', title: 'Confirm site plan', notes: '', status: 'done', dueLabel: 'Complete' },
      { id: 'step-volunteer-check-in', title: 'Volunteer check-in', notes: 'Confirm the check-in owner.', status: 'open', dueLabel: 'Saturday · 8:00 AM' },
    ],
  };
}

export function fixtureDashboardGateway(): DashboardGateway {
  let tasks = seedDashboardTasks();
  let project = seedDashboardProject();
  const members = fixtureDashboardMembers;
  return {
    summary: async () => ({
      openTaskCount: tasks.filter((task) => task.status === 'open').length,
      threadCount: 6,
      tasks,
      project,
      unreadThreads: [{ id: 'thread-weekend-team', title: 'Weekend Team', preview: 'Final volunteer positions are ready.', unreadCount: 1 }],
    }),
    members: async () => members,
    createTask: async (input) => {
      const collaborator = input.collaboratorId ? members.find((member) => member.id === input.collaboratorId) : undefined;
      const created: RhythmDashboardTask = {
        id: `task-dashboard-${tasks.length + 1}`, status: 'open', bucket: input.scheduledDate ? 'week' : 'unscheduled',
        dueLabel: input.dueDate ?? input.scheduledDate ?? 'Not scheduled', notes: '', collaboratorName: collaborator?.name, ...input,
      };
      tasks = [...tasks, created];
      return created;
    },
    updateTask: async (id, input) => {
      const existing = tasks.find((task) => task.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown task ${id}`);
      const collaborator = input.collaboratorId === null ? undefined : input.collaboratorId ? members.find((member) => member.id === input.collaboratorId) : undefined;
      const updated: RhythmDashboardTask = {
        ...existing,
        ...input,
        collaboratorId: input.collaboratorId === null ? undefined : input.collaboratorId ?? existing.collaboratorId,
        collaboratorName: input.collaboratorId === null ? undefined : collaborator?.name ?? existing.collaboratorName,
      };
      tasks = tasks.map((task) => (task.id === id ? updated : task));
      return updated;
    },
    updateProjectStep: async (id, input) => {
      const existing = project.steps.find((step) => step.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown project step ${id}`);
      const updated = { ...existing, ...input };
      project = { ...project, steps: project.steps.map((step) => (step.id === id ? updated : step)) };
      return updated;
    },
  };
}

export function failingDashboardGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): DashboardGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { summary: fail, members: fail, createTask: fail, updateTask: fail, updateProjectStep: fail };
}

export function emptyDashboardGateway(): DashboardGateway {
  const gateway = fixtureDashboardGateway();
  return { ...gateway, summary: async () => ({ openTaskCount: 0, threadCount: 0, tasks: [], project: null, unreadThreads: [] }) };
}
