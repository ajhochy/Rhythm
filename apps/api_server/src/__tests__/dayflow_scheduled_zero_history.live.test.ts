/**
 * Disposable sandbox acceptance for scheduled turns under the real API, fork
 * engine, and configured provider. It never targets the installed app.
 *
 * Run only after tools/dev/sandbox.sh up with a copied fixture DB:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 *   DB_PATH="$RHYTHM_LIVE_DB_PATH" RHYTHM_LIVE_DB_PATH="$RHYTHM_LIVE_DB_PATH" \
 *   npm exec -- vitest run src/__tests__/dayflow_scheduled_zero_history.live.test.ts --no-file-parallelism
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const engineBase = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH ?? '';
// The stock sandbox seeds this enabled, schedulable OpenAI profile. The task
// deliberately has no model override so scheduling exercises the profile's
// currently configured provider/model, rather than a Coordinator test override.
const scheduledProfileId = process.env.RHYTHM_LIVE_SCHEDULE_AGENT_CONFIG_ID || 'org-reviewer';
const schedules: string[] = [];
const sessions: string[] = [];
const retainArtifacts = process.env.RHYTHM_LIVE_RETAIN_ARTIFACTS === '1';

function assertSandbox(url: string): void {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.port === '4000' || parsed.port === '4001') {
    throw new Error(`RHYTHM_LIVE_URL must be an isolated loopback API, got ${url}`);
  }
  if (!dbPath || dbPath.includes('/Library/Application Support/Rhythm/')) {
    throw new Error('RHYTHM_LIVE_DB_PATH must name the copied sandbox database');
  }
}

function assertSandboxEngine(url: string): void {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || ['4000', '4001', '4096', '4098'].includes(parsed.port)) {
    throw new Error(`RHYTHM_LIVE_ENGINE_URL must be an isolated loopback engine, got ${url}`);
  }
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is { type?: unknown; text?: unknown } =>
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function partsFromJson(value: unknown): unknown {
  if (typeof value !== 'string') return [];
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function bounded(value: unknown, limit = 500): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\/Users\/[^\s"']+/g, '[local-path]')
    .slice(0, limit);
}

async function engineDiagnostic(sdkSessionId: string, directory: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${engineBase}/session/${encodeURIComponent(sdkSessionId)}/message?${new URLSearchParams({ directory })}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (!response.ok) return { readError: `engine returned ${response.status}: ${bounded(body, 200)}` };
    const parsed = JSON.parse(body) as unknown;
    const messages = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { data?: unknown })?.data)
        ? (parsed as { data: unknown[] }).data
        : [];
    const withRole = messages.map((message) => {
      const item = message as { info?: { role?: unknown }; role?: unknown; parts?: unknown };
      return { role: item.info?.role ?? item.role, text: textFromParts(item.parts) };
    });
    const user = withRole.filter((message) => message.role === 'user').pop();
    const assistant = withRole.filter((message) => message.role === 'assistant').pop();
    return {
      userPrompt: bounded(user?.text),
      finalAssistant: bounded(assistant?.text),
      messageCount: messages.length,
    };
  } catch (error) {
    return { readError: error instanceof Error ? error.message : String(error) };
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) as T : undefined as T;
}

async function poll<T>(read: () => Promise<T | undefined>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value: T | undefined;
  while (Date.now() < deadline) {
    value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

afterEach(async () => {
  // Only the explicitly retained disposable sandbox is eligible for inspection.
  if (retainArtifacts) return;
  for (const id of schedules.splice(0)) await fetch(`${base}/agent-schedules/${id}`, { method: 'DELETE' }).catch(() => undefined);
  for (const id of sessions.splice(0)) await fetch(`${base}/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
});

describeLive('live Dayflow scheduled zero-history admission', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    assertSandbox(base);
    assertSandboxEngine(engineBase);
    expect(await api<{ status: string }>('/opencode/health')).toMatchObject({ status: 'ready' });
  });

  it('runs an owner/project-unbound schedule through the real engine and bound profile model', async () => {
    const marker = `DAYFLOW_SCHEDULED_OK_${randomUUID().slice(0, 8)}`;
    const schedule = await api<{ id: string; createdByUserId: number | null }>('/agent-schedules', {
      method: 'POST',
      // No auth header deliberately produces the observed ownerless scheduler shape.
      body: JSON.stringify({
        name: `Dayflow scheduled zero-history ${marker}`,
        scheduleType: 'daily',
        scheduledTime: '23:59',
        prompt: `Reply with exactly ${marker} and nothing else.`,
        agentConfigId: scheduledProfileId,
      }),
    });
    schedules.push(schedule.id);
    expect(schedule.createdByUserId).toBeNull();

    await api(`/agent-schedules/${schedule.id}/trigger-now`, { method: 'POST', body: '{}' });
    const terminal = await poll(async () => {
      const task = await api<{ lastRunStatus: string | null; lastError: string | null }>(`/agent-schedules/${schedule.id}`);
      return ['success', 'completed_no_op', 'error', 'blocked_on_approval'].includes(task.lastRunStatus ?? '')
        ? task
        : undefined;
    }, 180_000, 'scheduled run');
    const listed = await api<{ sessions: Array<{ id: string; scheduledTaskId: string | null }> }>(
      `/agent-sessions?scheduledTaskId=${encodeURIComponent(schedule.id)}`,
    );
    const session = listed.sessions.find((item) => item.scheduledTaskId === schedule.id);
    expect(session).toBeDefined();
    sessions.push(session!.id);

    let mirrorDb: Record<string, unknown>[] = [];
    let runner: {
      sdkSessionId: string; directory: string; lastPreview: string | null;
      providerId: string | null; modelId: string | null;
    } | undefined;
    let configuredModel: { providerId: string; modelId: string } | undefined;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare(`SELECT owner_user_id, project_id, scheduled_task_id, is_system, category,
        sdk_session_id, cwd, last_preview, provider_id, model_id,
        dayflow_context_nonreuse_code, dayflow_context_nonreuse_at
        FROM agent_sessions WHERE id=?`).get(session!.id) as Record<string, unknown> | undefined;
      expect(row).toMatchObject({
        owner_user_id: null, project_id: null, scheduled_task_id: schedule.id,
        is_system: 1, category: 'scheduled', dayflow_context_nonreuse_code: null, dayflow_context_nonreuse_at: null,
      });
      expect(typeof row?.sdk_session_id).toBe('string');
      expect(typeof row?.cwd).toBe('string');
      const profile = db.prepare(`SELECT model_provider, model_id FROM agent_configs WHERE id=?`).get(scheduledProfileId) as
        { model_provider: string | null; model_id: string | null } | undefined;
      expect(profile).toBeDefined();
      expect(typeof profile?.model_provider).toBe('string');
      expect(typeof profile?.model_id).toBe('string');
      configuredModel = { providerId: profile!.model_provider!, modelId: profile!.model_id! };
      runner = {
        sdkSessionId: row!.sdk_session_id as string,
        directory: row!.cwd as string,
        lastPreview: typeof row?.last_preview === 'string' ? row.last_preview : null,
        providerId: typeof row?.provider_id === 'string' ? row.provider_id : null,
        modelId: typeof row?.model_id === 'string' ? row.model_id : null,
      };
      mirrorDb = db.prepare(`SELECT role, raw_text, stripped_text, parts_json
        FROM agent_session_messages WHERE session_id=? ORDER BY id ASC`).all(session!.id) as Record<string, unknown>[];
    } finally {
      db.close();
    }

    const transcript = await api<{ messages: Array<{ role: string; rawText?: string | null; strippedText?: string | null; parts?: unknown }> }>(
      `/agent-sessions/${session!.id}/messages?limit=100`,
    );
    const hasMirroredMarker = transcript.messages.some((message) => message.role === 'output' &&
      (message.rawText ?? message.strippedText ?? '').includes(marker));
    if (terminal.lastRunStatus !== 'completed_no_op' || !hasMirroredMarker) {
      // This intentionally exposes only the disposable marker prompt and final
      // answer, plus bounded local mirror state, before the sandbox is cleaned.
      console.error('[dayflow-scheduled-zero-history diagnostic]', JSON.stringify({
        terminalStatus: terminal.lastRunStatus,
        terminalError: bounded(terminal.lastError),
        configuredModel,
        runner: {
          lastPreview: bounded(runner?.lastPreview),
          providerId: runner?.providerId,
          modelId: runner?.modelId,
          mirrorRows: mirrorDb.slice(-6).map((row) => ({
            role: row.role,
            rawText: bounded(row.raw_text),
            strippedText: bounded(row.stripped_text),
            partsText: bounded(textFromParts(partsFromJson(row.parts_json))),
          })),
        },
        apiMirror: transcript.messages.slice(-6).map((message) => ({
          role: message.role,
          rawText: bounded(message.rawText),
          strippedText: bounded(message.strippedText),
          partsText: bounded(textFromParts(message.parts)),
        })),
        engine: runner ? await engineDiagnostic(runner.sdkSessionId, runner.directory) : { readError: 'missing session engine identity' },
      }));
    }
    // A marker-only prompt is a completed model turn, but deliberately makes no
    // mutation, so the scheduler's terminal contract is completed_no_op.
    expect(terminal.lastRunStatus, `scheduled model run failed: ${terminal.lastError}`).toBe('completed_no_op');
    expect(runner).toMatchObject(configuredModel);
    expect(hasMirroredMarker).toBe(true);
  }, 210_000);
});
