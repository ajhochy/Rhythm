import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

const PROFILE_TYPES = {
  'AI-Trend-Researcher': 'ai-trends',
  'Theological-Researcher': 'theological',
} as const;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

function urls(parts: unknown[]): string[] {
  return [...new Set(strings(parts).flatMap((s) => s.match(/https?:\/\/[^\s)'"\]]+/g) ?? []))];
}

function vaultPath(parts: unknown[]): string | null {
  return strings(parts).find((s) => /(?:^|\/)(?:Areas|Research|Reports)\/.*\.md$/i.test(s)) ?? null;
}

/** Index only completed specialist runs; safe to replay after idle/error events. */
export async function indexResearchSession(sessionId: string): Promise<void> {
  const session = new AgentSessionsRepository().findById(sessionId);
  const researchType = PROFILE_TYPES[session?.agentKind as keyof typeof PROFILE_TYPES];
  if (!session || !researchType) return;

  const messages = new AgentSessionMessagesRepository().listBySessionStructured(sessionId);
  const outputs = messages.filter((message) => message.role === 'output');
  const final = [...outputs].reverse().map((message) => message.rawText.trim()).find(Boolean) ?? '';
  if (!final && session.status !== 'error') return;
  const parts = outputs.flatMap((message) => message.parts ?? []);
  const title = session.name.trim() || final.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 160) || 'Research report';
  const now = new Date().toISOString();
  const db = getDb();
  const status = session.status === 'error' ? 'error' : 'done';
  const values = [sessionId, session.agentKind, researchType, title, JSON.stringify(urls(parts)), final, vaultPath(parts), now, session.statusMessage];
  db.prepare(`
    INSERT INTO agent_research_jobs
      (id, query, status, sources_json, report, error, agent_session_id, research_type, title, agent_profile_id, origin, vault_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'specialist-run', ?, ?, ?)
    ON CONFLICT(agent_session_id) WHERE agent_session_id IS NOT NULL DO UPDATE SET
      query=excluded.query, status=excluded.status, sources_json=excluded.sources_json, report=excluded.report, error=excluded.error,
      research_type=excluded.research_type, title=excluded.title, agent_profile_id=excluded.agent_profile_id,
      origin=excluded.origin, vault_path=excluded.vault_path, updated_at=excluded.updated_at
  `).run(randomUUID(), title, status, values[4], values[5] || null, status === 'error' ? values[8] : null, values[0], values[2], values[3], values[1], values[6], now, now);
}
