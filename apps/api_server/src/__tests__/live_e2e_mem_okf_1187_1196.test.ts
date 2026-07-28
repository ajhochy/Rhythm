/**
 * Combined live behavioral gate for MEM-OKF #1187–#1196.
 *
 * This suite drives the running isolated api_server over HTTP + WebSocket,
 * invokes the real built Rhythm MCP server over stdio JSON-RPC, and observes
 * the copied SQLite index plus sandbox Memory-Vault files. It deliberately
 * requires a second opt-in flag because it mutates the sandbox vault directly
 * for tolerant-YAML, ranking, reserved-file, rotation, and failure fixtures.
 *
 * Required launch posture (see docs/ai/runs/2026-07-26-mem-okf.md):
 *   RHYTHM_LIVE_E2E=1 RHYTHM_MEM_OKF_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=/tmp/<sandbox>/rhythm.db \
 *   RHYTHM_SANDBOX_DIR=/tmp/<sandbox> \
 *   npx vitest run src/__tests__/live_e2e_mem_okf_1187_1196.test.ts
 *
 * No provider, OAuth, PCO, email, or other external credentials are needed.
 * WS provenance is persisted before the engine attempts model execution.
 *
 * Mechanical consolidation has no public HTTP/MCP trigger. Its source-union,
 * collision-rewrite, retirement/backlink rewrite, audit, and byte-for-byte
 * revert contracts therefore remain covered by the real-FS/SQLite integration
 * suites. This live gate covers the public merge-on-capture collision path.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE =
  process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_MEM_OKF_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SANDBOX_ROOT = path.resolve(
  process.env.RHYTHM_SANDBOX_DIR ??
    path.dirname(process.env.DB_PATH ?? path.join(tmpdir(), 'rhythm-dev-sandbox', 'rhythm.db')),
);
const VAULT_ROOT = path.resolve(
  process.env.RHYTHM_LIVE_VAULT_PATH ?? path.join(SANDBOX_ROOT, 'vault'),
);
const MEMORY_DIR = path.join(VAULT_ROOT, 'memory');
const SERVER_LOG = path.join(SANDBOX_ROOT, 'api_server.log');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MCP_DIR = path.join(REPO_ROOT, 'apps', 'mcp_server');
const MCP_ENTRY = path.join(MCP_DIR, 'dist', 'index.js');
const RUN_TOKEN = randomUUID().replaceAll('-', '');

interface MemoryResult {
  id: string;
  path: string;
  kind: string;
}

interface MemoryRow {
  id: string;
  content: string;
  sourceId: string | null;
  status: string;
  staleAfter: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  trustTier: string;
  verifiedJson: string;
  sourcesJson: string;
}

interface AgentSession {
  id: string;
  sdkSessionId: string | null;
}

interface Provenance {
  recorded: boolean;
  memoryIds: string[];
  notePaths: Array<string | null>;
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface ParsedVaultNote {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

const memoryIds = new Set<string>();
const sessionIds = new Set<string>();
const directFixturePaths = new Set<string>();
let agentConfigId: string | null = null;
let mcp: StdioMcpClient | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

async function apiResponse(
  route: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function apiJson<T>(
  route: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiResponse(route, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${route} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) as T : undefined as T;
}

async function searchMemories(query: string, limit = 100): Promise<MemoryRow[]> {
  return apiJson<MemoryRow[]>(
    `/agent-memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

async function createMemory(
  content: string,
  extra: Record<string, unknown> = {},
): Promise<MemoryResult> {
  const result = await apiJson<MemoryResult>('/agent-memory', {
    method: 'POST',
    body: JSON.stringify({ kind: 'fact', content, ...extra }),
  });
  memoryIds.add(result.id);
  return result;
}

function absoluteNotePath(sourceId: string): string {
  const resolved = path.resolve(VAULT_ROOT, sourceId);
  if (
    resolved !== VAULT_ROOT &&
    !resolved.startsWith(`${VAULT_ROOT}${path.sep}`)
  ) {
    throw new Error(`note path escaped sandbox vault: ${sourceId}`);
  }
  return resolved;
}

async function readNote(sourceId: string): Promise<ParsedVaultNote> {
  const raw = await fs.readFile(absoluteNotePath(sourceId), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw, raw };
  const loaded = yaml.load(match[1]);
  return {
    frontmatter:
      loaded && typeof loaded === 'object' && !Array.isArray(loaded)
        ? loaded as Record<string, unknown>
        : {},
    body: match[2],
    raw,
  };
}

async function waitForFileContains(
  filename: string,
  needle: string,
  label: string,
): Promise<string> {
  return poll(async () => {
    const raw = await fs.readFile(filename, 'utf8');
    if (!raw.includes(needle)) throw new Error(`${needle} not present`);
    return raw;
  }, label);
}

async function waitForStableFile(filename: string): Promise<string> {
  return poll(async () => {
    const before = await fs.stat(filename);
    const raw = await fs.readFile(filename, 'utf8');
    await sleep(150);
    const after = await fs.stat(filename);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error('file is still changing');
    }
    return raw;
  }, `stable file ${filename}`);
}

async function createAgentSession(name: string): Promise<AgentSession> {
  if (!agentConfigId) throw new Error('live agent profile was not initialized');
  const created = await apiJson<AgentSession>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: agentConfigId,
      name,
      cwd: REPO_ROOT,
    }),
  });
  sessionIds.add(created.id);
  return poll(async () => {
    const { session: current } = await apiJson<{ session: AgentSession }>(
      `/agent-sessions/${created.id}`,
    );
    if (!current.sdkSessionId) throw new Error('SDK mapping not persisted yet');
    return current;
  }, `SDK session mapping for ${created.id}`);
}

async function promptAndReadProvenance(
  prompt: string,
  label: string,
): Promise<Provenance> {
  const session = await createAgentSession(`MEM-OKF ${label} ${RUN_TOKEN.slice(0, 8)}`);
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/agents`);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({
      v: 1,
      type: 'session.input',
      id: session.id,
      data: prompt,
    }));
    return await poll(async () => {
      const provenance = await apiJson<Provenance>(
        `/agent-sessions/${session.id}/memory-provenance`,
      );
      if (!provenance.recorded) throw new Error('provenance not recorded');
      return provenance;
    }, `WS memory provenance: ${label}`);
  } finally {
    ws.close();
  }
}

async function writeFixtureNote(
  memoryRelativePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<string> {
  const filename = path.resolve(MEMORY_DIR, memoryRelativePath);
  if (!filename.startsWith(`${MEMORY_DIR}${path.sep}`)) {
    throw new Error(`fixture path escaped memory dir: ${memoryRelativePath}`);
  }
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const rendered = `---\n${yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd()}\n---\n${body.trimEnd()}\n`;
  await fs.writeFile(filename, rendered, 'utf8');
  directFixturePaths.add(filename);
  return path.relative(VAULT_ROOT, filename);
}

async function syncVault(): Promise<void> {
  await apiJson('/agent-memory/sync', {
    method: 'POST',
    body: '{}',
  });
}

function toolText(result: McpToolResult): string {
  const text = result.content
    ?.filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n') ?? '';
  if (result.isError) throw new Error(`MCP tool failed: ${text}`);
  return text;
}

class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private stdoutBuffer = '';
  private stderr = '';

  constructor() {
    this.child = spawn(process.execPath, [MCP_ENTRY], {
      cwd: MCP_DIR,
      env: {
        ...process.env,
        RHYTHM_API_URL: BASE,
        RHYTHM_AGENT_URL: BASE,
        RHYTHM_API_TOKEN: 'isolated-live-e2e-token',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.once('exit', (code, signal) => {
      const error = new Error(
        `MCP process exited (${signal ?? code}); stderr=${this.stderr}`,
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'MCP request failed'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(
          `MCP ${method} timed out; stderr=${this.stderr}`,
        ));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    })}\n`);
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return this.request<McpToolResult>('tools/call', {
      name,
      arguments: args,
    });
  }

  async start(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'rhythm-mem-okf-live-e2e',
        version: '1.0.0',
      },
    });
    this.notify('notifications/initialized');
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    await Promise.race([
      new Promise<void>((resolve) => this.child.once('exit', () => resolve())),
      sleep(1_000).then(() => {
        this.child.kill('SIGTERM');
      }),
    ]);
  }
}

describeLive.sequential('live E2E — MEM-OKF #1187–#1196', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(BASE);
    expect(url.origin).toBe('http://127.0.0.1:4098');
    expect(url.pathname).toBe('/');

    const dbPath = path.resolve(process.env.DB_PATH ?? '');
    expect(dbPath).toBe(path.join(SANDBOX_ROOT, 'rhythm.db'));
    expect(VAULT_ROOT.startsWith(`${SANDBOX_ROOT}${path.sep}`)).toBe(true);
    await expect(fs.access(dbPath)).resolves.toBeUndefined();
    await expect(fs.access(VAULT_ROOT)).resolves.toBeUndefined();
    await expect(fs.access(MCP_ENTRY)).resolves.toBeUndefined();

    expect((await fetch(`${BASE}/health`)).ok).toBe(true);
    expect((await apiJson<{ status: string }>('/opencode/health')).status)
      .toBe('ready');

    const config = await apiJson<{ id: string }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        label: `MEM-OKF live ${RUN_TOKEN.slice(0, 8)}`,
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
        modelProvider: 'openrouter',
        systemPrompt: 'Live memory behavior probe. Reply briefly.',
      }),
    });
    agentConfigId = config.id;

    mcp = new StdioMcpClient();
    await mcp.start();
  }, 30_000);

  afterAll(async () => {
    await mcp?.close().catch(() => undefined);
    for (const sessionId of sessionIds) {
      await fetch(`${BASE}/agent-sessions/${sessionId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
      await fetch(`${BASE}/agent-sessions/${sessionId}/hard`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
    for (const memoryId of memoryIds) {
      await fetch(`${BASE}/agent-memory/${memoryId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
    if (agentConfigId) {
      await fetch(`${BASE}/agent-configs/${agentConfigId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
    for (const fixture of directFixturePaths) {
      await fs.rm(fixture, { force: true }).catch(() => undefined);
    }
    await fetch(`${BASE}/agent-memory/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  }, 30_000);

  it('preserves unknown YAML through public update and fails unauthenticated human verification closed', async () => {
    const marker = `yamlprojection${RUN_TOKEN.slice(0, 10)}`;
    const memory = await createMemory(
      `Stable public YAML title.\n${marker} projection body.`,
      {
        sources: [{
          id: 'yaml-source',
          resource: `rhythm://live-e2e/${RUN_TOKEN}`,
        }],
      },
    );
    const filename = absoluteNotePath(memory.path);
    const original = await fs.readFile(filename, 'utf8');
    const withUnknown = original.replace(
      '\n---\n',
      [
        '',
        'future_okf:',
        '  nested:',
        '    enabled: true',
        '    labels: [alpha, beta]',
        'verified:',
        '  - by: agent:projection-fixture/1',
        '    at: 2026-07-26T10:00:00Z',
        '---',
        '',
      ].join('\n'),
    );
    await fs.writeFile(filename, withUnknown, 'utf8');
    await syncVault();

    const projected = (await searchMemories(marker))
      .find((row) => row.sourceId === memory.path);
    expect(projected).toMatchObject({
      status: 'stable',
      trustTier: 'machine',
      generatedBy: 'agent:rhythm/1',
    });
    expect(JSON.parse(projected?.sourcesJson ?? '[]')).toContainEqual({
      id: 'yaml-source',
      resource: `rhythm://live-e2e/${RUN_TOKEN}`,
    });

    await apiJson(`/agent-memory/${memory.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: `Stable public YAML title.\n${marker} updated projection body.`,
        tags: ['live-e2e', 'unknown-yaml'],
      }),
    });
    const updated = await readNote(memory.path);
    expect(updated.frontmatter.future_okf).toEqual({
      nested: {
        enabled: true,
        labels: ['alpha', 'beta'],
      },
    });

    const beforeUnauthorized = updated.raw;
    const unauthorized = await apiResponse(
      `/agent-memory/${memory.id}/verify`,
      {
        method: 'POST',
        body: JSON.stringify({
          by: 'human:forged@example.test',
          staleAfter: '2026-12-31',
        }),
      },
    );
    expect(unauthorized.status).toBe(401);
    expect((await readNote(memory.path)).raw).toBe(beforeUnauthorized);
  });

  it('uses the real built MCP stdio server for tool count and fail-closed memory lifecycle', async () => {
    if (!mcp) throw new Error('MCP client unavailable');
    const listed = await mcp.request<{
      tools: Array<{ name: string }>;
    }>('tools/list');
    expect(listed.tools).toHaveLength(83);
    expect(listed.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'rhythm_remember_memory',
        'rhythm_search_memory',
        'rhythm_verify_memory',
      ]),
    );

    const marker = `mcpmachine${RUN_TOKEN.slice(0, 10)}`;
    const remembered = await createMemory(
      `MCP machine lifecycle ${marker}.[^mcp-source]`,
      {
        sources: [{
          id: 'mcp-source',
          resource: `rhythm://live-e2e/${marker}`,
        }],
      },
    );
    const before = (await searchMemories(marker))
      .find((row) => row.sourceId === remembered.path);
    expect(before).toMatchObject({
      status: 'stable',
      trustTier: 'unverified',
    });

    const blocked = await mcp.callTool(
      'rhythm_verify_memory',
      {
        id: remembered.id,
        action: 'verify',
        by: 'human:forged@example.test',
        staleAfter: '2026-12-31',
      },
    );
    expect(blocked.isError).toBe(true);
    expect(
      blocked.content?.some(({ text }) =>
        text?.includes('trusted Rhythm session/turn metadata is unavailable'),
      ),
    ).toBe(true);

    const unchanged = (await searchMemories(marker))
      .find((row) => row.sourceId === remembered.path);
    expect(unchanged).toMatchObject({
      status: 'stable',
      trustTier: before?.trustTier,
    });
    expect(unchanged?.verifiedJson).toBe(before?.verifiedJson);
  });

  it('stamps ambient session sources, rewrites source collisions, generates navigation, and keeps link expansion off by default', async () => {
    const ambientSession = await createAgentSession(
      `MEM-OKF ambient ${RUN_TOKEN.slice(0, 8)}`,
    );
    const ambient = await createMemory(
      `Ambient provenance ${RUN_TOKEN.slice(0, 12)}.`,
      {
        sdkSessionId: ambientSession.sdkSessionId,
        sessionId: `historical-${RUN_TOKEN.slice(0, 8)}`,
        contextSessionId: 'forged-local-session',
      },
    );
    const ambientNote = await readNote(ambient.path);
    const ambientSources = ambientNote.frontmatter.sources as Array<{
      id: string;
      resource: string;
    }>;
    expect(ambientSources).toEqual([
      {
        id: `sess-${ambientSession.id}`,
        resource: `rhythm://agent-session/${ambientSession.id}`,
      },
      {
        id: `sess-historical-${RUN_TOKEN.slice(0, 8)}`,
        resource: `rhythm://agent-session/historical-${RUN_TOKEN.slice(0, 8)}`,
      },
    ]);
    expect(JSON.stringify(ambientSources)).not.toContain('forged-local-session');

    const collisionMarker = `collision${RUN_TOKEN.slice(0, 10)}`;
    const collisionA = await createMemory(
      `Facilities ${collisionMarker} reservation calendar lives in the north hall.[^X]`,
      {
        sources: [{
          id: 'X',
          resource: `https://a.invalid/${RUN_TOKEN}`,
        }],
      },
    );
    const collisionB = await createMemory(
      `The facilities ${collisionMarker} reservation calendar uses the north hall for room booking.[^X]`,
      {
        sources: [{
          id: 'X',
          resource: `https://b.invalid/${RUN_TOKEN}`,
        }],
      },
    );
    expect(collisionB.path).toBe(collisionA.path);
    const merged = await readNote(collisionA.path);
    const mergedSources = merged.frontmatter.sources as Array<{
      id: string;
      resource: string;
    }>;
    expect(mergedSources.map(({ resource }) => resource).sort()).toEqual([
      `https://a.invalid/${RUN_TOKEN}`,
      `https://b.invalid/${RUN_TOKEN}`,
    ]);
    expect(new Set(mergedSources.map(({ id }) => id)).size).toBe(2);
    for (const source of mergedSources) {
      expect(merged.body).toContain(`[^${source.id}]`);
    }

    const targetMarker = `linktarget${RUN_TOKEN.slice(0, 10)}`;
    const target = await createMemory(
      `Unrelated destination ${targetMarker}.`,
      { kind: 'person' },
    );
    const decoyMarker = `linkdecoy${RUN_TOKEN.slice(0, 10)}`;
    const decoy = await createMemory(
      `Code-only destination ${decoyMarker}.`,
      { kind: 'person' },
    );
    const sourceMarker = `linksource${RUN_TOKEN.slice(0, 10)}`;
    const decoyTarget = `/person/${path.basename(decoy.path)}`;
    const escapedLink = `\\[escaped lookalike](${decoyTarget})`;
    const inlineCodeLink = `\`[inline lookalike](${decoyTarget})\``;
    const fencedCodeLink = [
      '```markdown',
      `[fenced lookalike](${decoyTarget})`,
      '```',
    ].join('\n');
    const source = await createMemory(
      [
        `Direct retrieval ${sourceMarker}.`,
        escapedLink,
        inlineCodeLink,
        fencedCodeLink,
      ].join('\n\n'),
      {
        kind: 'project',
        links: [{
          target: `/person/${path.basename(target.path)}`,
          label: 'Related person',
        }],
      },
    );
    const sourceBeforeTargetDelete = await readNote(source.path);
    expect(sourceBeforeTargetDelete.body).toContain(
      `[Related person](/person/${path.basename(target.path)})`,
    );
    expect(sourceBeforeTargetDelete.body).toContain(escapedLink);
    expect(sourceBeforeTargetDelete.body).toContain(inlineCodeLink);
    expect(sourceBeforeTargetDelete.body).toContain(fencedCodeLink);
    await apiJson(`/agent-memory/${source.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: ['link-code-preservation'] }),
    });
    const sourceAfterUpdate = await readNote(source.path);
    expect(sourceAfterUpdate.body).toContain(escapedLink);
    expect(sourceAfterUpdate.body).toContain(inlineCodeLink);
    expect(sourceAfterUpdate.body).toContain(fencedCodeLink);

    const personIndex = path.join(MEMORY_DIR, 'person', 'index.md');
    const indexRaw = await waitForFileContains(
      personIndex,
      path.basename(source.path),
      'generated backlink navigation',
    );
    expect(indexRaw).toContain('Backlinks:');
    const decoyLine = indexRaw
      .split(/\r?\n/)
      .find((line) => line.includes(path.basename(decoy.path)));
    expect(decoyLine).toBeDefined();
    expect(decoyLine).not.toContain('Backlinks:');

    const provenance = await promptAndReadProvenance(
      `Recall ${sourceMarker}`,
      'default-off links',
    );
    expect(provenance.notePaths).toContain(source.path);
    expect(provenance.notePaths).not.toContain(target.path);

    const deleted = await apiResponse(`/agent-memory/${target.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(204);
    memoryIds.delete(target.id);
    expect((await readNote(source.path)).body).toBe(sourceAfterUpdate.body);
    const afterDelete = await promptAndReadProvenance(
      `Recall ${sourceMarker}`,
      'deleted link target',
    );
    expect(afterDelete.notePaths).toContain(source.path);
    expect(afterDelete.notePaths).not.toContain(target.path);

    const rootIndex = await fs.readFile(path.join(MEMORY_DIR, 'index.md'), 'utf8');
    expect(rootIndex).toContain('okf_version: "0.2"');
    expect(rootIndex).toContain('[People](person/index.md)');

    const reservedMarker = `reservedarchive${RUN_TOKEN.slice(0, 10)}`;
    const reservedPath = path.join(
      MEMORY_DIR,
      'fact',
      'LOG-ARCHIVE-1999.MD',
    );
    await fs.writeFile(reservedPath, `# 1999-01-01\n\n${reservedMarker}\n`, 'utf8');
    directFixturePaths.add(reservedPath);
    await syncVault();
    expect(await searchMemories(reservedMarker)).toEqual([]);
  }, 90_000);

  it('replaces inactive FTS hits before topN and orders comparable trust below topical relevance', async () => {
    const gateMarker = `gate${RUN_TOKEN.slice(0, 12)}`;
    const inactivePaths = [
      await writeFixtureNote('fact/00-live-gate-deprecated.md', {
        id: `gate-deprecated-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'deprecated',
      }, `${gateMarker} shared replacement deprecated.`),
      await writeFixtureNote('fact/01-live-gate-stale.md', {
        id: `gate-stale-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
        stale_after: '2000-01-01',
      }, `${gateMarker} shared replacement stale.`),
    ];
    const livePaths: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      livePaths.push(await writeFixtureNote(
        `fact/1${index}-live-gate-active.md`,
        {
          id: `gate-active-${index}-${RUN_TOKEN}`,
          kind: 'fact',
          tags: [],
          created: '2026-01-01',
          updated: '2026-01-01',
          source: 'agent',
          status: 'stable',
        },
        `${gateMarker} shared replacement active ${index}.`,
      ));
    }

    const trustMarker = `trust${RUN_TOKEN.slice(0, 12)}`;
    const machinePath = await writeFixtureNote(
      'fact/20-live-trust-machine.md',
      {
        id: `trust-machine-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
        verified: [{
          by: 'agent:fixture/1',
          at: '2026-07-26T10:00:00Z',
        }],
      },
      `${trustMarker} comparable comparable comparable evidence.`,
    );
    const humanPath = await writeFixtureNote(
      'fact/21-live-trust-human.md',
      {
        id: `trust-human-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
        verified: [{
          by: 'human:fixture@example.test',
          at: '2026-07-26T10:00:00Z',
        }],
      },
      `${trustMarker} comparable evidence evidence evidence.`,
    );

    const relevanceMarker = `relevance${RUN_TOKEN.slice(0, 12)}`;
    const strongPath = await writeFixtureNote(
      'fact/30-live-relevance-strong.md',
      {
        id: `relevance-strong-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
      },
      `${relevanceMarker} cobalt zirconium topical.`,
    );
    const weakHumanPath = await writeFixtureNote(
      'fact/31-live-relevance-weak-human.md',
      {
        id: `relevance-weak-${RUN_TOKEN}`,
        kind: 'fact',
        tags: [],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
        verified: [{
          by: 'human:fixture@example.test',
          at: '2026-07-26T10:00:00Z',
        }],
      },
      `${relevanceMarker} cobalt.`,
    );
    await syncVault();

    const explicitInactive = await searchMemories(gateMarker, 20);
    expect(explicitInactive.map(({ sourceId }) => sourceId)).toEqual(
      expect.arrayContaining(inactivePaths),
    );
    const gated = await promptAndReadProvenance(
      `${gateMarker} shared replacement`,
      'inactive replacement',
    );
    expect(gated.notePaths).toHaveLength(5);
    expect(gated.notePaths).toEqual(expect.arrayContaining(livePaths));
    for (const inactivePath of inactivePaths) {
      expect(gated.notePaths).not.toContain(inactivePath);
    }

    const trusted = await promptAndReadProvenance(
      `${trustMarker} comparable evidence`,
      'trust ordering',
    );
    expect(trusted.notePaths).toEqual(expect.arrayContaining([
      humanPath,
      machinePath,
    ]));
    expect(trusted.notePaths.indexOf(humanPath)).toBeLessThan(
      trusted.notePaths.indexOf(machinePath),
    );

    const relevant = await promptAndReadProvenance(
      `${relevanceMarker} cobalt zirconium topical`,
      'relevance ordering',
    );
    expect(relevant.notePaths).toEqual(expect.arrayContaining([
      strongPath,
      weakHumanPath,
    ]));
    expect(relevant.notePaths.indexOf(strongPath)).toBeLessThan(
      relevant.notePaths.indexOf(weakHumanPath),
    );
  }, 90_000);

  it('serializes public mutation logs, rotates old entries, and fails open on a symlinked log', async () => {
    const logPath = path.join(MEMORY_DIR, 'log.md');
    const beforeConcurrentLog = await waitForStableFile(logPath);
    const beforeConcurrentEntries = (
      beforeConcurrentLog.match(/<!-- memory-audit:/g) ?? []
    ).length;
    const concurrencyMarker = `logconcurrent${RUN_TOKEN.slice(0, 10)}`;
    const secret = `SECRET_BODY_${RUN_TOKEN}`;
    const credential = `sk_live_${RUN_TOKEN.slice(0, 16)}`;
    const credentialSlug = credential
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createMemory(
          index === 0
            ? `Credential ${credential} ${concurrencyMarker} ${index}.\n${secret}`
            : `Log concurrent ${concurrencyMarker} ${index}.\n${secret}`,
          { kind: index % 2 === 0 ? 'fact' : 'context' },
        )),
    );
    expect(concurrent).toHaveLength(12);
    const concurrentLog = await poll(async () => {
      const raw = await fs.readFile(logPath, 'utf8');
      const entryCount = (raw.match(/<!-- memory-audit:/g) ?? []).length;
      const addedEntries = entryCount - beforeConcurrentEntries;
      if (addedEntries !== 12) {
        throw new Error(`expected 12 new entries, found ${addedEntries}`);
      }
      return raw;
    }, 'serialized concurrent audit entries');
    expect(concurrentLog).not.toContain(secret);
    expect(concurrentLog).not.toContain(credential);
    expect(concurrentLog).not.toContain(credentialSlug);
    expect(concurrentLog).toMatch(/^# \d{4}-\d{2}-\d{2}$/m);
    expect(concurrentLog).toContain('**Creation**');
    expect(concurrentLog).toContain('**Update**');
    expect(concurrentLog).toContain('**Deprecation**');

    const stableLog = await waitForStableFile(logPath);
    const syntheticMarker = `rotationsynthetic${RUN_TOKEN.slice(0, 10)}`;
    const synthetic = Array.from(
      { length: 2_001 },
      (_, index) =>
        `**Creation** [Synthetic ${syntheticMarker} ${index}](/fact/synthetic-${index}.md) - fixture by process:live-e2e. <!-- memory-audit:${randomUUID()} -->`,
    );
    await fs.writeFile(
      logPath,
      `${stableLog.trimEnd()}\n\n# 2020-01-01\n\n${synthetic.join('\n')}\n`,
      'utf8',
    );
    await createMemory(
      `Rotation trigger ${RUN_TOKEN.slice(0, 12)}.`,
      { kind: 'context' },
    );
    const archivePath = path.join(MEMORY_DIR, 'log-archive-2020.md');
    directFixturePaths.add(archivePath);
    await waitForFileContains(
      archivePath,
      syntheticMarker,
      'bounded log rotation archive',
    );
    expect((await fs.readFile(logPath, 'utf8'))).not.toContain(syntheticMarker);

    await waitForStableFile(logPath);
    const backupPath = path.join(
      MEMORY_DIR,
      `.log-live-e2e-${RUN_TOKEN}.backup`,
    );
    const outsidePath = path.join(SANDBOX_ROOT, `log-outside-${RUN_TOKEN}.md`);
    directFixturePaths.add(outsidePath);
    await fs.writeFile(outsidePath, 'must remain unchanged', 'utf8');
    await fs.rename(logPath, backupPath);
    await fs.symlink(outsidePath, logPath);
    const serverLogBefore = (await fs.readFile(SERVER_LOG, 'utf8')).length;
    try {
      const failOpen = await createMemory(
        `Audit fail-open ${RUN_TOKEN.slice(0, 12)}.`,
        { kind: 'context' },
      );
      expect(failOpen.id).toBeTruthy();
      await poll(async () => {
        const tail = (await fs.readFile(SERVER_LOG, 'utf8'))
          .slice(serverLogBefore);
        if (!tail.includes('[MemoryVaultLog] append failed')) {
          throw new Error('audit failure warning not observed');
        }
        return tail;
      }, 'non-fatal symlink audit failure');
      expect(await fs.readFile(outsidePath, 'utf8')).toBe(
        'must remain unchanged',
      );
    } finally {
      await fs.rm(logPath, { force: true });
      await fs.rename(backupPath, logPath);
    }
  }, 90_000);
});
