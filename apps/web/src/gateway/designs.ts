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
  folderId?: string | null;
  createdAt: string;
}

// Single-level gallery folder — agent_designs_repository.ts AgentDesignFolder.
export interface AgentDesignFolder {
  id: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
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
  // GET an API-relative design asset (/agent-designs/:id/artifact or /thumbnail) as bytes.
  // <img>/<video> can't load these directly: a no-cors media request carries no Origin, so the
  // local API's surface guard 403s it (Sec-Fetch-Site: cross-site) and Chromium ORB-blocks the
  // JSON body. fetch() sends the allowed renderer Origin; callers display the Blob via blob: URLs.
  asset(path: string): Promise<Blob>;
  // POST /agent-sessions seeded from this design's canonical id/artifact context — there is no
  // dedicated "launch" endpoint; a Creative Media session is just a session created with designId
  // in its body so the server can seed context from the design it names.
  launch(designId: string): Promise<LaunchedDesignSession>;
  // Folder + organization routes (agentDesignsRoutes.ts). Deleting a folder unfiles its designs;
  // deleting a design removes the gallery record only — the media file stays on disk.
  listFolders(): Promise<AgentDesignFolder[]>;
  createFolder(name: string): Promise<AgentDesignFolder>;
  renameFolder(id: string, name: string): Promise<AgentDesignFolder>;
  deleteFolder(id: string): Promise<void>;
  update(id: string, patch: { title?: string; folderId?: string | null }): Promise<AgentDesign>;
  remove(id: string): Promise<void>;
}

export class DesignsGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Gallery service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Design not found' }[status] ?? `${operation} failed (${status})`);

export function createFixtureDesignsGateway(): DesignsGateway {
  const unsupported = async (): Promise<never> => { throw new DesignsGatewayError(0, 'Fixture designs gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, asset: unsupported, launch: unsupported, listFolders: unsupported, createFolder: unsupported, renameFolder: unsupported, deleteFolder: unsupported, update: unsupported, remove: unsupported };
}

export function createLiveDesignsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): DesignsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a gallery token is required');
  const auth = { Authorization: `Bearer ${token}` };
  const send = async (method: string, path: string, operation: string, body?: unknown) => {
    let result: Response;
    try {
      result = await fetcher(`${apiBase}${path}`, {
        method,
        headers: body === undefined ? auth : { ...auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new DesignsGatewayError(0, failureText(0, operation)); }
    if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined : await result.json();
  };
  const id = encodeURIComponent;
  return {
    mode: 'live',
    list: async () => {
      let result: Response;
      try { result = await fetcher(`${apiBase}/agent-designs`, { headers: auth }); }
      catch { throw new DesignsGatewayError(0, failureText(0, 'Load creative designs')); }
      if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, 'Load creative designs'));
      return await result.json() as AgentDesign[];
    },
    asset: async (path) => {
      if (!path.startsWith('/agent-designs/')) throw new DesignsGatewayError(404, 'This design has no stored artifact');
      let result: Response;
      try { result = await fetcher(`${apiBase}${path}`, { headers: auth }); }
      catch { throw new DesignsGatewayError(0, failureText(0, 'Open deliverable')); }
      if (!result.ok) throw new DesignsGatewayError(result.status, failureText(result.status, 'Open deliverable'));
      return await result.blob();
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
    listFolders: async () => await send('GET', '/agent-designs/folders', 'Load folders') as AgentDesignFolder[],
    createFolder: async (name) => await send('POST', '/agent-designs/folders', 'Create folder', { name }) as AgentDesignFolder,
    renameFolder: async (folderId, name) => await send('PATCH', `/agent-designs/folders/${id(folderId)}`, 'Rename folder', { name }) as AgentDesignFolder,
    deleteFolder: async (folderId) => { await send('DELETE', `/agent-designs/folders/${id(folderId)}`, 'Delete folder'); },
    update: async (designId, patch) => await send('PATCH', `/agent-designs/${id(designId)}`, 'Update design', patch) as AgentDesign,
    remove: async (designId) => { await send('DELETE', `/agent-designs/${id(designId)}`, 'Delete design'); },
  };
}
