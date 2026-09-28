import type { AutomationsGateway, RhythmAutomation } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

function seedAutomations(): RhythmAutomation[] {
  return [
    {
      id: 'rule-rhythm-due-reminder', name: 'Nudge owners before tasks are due', source: 'rhythm', accountLabel: 'Internal Rhythm rules',
      triggerKey: 'rhythm.task_due', triggerLabel: 'Task is approaching its due date', actionType: 'send_notification', actionLabel: 'Send notification',
      enabled: true, createdAt: '2026-07-19T09:12:00-07:00', lastMatchedAt: '2026-08-12T14:35:00-07:00', matchCountLastRun: 3,
      previewSummary: 'When a Rhythm task is due within two days, notify its owner.', conditions: [],
    },
    {
      id: 'rule-pco-volunteer-decline', name: 'Follow up on declined positions', source: 'planning_center', accountLabel: 'Production Services',
      triggerKey: 'pco.volunteer_declined', triggerLabel: 'Volunteer declined', actionType: 'create_task', actionLabel: 'Create task',
      enabled: true, createdAt: '2026-07-29T08:45:00-07:00', lastMatchedAt: '2026-08-12T13:05:00-07:00', matchCountLastRun: 1,
      previewSummary: 'When a Planning Center volunteer declines, create a coverage task.', conditions: [{ field: 'teamName', operator: 'equals', value: 'Worship' }],
    },
  ];
}

export function fixtureAutomationsGateway(): AutomationsGateway {
  let automations = seedAutomations();
  return {
    list: async () => automations,
    create: async (input) => {
      const created: RhythmAutomation = { id: `rule-${automations.length + 1}`, accountLabel: 'Internal Rhythm rules', enabled: true, createdAt: '2026-08-12T15:48:00-07:00', lastMatchedAt: null, matchCountLastRun: 0, previewSummary: '', conditions: [], ...input };
      automations = [...automations, created];
      return created;
    },
    update: async (id, input) => {
      const existing = automations.find((automation) => automation.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown automation ${id}`);
      const updated = { ...existing, ...input };
      automations = automations.map((automation) => (automation.id === id ? updated : automation));
      return updated;
    },
    delete: async (id) => {
      automations = automations.filter((automation) => automation.id !== id);
    },
  };
}

export function failingAutomationsGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): AutomationsGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { list: fail, create: fail, update: fail, delete: fail };
}

export function emptyAutomationsGateway(): AutomationsGateway {
  const gateway = fixtureAutomationsGateway();
  return { ...gateway, list: async () => [] };
}
