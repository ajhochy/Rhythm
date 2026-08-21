import type {
  AutomationsGateway,
  DashboardGateway,
  FacilitiesGateway,
  IntegrationsGateway,
  MessagesGateway,
  PlannerGateway,
  ProjectsGateway,
  RhythmDomainGateway,
  RhythmsGateway,
  RhythmTask,
  TasksGateway,
} from '../../src/domain/types';

/** Deterministic in-memory gateway builders for tests only — never shipped from src/index.
 * A real host wires its own authenticated implementation of these same narrow interfaces. */

export function fixtureTasksGateway(): TasksGateway {
  let tasks: RhythmTask[] = [
    { id: 't1', title: 'Confirm Sunday greeter schedule', notes: '', status: 'open', priority: 2, tags: ['ops'], dueDate: '2026-08-23' },
    { id: 't2', title: 'Reply to facilities request', notes: '', status: 'in_progress', priority: 1, tags: [] },
  ];
  return {
    list: async () => tasks,
    create: async (input) => {
      const created = { id: `t${tasks.length + 1}`, status: 'open' as const, priority: 0 as const, tags: [], ...input };
      tasks = [...tasks, created];
      return created;
    },
    setStatus: async (id, status) => {
      tasks = tasks.map((task) => (task.id === id ? { ...task, status } : task));
      const updated = tasks.find((task) => task.id === id);
      if (!updated) throw new Error(`unknown task ${id}`);
      return updated;
    },
  };
}

export function fixtureDashboardGateway(): DashboardGateway {
  return {
    summary: async () => ({
      greetingName: 'AJ',
      openTaskCount: 2,
      todayTaskTitles: ['Confirm Sunday greeter schedule'],
      upcomingRhythmTitles: ['Weekly staff huddle'],
    }),
  };
}

export function fixturePlannerGateway(): PlannerGateway {
  return {
    week: async () => [
      { date: '2026-08-24', label: 'Monday', items: [{ id: 't1', title: 'Confirm Sunday greeter schedule', kind: 'task' }] },
      { date: '2026-08-25', label: 'Tuesday', items: [] },
    ],
  };
}

export function fixtureProjectsGateway(): ProjectsGateway {
  return {
    list: async () => [{ id: 'p1', name: 'Fall retreat planning', status: 'active', progressPercent: 40 }],
  };
}

export function fixtureRhythmsGateway(): RhythmsGateway {
  return {
    list: async () => [{ id: 'r1', title: 'Weekly staff huddle', cadence: 'weekly', nextOccurrence: '2026-08-24' }],
  };
}

export function fixtureMessagesGateway(): MessagesGateway {
  return {
    list: async () => [{ id: 'm1', subject: 'Sunday setup', lastSenderName: 'Pat', unreadCount: 1 }],
  };
}

export function fixtureFacilitiesGateway(): FacilitiesGateway {
  return {
    list: async () => [{ id: 'f1', roomName: 'Fellowship Hall', requestedFor: '2026-08-30', status: 'requested' }],
  };
}

export function fixtureIntegrationsGateway(): IntegrationsGateway {
  let integrations = [{ id: 'pco', name: 'Planning Center Online', connected: true }];
  return {
    list: async () => integrations,
    setConnected: async (id, connected) => {
      integrations = integrations.map((integration) => (integration.id === id ? { ...integration, connected } : integration));
      const updated = integrations.find((integration) => integration.id === id);
      if (!updated) throw new Error(`unknown integration ${id}`);
      return updated;
    },
  };
}

export function fixtureAutomationsGateway(): AutomationsGateway {
  let automations = [{ id: 'a1', name: 'Auto-archive completed tasks', enabled: false, description: 'Archives tasks 30 days after completion.' }];
  return {
    list: async () => automations,
    setEnabled: async (id, enabled) => {
      automations = automations.map((automation) => (automation.id === id ? { ...automation, enabled } : automation));
      const updated = automations.find((automation) => automation.id === id);
      if (!updated) throw new Error(`unknown automation ${id}`);
      return updated;
    },
  };
}

export function fixtureDomainGateway(): RhythmDomainGateway {
  return {
    dashboard: fixtureDashboardGateway(),
    tasks: fixtureTasksGateway(),
    planner: fixturePlannerGateway(),
    projects: fixtureProjectsGateway(),
    rhythms: fixtureRhythmsGateway(),
    messages: fixtureMessagesGateway(),
    facilities: fixtureFacilitiesGateway(),
    integrations: fixtureIntegrationsGateway(),
    automations: fixtureAutomationsGateway(),
  };
}
