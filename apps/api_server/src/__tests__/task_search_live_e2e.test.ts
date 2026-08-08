/**
 * Live S5 contract: regressions in FTS triggers, ranked API retrieval, or the
 * actual stdio MCP registration surface fail observable task-search results.
 * Run only against tools/dev/sandbox.sh; this suite never targets the app ports.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_API_URL ?? process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const root = path.resolve(__dirname, '..', '..', '..', '..');
const mcpDir = path.join(root, 'apps', 'mcp_server');
const mcpEntrypoint = path.join(mcpDir, 'src', 'index.ts');
const tsxBin = path.join(mcpDir, 'node_modules', '.bin', 'tsx');
const fenceOpen = '<<<UNTRUSTED_EXTERNAL_CONTENT';
const fenceClose = '<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>';

type Task = {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  scheduledDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

type McpResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  private stderr = '';

  constructor(token: string) {
    this.child = spawn(tsxBin, [mcpEntrypoint], {
      cwd: mcpDir,
      env: {
        ...process.env,
        RHYTHM_API_URL: baseUrl,
        RHYTHM_AGENT_URL: baseUrl,
        RHYTHM_API_TOKEN: token,
      },
      stdio: 'pipe',
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (message.id === undefined) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => { this.stderr += chunk; });
    this.child.once('error', (cause) => {
      const error = new Error(`real MCP server failed to start: ${cause.message}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.child.once('exit', (code) => {
      const error = new Error(`real MCP server exited (${code}): ${this.stderr}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
    return result;
  }

  async connect(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'task-search-tier12-live', version: '1.0.0' },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }

  async callTaskList(arguments_: Record<string, unknown>): Promise<McpResult> {
    return this.request('tools/call', {
      name: 'rhythm_list_tasks',
      arguments: arguments_,
      _meta: {
        'com.vcrc.rhythm/security-context': {
          sdkSessionId: `task-search-live-${randomUUID()}`,
          turnId: `task-search-live-${randomUUID()}`,
          agentName: 'task-search-live',
          toolCallId: `task-search-live-${randomUUID()}`,
        },
      },
    }) as Promise<McpResult>;
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
  }
}

function assertSandbox(): void {
  const parsed = new URL(baseUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '4098') {
    throw new Error(`S5 requires RHYTHM_LIVE_API_URL=http://127.0.0.1:4098, got ${baseUrl || '(unset)'}`);
  }
  if (!dbPath || dbPath.includes('/Library/Application Support/Rhythm/') || !existsSync(dbPath)) {
    throw new Error('S5 requires RHYTHM_LIVE_DB_PATH for the sandbox copied SQLite database');
  }
}

function parseFencedResult(result: McpResult): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  const text = result.content[0]?.text ?? '';
  expect(text).toContain(fenceOpen);
  expect(text).toContain(fenceClose);
  const start = text.indexOf('\n', text.indexOf(fenceOpen)) + 1;
  return JSON.parse(text.slice(start, text.indexOf(fenceClose)).trim()) as Record<string, unknown>;
}

async function api<T>(route: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${route} -> ${response.status}: ${body}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

describeLive('S5 live task-search Tier 1+2', () => {
  const run = randomUUID().replaceAll('-', '');
  const token = `task-search-s5-${run}`;
  const termA = `s5alpha${run.slice(0, 12)}`;
  const termB = `s5beta${run.slice(12, 24)}`;
  const query = `${termA} ${termB}`;
  const longNotes = `${query} ${query} ${query} ${'n'.repeat(230)}`;
  let db: Database.Database;
  let userId: number;
  const taskIds: string[] = [];
  let client: StdioMcpClient;
  let strongest: Task;

  beforeAll(async () => {
    assertSandbox();
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true);
    const engine = await fetch(`${baseUrl}/opencode/health`);
    expect(engine.ok).toBe(true);
    expect((await engine.json() as { status?: string }).status).toBe('ready');

    // The auth route is OAuth-only; seed only a disposable sandbox session.
    // Task fixtures themselves are created, changed, and deleted through /tasks.
    db = new Database(dbPath);
    userId = Number(db.prepare('INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)').run(
      'Task search S5', `task-search-s5-${run}@example.test`, `task-search-s5-${run}`,
    ).lastInsertRowid);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
      token, userId, new Date(Date.now() + 600_000).toISOString(),
    );
    client = new StdioMcpClient(token);
    await client.connect();

    const fixtures = [
      { title: `${termA} title-only ${termB}`, notes: 'short fixture note' },
      { title: 'notes-only fixture', notes: longNotes },
      { title: `${query} ${query}`, notes: `${query} strongest fixture` },
      { title: `${termA} extra ${termB}`, notes: 'fourth matching fixture' },
    ];
    const created = await Promise.all(fixtures.map((fixture) => api<Task>('/tasks', token, {
      method: 'POST', body: JSON.stringify(fixture),
    })));
    taskIds.push(...created.map((task) => task.id));
    strongest = created[2]!;
  }, 30_000);

  afterAll(async () => {
    try {
      await Promise.all(taskIds.map(async (id) => {
        try { await api<void>(`/tasks/${id}`, token, { method: 'DELETE' }); } catch { /* cleanup best effort */ }
      }));
      if (userId) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
    } finally {
      db?.close();
      await client?.close();
    }
  });

  it('uses the real MCP stdio surface for ranked, bounded, fenced title-and-notes search', async () => {
    const output = parseFencedResult(await client.callTaskList({ search: query, limit: 2 }));
    const tasks = output.tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toBe(strongest.id);
    expect(tasks.every((task) => taskIds.includes(task.id as string))).toBe(true);
    expect(output).toMatchObject({ returned: 2, total: 4, more: 2, message: '+2 more; use narrower search/filters or a larger limit.' });
    expect(Object.keys(tasks[0]!)).toEqual(['id', 'title', 'status', 'notes', 'scheduledDate', 'dueDate', 'createdAt', 'updatedAt']);
    const notesTask = tasks.find((task) => task.id === taskIds[1]);
    expect(notesTask?.notes).toBe(`${longNotes.slice(0, 200)}… +${longNotes.length - 200} chars; fetch task by id for full notes.`);
  });

  it('uses the MCP default 50 cap with internally consistent count metadata', async () => {
    const output = parseFencedResult(await client.callTaskList({}));
    const tasks = output.tasks as unknown[];
    expect(tasks.length).toBeLessThanOrEqual(50);
    expect(output.returned).toBe(tasks.length);
    expect(output.total).toBeGreaterThanOrEqual(tasks.length);
    expect(output.more).toBe((output.total as number) - tasks.length);
  });

  it('makes real SQLite FTS triggers expose updates and remove deletes', async () => {
    const replacement = `s5replacement${run.slice(0, 12)}`;
    await api<Task>(`/tasks/${strongest.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ title: replacement, notes: `${replacement} updated notes` }),
    });
    const updated = parseFencedResult(await client.callTaskList({ search: replacement, limit: 2 }));
    expect((updated.tasks as Array<Record<string, unknown>>).map((task) => task.id)).toContain(strongest.id);
    const old = parseFencedResult(await client.callTaskList({ search: query, limit: 200 }));
    expect((old.tasks as Array<Record<string, unknown>>).map((task) => task.id)).not.toContain(strongest.id);

    await api<void>(`/tasks/${strongest.id}`, token, { method: 'DELETE' });
    taskIds.splice(taskIds.indexOf(strongest.id), 1);
    const deleted = parseFencedResult(await client.callTaskList({ search: replacement, limit: 2 }));
    expect((deleted.tasks as Array<Record<string, unknown>>).map((task) => task.id)).not.toContain(strongest.id);
  });
}, 60_000);
