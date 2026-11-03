/**
 * Byte bounds for mirror-served transcript pages.
 *
 * The engine applies the same ceiling in
 * `apps/opencode_fork/packages/opencode/src/session/message-bounds.ts`. This
 * is the mirror's copy of that rule, because a mirror-served page skips the
 * engine entirely and would otherwise reach `mirrorResponse` unbounded —
 * which rejects it outright with UPSTREAM_RESPONSE_TOO_LARGE, producing the
 * same undeliverable seed the engine bound exists to prevent.
 *
 * Keep the two in step. Measured 2026-10-06 on a real 20-message page:
 * `state.attachments[].url` held 15,575,354 of 15,714,325 bytes (99.1%) as
 * inline base64 data URIs, while `state.output` was 10 KB across the whole
 * page.
 */

/** Largest body kept inline for one field of one part. Mirrors the engine. */
export const PART_BODY_LIMIT_BYTES = 32 * 1024;

/** Whole-page budget, well under the gateway's 8 MB response ceiling. */
export const PAGE_BUDGET_BYTES = 4 * 1024 * 1024;

/** Body kept for parts trimmed once the page budget is already spent. */
export const EXHAUSTED_BODY_LIMIT_BYTES = 1024;

interface TruncatedBodyMark {
  field: string;
  originalLength: number;
  keptLength: number;
}

type AnyRecord = Record<string, any>;

const utf8Length = (value: string) => Buffer.byteLength(value, 'utf8');

/** Cut on a UTF-8 boundary so a trimmed body is still valid text. */
function clampText(value: string, limit: number): string {
  if (utf8Length(value) <= limit) return value;
  const text = Buffer.from(value, 'utf8').subarray(0, limit).toString('utf8');
  return text.endsWith('�') ? text.slice(0, -1) : text;
}

function withMarks(part: AnyRecord, marks: TruncatedBodyMark[]): AnyRecord {
  const existing = Array.isArray(part.metadata?.truncated)
    ? part.metadata.truncated
    : [];
  return {
    ...part,
    metadata: { ...(part.metadata ?? {}), truncated: [...existing, ...marks] },
  };
}

/** Bytes a part currently contributes through its oversized-capable fields. */
function bodyBytes(part: AnyRecord): number {
  let total = 0;
  if (typeof part.text === 'string') total += utf8Length(part.text);
  const state = part.state;
  if (state && typeof state === 'object') {
    for (const field of ['output', 'error']) {
      if (typeof state[field] === 'string') total += utf8Length(state[field]);
    }
    if (Array.isArray(state.attachments)) {
      for (const attachment of state.attachments) {
        if (attachment && typeof attachment.url === 'string') {
          total += utf8Length(attachment.url);
        }
      }
    }
  }
  return total;
}

function boundPart(part: AnyRecord, limit: number): AnyRecord {
  const marks: TruncatedBodyMark[] = [];
  let next: AnyRecord = { ...part };
  let changed = false;

  if (typeof part.text === 'string' && utf8Length(part.text) > limit) {
    const kept = clampText(part.text, limit);
    next.text = kept;
    marks.push({
      field: 'text',
      originalLength: utf8Length(part.text),
      keptLength: utf8Length(kept),
    });
    changed = true;
  }

  const state = part.state;
  if (state && typeof state === 'object') {
    const nextState: AnyRecord = { ...state };
    let stateChanged = false;
    for (const field of ['output', 'error']) {
      const value = state[field];
      if (typeof value === 'string' && utf8Length(value) > limit) {
        const kept = clampText(value, limit);
        nextState[field] = kept;
        marks.push({
          field,
          originalLength: utf8Length(value),
          keptLength: utf8Length(kept),
        });
        stateChanged = true;
      }
    }
    if (Array.isArray(state.attachments)) {
      let attachmentsChanged = false;
      const attachments = state.attachments.map((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object') return candidate;
        const attachment = candidate as AnyRecord;
        const url = attachment.url;
        if (typeof url !== 'string' || utf8Length(url) <= limit) return candidate;
        attachmentsChanged = true;
        // A truncated base64 data URI is a corrupt image, not a smaller one.
        marks.push({
          field: `attachments.${attachment.id ?? '?'}.url`,
          originalLength: utf8Length(url),
          keptLength: 0,
        });
        return { ...attachment, url: '' };
      });
      if (attachmentsChanged) {
        nextState.attachments = attachments;
        stateChanged = true;
      }
    }
    if (stateChanged) {
      next.state = nextState;
      changed = true;
    }
  }

  if (!changed) return part;
  next = withMarks(next, marks);
  return next;
}

/**
 * Bound a mirror-served transcript page by bytes. Messages and parts are never
 * dropped and part identity is preserved, so delta application still attaches
 * parts to their parent message.
 */
export function boundMirrorTranscript(messages: unknown[]): unknown[] {
  let spent = 0;
  let pageChanged = false;

  // Newest messages render first, so spend the budget from the tail backwards.
  const bounded = new Array<unknown>(messages.length);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AnyRecord;
    const parts = message?.parts;
    if (!message || !Array.isArray(parts)) {
      bounded[index] = message;
      continue;
    }
    let changed = false;
    const nextParts = parts.map((candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return candidate;
      const limit =
        spent >= PAGE_BUDGET_BYTES
          ? EXHAUSTED_BODY_LIMIT_BYTES
          : PART_BODY_LIMIT_BYTES;
      const part = boundPart(candidate as AnyRecord, limit);
      if (part !== candidate) changed = true;
      spent += bodyBytes(part);
      return part;
    });
    if (changed) {
      pageChanged = true;
      bounded[index] = { ...message, parts: nextParts };
    } else {
      bounded[index] = message;
    }
  }

  return pageChanged ? bounded : messages;
}
