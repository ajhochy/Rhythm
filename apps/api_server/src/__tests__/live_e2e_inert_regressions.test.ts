/**
 * Live contracts for the three 2026-07-11 adversarial-review regressions.
 *
 * These tests intentionally drive the running api_server + bundled fork and
 * are skipped by the normal suite. Run only against an isolated DB/HOME:
 *
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   RHYTHM_LIVE_DB_PATH=/tmp/rhythm-inert-e2e/rhythm.db \
 *   RHYTHM_LIVE_SERVER_LOG=/tmp/rhythm-inert-e2e/server.log \
 *   npx vitest run src/__tests__/live_e2e_inert_regressions.test.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const DB_PATH = process.env.RHYTHM_LIVE_DB_PATH;
const SERVER_LOG = process.env.RHYTHM_LIVE_SERVER_LOG;
const describeLive = LIVE ? describe : describe.skip;

const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];
const createdScheduleIds: string[] = [];
const seededGaps: Array<{ id: string; dedupKey: string }> = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 750,
  label = 'poll',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms; last=${String(lastError)}`);
}

interface SessionMessage {
  role: string;
  rawText: string;
  partsJson?: string | null;
  parts?: unknown[] | null;
}

function assistantEvidence(rows: SessionMessage[]): string {
  return rows
    .filter((row) => row.role === 'output')
    // #999 aligned GET /:id/messages to the structured `parts` array (the shape the
    // Flutter client reads); keep the legacy `partsJson` string as a fallback so
    // this evidence check works against either server shape.
    .map((row) => `${row.rawText}\n${row.partsJson ?? ''}\n${row.parts ? JSON.stringify(row.parts) : ''}`)
    .join('\n');
}

async function messages(sessionId: string): Promise<SessionMessage[]> {
  const result = await apiJson<{ messages: SessionMessage[] }>(
    `/agent-sessions/${sessionId}/messages?limit=500`,
  );
  return result.messages;
}

async function sendTurnAndWait(
  ws: WebSocket,
  sessionId: string,
  prompt: string,
  previousMessageCount: number,
): Promise<SessionMessage[]> {
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: prompt }));
  return poll(
    async () => {
      const [session, currentMessages] = await Promise.all([
        apiJson<{ session: { status: string } }>(`/agent-sessions/${sessionId}`),
        messages(sessionId),
      ]);
      if (currentMessages.length <= previousMessageCount) {
        throw new Error(`no new messages yet (${currentMessages.length})`);
      }
      if (session.session.status === 'starting' || session.session.status === 'working') {
        throw new Error(`session still ${session.session.status}`);
      }
      return currentMessages;
    },
    180_000,
    800,
    `await turn for ${sessionId}`,
  );
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function openIsolatedDb(): Database.Database {
  if (!DB_PATH) {
    throw new Error('UNVERIFIED: RHYTHM_LIVE_DB_PATH must name the isolated server DB copy');
  }
  return new Database(DB_PATH);
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdScheduleIds.splice(0)) {
    await api(`/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  if (seededGaps.length > 0 && DB_PATH) {
    const db = openIsolatedDb();
    try {
      for (const gap of seededGaps.splice(0)) {
        db.prepare(`DELETE FROM agent_org_proposals WHERE signal_ref = ?`).run(
          `gapId:${gap.dedupKey}`,
        );
        db.prepare(`DELETE FROM agent_capability_gaps WHERE id = ?`).run(gap.id);
      }
    } finally {
      db.close();
    }
  }
});

describeLive('live inert-regression contracts', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`isolated server is not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') throw new Error(`fork engine is not ready: ${engine.status}`);
    if (BASE.includes(':4001')) {
      throw new Error('refusing to run destructive live contracts against the shipping :4001 app');
    }
  });

  it(
    'issue-1014-c1: a roster PATCH changes the next task authorization in the same open session',
    async () => {
      // Regression caught: /config/reload invalidated only its request directory,
      // leaving the already-open session directory's Agent cache on the old roster.
      const suffix = randomUUID().slice(0, 8);
      const managerId = `live-manager-${suffix}`;
      const childId = `live-child-${suffix}`;

      for (const input of [
        {
          id: childId,
          label: `Live child ${suffix}`,
          isAgent: true,
          modelProvider: 'google',
          modelId: 'gemini-2.5-pro',
          systemPrompt: 'Return exactly CHILD_ALLOWED_OK and nothing else.',
        },
        {
          id: managerId,
          label: `Live manager ${suffix}`,
          isAgent: true,
          isManager: true,
          ocAgent: managerId,
          allowedDelegatesJson: '[]',
          modelProvider: 'google',
          modelId: 'gemini-2.5-pro',
          systemPrompt:
            'When the user names a subagent, call the task tool exactly once with that subagent_type. Never answer directly.',
        },
      ]) {
        const created = await apiJson<{ id: string }>('/agent-configs', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        createdAgentIds.push(created.id);
      }

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: managerId,
          name: `Live roster probe ${suffix}`,
          cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
        }),
      });
      createdSessionIds.push(session.id);
      const ws = await openWs();
      try {
        const deniedMessages = await sendTurnAndWait(
          ws,
          session.id,
          `Use task with subagent_type=${childId}. Ask it to return CHILD_ALLOWED_OK.`,
          0,
        );
        expect(await apiJson<unknown[]>(`/agent-sessions/${session.id}/children`)).toHaveLength(0);

        await apiJson(`/agent-configs/${managerId}`, {
          method: 'PATCH',
          body: JSON.stringify({ allowedDelegatesJson: JSON.stringify([childId]) }),
        });

        const allowedMessages = await sendTurnAndWait(
          ws,
          session.id,
          `The roster was updated. Now use task with subagent_type=${childId}. Ask it to return CHILD_ALLOWED_OK.`,
          deniedMessages.length,
        );
        const allowedEvidence = assistantEvidence(
          allowedMessages.slice(deniedMessages.length),
        );
        expect(allowedEvidence).toMatch(/"tool":"task"/);
        expect(allowedEvidence).toContain('CHILD_ALLOWED_OK');
        await poll(
          async () => {
            const children = await apiJson<unknown[]>(
              `/agent-sessions/${session.id}/children`,
            );
            if (children.length === 0) throw new Error('no child session yet');
            return children;
          },
          30_000,
          500,
          'await delegated child session',
        );
      } finally {
        ws.close();
      }
    },
    360_000,
  );

  it(
    'issue-1007-c1: trigger-now creates a scheduled session named from its distinctive prompt',
    async () => {
      // Regression caught: the scheduler passes "Scheduled: <task name>", which
      // the old placeholder predicate preserved instead of deriving a title.
      const marker = `north balcony acoustics ${randomUUID().slice(0, 8)}`;
      const prompt = `Draft the distinctive quarterly ${marker} maintenance checklist.`;
      const task = await apiJson<{ id: string }>('/agent-schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Scheduled run',
          scheduleType: 'once',
          runAt: new Date(Date.now() + 86_400_000).toISOString(),
          timezone: 'America/Los_Angeles',
          prompt,
          agentKind: 'claude-code',
          modelProvider: 'google',
          modelId: 'gemini-2.5-flash',
        }),
      });
      createdScheduleIds.push(task.id);

      await apiJson(`/agent-schedules/${task.id}/trigger-now`, { method: 'POST', body: '{}' });

      const session = await poll(
        async () => {
          const result = await apiJson<{ sessions: Array<{
            id: string;
            name: string;
            scheduledTaskId: string | null;
            status: string;
          }> }>(`/agent-sessions?scheduledTaskId=${encodeURIComponent(task.id)}`);
          const found = result.sessions.find((candidate) => candidate.scheduledTaskId === task.id);
          if (!found) throw new Error('scheduled session not created yet');
          return found;
        },
        120_000,
        1_000,
        'scheduled trigger-now session',
      );
      createdSessionIds.push(session.id);
      expect(session.name).not.toBe('Scheduled: Scheduled run');
      expect(session.name.toLowerCase()).toContain('north balcony acoustics');
    },
    150_000,
  );

  it(
    'issue-997-c1: a real conventional-commit candidate receives nonzero scores and reaches proposed',
    async () => {
      // Regression caught: an unparseable/null real judge response became 0/0,
      // and strict-greater silently discarded every provenance-clean candidate.
      if (!SERVER_LOG) {
        throw new Error('UNVERIFIED: RHYTHM_LIVE_SERVER_LOG is required to assert judge scores');
      }
      const db = openIsolatedDb();
      const gapId = `live-gap-${randomUUID()}`;
      const title = 'conventional commit';
      const tags: string[] = [];
      const dedupKey = createHash('sha256')
        .update(`${title}|${[...tags].sort().join(',')}`)
        .digest('hex');
      const now = new Date().toISOString();
      try {
        db.prepare(`DELETE FROM agent_capability_gaps WHERE dedup_key = ?`).run(dedupKey);
        db.prepare(
          `INSERT INTO agent_capability_gaps
             (id, dedup_key, intent_title, intent_problem, intent_tags_json,
              sample_session_id, agent_config_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, 'open', ?, ?)`,
        ).run(
          gapId,
          dedupKey,
          title,
          'Write consistent conventional commit messages with correct type, scope, and summary.',
          JSON.stringify(tags),
          now,
          now,
        );
        seededGaps.push({ id: gapId, dedupKey });
      } finally {
        db.close();
      }

      const run = await poll(
        async () => {
          const result = await apiJson<{ skipped: boolean; skippedReason?: string }>(
            '/agent-org-optimizer/run',
            { method: 'POST', body: JSON.stringify({ maxProposalsPerRun: 500 }) },
          );
          if (result.skipped) throw new Error(result.skippedReason ?? 'optimizer skipped');
          return result;
        },
        130_000,
        10_000,
        'optimizer cold-start window',
      );
      expect(run.skipped).toBe(false);

      const log = await readFile(SERVER_LOG, 'utf8');
      const judgeLines = log
        .split('\n')
        .filter((line) => line.includes(`judge gap=${dedupKey}:`));
      expect(judgeLines.length).toBeGreaterThan(0);
      expect(judgeLines.some((line) => !line.includes('candidate=0 vs would-be-draft=0'))).toBe(true);

      const proposal = await poll(
        async () => {
          const proposals = await apiJson<Array<{
            kind: string;
            status: string;
            signalRef: string | null;
            provenanceJson: string | null;
          }>>('/agent-org-proposals?status=proposed');
          const found = proposals.find(
            (candidate) =>
              candidate.kind === 'external-adoption' &&
              candidate.signalRef === `gapId:${dedupKey}`,
          );
          if (!found) throw new Error('external-adoption proposal not visible yet');
          return found;
        },
        120_000,
        2_000,
        'external-adoption proposal',
      );
      expect(proposal.status).toBe('proposed');
      expect(JSON.parse(proposal.provenanceJson ?? '{}')).toMatchObject({ source: 'skills.sh' });

    },
    300_000,
  );
});
