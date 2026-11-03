import { logger } from '../utils/logger';
import { MediaArtifactStore } from './media_artifact_store';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Chat attachments live in the media artifact store, never inside parts_json. A part keeps a
// reference: { url: '/artifacts/<id>', artifactId, artifactProject, size }. Clients fetch the
// url relative to their API base, sending X-Rhythm-Project: artifactProject.

// Types the store may serve from the API origin. No SVG/HTML: they can carry script.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HOSTABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', XLSX_MIME]);
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
  if (typeof url !== 'string') return attachment;
  const match = DATA_URL.exec(url);
  const mime = match?.[1]?.toLowerCase();
  if (!match || !mime || !HOSTABLE_MIMES.has(mime)) return attachment;
  if (mime !== XLSX_MIME && url.length < MIN_HOSTED_BASE64_CHARS) return attachment;
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

export const ATTACHMENT_UNAVAILABLE = 'Attachment unavailable for this session. Select an accessible attachment or remove the reference.';
export const ATTACHMENT_UNSUPPORTED_REFERENCE = 'Unsupported attachment reference. Send selected file bytes, not a remote URL or client-local path.';

/** Trusted API boundary: display identity becomes owned bytes, never a credentialed remote fetch. */
export async function normalizePartAttachments(
  parts: Array<Record<string, unknown>>,
  session: AttachmentSession & { sdkSessionId?: string | null; ownerUserId?: number | null },
  actorUserId?: number,
): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (part.type !== 'file') { result.push(part); continue; }
    const url = part.url;
    if (typeof url !== 'string') throw new Error(ATTACHMENT_UNSUPPORTED_REFERENCE);
    if (url.startsWith('data:')) {
      const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(url);
      if (!match || match[2].length % 4 !== 0 || match[1].toLowerCase() !== String(part.mime).toLowerCase()) throw new Error('Invalid attachment bytes. Send a valid base64 file with its actual MIME type.');
      result.push(part); continue;
    }
    // Preserve the existing trusted native desktop file-reference surface, not file:name fabrication.
    if (url.startsWith('file:///')) { result.push(part); continue; }
    const match = /^\/artifacts\/([a-f0-9-]{36})$/i.exec(url);
    if (!match) throw new Error(url.startsWith('/artifacts/') ? ATTACHMENT_UNAVAILABLE : ATTACHMENT_UNSUPPORTED_REFERENCE);
    if (part.artifactId !== undefined && part.artifactId !== match[1]) throw new Error(ATTACHMENT_UNAVAILABLE);
    if (actorUserId !== undefined && session.ownerUserId !== actorUserId) throw new Error(ATTACHMENT_UNAVAILABLE);
    const project = attachmentProject(session);
    if (part.artifactProject !== undefined && part.artifactProject !== project) throw new Error(ATTACHMENT_UNAVAILABLE);
    const store = new MediaArtifactStore();
    const artifact = await store.findProjectArtifact(match[1], project);
    if (!artifact || (artifact.session !== session.id && artifact.session !== session.sdkSessionId) || artifact.size > 15 * 1024 * 1024) throw new Error(ATTACHMENT_UNAVAILABLE);
    let bytes: Buffer;
    try {
      const path = store.resolveStoragePath(artifact.storageKey);
      const stat = statSync(path);
      if (!stat.isFile() || stat.size !== artifact.size) throw new Error(ATTACHMENT_UNAVAILABLE);
      bytes = readFileSync(path);
    }
    catch { throw new Error(ATTACHMENT_UNAVAILABLE); }
    if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.checksum) throw new Error(ATTACHMENT_UNAVAILABLE);
    const { artifactId: _id, artifactProject: _project, ...native } = part;
    result.push({ ...native, mime: artifact.mime, url: `data:${artifact.mime};base64,${bytes.toString('base64')}` });
  }
  return result;
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
