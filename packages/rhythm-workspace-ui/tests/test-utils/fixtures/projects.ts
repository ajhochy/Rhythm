import type { ProjectsGateway, RhythmProject, RhythmProjectTemplate, RhythmWorkspaceMember } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

export const fixtureProjectsMembers: RhythmWorkspaceMember[] = [
  { id: 'workspace-user-1', name: 'AJ Hochhalter', initials: 'AH' },
  { id: 'workspace-user-2', name: 'Morgan Lee', initials: 'ML' },
];

function seedTemplates(): RhythmProjectTemplate[] {
  return [
    {
      id: 'template-sunday-service', name: 'Sunday Service Launch', description: 'Coordinate every handoff from rehearsal through welcome.', anchorType: 'Service date',
      steps: [
        { id: 'template-step-volunteer-plan', title: 'Confirm volunteer plan', offsetDays: -7, offsetDescription: 'One week before', assigneeId: 'workspace-user-2' },
        { id: 'template-step-service-ready', title: 'Publish final run sheet', offsetDays: 0, offsetDescription: 'Service day', assigneeId: 'workspace-user-1' },
      ],
    },
    { id: 'template-empty', name: 'New ministry pattern', description: 'A clean template ready for its first step.', anchorType: 'Event date', steps: [] },
  ];
}

function seedInstances(): RhythmProject[] {
  return [
    {
      id: 'instance-sunday-service-2026-08-16', templateId: 'template-sunday-service', name: 'Sunday Service - August 16', anchorDate: '2026-08-16', status: 'active',
      ownerId: 'workspace-user-1', collaborators: [fixtureProjectsMembers[1]!],
      milestones: [{ id: 'milestone-service-ready', title: 'Service ready', sortOrder: 0 }],
      steps: [
        { id: 'step-volunteer-check-in', title: 'Volunteer check-in', notes: 'Welcome team checked in.', dueDate: '2026-08-12', scheduledDate: '2026-08-12', status: 'done', assigneeId: 'workspace-user-2', milestoneId: 'milestone-service-ready' },
        { id: 'step-final-run-sheet', title: 'Finalize the run sheet', notes: 'Confirm cues and livestream fallback.', dueDate: '2026-08-15', scheduledDate: '2026-08-15', status: 'open', assigneeId: 'workspace-user-1', milestoneId: null },
      ],
    },
    {
      id: 'instance-finished-service', templateId: 'template-sunday-service', name: 'Sunday Service - August 9', anchorDate: '2026-08-09', status: 'complete',
      ownerId: 'workspace-user-1', collaborators: [],
      milestones: [{ id: 'milestone-finished', title: 'Complete', sortOrder: 0 }],
      steps: [
        { id: 'step-finished-service', title: 'Close the service notes', notes: 'Archived fixture work.', dueDate: '2026-08-09', scheduledDate: '2026-08-09', status: 'done', assigneeId: 'workspace-user-1', milestoneId: 'milestone-finished' },
      ],
    },
  ];
}

export function fixtureProjectsGateway(): ProjectsGateway {
  const templates = seedTemplates();
  let instances = seedInstances();
  const members = fixtureProjectsMembers;
  return {
    templates: async () => templates,
    list: async () => instances,
    members: async () => members,
    generate: async (templateId, input) => {
      const template = templates.find((item) => item.id === templateId);
      if (!template) throw new RhythmGatewayError('not_found', `unknown template ${templateId}`);
      const created: RhythmProject = {
        id: `instance-${instances.length + 1}`, templateId, name: input.name ?? template.name, anchorDate: input.anchorDate, status: 'planning',
        ownerId: 'workspace-user-1', collaborators: [], milestones: [],
        steps: template.steps.map((step) => ({ id: `${created_id(templateId)}-${step.id}`, title: step.title, notes: '', status: 'open', dueDate: input.anchorDate, assigneeId: step.assigneeId })),
      };
      instances = [...instances, created];
      return created;
    },
    delete: async (id) => {
      instances = instances.filter((instance) => instance.id !== id);
    },
    updateStep: async (instanceId, stepId, input) => {
      const instance = instances.find((item) => item.id === instanceId);
      if (!instance) throw new RhythmGatewayError('not_found', `unknown project ${instanceId}`);
      const existing = instance.steps.find((step) => step.id === stepId);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown step ${stepId}`);
      const updated = { ...existing, ...input };
      instances = instances.map((item) => (item.id === instanceId ? { ...item, steps: item.steps.map((step) => (step.id === stepId ? updated : step)) } : item));
      return updated;
    },
    addMilestone: async (instanceId, input) => {
      const instance = instances.find((item) => item.id === instanceId);
      if (!instance) throw new RhythmGatewayError('not_found', `unknown project ${instanceId}`);
      const milestone = { id: `${instanceId}-milestone-${instance.milestones.length + 1}`, sortOrder: instance.milestones.length, ...input };
      instances = instances.map((item) => (item.id === instanceId ? { ...item, milestones: [...item.milestones, milestone] } : item));
      return milestone;
    },
    addCollaborator: async (instanceId, memberId) => {
      const member = members.find((candidate) => candidate.id === memberId);
      const instance = instances.find((item) => item.id === instanceId);
      if (!member || !instance) throw new RhythmGatewayError('not_found', 'unknown project or member');
      const updated = { ...instance, collaborators: [...instance.collaborators, member] };
      instances = instances.map((item) => (item.id === instanceId ? updated : item));
      return updated;
    },
    removeCollaborator: async (instanceId, memberId) => {
      const instance = instances.find((item) => item.id === instanceId);
      if (!instance) throw new RhythmGatewayError('not_found', `unknown project ${instanceId}`);
      const updated = { ...instance, collaborators: instance.collaborators.filter((member) => member.id !== memberId) };
      instances = instances.map((item) => (item.id === instanceId ? updated : item));
      return updated;
    },
  };
}

function created_id(templateId: string) {
  return templateId.replace('template-', '');
}

export function failingProjectsGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): ProjectsGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { templates: fail, list: fail, members: fail, generate: fail, delete: fail, updateStep: fail, addMilestone: fail, addCollaborator: fail, removeCollaborator: fail };
}

export function emptyProjectsGateway(): ProjectsGateway {
  const gateway = fixtureProjectsGateway();
  return { ...gateway, list: async () => [] };
}
