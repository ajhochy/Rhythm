export interface ProjectInstanceStep {
  id: string;
  instanceId: string;
  stepId: string;
  title: string;
  dueDate: string;
  status: 'open' | 'done';
  notes: string | null;
}

export interface ProjectInstance {
  id: string;
  templateId: string;
  name: string | null;
  anchorDate: string;
  status: string;
  ownerId: number | null;
  isShared?: boolean;
  createdAt: string;
  steps: ProjectInstanceStep[];
}
