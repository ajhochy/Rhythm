export interface ProjectInstanceStep {
  id: string;
  instanceId: string;
  stepId: string;
  title: string;
  dueDate: string;
  status: 'open' | 'done';
}

export interface ProjectInstance {
  id: string;
  templateId: string;
  anchorDate: string;
  status: string;
  createdAt: string;
  steps: ProjectInstanceStep[];
}
