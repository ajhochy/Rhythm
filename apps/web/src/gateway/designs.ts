import type { GatewayMode } from '.';

// Canonical public design row — apps/api_server/src/repositories/agent_designs_repository.ts:5-33
// (publicAgentDesign strips the local filePath before this ever reaches a client).
export interface AgentDesign {
  id: string;
  title: string | null;
  provider: string | null;
  artifactUrl: string | null;
  projectUrl: string | null;
  canvaUrl: string | null;
  artifactType: string | null;
  thumbnailUrl: string | null;
  sessionId: string | null;
  createdAt: string;
}

// A newly launched Creative Media session, seeded from the selected design — the caller only
// needs enough identity to route into it; full detail comes from the normal session gateway.
export interface LaunchedDesignSession {
  id: string;
  status: string;
}

export interface DesignsGateway {
  readonly mode: GatewayMode;
  // GET /agent-designs — agentDesignsRoutes.ts:11.
  list(): Promise<AgentDesign[]>;
  // GET /agent-designs/:id/artifact — agentDesignsRoutes.ts:13. Opens the actual deliverable
  // rather than a fixture preview; callers get back the raw bytes/text and content-type.
  artifact(design: AgentDesign): Promise<{ contentType: string; body: string }>;
  // POST /agent-sessions seeded from this design's canonical id/artifact context — there is no
  // dedicated "launch" endpoint; a Creative Media session is just a session created with designId
  // in its body so the server can seed context from the design it names.
  launch(designId: string): Promise<LaunchedDesignSession>;
}

export class DesignsGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Gallery service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Design not found' }[status] ?? `${operation} failed (${status})`);

export function createFixtureDesignsGateway(): DesignsGateway {
  const unsupported = async (): Promise<never> => { throw new DesignsGatewayError(0, 'Fixture designs gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, artifact: unsupported, launch: unsupported };
}

export function createLiveDesignsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): DesignsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a gallery token is required');
  const auth = { Authorization: `Bearer ${token}` };
  return {
    mode: 'live',
    list: async () => {
      let result: Response;
      try { result = await fetcher(`${apiBase}/agent-designs`, { headers: auth }); }
      catch { throw new DesignsGatewayError(0, failureText(0, 'Load creative designs')); }
      if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, 'Load creative designs'));
      return await result.json() as AgentDesign[];
    },
    artifact: async (design) => {
      if (!design.artifactUrl) throw new DesignsGatewayError(404, 'This design has no stored artifact');
      let result: Response;
      try { result = await fetcher(`${apiBase}${design.artifactUrl}`, { headers: auth }); }
      catch { throw new DesignsGatewayError(0, failureText(0, 'Open deliverable')); }
      if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, 'Open deliverable'));
      return { contentType: result.headers.get('content-type') ?? 'application/octet-stream', body: await result.text() };
    },
    launch: async (designId) => {
      let result: Response;
      try {
        result = await fetcher(`${apiBase}/agent-sessions`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ designId }),
        });
      } catch { throw new DesignsGatewayError(0, failureText(0, 'Launch Creative Media')); }
      if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, 'Launch Creative Media'));
      const body = await result.json() as { id?: string; status?: string };
      if (!body.id) throw new DesignsGatewayError(0, 'Launch Creative Media returned no session id');
      return { id: body.id, status: body.status ?? 'idle' };
    },
  };
}
