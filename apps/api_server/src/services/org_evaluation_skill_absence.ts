/** Negative skill effects require a persisted engine denial and the exact copied source state. */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

type Effect = { kind: string; source: 'worker-db' | 'engine-tool' | 'loopback-receiver';
  subject: string; evidenceHash: string };
type ToolPart = { type?: unknown; tool?: unknown; callID?: unknown;
  state?: { status?: unknown; input?: { name?: unknown }; error?: unknown } };
type PublicationObservation = { method: string; path: string; status: number;
  client?: 'worker-verifier' | 'engine' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The engine's SkillTool throws this exact not-found clause. A model-written
 * answer or a generic tool error does not prove a removed skill is unavailable. */
export function skillNotFoundEvent(parts: readonly unknown[], name: string): Effect | null {
  if (!name || !Array.isArray(parts)) return null;
  const attempts = parts.filter((part): part is ToolPart => !!part && typeof part === 'object'
    && (part as ToolPart).type === 'tool' && (part as ToolPart).tool === 'skill'
    && (part as ToolPart).state?.input?.name === name);
  if (attempts.some((part) => part.state?.status === 'completed')) return null;
  const denied = attempts.find((part) => part.state?.status === 'error'
    && typeof part.callID === 'string' && part.callID.length > 0
    && typeof part.state?.error === 'string'
    && (part.state.error === `Skill "${name}" not found. Available skills: none`
      || part.state.error.startsWith(`Tool execution failed: Skill "${name}" not found. Available skills: `)
      || part.state.error.startsWith(`Skill "${name}" not found. Available skills: `)));
  if (!denied) return null;
  return { kind: 'skill-unavailable', source: 'engine-tool', subject: name,
    evidenceHash: hash({ name, callId: denied.callID, error: denied.state!.error }) };
}

/** A consolidation must retire the exact second row and remove its managed
 * bytes in the copied worker before an engine not-found attempt can count. */
export function retiredSkillUnavailableEvent(input: {
  db: Database.Database; targetRef: string; changeJson: string | null;
  historyParts: readonly unknown[]; readManagedBytes: (name: string) => Buffer | null;
}): Effect | null {
  let change: Record<string, unknown>;
  try { change = JSON.parse(input.changeJson ?? '') as Record<string, unknown>; }
  catch { return null; }
  if (typeof change.survivorSkillId !== 'string' || typeof change.retiredSkillId !== 'string'
    || !change.retiredSkillId || change.survivorSkillId === change.retiredSkillId
    || input.targetRef !== `skill:${change.survivorSkillId}`) return null;
  const row = input.db.prepare('SELECT id, title, status FROM agent_skills WHERE id = ?')
    .get(change.retiredSkillId) as { id: string; title: string; status: string } | undefined;
  if (!row || row.status !== 'retired' || input.readManagedBytes(row.title) !== null) return null;
  const denied = skillNotFoundEvent(input.historyParts, row.title);
  return denied ? { kind: 'retired-skill-unavailable', source: 'engine-tool', subject: row.title,
    evidenceHash: hash({ retiredId: row.id, retiredStatus: row.status, engineDenial: denied.evidenceHash }) } : null;
}

/** The private receiver must observe the real DELETE and both the worker's
 * 404 readback and the engine's catalog lookup after the remote state clears. */
export function unpublishedOrgSkillEvent(input: {
  name: string; action: 'publish' | 'unpublish' | 'none';
  publishedBody: string | null; requests: readonly PublicationObservation[];
}): Effect | null {
  if (input.action !== 'unpublish' || input.publishedBody !== null) return null;
  const target = `/org-skills/${encodeURIComponent(input.name)}`;
  const deletedIndex = input.requests.findIndex((item) => item.method === 'DELETE' && item.path === target && item.status === 204);
  if (deletedIndex < 0) return null;
  const readbackIndex = input.requests.findIndex((item, index) => index > deletedIndex
    && item.method === 'GET' && item.path === `${target}/SKILL.md`
    && item.status === 404 && item.client === 'worker-verifier');
  const engineIndexPosition = input.requests.findIndex((item, index) => index > deletedIndex
    && item.method === 'GET' && item.path === '/org-skills/index.json'
    && item.status === 200 && item.client === 'engine');
  if (readbackIndex < 0 || engineIndexPosition < 0) return null;
  const deleted = input.requests[deletedIndex];
  const readback = input.requests[readbackIndex];
  const engineIndex = input.requests[engineIndexPosition];
  return { kind: 'org-skill-unavailable', source: 'loopback-receiver', subject: input.name,
    evidenceHash: hash({ name: input.name, deleted, readback, engineIndex, published: false }) };
}
