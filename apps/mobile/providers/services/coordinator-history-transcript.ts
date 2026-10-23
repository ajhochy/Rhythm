import {
  toTranscriptEntry,
  type SessionMessageRecord,
  type TranscriptEntry,
} from '@/lib/opencode/format';
import type { Part } from '@/lib/opencode/types';

import type { MobileCoordinatorHistoryMessage } from './coordinator-conversations-service';

function createdAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Adapts an existing persisted agent_session_messages row through the same
 * formatter used by normal paired-session history.  The fallback text is the
 * row's already persisted stripped/raw text, never an acknowledgement or a
 * locally invented assistant reply.
 */
function toSessionRecord(row: MobileCoordinatorHistoryMessage): SessionMessageRecord {
  const id = row.sdkMessageId ?? `coordinator-row:${row.id}`;
  const role = row.role === 'input' ? 'user' : 'assistant';
  const parts = row.parts.filter((part): part is Record<string, unknown> => (
    Boolean(part) && typeof part === 'object' && !Array.isArray(part) && typeof (part as { type?: unknown }).type === 'string'
  )).map((part, index) => ({
    ...part,
    id: typeof part.id === 'string' && part.id ? part.id : `${id}-part-${index}`,
    sessionID: row.sessionId,
    messageID: id,
  })) as Part[];
  if (parts.length === 0 && (row.strippedText || row.rawText)) {
    parts.push({
      id: `${id}-persisted-text`,
      sessionID: row.sessionId,
      messageID: id,
      type: 'text',
      text: row.strippedText || row.rawText,
      synthetic: true,
    } as Part);
  }
  return {
    info: {
      id,
      sessionID: row.sessionId,
      role,
      time: { created: createdAt(row.createdAt) },
      // The normal formatter only needs the common message identity/role/time
      // shape. These fields remain presentation placeholders and are never
      // sent back to an SDK or coordinator route.
      ...(role === 'user'
        ? { agent: 'coordinator', model: { providerID: 'coordinator', modelID: 'canonical-history' } }
        : {
            parentID: '', modelID: 'canonical-history', providerID: 'coordinator', mode: 'coordinator', agent: 'coordinator',
            path: { cwd: '', root: '' }, cost: row.cost ?? 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
    } as SessionMessageRecord['info'],
    parts,
  };
}

/** Existing canonical rows, kept in their persisted order and identities. */
export function mapMobileCoordinatorHistory(rows: MobileCoordinatorHistoryMessage[]): TranscriptEntry[] {
  return rows.map((row) => {
    const entry = toTranscriptEntry(toSessionRecord(row));
    return {
      ...entry,
      role: row.role === 'system' ? 'system' : entry.role,
      origin: 'coordinator' as const,
    };
  }).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

