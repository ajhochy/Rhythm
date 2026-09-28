// Ported semantics from sst/opencode v1.14.49 (MIT):
// packages/app/src/context/global-sync/event-reducer.ts and
// packages/opencode/src/cli/cmd/run/session-data.ts. See tests/fixtures/transcript/VENDORED-MIT-LICENSE.txt.
// No Solid state, engine SSE, or timer enters this pure renderer boundary.
import { mapPart, mapMessage, type RichTranscriptBlock, type RichTranscriptMessage, type SessionWireEvent } from './sessions';

type Origin = 'ws' | 'rest';
type PartState = { origin: Origin; terminal: boolean; generation: number; active: boolean };
type Pending = { messageId: string; partId: string; text: string; since: number; generation: number };
export type TranscriptState = {
  messages: RichTranscriptMessage[];
  pending: Record<string, Pending>;
  parts: Record<string, PartState>;
  tombstones: { messages: Record<string, number>; parts: Record<string, number> };
  aliases: Record<string, string>;
  generation: number;
  contentRevision: number;
  reconciliationNeeded: boolean;
  cursor?: string | null;
  hasMore?: boolean;
};
export type TranscriptPageOptions = { mode: 'merge' | 'replace'; hasMore: boolean; nextCursor?: string | null; older?: boolean; now?: number };
export const emptyTranscript = (): TranscriptState => ({ messages: [], pending: {}, parts: {}, tombstones: { messages: {}, parts: {} }, aliases: {}, generation: 0, contentRevision: 0, reconciliationNeeded: false });
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const id = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const key = (messageId: string, partId: string) => `${messageId}\u0000${partId}`;
const terminal = (part: Record<string, unknown>) => typeof object(part.time).end === 'number' || part.type !== 'text' && part.type !== 'reasoning' && (part.type !== 'tool' || ['completed', 'error'].includes(String(object(part.state).status)));
const placeholder = (messageId: string): RichTranscriptMessage => ({ id: messageId, role: 'assistant', createdAt: '', blocks: [] });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
// ponytail: v1.14.49 IDs sort chronologically; use time.created+id if fork adopts upstream #41001.
const order = (a: RichTranscriptMessage, b: RichTranscriptMessage) => {
  const rank = (value: string) => value.startsWith('local-user-') ? 2 : value.startsWith('msg_') ? 1 : 0;
  // ponytail: numeric REST rows have no engine ID; use createdAt. Ceiling: cross-host clock skew.
  if ((rank(a.id) === 0 || rank(b.id) === 0) && rank(a.id) < 2 && rank(b.id) < 2 && a.createdAt && b.createdAt && a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return rank(a.id) - rank(b.id) || (rank(a.id) === 1 ? a.id.localeCompare(b.id) : 0);
};
const insert = (messages: RichTranscriptMessage[], message: RichTranscriptMessage) => {
  const index = messages.findIndex(item => item.id === message.id);
  if (index >= 0) { const next = messages.slice(); next[index] = message; return next; }
  return [...messages, message].sort(order);
};
const putBlock = (message: RichTranscriptMessage, block: RichTranscriptBlock): RichTranscriptMessage => {
  const index = message.blocks.findIndex(item => item.id === block.id);
  const blocks = message.blocks.slice();
  if (index < 0) blocks.push(block);
  else blocks[index] = block;
  // Canonical prt_* IDs are ordered by the engine; legacy page blocks retain insertion order.
  blocks.sort((a, b) => a.id.startsWith('prt_') && b.id.startsWith('prt_') ? a.id.localeCompare(b.id) : 0);
  return { ...message, blocks };
};
const changed = (state: TranscriptState, update: Partial<TranscriptState>, content = false): TranscriptState => ({ ...state, ...update, contentRevision: (state.contentRevision ?? 0) + (content ? 1 : 0) });
const meta = (state: TranscriptState, messageId: string, partId: string) => state.parts?.[key(messageId, partId)];
const isRemoved = (state: TranscriptState, messageId: string, partId?: string) => state.tombstones?.messages[messageId] === state.generation || (partId !== undefined && state.tombstones?.parts[key(messageId, partId)] === state.generation);

function aliasUser(state: TranscriptState, message: RichTranscriptMessage, messages: RichTranscriptMessage[]): { message: RichTranscriptMessage; messages: RichTranscriptMessage[]; aliases: Record<string, string> } {
  if (message.role !== 'user' || message.uiKey || state.aliases?.[message.id] || message.id.startsWith('local-user-')) return { message, messages, aliases: state.aliases ?? {} };
  const candidates = messages.filter(row => row.id.startsWith('local-user-') && !Object.values(state.aliases ?? {}).includes(row.id));
  const first = message.blocks.find(block => block.kind === 'markdown')?.content;
  const signature = (attachments: RichTranscriptMessage['attachments']) => (attachments ?? []).map(a => ({ type: a.type, filename: a.filename, mime: a.mime }));
  const attachments = message.attachments?.length ? message.attachments : message.blocks.filter(b => b.kind === 'file').map(b => ({ type: 'file' as const, filename: b.title ?? '', mime: b.meta ?? '', size: 0, id: b.id, path: '' }));
  // No text-only guessing for attachments; match uniquely by the full ordered attachment signature.
  const sameText = (row: RichTranscriptMessage) => { const text = row.blocks.find(block => block.kind === 'markdown')?.content; return text === first || first === undefined && text === 'Attached file context.'; };
  const wanted = signature(attachments);
  const matches = candidates.filter(row => sameText(row) && same(signature(row.attachments), wanted));
  // Incremental file parts: an earlier same-text send with a longer matching prefix may still be arriving.
  if (matches.length && candidates.slice(0, candidates.indexOf(matches[0])).some(row => sameText(row) && signature(row.attachments).length > wanted.length && same(signature(row.attachments).slice(0, wanted.length), wanted))) return { message, messages, aliases: state.aliases ?? {} };
  if (!matches.length || first === undefined && !(attachments?.length)) return { message, messages, aliases: state.aliases ?? {} };
  const selected = matches[0]; // ordered sends: each confirmation consumes exactly one pending alias
  return { message: { ...message, uiKey: selected.uiKey ?? selected.id }, messages: messages.filter(row => row !== selected), aliases: { ...state.aliases, [message.id]: selected.id } };
}

export function applyTranscriptEvent(state: TranscriptState, event: SessionWireEvent): TranscriptState {
  const generation = state.generation ?? 0;
  if (event.type === 'session.status') {
    const next = typeof (event as SessionWireEvent & { generation?: number }).generation === 'number' ? (event as SessionWireEvent & { generation: number }).generation : generation;
    if (next !== generation) return changed(state, { generation: next, pending: {}, parts: {}, tombstones: { messages: {}, parts: {} }, reconciliationNeeded: true });
    return event.working === false ? settleTranscript(state) : state;
  }
  if (event.type === 'message.removed' || event.type === 'message.part.removed') {
    const messageId = id(event.messageId ?? object(event.info).id ?? object(event.part).messageID);
    const partId = id(event.partId ?? object(event.part).id);
    if (!messageId || event.type === 'message.part.removed' && !partId) return state;
    const partKey = key(messageId, partId);
    const messages = event.type === 'message.removed' ? state.messages.filter(m => m.id !== messageId)
      : state.messages.map(m => m.id === messageId ? { ...m, blocks: m.blocks.filter(b => b.id !== partId) } : m);
    return changed(state, {
      messages,
      tombstones: event.type === 'message.removed' ? { ...state.tombstones, messages: { ...state.tombstones.messages, [messageId]: generation } }
        : { ...state.tombstones, parts: { ...state.tombstones.parts, [partKey]: generation } },
      pending: Object.fromEntries(Object.entries(state.pending ?? {}).filter(([k]) => k !== partKey && (event.type !== 'message.removed' || !k.startsWith(`${messageId}\u0000`)))),
    }, true);
  }
  if (event.type === 'message.updated') {
    const raw = object(event.info); const messageId = id(raw.id);
    if (!messageId || isRemoved(state, messageId)) return state;
    const existing = state.messages.find(m => m.id === messageId);
    const mapped = mapMessage({ info: raw });
    let message: RichTranscriptMessage = { ...existing, ...mapped, blocks: existing?.blocks ?? [],
      role: typeof raw.role === 'string' ? mapped.role : existing?.role ?? mapped.role,
      createdAt: mapped.createdAt || existing?.createdAt || '',
      interrupted: mapped.interrupted || existing?.interrupted,
      cost: mapped.cost ?? existing?.cost, tokens: mapped.tokens ?? existing?.tokens };
    if (existing && same(existing, message)) return state;
    const alias = aliasUser(state, message, state.messages);
    message = alias.message;
    return changed(state, { messages: insert(alias.messages, message), aliases: alias.aliases }, !existing || alias.messages !== state.messages);
  }
  if (event.type === 'message.part.delta') {
    const messageId = id(event.messageId), partId = id(event.partId);
    if (!messageId || !partId || event.field !== 'text' || typeof event.delta !== 'string' || isRemoved(state, messageId, partId)) return state;
    const existing = state.messages.find(m => m.id === messageId);
    const current = existing?.blocks.find(b => b.id === partId);
    const provenance = meta(state, messageId, partId);
    if (provenance?.terminal || current?.terminal) return state;
    if (current && (current.kind === 'markdown' || current.kind === 'reasoning')) {
      const message = putBlock(existing!, { ...current, content: current.content + event.delta, streaming: true });
      return changed(state, { messages: insert(state.messages, message), parts: { ...state.parts, [key(messageId, partId)]: { origin: 'ws', terminal: false, generation, active: true } } }, true);
    }
    const now = typeof (event as SessionWireEvent & { receivedAt?: number }).receivedAt === 'number' ? (event as SessionWireEvent & { receivedAt: number }).receivedAt : 0;
    const expired = now ? Object.values(state.pending ?? {}).some(item => item.since && now - item.since > 60000) : false;
    const pending = expired ? Object.fromEntries(Object.entries(state.pending ?? {}).filter(([, item]) => !item.since || now - item.since <= 60000)) : state.pending ?? {};
    const partKey = key(messageId, partId), prior = pending[partKey];
    const bytes = Object.values(pending).reduce((count, item) => count + new TextEncoder().encode(item.text).length, 0);
    if (!prior && Object.keys(pending).length >= 128 || bytes + new TextEncoder().encode(event.delta).length > 1024 * 1024) {
      return changed(state, { pending, reconciliationNeeded: true });
    }
    return changed(state, { pending: { ...pending, [partKey]: { messageId, partId, text: (prior?.text ?? '') + event.delta, since: prior?.since ?? now, generation } }, reconciliationNeeded: state.reconciliationNeeded || expired });
  }
  if (event.type === 'message.part.updated') {
    const raw = object(event.part); const messageId = id(raw.messageID) || id(event.messageId), partId = id(raw.id) || id(event.partId);
    if (!messageId || !partId || isRemoved(state, messageId, partId)) return state;
    return upsertPart(state, messageId, partId, mapPart(raw, partId), 'ws', terminal(raw));
  }
  return state;
}

function upsertPart(state: TranscriptState, messageId: string, partId: string, incoming: RichTranscriptBlock, origin: Origin, final: boolean): TranscriptState {
  const existing = state.messages.find(m => m.id === messageId) ?? placeholder(messageId);
  const old = existing.blocks.find(b => b.id === partId);
  const partKey = key(messageId, partId), provenance = meta(state, messageId, partId);
  const pending = state.pending?.[partKey];
  if (origin === 'rest' && provenance?.origin === 'ws' && provenance.generation === state.generation && (provenance.terminal || provenance.active && !final)) return state;
  if (origin === 'rest' && (provenance?.terminal || old?.terminal) && !final) return state;
  if (origin === 'ws' && (provenance?.terminal || old?.terminal) && !final) return state;
  let reconciliationNeeded = state.reconciliationNeeded ?? false;
  let content = incoming.content;
  if (!final && old && (incoming.kind === 'reasoning' || incoming.kind === 'markdown') && old.kind === incoming.kind && old.content.startsWith(content)) content = old.content;
  if (pending?.text && !final && (incoming.kind === 'reasoning' || incoming.kind === 'markdown')) {
    if (!content) content = pending.text;
    else reconciliationNeeded = true; // nonempty snapshot may overlap repeated deltas: do not guess
  }
  const block = { ...incoming, content, terminal: final, streaming: origin === 'ws' && !messageId.startsWith('local-user-') && !final && (incoming.kind === 'reasoning' || incoming.kind === 'markdown') };
  const nextPending = pending ? Object.fromEntries(Object.entries(state.pending).filter(([k]) => k !== partKey)) : state.pending;
  const part = { origin, terminal: final, generation: state.generation ?? 0, active: origin === 'ws' && !final } as PartState;
  if (old && same(old, block) && same(provenance, part) && !pending) return state;
  const updated = putBlock(existing, block);
  const alias = aliasUser(state, updated, state.messages);
  return changed(state, { messages: insert(alias.messages, alias.message), aliases: alias.aliases, pending: nextPending, parts: { ...state.parts, [partKey]: part }, reconciliationNeeded }, !old || !same(old, block));
}

export function mergeTranscriptPage(state: TranscriptState, page: RichTranscriptMessage[], opts: TranscriptPageOptions): TranscriptState {
  if (opts.mode === 'replace') state = { ...emptyTranscript(), generation: (state.generation ?? 0) + 1, contentRevision: (state.contentRevision ?? 0) + 1, cursor: opts.nextCursor ?? null, hasMore: opts.hasMore };
  let next = state;
  for (const row of page) {
    if (!row.id || isRemoved(next, row.id)) continue;
    const existing = next.messages.find(m => m.id === row.id);
    const alias = aliasUser(next, row, next.messages);
    const info: RichTranscriptMessage = { ...existing, ...alias.message, blocks: existing?.blocks ?? [], createdAt: existing?.createdAt || row.createdAt, interrupted: row.interrupted || existing?.interrupted };
    if (!existing || !same(existing, info) || alias.messages !== next.messages) {
      const aliasChanged = alias.messages !== next.messages || !same(alias.aliases, next.aliases);
      next = changed(next, { messages: insert(alias.messages, info), aliases: alias.aliases }, !existing || aliasChanged);
    }
    for (const part of row.blocks) {
      if (isRemoved(next, row.id, part.id)) continue;
      next = upsertPart(next, row.id, part.id, part, 'rest', part.terminal ?? !['markdown', 'reasoning', 'tool', 'children'].includes(part.kind));
    }
  }
  const cursor = opts.older ? opts.nextCursor ?? null : next.cursor === undefined ? opts.nextCursor ?? null : next.cursor;
  const hasMore = opts.older || next.hasMore === undefined ? opts.hasMore : next.hasMore;
  if (cursor !== next.cursor || hasMore !== next.hasMore) next = changed(next, { cursor, hasMore });
  return next;
}

export function settleTranscript(state: TranscriptState): TranscriptState {
  const messages = state.messages.filter(m => !m.id.startsWith('local-user-') || !m.blocks.length || m.blocks.every(b => !b.streaming)).map(m => {
    const blocks = m.blocks.map(b => b.streaming ? { ...b, streaming: false } : b);
    return blocks.some((b, i) => b !== m.blocks[i]) ? { ...m, blocks } : m;
  });
  if (!Object.keys(state.pending ?? {}).length && messages.length === state.messages.length && messages.every((m, i) => m === state.messages[i])) return state;
  return changed(state, { messages, pending: {} }, messages.some((m, i) => m !== state.messages[i]));
}
