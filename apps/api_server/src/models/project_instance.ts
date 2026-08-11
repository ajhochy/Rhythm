export interface ProjectInstanceStep {
  id: string;
  instanceId: string;
  stepId: string;
  title: string;
  dueDate: string;
  scheduledDate: string | null;
  status: 'open' | 'done';
  notes: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  milestoneId: string | null;
}

export interface ProjectMilestone {
  id: string;
  instanceId: string;
  title: string;
  dueDate: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectMilestoneDto {
  title: string;
  dueDate?: string | null;
  color?: string | null;
  sortOrder?: number;
}

export interface UpdateProjectMilestoneDto {
  title?: string;
  dueDate?: string | null;
  color?: string | null;
  sortOrder?: number;
}

export interface ProjectInstance {
  id: string;
  templateId: string;
  name: string | null;
  anchorDate: string;
  status: string;
  ownerId: number | null;
  goalId: string | null;
  isShared?: boolean;
  createdAt: string;
  milestones: ProjectMilestone[];
  steps: ProjectInstanceStep[];
}
