import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentSession } from '../models/agent_session';
import {
  listMobileChatChildren,
  listProjectScopedMobileChats,
  type MobileChatCatalogPage,
} from './mobile_chat_catalog';
import type { MobileProjectScope } from './mobile_project_scope';

/**
 * Mirror-served mobile reads (#1379).
 *
 * The phone used to live-proxy every read to the OpenCode engine on :4096, so
 * opening a session blocked on engine liveness — a cold Tailscale connection or
 * a Mac mid-turn produced the observed ~40s three-attempt first open. The
 * desktop never had that problem because it reads api_server's SQLite mirror,
 * which the consolidated `/global/event` ingest keeps current.
 *
 * These readers flip the phone onto the same mirror, served behind the
 * *existing engine-shaped operationIds* so the pinned `contractFingerprint`
 * (which covers only the engine's OpenAPI) does not move and no paired phone
 * has to re-pair.
 *
 * Every reader returns `null` when the mirror cannot answer authoritatively.
 * The caller then falls through to the live engine, whose existing
 * write-through (`reconcileCatalogSession`) populates the mirror for next time.
 * Nothing here ever serves a partial or reconstructed answer.
 */

/** Engine `session.messages` page size the mobile gateway pins. */
export const MOBILE_MIRROR_TRANSCRIPT_PAGE_SIZE = 20;

export interface MirrorSessionListResult {
  items: Array<Record<string, unknown>>;
  nextCursor: number | null;
}

/**
 * Resolve the addressed session from the mirror, but only when the mirror's own
 * ownership columns settle the question.
 *
 * A NULL `project_id` is treated as unresolved rather than as a match: the
 * engine's `directory` check is the only thing that can place such a row, so
 * those sessions keep going live.
 */
export function resolveMirrorSession(
  sdkSessionId: string,
  userId: number,
  project: MobileProjectScope,
  sessions = new AgentSessionsRepository(),
): AgentSession | null {
  const local = sessions.findBySdkSessionId(sdkSessionId);
  if (!local) return null;
  if (local.ownerUserId !== userId) return null;
  if (!local.projectId || local.projectId !== project.id) return null;
  return local;
}

/**
 * A project-scoped chat list from the mirror.
 *
 * Returns `null` when the mirror holds no chat rows at all for this
 * (owner, project) — indistinguishable from "the ingest has not seen this
 * project yet" — or when an exact-session lookup misses. Both cases must reach
 * the engine so a session created out-of-band still appears, and so the
 * phone's exact-session pinning never false-negatives.
 */
export async function readMirrorSessionList(input: {
  userId: number;
  project: MobileProjectScope;
  archived: boolean;
  cursor: number;
  limit: number;
  sessionId?: string;
}): Promise<MirrorSessionListResult | null> {
  const page: MobileChatCatalogPage = await listProjectScopedMobileChats({
    archived: input.archived,
    cursor: input.cursor,
    limit: input.limit,
    ownerUserId: input.userId,
    projectId: input.project.id,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  if (page.items.length > 0) return page;

  // Empty page. Distinguish "genuinely nothing on this page" from "the mirror
  // does not know this project" — only the former may be served.
  if (input.sessionId) return null;
  const anyRow = await listProjectScopedMobileChats({
    archived: input.archived,
    cursor: 0,
    limit: 1,
    ownerUserId: input.userId,
    projectId: input.project.id,
  });
  if (anyRow.items.length === 0) return null;
  // The mirror knows this project and this page is past the end.
  return page;
}

/**
 * Children of one session from the mirror's `parent_session_id` edge.
 *
 * Returns `null` when the parent itself is not a mirror row this caller owns.
 * When the parent *is* mirrored, an empty child list is authoritative: the same
 * always-on ingest that recorded the parent records every `session.created`
 * child edge, so "no children" is an answer, not a cache miss.
 */
export async function readMirrorSessionChildren(input: {
  sdkSessionId: string;
  userId: number;
  project: MobileProjectScope;
}): Promise<Array<Record<string, unknown>> | null> {
  const local = resolveMirrorSession(
    input.sdkSessionId,
    input.userId,
    input.project,
  );
  if (!local) return null;
  return listMobileChatChildren({
    ownerUserId: input.userId,
    parentSdkSessionId: input.sdkSessionId,
    projectId: input.project.id,
  });
}

/**
 * One engine-shaped transcript page from the mirror, or `null` when the mirror
 * cannot reproduce the engine shape faithfully.
 *
 * Faithful means every row in the window carries the engine's verbatim
 * `message.info` (`info_json`). Rows persisted before that column existed, and
 * child sessions whose message parts the bridge does not yet mirror, both fail
 * this check and fall through live — so a partly-mirrored transcript is never
 * served as if it were whole.
 */
export function readMirrorTranscript(input: {
  sdkSessionId: string;
  userId: number;
  project: MobileProjectScope;
  before?: string;
  limit?: number;
}): unknown[] | null {
  const local = resolveMirrorSession(
    input.sdkSessionId,
    input.userId,
    input.project,
  );
  if (!local) return null;
  const page = new AgentSessionMessagesRepository().listEngineShapedPage(
    local.id,
    input.limit ?? MOBILE_MIRROR_TRANSCRIPT_PAGE_SIZE,
    input.before,
  );
  if (!page.complete) return null;
  return page.messages;
}
