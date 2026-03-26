export interface ProjectTemplateStep {
  id: string;
  templateId: string;
  title: string;
  offsetDays: number;
  offsetDescription: string | null;
  sortOrder: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  anchorType: string;
  createdAt: string;
  steps: ProjectTemplateStep[];
}

export interface CreateProjectTemplateDto {
  name: string;
  description?: string | null;
  anchorType?: string;
}

export interface UpdateProjectTemplateDto {
  name?: string;
  description?: string | null;
}

export interface CreateStepDto {
  title: string;
  offsetDays: number;
  offsetDescription?: string | null;
  sortOrder?: number;
}
