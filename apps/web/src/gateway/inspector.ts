export interface ShareItem { id: string; category: string; content: unknown }
export interface ShareReview { items: ShareItem[] }
export interface PreparedShare {
  sourceOwnerUserId: number | null;
  reviewHash: string;
  review: ShareReview;
  snapshot: ShareReview;
  inclusiveSnapshot: ShareReview;
}
export interface TranscriptShare {
  id: string; ownerUserId: number; sourceSessionId: string | null;
  recipientUserIds: number[]; snapshot: ShareReview; expiresAt: string; revokedAt: string | null;
}
export interface InspectorTodo { id: string; content: string; status: string; priority: string }
export interface MemoryProvenance { recorded: boolean; memoryIds: string[]; notePaths: string[]; items: unknown[] }
export interface SessionResource { id: string; kind: 'artifact' | 'mcp' }
export class InspectorGatewayError extends Error {
  constructor(readonly status: number) { super(`Inspector request unavailable (${status})`); }
}

export function readOnlyResourceDocument(html: string): string {
  // ponytail: static semantic preview, not an MCP App runtime. Interactive
  // rendering requires the existing capability broker, never relaxed sandbox flags.
  const template = document.createElement('template');
  template.innerHTML = html;
  const tags = new Set('A ARTICLE ASIDE BLOCKQUOTE BR CODE DD DETAILS DIV DL DT EM FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR I LI MAIN OL P PRE SECTION SMALL SPAN STRONG SUMMARY TABLE TBODY TD TH THEAD TR UL'.split(' '));
  for (const element of template.content.querySelectorAll('*')) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(element.tagName)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  }
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; base-uri 'none'">${template.innerHTML}`;
}

/** Same persisted tool shapes as Flutter's transcript_artifact_extractor.dart. */
export function sessionResources(messages: Array<{ parts?: unknown[] }>): SessionResource[] {
  const resources = new Map<string, SessionResource>();
  for (const message of messages) for (const value of message.parts ?? []) {
    if (!value || typeof value !== 'object') continue;
    const part = value as Record<string, any>;
    if (part.type !== 'tool' || !part.state || typeof part.state !== 'object' || part.state.status !== 'completed') continue;
    const state = part.state;
    const callId = part.callID ?? part.callId ?? part.toolCallId;
    // Canonical fork-owned descriptor; tool output/_meta alone is not provenance.
    const descriptor = state.mcpAppResource;
    if (typeof callId === 'string' && descriptor?.callID === callId && typeof descriptor.resourceUri === 'string' && descriptor.resourceUri.startsWith('ui://')) {
      resources.set(`mcp:${callId}`, { id: callId, kind: 'mcp' });
    }
    let id: unknown;
    if (part.tool === 'rhythm_create_live_artifact' && typeof state.output === 'string') {
      try { id = JSON.parse(state.output)?.id; } catch { /* not a successful artifact response */ }
    } else if (['rhythm_update_live_artifact_state', 'rhythm_update_live_artifact_bundle', 'rhythm_update_live_artifact_sharing'].includes(part.tool)) id = state.input?.id;
    if (typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) resources.set(`artifact:${id}`, { id, kind: 'artifact' });
  }
  return [...resources.values()];
}

export function createInspectorGateway(apiBase: string, sharingApiBase: string, token: string | undefined, fetcher: typeof fetch = fetch, localFetcher: typeof fetch = fetch) {
  async function request<T>(path: string, method = 'GET', body?: unknown, authenticated = false, localReview = false): Promise<T> {
    let result: Response;
    if (authenticated && !token) throw new InspectorGatewayError(401);
    // E11 exclusive-runtime exception: bearer only to this loopback review route.
    if (localReview) {
      const url = new URL(apiBase);
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || !/^\/agent-sessions\/[^/]+\/shares\/review$/.test(path)) throw new InspectorGatewayError(403);
    }
    try { result = await (authenticated ? fetcher : localFetcher)(`${authenticated && !localReview ? sharingApiBase : apiBase}${path}`, { method, cache: 'no-store', redirect: 'error', headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new InspectorGatewayError(0); }
    if (!result.ok) throw new InspectorGatewayError(result.status);
    return result.status === 204 ? undefined as T : result.json();
  }
  const session = (id: string) => `/agent-sessions/${encodeURIComponent(id)}`;
  return {
    todos: (id: string) => request<InspectorTodo[]>(`${session(id)}/todo`),
    provenance: (id: string) => request<MemoryProvenance>(`${session(id)}/memory-provenance`),
    messages: (id: string, before?: number) => request<{ messages: Array<{ parts?: unknown[] }>; pageInfo: { hasMore: boolean; nextCursor: number | null } }>(`${session(id)}/messages?limit=50${before ? `&before=${before}` : ''}`),
    resource: (id: string, callId: string) => request<{ mimeType: string; text: string }>(`${session(id)}/mcp-app-resource/${encodeURIComponent(callId)}`),
    review: (id: string) => request<PreparedShare>(`${session(id)}/shares/review`, 'GET', undefined, true, true),
    recipients: () => request<Array<{ userId: number; name: string; email?: string }>>('/workspaces/me/members', 'GET', undefined, true),
    createShare: async (id: string, input: { reviewHash: string; review: ShareReview; explicitlyIncludedItemIds: string[]; recipientUserIds: number[]; expiresAt?: string }) => {
      const fresh = await request<PreparedShare>(`${session(id)}/shares/review`, 'GET', undefined, true, true);
      if (fresh.reviewHash !== input.reviewHash) throw new InspectorGatewayError(409);
      const ids = new Set(input.review.items.map(item => item.id));
      if (ids.size !== input.review.items.length || [...ids].some(id => !fresh.inclusiveSnapshot.items.some(item => item.id === id))) throw new InspectorGatewayError(400);
      // Never forward review/raw content supplied by a caller. Publication consumes
      // only the freshly checked local server's sanitized selected snapshot.
      return request<TranscriptShare>('/shares', 'POST', { reviewHash: fresh.reviewHash,
        review: { items: fresh.inclusiveSnapshot.items.filter(item => ids.has(item.id)) },
        explicitlyIncludedItemIds: input.explicitlyIncludedItemIds, recipientUserIds: input.recipientUserIds,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) }, true);
    },
    shares: () => request<TranscriptShare[]>('/shares', 'GET', undefined, true),
    share: (id: string) => request<TranscriptShare>(`/shares/${encodeURIComponent(id)}`, 'GET', undefined, true),
    revoke: (id: string) => request<void>(`/shares/${encodeURIComponent(id)}`, 'DELETE', undefined, true),
  };
}
