import { useRef, useState, useSyncExternalStore } from 'react';
import type { RendererGateway } from './gateway';
import { useGateway } from './gateway/context';
import type { LivePermissionRequest as LivePermission, LiveQuestionRequest as LiveQuestion } from './types';

type Decisions = { permissions: ReadonlyMap<string, LivePermission>; questions: ReadonlyMap<string, LiveQuestion> };
type Kind = keyof Decisions;
const empty: Decisions = { permissions: new Map(), questions: new Map() };
let snapshot: ReadonlyMap<string, Decisions> = new Map();
const listeners = new Set<() => void>();
let revision = 0;
let epoch = 0;
const changes = new Map<string, number>();
const reads = new Map<string, number>();
const key = (sessionId: string, kind: Kind, id: string) => JSON.stringify([sessionId, kind, id]);
export const getSnapshot = () => snapshot;
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(sessionId: string, value: Decisions) {
  const next = new Map(snapshot);
  if (value.permissions.size || value.questions.size) next.set(sessionId, value); else next.delete(sessionId);
  snapshot = next;
  for (const listener of listeners) listener();
}
export function addPermission(sessionId: string, permission: LivePermission) {
  const current = snapshot.get(sessionId) ?? empty;
  changes.set(key(sessionId, 'permissions', permission.permissionID), ++revision);
  publish(sessionId, { ...current, permissions: new Map(current.permissions).set(permission.permissionID, permission) });
}
export function addQuestion(sessionId: string, question: LiveQuestion) {
  const current = snapshot.get(sessionId) ?? empty;
  changes.set(key(sessionId, 'questions', question.requestId), ++revision);
  publish(sessionId, { ...current, questions: new Map(current.questions).set(question.requestId, question) });
}
export function removeDecision(sessionId: string, kind: Kind, id: string) {
  changes.set(key(sessionId, kind, id), ++revision);
  const current = snapshot.get(sessionId) ?? empty;
  const next = new Map<string, LivePermission | LiveQuestion>(current[kind]);
  next.delete(id);
  publish(sessionId, { ...current, [kind]: next });
}
export function clearPendingDecisions() {
  epoch++; changes.clear(); reads.clear(); snapshot = new Map();
  for (const listener of listeners) listener();
}
export function replacePending(sessionId: string, incoming: Decisions, started: number) {
  const current = snapshot.get(sessionId) ?? empty;
  function reconcile<T>(kind: Kind, rows: ReadonlyMap<string, T>, previous: ReadonlyMap<string, T>) {
    const next = new Map(rows);
    // A reply/ask received after the read began outranks that older HTTP snapshot.
    for (const id of new Set([...rows.keys(), ...previous.keys()])) {
      if ((changes.get(key(sessionId, kind, id)) ?? 0) <= started) continue;
      if (previous.has(id)) next.set(id, previous.get(id)!); else next.delete(id);
    }
    return next;
  }
  publish(sessionId, { permissions: reconcile('permissions', incoming.permissions, current.permissions), questions: reconcile('questions', incoming.questions, current.questions) });
}

export async function rehydrateDecisions(gateway: RendererGateway, session: { id: string; sdkSessionId?: string; cwd: string }) {
  if (gateway.mode !== 'live' || !gateway.environment || !session.id) return;
  const started = revision; const owner = epoch;
  const read = (reads.get(session.id) ?? 0) + 1;
  reads.set(session.id, read);
  const permissions = gateway.domains.permissions!.pending(session.id);
  // The existing local API exposes question replies, but not a pending-question list.
  // Use the engine's directory-scoped GET /question; never send the cloud bearer here.
  const questions = session.sdkSessionId ? fetch(`http://127.0.0.1:${gateway.environment.enginePort}/question?directory=${encodeURIComponent(session.cwd)}`, { signal: AbortSignal.timeout(5000) }).then(async response => {
    if (!response.ok) throw new Error(`Pending questions unavailable (${response.status})`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid pending question list');
    return rows.filter(row => row?.sessionID === session.sdkSessionId).map((row): LiveQuestion => {
      if (typeof row.id !== 'string' || !row.id || typeof row.tool?.callID !== 'string' || !row.tool.callID || !Array.isArray(row.questions) || !row.questions.every((item: Record<string, unknown>) => item && typeof item.header === 'string' && typeof item.question === 'string' && (item.multiple === undefined || typeof item.multiple === 'boolean') && (item.custom === undefined || typeof item.custom === 'boolean') && Array.isArray(item.options) && item.options.every(option => option && typeof option.label === 'string' && (option.description === undefined || typeof option.description === 'string')))) throw new Error('Invalid pending question');
      return { requestId: row.id, callId: row.tool.callID, questions: row.questions.map((item: Record<string, unknown>) => ({ ...item, custom: item.custom !== false })) as LiveQuestion['questions'] };
    });
  }) : Promise.resolve([]);
  const [permissionRows, questionRows] = await Promise.all([permissions, questions]);
  if (owner !== epoch || reads.get(session.id) !== read) return;
  if (!Array.isArray(permissionRows) || !permissionRows.every(row => row && row.sessionId === session.id && typeof row.permissionID === 'string' && row.permissionID && typeof row.directory === 'string' && typeof row.tool === 'string' && typeof row.title === 'string' && typeof row.createdAt === 'string' && Array.isArray(row.patterns) && row.patterns.every(pattern => typeof pattern === 'string'))) throw new Error('Invalid pending permission list');
  replacePending(session.id, { permissions: new Map(permissionRows.map(row => [row.permissionID, row])), questions: new Map(questionRows.map(row => [row.requestId, row])) }, started);
}

export function usePendingDecisions(sessionId: string) {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).get(sessionId) ?? empty;
}
export function usePendingSessionIds() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
export function useDecisionReply(sessionId: string, kind: Kind, id: string) {
  const gateway = useGateway();
  const lock = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const send = async (operation: (permissions: NonNullable<RendererGateway['domains']['permissions']>) => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setSending(true); setError('');
    try { await operation(gateway.domains.permissions!); removeDecision(sessionId, kind, id); }
    catch (error) { setError(error instanceof Error ? error.message : 'Decision failed. Try again.'); }
    finally { lock.current = false; setSending(false); }
  };
  return { sending, error, send };
}
