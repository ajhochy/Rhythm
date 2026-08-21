import type { GatewayMode } from '.';

// Canonical shape from apps/api_server/src/models/live_artifact.ts:1-10. `updatedByUserId` is
// stripped from every public response by `publicArtifact()` at
// apps/api_server/src/controllers/live_artifacts_controller.ts:17, so it is intentionally absent here.
export type LiveArtifactVisibility = 'private' | 'shared' | 'organization';

export interface LiveArtifact {
  id: string;
  type: 'html';
  title: string;
  ownerUserId: number;
  workspaceId: number;
  visibility: LiveArtifactVisibility;
  currentBundleRevision: number;
  currentBundleHash: string;
  currentStateRevision: number;
  currentStateHash: string;
  declaredCapabilities: string[];
  createdAt: string;
  updatedAt: string;
  updatedByDisplayName: string | null;
  deletedAt: string | null;
}

// GET /live-artifacts/:id adds `state` per
// apps/api_server/src/controllers/live_artifacts_controller.ts:44.
export interface LiveArtifactDetail extends LiveArtifact { state: unknown }

export interface LiveArtifactBundle { html: string; css: string; js: string }

export interface CreateLiveArtifactInput {
  type: 'html';
  title: string;
  workspaceId: number;
  visibility?: LiveArtifactVisibility;
  bundle: LiveArtifactBundle;
  state: unknown;
  collaborators?: number[];
  declaredCapabilities?: string[];
}

export interface LiveArtifactCollaborator { userId: number }

// Exact request union validated at
// apps/api_server/src/controllers/live_artifact_capabilities_controller.ts:26-45.
export type PcoServicesReadRequest =
  | { operation: 'list_service_types' }
  | { operation: 'list_plans'; serviceTypeId: string; filter: 'future' | 'past' }
  | { operation: 'list_plan_items'; serviceTypeId: string; planId: string };

export class LiveArtifactsGatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly currentStateRevision?: number,
    readonly currentBundleRevision?: number,
  ) { super(message); }
}

export interface LiveArtifactsGateway {
  readonly mode: GatewayMode;
  list(search?: string): Promise<LiveArtifact[]>;
  get(id: string): Promise<LiveArtifactDetail>;
  render(id: string): Promise<string>;
  create(input: CreateLiveArtifactInput): Promise<LiveArtifact>;
  patch(id: string, input: { title?: string; visibility?: LiveArtifactVisibility; declaredCapabilities?: string[] }): Promise<LiveArtifact>;
  updateState(id: string, expectedStateRevision: number, state: unknown): Promise<LiveArtifact>;
  updateBundle(id: string, expectedBundleRevision: number, bundle: LiveArtifactBundle): Promise<LiveArtifact>;
  collaborators(id: string): Promise<LiveArtifactCollaborator[]>;
  addCollaborator(id: string, userId: number): Promise<LiveArtifactCollaborator>;
  removeCollaborator(id: string, userId: number): Promise<void>;
  pcoServicesRead(id: string, request: PcoServicesReadRequest): Promise<{ operation: string; data: unknown }>;
}

async function parsedError(result: Response): Promise<LiveArtifactsGatewayError> {
  let body: { error?: { code?: string }; currentStateRevision?: number; currentBundleRevision?: number } | null = null;
  try { body = await result.json(); } catch { /* body may be empty */ }
  const code = body?.error?.code;
  return new LiveArtifactsGatewayError(result.status, code ?? `Live artifact request failed (${result.status})`, code, body?.currentStateRevision, body?.currentBundleRevision);
}

async function response<T>(pending: Promise<Response>): Promise<T> {
  let result: Response;
  try { result = await pending; } catch (error) {
    if (error instanceof LiveArtifactsGatewayError) throw error;
    throw new LiveArtifactsGatewayError(0, 'Live artifacts service unavailable');
  }
  if (!result.ok) throw await parsedError(result);
  return result.status === 204 ? (undefined as T) : (await result.json() as T);
}

export function createLiveArtifactsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): LiveArtifactsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live-artifacts token is required');
  // Every request authenticates — apps/api_server/src/routes/live_artifacts_routes.ts:9 mounts
  // requireAuth ahead of every route on this router.
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/controllers/live_artifacts_controller.ts:27 — list is HTML-only by contract.
    list: (search) => response<LiveArtifact[]>(request(`/live-artifacts?type=html${search ? `&search=${encodeURIComponent(search)}` : ''}`)),
    get: (id) => response<LiveArtifactDetail>(request(`/live-artifacts/${encodeURIComponent(id)}`)),
    // The render document is fetched by the host and handed to an isolated frame — never routed
    // through code that could log or forward the bearer used to fetch it.
    render: async (id) => {
      const result = await request(`/live-artifacts/${encodeURIComponent(id)}/render`);
      if (!result.ok) throw await parsedError(result);
      return result.text();
    },
    create: (input) => response<LiveArtifact>(request('/live-artifacts', { method: 'POST', body: json(input) })),
    patch: (id, input) => response<LiveArtifact>(request(`/live-artifacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    // expectedStateRevision/expectedBundleRevision are a compare-and-set contract — a stale write is
    // never retried blindly; the 409 payload's currentStateRevision/currentBundleRevision is surfaced
    // to the caller via LiveArtifactsGatewayError instead.
    updateState: (id, expectedStateRevision, state) => response<LiveArtifact>(request(`/live-artifacts/${encodeURIComponent(id)}/state`, { method: 'PUT', body: json({ expectedStateRevision, state }) })),
    updateBundle: (id, expectedBundleRevision, bundle) => response<LiveArtifact>(request(`/live-artifacts/${encodeURIComponent(id)}/bundle`, { method: 'PUT', body: json({ expectedBundleRevision, bundle }) })),
    collaborators: (id) => response<LiveArtifactCollaborator[]>(request(`/live-artifacts/${encodeURIComponent(id)}/collaborators`)),
    addCollaborator: (id, userId) => response<LiveArtifactCollaborator>(request(`/live-artifacts/${encodeURIComponent(id)}/collaborators`, { method: 'POST', body: json({ userId }) })),
    removeCollaborator: (id, userId) => response<void>(request(`/live-artifacts/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(String(userId))}`, { method: 'DELETE' })),
    pcoServicesRead: (id, capabilityRequest) => response<{ operation: string; data: unknown }>(request(`/live-artifacts/${encodeURIComponent(id)}/capabilities/pco.services.read`, { method: 'POST', body: json(capabilityRequest) })),
  };
}
