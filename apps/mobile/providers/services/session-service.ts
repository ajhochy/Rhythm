import type { OpencodeClient, Part, PermissionRuleset } from '@opencode-ai/sdk/v2/client';

import type { GlobalSession, Project } from '@/lib/opencode/types';
import { createOpenCodeMessageId } from '@/lib/opencode/identifier';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function loadWorkspaceCatalog(catalogClient: OpencodeClient) {
  const [pathResponse, projectsResponse, currentProjectResponse] = await Promise.all([
    catalogClient.path.get(),
    catalogClient.project.list(),
    catalogClient.project.current(),
  ]);

  const discoveredProjects = requireData(projectsResponse.data, 'project list request');
  const currentProject = requireData(currentProjectResponse.data, 'current project request');
  const path = requireData(pathResponse.data, 'path request');
  const dedupedProjects = new Map<string, Project>();

  if (currentProject?.worktree) {
    dedupedProjects.set(currentProject.worktree, currentProject);
  }

  discoveredProjects.forEach((project) => {
    dedupedProjects.set(project.worktree, project);
  });

  const nextProjects = [...dedupedProjects.values()].sort(
    (left, right) => (right.time.initialized || right.time.created) - (left.time.initialized || left.time.created),
  );

  return {
    currentProjectPath: currentProject?.worktree,
    serverRootPath: path.directory,
    serverProjects: nextProjects,
  };
}

export async function listSessions(client: OpencodeClient) {
  const [sessionsResponse, statusesResponse] = await Promise.all([client.session.list(), client.session.status()]);

  const nextSessions = [...requireData(sessionsResponse.data, 'session list request')]
    .sort((left, right) => right.time.updated - left.time.updated);
  return { sessions: nextSessions, statuses: requireData(statusesResponse.data, 'session status request') };
}

export async function listArchivedSessions(client: OpencodeClient) {
  const sessions: GlobalSession[] = [];
  let cursor: number | undefined;
  do {
    const response = await client.experimental.session.list({ archived: true, cursor, limit: 100 });
    sessions.push(...requireData(response.data, 'archived session list request'));
    const next = response.response?.headers.get('x-next-cursor');
    cursor = next ? Number(next) : undefined;
  } while (cursor !== undefined);
  return sessions;
}

export type ProjectSessionCatalogEntry = Record<string, unknown> & {
  id: string;
  projectId: string | null;
  routingProjectId?: string;
  status: string;
};

type SessionCatalogOptions = {
  onProgress?: (sessions: ProjectSessionCatalogEntry[]) => void;
  skipProjectScopedSweep?: boolean;
};

function statusLabel(status: unknown): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    const type = (status as Record<string, unknown>).type;
    if (typeof type === 'string') return type;
  }
  return 'idle';
}

export async function listSessionsAcrossProjects(
  buildScopedClient: (projectId: string) => OpencodeClient,
  projectPaths: string[],
  options: SessionCatalogOptions = {},
): Promise<ProjectSessionCatalogEntry[]> {
  const uniquePaths = [...new Set(projectPaths.filter(Boolean))];
  const catalog: ProjectSessionCatalogEntry[] = [];
  const publish = () => {
    const deduped = new Map<string, ProjectSessionCatalogEntry>();
    for (const session of catalog) {
      const existing = deduped.get(session.id);
      const existingIsRoutingOnly =
        existing?.projectId === null && Boolean(existing.routingProjectId);
      if (!existing || (existingIsRoutingOnly && session.projectId !== null)) {
        deduped.set(session.id, session);
      }
    }
    const snapshot = [...deduped.values()];
    options.onProgress?.(snapshot);
    return snapshot;
  };

  if (uniquePaths.length > 0) {
    const discoveryClient = buildScopedClient(uniquePaths[0]);
    for (const archived of [false, true]) {
      let cursor: number | undefined;
      let firstPage = true;
      do {
        const response = await discoveryClient.experimental.session.list(
          { archived, cursor, limit: firstPage && !archived ? 10 : 100 },
          {
            headers: {
              'x-rhythm-session-discovery': 'owner-unscoped',
            },
          },
        );
        catalog.push(
          ...requireData(response.data, 'owner session discovery request')
            .map((session) => ({
              ...(session as unknown as Record<string, unknown>),
              id: session.id,
              projectId:
                typeof (session as unknown as Record<string, unknown>).projectId === 'string'
                  ? (session as unknown as { projectId: string }).projectId
                  : null,
              routingProjectId: uniquePaths[0],
              status: archived
                ? 'archived'
                : statusLabel(
                    (session as unknown as Record<string, unknown>).status,
                  ),
            })),
        );
        publish();
        const next = response.response?.headers.get('x-next-cursor');
        cursor = next ? Number(next) : undefined;
        firstPage = false;
      } while (cursor !== undefined);
    }
  }

  if (options.skipProjectScopedSweep) {
    return publish();
  }

  // Keep the paired Mac responsive when an organization has many worktrees.
  for (let offset = 0; offset < uniquePaths.length; offset += 4) {
    const batch = uniquePaths.slice(offset, offset + 4);
    const results = await Promise.all(
      batch.map(async (projectId) => {
        const scopedClient = buildScopedClient(projectId);
        const [{ sessions, statuses }, archived] = await Promise.all([
          listSessions(scopedClient),
          listArchivedSessions(scopedClient),
        ]);
        return [
          ...sessions.map((session) => ({
            ...(session as unknown as Record<string, unknown>),
            id: session.id,
            projectId,
            status: statusLabel(statuses[session.id]),
          })),
          ...archived.map((session) => ({
            ...(session as unknown as Record<string, unknown>),
            id: session.id,
            projectId,
            status: 'archived',
          })),
        ] satisfies ProjectSessionCatalogEntry[];
      }),
    );
    catalog.push(...results.flat());
    publish();
  }
  return publish();
}

export const MOBILE_SESSION_MESSAGE_PAGE_SIZE = 20;

export async function resolveOwnerDiscoveredSession(
  client: OpencodeClient,
  sessionId: string,
) {
  const response = await client.experimental.session.list(
    { archived: false, search: sessionId, limit: 1 },
    {
      headers: {
        'x-rhythm-session-discovery': 'owner-unscoped',
      },
    },
  );
  return requireData(response.data, 'owner session lookup request')
    .find((session) => session.id === sessionId);
}

function requestStatus(reason: unknown): number | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  const cause = (reason as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return undefined;
  const status = Number((cause as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

export async function resolveExactSession(
  client: OpencodeClient,
  sessionId: string,
) {
  let scopedLookupError: unknown;
  try {
    const response = await client.session.get({ sessionID: sessionId });
    const session = requireData(response.data, 'session lookup request');
    if (session.id === sessionId) return session;
  } catch (reason) {
    if (requestStatus(reason) !== 404) {
      scopedLookupError = reason;
    }
  }

  const ownerSession = await resolveOwnerDiscoveredSession(client, sessionId);
  if (ownerSession) return ownerSession;
  if (scopedLookupError) throw scopedLookupError;
  return undefined;
}

export type SessionMessagePage = {
  records: NonNullable<Awaited<ReturnType<OpencodeClient['session']['messages']>>['data']>;
  nextCursor?: string;
};

export async function getSessionMessages(
  client: OpencodeClient,
  sessionId: string,
  options: { cursor?: string } = {},
): Promise<SessionMessagePage> {
  const response = await client.session.messages({
    sessionID: sessionId,
    limit: MOBILE_SESSION_MESSAGE_PAGE_SIZE,
    ...(options.cursor ? { before: options.cursor } : {}),
  });
  const records = requireData(response.data, 'session messages request');
  return {
    records,
    nextCursor:
      records.length === MOBILE_SESSION_MESSAGE_PAGE_SIZE
        ? records[0]?.info.id
        : undefined,
  };
}

export async function getSessionDiff(
  client: OpencodeClient,
  sessionId: string,
  loadedMessages?: SessionMessagePage['records'],
) {
  const messages = loadedMessages ?? (await getSessionMessages(client, sessionId)).records;
  const latestUserMessage = messages.slice().reverse().find(({ info }) => info.role === 'user');
  if (!latestUserMessage) {
    return [];
  }

  const response = await client.session.diff({ sessionID: sessionId, messageID: latestUserMessage.info.id });
  return requireData(response.data, 'message diff request');
}

export async function getSessionTodos(client: OpencodeClient, sessionId: string) {
  const response = await client.session.todo({ sessionID: sessionId });
  return requireData(response.data, 'session todo request');
}

export async function deleteSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.delete({ sessionID: sessionId })).data;
}

export async function updateSessionTitle(client: OpencodeClient, sessionId: string, title: string) {
  return (await client.session.update({ sessionID: sessionId, title })).data;
}

export type SessionUpdate = {
  title?: string;
  metadata?: Record<string, unknown>;
  permission?: PermissionRuleset;
  time?: { archived?: number };
};

export async function updateSession(client: OpencodeClient, sessionId: string, update: SessionUpdate) {
  return requireData((await client.session.update({ sessionID: sessionId, ...update })).data, 'session update request');
}

export function archiveSession(client: OpencodeClient, sessionId: string, archived = Date.now()) {
  return updateSession(client, sessionId, { time: { archived } });
}

export function restoreSession(client: OpencodeClient, sessionId: string) {
  return updateSession(client, sessionId, { time: { archived: 0 } });
}

export async function getSessionChildren(client: OpencodeClient, sessionId: string) {
  return requireData((await client.session.children({ sessionID: sessionId })).data, 'session children request');
}

export async function deleteSessionMessage(client: OpencodeClient, sessionId: string, messageId: string) {
  return requireData(
    (await client.session.deleteMessage({ sessionID: sessionId, messageID: messageId })).data,
    'message deletion request',
  );
}

export async function updateSessionPart(
  client: OpencodeClient,
  sessionId: string,
  messageId: string,
  part: Part,
) {
  return requireData(
    (await client.part.update({
      sessionID: sessionId,
      messageID: messageId,
      partID: part.id,
      part,
    })).data,
    'message part update request',
  );
}

export async function deleteSessionPart(
  client: OpencodeClient,
  sessionId: string,
  messageId: string,
  partId: string,
) {
  return requireData(
    (await client.part.delete({ sessionID: sessionId, messageID: messageId, partID: partId })).data,
    'message part deletion request',
  );
}

export async function initializeSession(
  client: OpencodeClient,
  sessionId: string,
  model?: { providerID: string; modelID: string },
) {
  return client.session.init({
    sessionID: sessionId,
    ...model,
    messageID: createOpenCodeMessageId(),
  });
}

export async function runSessionShell(
  client: OpencodeClient,
  sessionId: string,
  command: string,
  options?: { agent?: string; model?: { providerID: string; modelID: string } },
) {
  return requireData(
    (await client.session.shell({
      sessionID: sessionId,
      command,
      agent: options?.agent,
      model: options?.model,
    })).data,
    'session shell request',
  );
}

export async function forkSession(client: OpencodeClient, sessionId: string, messageId?: string) {
  return (await client.session.fork({ sessionID: sessionId, messageID: messageId })).data;
}

export async function revertSession(client: OpencodeClient, sessionId: string, messageId: string, partId?: string) {
  return (await client.session.revert({ sessionID: sessionId, messageID: messageId, partID: partId })).data;
}

export async function unrevertSession(client: OpencodeClient, sessionId: string) {
  return (await client.session.unrevert({ sessionID: sessionId })).data;
}

export async function listCommands(client: OpencodeClient) {
  return requireData((await client.command.list()).data, 'command list request');
}

export async function executeCommand(
  client: OpencodeClient,
  sessionId: string,
  command: string,
  args: string,
  options?: { agent?: string; model?: string; messageId?: string },
) {
  return (await client.session.command({
    sessionID: sessionId,
    command,
    arguments: args,
    agent: options?.agent,
    model: options?.model,
    messageID: options?.messageId,
  })).data;
}
