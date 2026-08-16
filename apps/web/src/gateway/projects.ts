import type { GatewayMode } from '.';

export interface ProjectTemplateStep { id: string; templateId: string; title: string; offsetDays: number; offsetDescription: string | null; sortOrder: number; assigneeId: number | null; assigneeName: string | null }
export interface ProjectTemplate { id: string; name: string; description: string | null; anchorType: string; ownerId: number | null; createdAt: string; steps: ProjectTemplateStep[] }
export interface ProjectInstanceStep { id: string; instanceId: string; stepId: string; title: string; dueDate: string; scheduledDate: string | null; status: 'open' | 'done'; notes: string | null; assigneeId: number | null; assigneeName: string | null; milestoneId: string | null }
export interface ProjectMilestone { id: string; instanceId: string; title: string; dueDate: string | null; color: string | null; sortOrder: number; createdAt: string; updatedAt: string }
export interface ProjectInstance { id: string; templateId: string; name: string | null; anchorDate: string; status: string; ownerId: number | null; goalId: string | null; isShared?: boolean; createdAt: string; milestones: ProjectMilestone[]; steps: ProjectInstanceStep[] }
export interface ProjectCollaborator { userId: number; name: string; email?: string; photoUrl?: string | null }
export interface CreateProjectTemplateInput { name: string; description?: string | null; anchorType?: string; ownerId?: number | null }
export interface UpdateProjectTemplateInput { name?: string; description?: string | null; ownerId?: number | null }
export interface CreateProjectTemplateStepInput { title: string; offsetDays: number; offsetDescription?: string | null; sortOrder?: number; assigneeId?: number | null }
export type UpdateProjectTemplateStepInput = Partial<CreateProjectTemplateStepInput>;
export interface GenerateProjectInput { anchorDate: string; name?: string | null; goalId?: string | null }
export interface CreateProjectInstanceInput extends GenerateProjectInput { templateId: string }
export type UpdateProjectInstanceStepInput = Partial<Pick<ProjectInstanceStep, 'title' | 'dueDate' | 'scheduledDate' | 'status' | 'notes' | 'assigneeId' | 'milestoneId'>>;
export interface CreateMilestoneInput { title: string; dueDate?: string | null; color?: string | null; sortOrder?: number }
export type UpdateMilestoneInput = Partial<CreateMilestoneInput>;

export interface ProjectsGateway {
  readonly mode: GatewayMode;
  templates(): Promise<ProjectTemplate[]>;
  template(id: string): Promise<ProjectTemplate>;
  createTemplate(input: CreateProjectTemplateInput): Promise<ProjectTemplate>;
  updateTemplate(id: string, input: UpdateProjectTemplateInput): Promise<ProjectTemplate>;
  deleteTemplate(id: string): Promise<void>;
  addTemplateStep(templateId: string, input: CreateProjectTemplateStepInput): Promise<ProjectTemplateStep>;
  updateTemplateStep(templateId: string, stepId: string, input: UpdateProjectTemplateStepInput): Promise<ProjectTemplateStep>;
  deleteTemplateStep(templateId: string, stepId: string): Promise<void>;
  generateInstance(templateId: string, input: GenerateProjectInput): Promise<ProjectInstance>;
  instances(templateId?: string): Promise<ProjectInstance[]>;
  createInstance(input: CreateProjectInstanceInput): Promise<ProjectInstance>;
  updateInstanceGoal(id: string, goalId: string | null): Promise<ProjectInstance>;
  deleteInstance(id: string): Promise<void>;
  updateInstanceStep(stepId: string, input: UpdateProjectInstanceStepInput): Promise<ProjectInstanceStep>;
  milestones(instanceId: string): Promise<ProjectMilestone[]>;
  createMilestone(instanceId: string, input: CreateMilestoneInput): Promise<ProjectMilestone>;
  updateMilestone(instanceId: string, milestoneId: string, input: UpdateMilestoneInput): Promise<ProjectMilestone>;
  deleteMilestone(instanceId: string, milestoneId: string): Promise<void>;
  collaborators(instanceId: string): Promise<ProjectCollaborator[]>;
  addCollaborator(instanceId: string, userId: number): Promise<ProjectCollaborator[]>;
  removeCollaborator(instanceId: string, userId: number): Promise<void>;
}

export class ProjectsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Projects service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Project record not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new ProjectsGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof ProjectsGatewayError) throw error; throw new ProjectsGatewayError(0, failureText(0, operation)); } }

export function createFixtureProjectsGateway(_fetcher?: typeof fetch): ProjectsGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new ProjectsGatewayError(0, 'Fixture projects gateway is unsupported'); };
  return { mode: 'fixture', templates: unsupported, template: unsupported, createTemplate: unsupported, updateTemplate: unsupported, deleteTemplate: unsupported, addTemplateStep: unsupported, updateTemplateStep: unsupported, deleteTemplateStep: unsupported, generateInstance: unsupported, instances: unsupported, createInstance: unsupported, updateInstanceGoal: unsupported, deleteInstance: unsupported, updateInstanceStep: unsupported, milestones: unsupported, createMilestone: unsupported, updateMilestone: unsupported, deleteMilestone: unsupported, collaborators: unsupported, addCollaborator: unsupported, removeCollaborator: unsupported };
}

export function createLiveProjectsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): ProjectsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit projects token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/routes/project_templates_routes.ts:12-16
    templates: () => response<ProjectTemplate[]>('Load project templates', request('/project-templates')),
    template: (id) => response<ProjectTemplate>('Load project template', request(`/project-templates/${encodeURIComponent(id)}`)),
    createTemplate: (input) => response<ProjectTemplate>('Create project template', request('/project-templates', { method: 'POST', body: json(input) })),
    updateTemplate: (id, input) => response<ProjectTemplate>('Update project template', request(`/project-templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    deleteTemplate: (id) => response<void>('Delete project template', request(`/project-templates/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/project_templates_routes.ts:17-19
    addTemplateStep: (templateId, input) => response<ProjectTemplateStep>('Add project template step', request(`/project-templates/${encodeURIComponent(templateId)}/steps`, { method: 'POST', body: json(input) })),
    updateTemplateStep: (templateId, stepId, input) => response<ProjectTemplateStep>('Update project template step', request(`/project-templates/${encodeURIComponent(templateId)}/steps/${encodeURIComponent(stepId)}`, { method: 'PATCH', body: json(input) })),
    deleteTemplateStep: (templateId, stepId) => response<void>('Delete project template step', request(`/project-templates/${encodeURIComponent(templateId)}/steps/${encodeURIComponent(stepId)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/project_templates_routes.ts:20
    generateInstance: (templateId, input) => response<ProjectInstance>('Generate project instance', request(`/project-templates/${encodeURIComponent(templateId)}/generate`, { method: 'POST', body: json(input) })),
    // apps/api_server/src/routes/project_instances_routes.ts:10-13,18
    instances: (templateId) => response<ProjectInstance[]>('Load project instances', request(`/project-instances${templateId ? `?templateId=${encodeURIComponent(templateId)}` : ''}`)),
    createInstance: (input) => response<ProjectInstance>('Create project instance', request('/project-instances', { method: 'POST', body: json(input) })),
    updateInstanceGoal: (id, goalId) => response<ProjectInstance>('Update project instance', request(`/project-instances/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ goalId }) })),
    deleteInstance: (id) => response<void>('Delete project instance', request(`/project-instances/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    updateInstanceStep: (stepId, input) => response<ProjectInstanceStep>('Update project instance step', request(`/project-instances/steps/${encodeURIComponent(stepId)}`, { method: 'PATCH', body: json(input) })),
    // apps/api_server/src/routes/project_instances_routes.ts:14-17
    milestones: (instanceId) => response<ProjectMilestone[]>('Load project milestones', request(`/project-instances/${encodeURIComponent(instanceId)}/milestones`)),
    createMilestone: (instanceId, input) => response<ProjectMilestone>('Create project milestone', request(`/project-instances/${encodeURIComponent(instanceId)}/milestones`, { method: 'POST', body: json(input) })),
    updateMilestone: (instanceId, milestoneId, input) => response<ProjectMilestone>('Update project milestone', request(`/project-instances/${encodeURIComponent(instanceId)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'PATCH', body: json(input) })),
    deleteMilestone: (instanceId, milestoneId) => response<void>('Delete project milestone', request(`/project-instances/${encodeURIComponent(instanceId)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/project_instances_routes.ts:19-21
    collaborators: (instanceId) => response<ProjectCollaborator[]>('Load project collaborators', request(`/project-instances/${encodeURIComponent(instanceId)}/collaborators`)),
    addCollaborator: (instanceId, userId) => response<ProjectCollaborator[]>('Add project collaborator', request(`/project-instances/${encodeURIComponent(instanceId)}/collaborators`, { method: 'POST', body: json({ userId }) })),
    removeCollaborator: (instanceId, userId) => response<void>('Remove project collaborator', request(`/project-instances/${encodeURIComponent(instanceId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' })),
  };
}
