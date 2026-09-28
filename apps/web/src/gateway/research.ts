import type { GatewayMode } from '.';

// Canonical research project — apps/api_server/src/repositories/agent_research_repository.ts:34-59
// (ResearchProjectInput/ResearchProject) via apps/api_server/src/routes/agentResearchRoutes.ts:11-15.
export interface ResearchProject {
  id: string;
  ownerUserId: number;
  name: string;
  question: string;
  goals: unknown[];
  domain: string | null;
  profileId: string | null;
  passConfig: unknown[];
  modelPolicy: Record<string, unknown>;
  criticConfig: Record<string, unknown>;
  synthesisConfig: Record<string, unknown>;
  scheduleRef: string | null;
  budget: Record<string, unknown>;
  /** Production live-artifact id of the project's living magazine (null until first published). */
  magazineArtifactId?: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A reader's section comment, fed to the next run's plan (agentResearchController.researchGuidance). */
export interface ResearchGuidance { anchor: string | null; quote: string; text: string }

export interface ResearchProjectInput {
  name: string;
  question: string;
  goals: unknown[];
  domain?: string | null;
  profileId?: string | null;
  passConfig?: unknown[];
  modelPolicy?: Record<string, unknown>;
  criticConfig?: Record<string, unknown>;
  synthesisConfig?: Record<string, unknown>;
  scheduleRef?: string | null;
  budget?: Record<string, unknown>;
}

// Canonical per-run row — agent_research_repository.ts:61-77 (ResearchProjectRun).
export interface ResearchProjectRun {
  id: string;
  projectId: string;
  ownerUserId: number;
  triggerType: 'manual' | 'scheduled' | 'follow-up';
  configSnapshot: Record<string, unknown>;
  status: string;
  progress: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  canonicalArtifact: Record<string, unknown> | null;
  artifacts: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  usage: { tokens: number; costUsd: number };
}

// research_discussion_service.ts:151 (ResearchDiscussionService.start()).
export interface ResearchDiscussion {
  sessionId: string;
  contextHash: string;
}

export interface ResearchGateway {
  readonly mode: GatewayMode;
  listProjects(includeArchived?: boolean): Promise<ResearchProject[]>;
  createProject(input: ResearchProjectInput): Promise<ResearchProject>;
  updateProject(id: string, patch: Partial<ResearchProjectInput>): Promise<ResearchProject>;
  archiveProject(id: string): Promise<ResearchProject>;
  listRuns(projectId: string): Promise<ResearchProjectRun[]>;
  getRun(projectId: string, runId: string): Promise<ResearchProjectRun>;
  startRun(projectId: string, guidance?: ResearchGuidance[]): Promise<ResearchProjectRun>;
  cancelRun(projectId: string, runId: string): Promise<ResearchProjectRun>;
  resumeRun(projectId: string, runId: string): Promise<ResearchProjectRun>;
  finishRun(projectId: string, runId: string): Promise<ResearchProjectRun>;
  retryPass(projectId: string, runId: string, passId: string): Promise<unknown>;
  startDiscussion(projectId: string, runId: string, selectedArtifactIds: string[]): Promise<ResearchDiscussion>;
  magazine(projectId: string, runId: string): Promise<string>;
  exportRun(projectId: string, runId: string, format: 'html' | 'markdown'): Promise<string>;
  setMagazineArtifact(projectId: string, artifactId: string): Promise<ResearchProject>;
  sessionMagazine(sessionId: string): Promise<{ projectId: string; runId: string | null; artifactId: string | null }>;
}

export class ResearchGatewayError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Research service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Research project not found' }[status] ?? `${operation} failed (${status})`);

/** Surfaces the API's `{ error: { code, message } }` body instead of a bare status. */
async function failure(result: Response, operation: string): Promise<ResearchGatewayError> {
  const body = await result.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
  const message = typeof body?.error?.message === 'string' && body.error.message.trim() ? body.error.message : failureText(result.status, operation);
  return new ResearchGatewayError(result.status, message, typeof body?.error?.code === 'string' ? body.error.code : undefined);
}

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw await failure(result, operation);
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof ResearchGatewayError) throw error;
    throw new ResearchGatewayError(0, failureText(0, operation));
  }
}

async function textResponse(operation: string, pending: Promise<Response>): Promise<string> {
  try {
    const result = await pending;
    if (!result.ok) throw await failure(result, operation);
    return await result.text();
  } catch (error) {
    if (error instanceof ResearchGatewayError) throw error;
    throw new ResearchGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureResearchGateway(): ResearchGateway {
  const unsupported = async (): Promise<never> => { throw new ResearchGatewayError(0, 'Fixture research gateway is unsupported'); };
  return {
    mode: 'fixture', listProjects: unsupported, createProject: unsupported, updateProject: unsupported, archiveProject: unsupported,
    listRuns: unsupported, getRun: unsupported, startRun: unsupported, cancelRun: unsupported, resumeRun: unsupported, finishRun: unsupported, retryPass: unsupported,
    startDiscussion: unsupported, magazine: unsupported, exportRun: unsupported, setMagazineArtifact: unsupported, sessionMagazine: unsupported,
  };
}

export function createLiveResearchGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): ResearchGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a research token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const base = '/agent-research/projects';
  return {
    mode: 'live',
    listProjects: (includeArchived) => response<ResearchProject[]>('Load research projects', request(`${base}${includeArchived ? '?includeArchived=true' : ''}`)),
    createProject: (input) => response<ResearchProject>('Create research project', request(base, { method: 'POST', body: JSON.stringify(input) })),
    updateProject: (id, patch) => response<ResearchProject>('Update research project', request(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    archiveProject: (id) => response<ResearchProject>('Archive research project', request(`${base}/${encodeURIComponent(id)}/archive`, { method: 'POST' })),
    listRuns: (projectId) => response<ResearchProjectRun[]>('Load research runs', request(`${base}/${encodeURIComponent(projectId)}/runs`)),
    getRun: (projectId, runId) => response<ResearchProjectRun>('Load research run', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`)),
    startRun: (projectId, guidance) => response<ResearchProjectRun>('Start research run', request(`${base}/${encodeURIComponent(projectId)}/runs`, { method: 'POST', body: JSON.stringify({ triggerType: 'manual', ...(guidance?.length ? { guidance } : {}) }) })),
    cancelRun: (projectId, runId) => response<ResearchProjectRun>('Cancel research run', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })),
    resumeRun: (projectId, runId) => response<ResearchProjectRun>('Resume research run', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' })),
    finishRun: (projectId, runId) => response<ResearchProjectRun>('Finish research run', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/finish`, { method: 'POST' })),
    retryPass: (projectId, runId, passId) => response<unknown>('Retry research pass', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/passes/${encodeURIComponent(passId)}/retry`, { method: 'POST' })),
    startDiscussion: (projectId, runId, selectedArtifactIds) => response<ResearchDiscussion>('Start research discussion', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/discussions`, { method: 'POST', body: JSON.stringify({ selectedArtifactIds }) })),
    magazine: (projectId, runId) => textResponse('Load research magazine', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/magazine`)),
    exportRun: (projectId, runId, format) => textResponse('Export research run', request(`${base}/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/export?format=${format}`)),
    setMagazineArtifact: (projectId, artifactId) => response<ResearchProject>('Link research magazine', request(`${base}/${encodeURIComponent(projectId)}/magazine-artifact`, { method: 'PUT', body: JSON.stringify({ artifactId }) })),
    sessionMagazine: (sessionId) => response<{ projectId: string; runId: string | null; artifactId: string | null }>('Load discussion magazine', request(`/agent-research/sessions/${encodeURIComponent(sessionId)}/magazine`)),
  };
}
