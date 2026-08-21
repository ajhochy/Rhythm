export interface ProjectPerson {
  id: string;
  name: string;
  initials: string;
}

export interface ProjectTemplateStep {
  id: string;
  title: string;
  offsetDays: number;
  offsetDescription: string;
  sortOrder: number;
  assigneeId: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  anchorType: string;
  steps: ProjectTemplateStep[];
}

export interface ProjectMilestone {
  id: string;
  title: string;
  sortOrder: number;
}

export interface ProjectInstanceStep {
  id: string;
  title: string;
  notes: string;
  dueDate: string;
  scheduledDate: string;
  status: 'open' | 'done';
  assigneeId: string;
  milestoneId: string | null;
}

export interface ProjectInstance {
  id: string;
  templateId: string;
  name: string;
  anchorDate: string;
  owner: ProjectPerson;
  collaborators: ProjectPerson[];
  milestones: ProjectMilestone[];
  steps: ProjectInstanceStep[];
}

export const currentProjectUserId = '1';

export const projectMembers: ProjectPerson[] = [
  { id: '1', name: 'AJ Hochhalter', initials: 'AJ' },
  { id: '2', name: 'Morgan Lee', initials: 'ML' },
  { id: '7', name: 'Visalia CRC', initials: 'VC' },
  { id: '8', name: 'Riley Chen', initials: 'RC' },
];

export const seededProjectTemplates: ProjectTemplate[] = [
  {
    id: 'template-sunday-service',
    name: 'Sunday Service Launch',
    description: 'Coordinate every handoff from first rehearsal through the final welcome.',
    anchorType: 'Service date',
    steps: [
      { id: 'template-step-volunteer-plan', title: 'Confirm volunteer plan', offsetDays: -7, offsetDescription: 'One week before', sortOrder: 0, assigneeId: '2' },
      { id: 'template-step-worship-brief', title: 'Share worship brief', offsetDays: -3, offsetDescription: 'Three days before', sortOrder: 1, assigneeId: '1' },
      { id: 'template-step-room-check', title: 'Complete room check', offsetDays: -1, offsetDescription: 'Day before', sortOrder: 2, assigneeId: '7' },
      { id: 'template-step-service-ready', title: 'Publish final run sheet', offsetDays: 0, offsetDescription: 'Service day', sortOrder: 3, assigneeId: '1' },
    ],
  },
  {
    id: 'template-weekend-service',
    name: 'إطلاق خدمة المجتمع - 准备礼拜 🎵',
    description: 'A multilingual Weekend Service project that remains readable under long text and RTL.',
    anchorType: 'Weekend service date',
    steps: [
      { id: 'template-step-weekend-check-in', title: 'Volunteer check-in', offsetDays: -2, offsetDescription: 'Two days before', sortOrder: 0, assigneeId: '2' },
      { id: 'template-step-weekend-open', title: 'Open the community welcome', offsetDays: 0, offsetDescription: 'Service day', sortOrder: 1, assigneeId: '7' },
    ],
  },
  {
    id: 'template-empty',
    name: 'New ministry pattern',
    description: 'A clean template ready for its first step.',
    anchorType: 'Event date',
    steps: [],
  },
];

export const seededProjectInstances: ProjectInstance[] = [
  {
    id: 'instance-sunday-service-2026-08-16',
    templateId: 'template-sunday-service',
    name: 'Sunday Service - August 16',
    anchorDate: '2026-08-16',
    owner: projectMembers[0],
    collaborators: [projectMembers[1]],
    milestones: [
      { id: 'milestone-service-ready', title: 'Service ready', sortOrder: 0 },
      { id: 'milestone-live', title: 'Doors open', sortOrder: 1 },
    ],
    steps: [
      { id: 'step-volunteer-check-in', title: 'Volunteer check-in', notes: 'Welcome team checked in.', dueDate: '2026-08-12', scheduledDate: '2026-08-12', status: 'done', assigneeId: '2', milestoneId: 'milestone-service-ready' },
      { id: 'step-final-run-sheet', title: 'Finalize the run sheet', notes: 'Confirm cues, owners, and the livestream fallback.', dueDate: '2026-08-15', scheduledDate: '2026-08-15', status: 'open', assigneeId: '1', milestoneId: null },
    ],
  },
  {
    id: 'instance-weekend-service-2026-08-23',
    templateId: 'template-weekend-service',
    name: 'Weekend Service - August 23',
    anchorDate: '2026-08-23',
    owner: projectMembers[0],
    collaborators: [projectMembers[1]],
    milestones: [{ id: 'milestone-weekend-welcome', title: 'Welcome ready', sortOrder: 0 }],
    steps: [
      { id: 'step-weekend-volunteer-check-in', title: 'Volunteer check-in', notes: 'Dashboard fixture continuity: completed.', dueDate: '2026-08-21', scheduledDate: '2026-08-21', status: 'done', assigneeId: '2', milestoneId: 'milestone-weekend-welcome' },
      { id: 'step-weekend-community-welcome', title: 'Open the community welcome', notes: 'Confirm multilingual signage.', dueDate: '2026-08-23', scheduledDate: '2026-08-23', status: 'open', assigneeId: '7', milestoneId: null },
    ],
  },
  {
    id: 'instance-finished-service',
    templateId: 'template-sunday-service',
    name: 'Sunday Service - August 9',
    anchorDate: '2026-08-09',
    owner: projectMembers[0],
    collaborators: [],
    milestones: [{ id: 'milestone-finished', title: 'Complete', sortOrder: 0 }],
    steps: [
      { id: 'step-finished-service', title: 'Close the service notes', notes: 'Archived fixture work.', dueDate: '2026-08-09', scheduledDate: '2026-08-09', status: 'done', assigneeId: '1', milestoneId: 'milestone-finished' },
    ],
  },
];

export const cloneProjectTemplates = () => structuredClone(seededProjectTemplates) as ProjectTemplate[];
export const cloneProjectInstances = () => structuredClone(seededProjectInstances) as ProjectInstance[];

export const initialProjectReceipts = [
  'GET /project-templates → 200',
  'GET /project-instances → 200',
];

