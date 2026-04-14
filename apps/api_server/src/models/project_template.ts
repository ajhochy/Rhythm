export interface ProjectTemplateStep {
  id: string;
  templateId: string;
  title: string;
  offsetDays: number;
  offsetDescription: string | null;
  sortOrder: number;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  anchorType: string;
  ownerId: number | null;
  createdAt: string;
  steps: ProjectTemplateStep[];
}

export interface CreateProjectTemplateDto {
  name: string;
  description?: string | null;
  anchorType?: string;
  ownerId?: number | null;
}

export interface UpdateProjectTemplateDto {
  name?: string;
  description?: string | null;
  ownerId?: number | null;
}

export interface CreateStepDto {
  title: string;
  offsetDays: number;
  offsetDescription?: string | null;
  sortOrder?: number;
  assigneeId?: number | null;
}
