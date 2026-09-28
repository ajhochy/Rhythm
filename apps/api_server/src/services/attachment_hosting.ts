import { logger } from '../utils/logger';
import { MediaArtifactStore } from './media_artifact_store';

// Chat attachments live in the media artifact store, never inside parts_json. A part keeps a
// reference: { url: '/artifacts/<id>', artifactId, artifactProject, size }. Clients fetch the
// url relative to their API base, sending X-Rhythm-Project: artifactProject.

// Types the store may serve from the API origin. No SVG/HTML: they can carry script.
const HOSTABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
// Tiny inline payloads (icons, 1px images) are cheaper left in place.
const MIN_HOSTED_BASE64_CHARS = 8 * 1024;
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[^,;]*)*;base64,/i;

export interface AttachmentSession {
  id: string;
  projectId: string | null;
}

/** Artifact scope for a session. Project-less sessions get a private per-session scope. */
export function attachmentProject(session: AttachmentSession): string {
  return session.projectId ?? `session:${session.id}`;
}

function hostOne(
  attachment: Record<string, unknown>,
  session: AttachmentSession,
  store: MediaArtifactStore,
): Record<string, unknown> {
  const url = attachment.url;
  if (typeof url !== 'string' || url.length < MIN_HOSTED_BASE64_CHARS) return attachment;
  const match = DATA_URL.exec(url);
  const mime = match?.[1]?.toLowerCase();
  if (!match || !mime || !HOSTABLE_MIMES.has(mime)) return attachment;
  const bytes = Buffer.from(url.slice(match[0].length), 'base64');
  if (bytes.length === 0) return attachment;
  const project = attachmentProject(session);
  const artifact = store.registerAttachmentBytesSync({ bytes, mime, project, session: session.id });
  return {
    ...attachment,
    mime,
    url: `/artifacts/${artifact.id}`,
    artifactId: artifact.id,
    artifactProject: project,
    size: artifact.size,
  };
}

/**
 * Returns the part with every hostable data: attachment moved to the media store (the same
 * object when nothing changed). Covers user file parts and tool state.attachments. Failures
 * leave that attachment inline: losing the transcript image is worse than a large row.
 */
export function hostPartAttachments(
  part: Record<string, unknown>,
  session: AttachmentSession,
  store: MediaArtifactStore = new MediaArtifactStore(),
): Record<string, unknown> {
  const host = (attachment: Record<string, unknown>): Record<string, unknown> => {
    try {
      return hostOne(attachment, session, store);
    } catch (error) {
      logger.warn(`[attachment-hosting] kept attachment inline: ${String(error)}`);
      return attachment;
    }
  };
  if (part.type === 'file') return host(part);
  const state = part.state as Record<string, unknown> | undefined;
  const attachments = state?.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return part;
  let changed = false;
  const next = attachments.map((attachment: unknown) => {
    if (attachment === null || typeof attachment !== 'object') return attachment;
    const hosted = host(attachment as Record<string, unknown>);
    if (hosted !== attachment) changed = true;
    return hosted;
  });
  return changed ? { ...part, state: { ...state, attachments: next } } : part;
}
